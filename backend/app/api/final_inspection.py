"""Final inspection: admin releases it, the assigned client passes or fails it.

Flow
----
1. Staff/admin "submit" (release) the final inspection on a job. This moves the
   job from Machining into the Inspection stage and makes the form available to
   the assigned client.
2. The client opens their job, enters the inspector's name and either:
     * PASSES it (optionally with an internal reference) — the final inspection
       is marked complete and the job moves to the Completed stage; a customer
       review can then be requested; or
     * FAILS it with a written reason — the job moves to the "Inspection Failed"
       stage. The review stays locked. Each failure is numbered (1st, 2nd, …),
       logged to the timeline, and saved as a note.
3. Staff fix whatever was flagged, then release the final inspection again
   ("send for re-inspection"). The job moves back to the Inspection stage and
   the client gets the pass/fail form once more. This loops until it passes.
4. Every outcome is recorded in the attempt log, which drives the inspection
   report (full pass/fail history).
5. Only once the final inspection has PASSED can a customer review be requested
   (enforced in app/api/reviews.py).
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user, require_admin, require_staff
from app.api.jobs import (
    actor_name,
    assert_can_view,
    get_client_job_ids,
    job_has_client_access,
    log_event,
)
from app.core.database import get_db
from app.models import (
    FinalInspection,
    FinalInspectionAttempt,
    Job,
    JobCheckin,
    Note,
    User,
    UserRole,
)
from app.schemas import (
    ClosureReject,
    ClosureRequest,
    FinalInspectionFail,
    FinalInspectionOut,
    FinalInspectionSubmit,
    PendingClosureItem,
    PendingInspectionItem,
)

router = APIRouter(tags=["final-inspection"])

FAILED_STATUS = "Inspection Failed"
INSPECTION_STATUS = "Inspection"
COMPLETED_STATUS = "Completed"


def _ordinal(n: int) -> str:
    """1 -> '1st', 2 -> '2nd', 3 -> '3rd', 11 -> '11th', etc."""
    if 11 <= (n % 100) <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


async def _get_fi(db: AsyncSession, job_id: int) -> FinalInspection | None:
    result = await db.execute(
        select(FinalInspection).where(FinalInspection.job_id == job_id)
    )
    return result.scalar_one_or_none()


async def _is_checked_in(db: AsyncSession, job_id: int) -> bool:
    """True once the job's QR check-in has been completed (one-time, permanent)."""
    return bool(
        await db.scalar(
            select(JobCheckin.id)
            .where(JobCheckin.job_id == job_id)
            .where(JobCheckin.checked_in.is_(True))
            .limit(1)
        )
    )


async def _get_fi_with_log(db: AsyncSession, job_id: int) -> FinalInspection | None:
    """Load the final inspection with its attempt log eagerly (for responses)."""
    result = await db.execute(
        select(FinalInspection)
        .options(selectinload(FinalInspection.attempts_log))
        .where(FinalInspection.job_id == job_id)
    )
    return result.scalar_one_or_none()


async def _next_attempt_number(db: AsyncSession, fi_id: int) -> int:
    existing = await db.scalar(
        select(func.count())
        .select_from(FinalInspectionAttempt)
        .where(FinalInspectionAttempt.final_inspection_id == fi_id)
    )
    return (existing or 0) + 1


async def _set_status(db: AsyncSession, job: Job, new_status: str, user: User) -> None:
    if job.status != new_status:
        old = job.status
        job.status = new_status
        await log_event(
            db, job.id, "status_change", f"Status changed: {old} → {new_status}", user
        )


@router.post(
    "/jobs/{job_id}/final-inspection",
    response_model=FinalInspectionOut,
    status_code=201,
)
async def release_final_inspection(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    """Release the final inspection for client completion (idempotent).

    Creates the final-inspection record if needed and moves the job into the
    Inspection stage so the assigned client can fill it in. If the inspection
    was previously failed, this re-opens it for re-inspection (clears the
    failed result while keeping the last reason on record for context).
    """
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # The final inspection is sent to the assigned client — there must be at
    # least one, or it releases to nobody.
    if not await job_has_client_access(db, job_id):
        raise HTTPException(
            status_code=409,
            detail="Assign at least one client under the Client Access tab before "
            "releasing the final inspection.",
        )

    fi = await _get_fi(db, job_id)

    if not fi:
        # First release — only allowed once the QR check-in is done.
        if not await _is_checked_in(db, job_id):
            raise HTTPException(
                status_code=409,
                detail="Scan the QR code to check the job in before releasing "
                "the final inspection.",
            )
        fi = FinalInspection(job_id=job_id, requested_by_id=user.id)
        db.add(fi)
        await log_event(db, job_id, "final_inspection", "Final inspection released", user)
        await _set_status(db, job, INSPECTION_STATUS, user)
    elif fi.completed:
        # Already passed — nothing to release.
        return await _get_fi_with_log(db, job_id)
    elif fi.result == "failed":
        # Re-inspection: reopen the form, keep failure_reason for reference.
        fi.result = None
        await log_event(
            db,
            job_id,
            "final_inspection",
            f"Sent for re-inspection (attempt {fi.attempts + 1})",
            user,
        )
        await _set_status(db, job, INSPECTION_STATUS, user)
    else:
        # Already released and pending — just make sure the stage is right.
        await _set_status(db, job, INSPECTION_STATUS, user)

    await db.commit()
    return await _get_fi_with_log(db, job_id)


@router.post(
    "/jobs/{job_id}/final-inspection/cancel",
    response_model=FinalInspectionOut | None,
)
async def cancel_final_inspection(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    """Un-release a final inspection that's sitting with the client unactioned.

    Covers the "released but no inspector on the client's side" case: staff
    pull the job back out of the Inspection stage so they can either fix
    something first or request closure instead. Not allowed once the client
    has actually passed it, while a closure request is pending admin review,
    or while it's mid-way through a client-side fail.
    """
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    fi = await _get_fi(db, job_id)
    if not fi or fi.completed:
        raise HTTPException(
            status_code=409, detail="There's no released inspection to cancel."
        )
    if fi.closure_status == CLOSURE_PENDING:
        raise HTTPException(
            status_code=409,
            detail="A closure request is pending — approve or reject that first.",
        )
    if fi.result == "failed":
        raise HTTPException(
            status_code=409,
            detail="This inspection was already failed by the client — send it "
            "for re-inspection or request closure instead of cancelling.",
        )

    if fi.attempts > 0:
        # This release was a re-inspection after an earlier client failure —
        # cancelling puts it back exactly where that failure left it, keeping
        # the failure history intact.
        fi.result = "failed"
        await log_event(
            db, job_id, "final_inspection", "Re-inspection cancelled", user
        )
        await _set_status(db, job, FAILED_STATUS, user)
        await db.commit()
        return await _get_fi_with_log(db, job_id)

    # First-time release, never failed, nothing logged yet — fully undo it.
    await log_event(db, job_id, "final_inspection", "Final inspection cancelled", user)
    await db.delete(fi)
    await _set_status(db, job, "Machining", user)
    await db.commit()
    return None


@router.get("/final-inspection/pending", response_model=list[PendingInspectionItem])
async def pending_final_inspections(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Final inspections released and awaiting the current user's sign-off.

    Drives the client login banner. A job appears here once staff release the
    final inspection (or send a re-inspection) and disappears once the client
    passes it (completed) or fails it (result == "failed", i.e. back with the
    workshop). Clients only see jobs they're assigned to.
    """
    query = (
        select(Job, FinalInspection)
        .join(FinalInspection, FinalInspection.job_id == Job.id)
        .where(FinalInspection.completed.is_(False))
        .where(FinalInspection.result.is_(None))
        # If staff have requested closure (client isn't going to inspect), stop
        # nagging the client about this job.
        .where(FinalInspection.closure_status.is_distinct_from("pending"))
        .order_by(Job.sequence.desc())
    )
    if user.role == UserRole.client.value:
        allowed = await get_client_job_ids(db, user.id)
        if not allowed:
            return []
        query = query.where(Job.id.in_(allowed))

    rows = (await db.execute(query)).all()
    return [
        PendingInspectionItem(
            job_id=job.id,
            job_number=job.job_number,
            customer_name=job.customer_name,
            attempts=fi.attempts,
            is_reinspection=fi.attempts > 0,
        )
        for job, fi in rows
    ]


@router.get("/jobs/{job_id}/final-inspection", response_model=FinalInspectionOut | None)
async def get_final_inspection(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await assert_can_view(db, job, user)
    return await _get_fi_with_log(db, job_id)


@router.put("/jobs/{job_id}/final-inspection", response_model=FinalInspectionOut)
async def submit_final_inspection(
    job_id: int,
    payload: FinalInspectionSubmit,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Pass the final inspection (assigned client, or staff). Moves to Completed."""
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await assert_can_view(db, job, user)

    fi = await _get_fi(db, job_id)
    if not fi:
        raise HTTPException(
            status_code=404, detail="Final inspection is not available yet"
        )
    if fi.completed:
        raise HTTPException(
            status_code=409, detail="This final inspection has already been submitted"
        )
    if fi.result == "failed":
        raise HTTPException(
            status_code=409,
            detail="This inspection was failed — the workshop must send it for "
            "re-inspection before it can be passed.",
        )

    name = (payload.inspector_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Inspector name is required")
    reference = (payload.internal_reference or "").strip() or None

    fi.inspector_name = name
    fi.internal_reference = reference
    fi.result = "passed"
    fi.completed = True
    fi.completed_by_id = user.id
    fi.completed_at = datetime.now(timezone.utc)

    attempt_no = await _next_attempt_number(db, fi.id)
    db.add(
        FinalInspectionAttempt(
            job_id=job_id,
            final_inspection_id=fi.id,
            attempt_number=attempt_no,
            result="passed",
            inspector_name=name,
            internal_reference=reference,
            created_by_id=user.id,
        )
    )

    await log_event(
        db, job_id, "final_inspection", f"Final inspection passed by {name}", user
    )
    await _set_status(db, job, COMPLETED_STATUS, user)

    await db.commit()
    return await _get_fi_with_log(db, job_id)


@router.post("/jobs/{job_id}/final-inspection/fail", response_model=FinalInspectionOut)
async def fail_final_inspection(
    job_id: int,
    payload: FinalInspectionFail,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Fail the final inspection with a reason (assigned client, or staff).

    Moves the job to the "Inspection Failed" stage and records why. The reason
    is saved as a numbered note (1st/2nd/… failure) and to the attempt log; the
    review stays locked until a later attempt passes.
    """
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await assert_can_view(db, job, user)

    fi = await _get_fi(db, job_id)
    if not fi:
        raise HTTPException(
            status_code=404, detail="Final inspection is not available yet"
        )
    if fi.completed:
        raise HTTPException(
            status_code=409,
            detail="This final inspection has already passed and can't be failed.",
        )
    if fi.result == "failed":
        raise HTTPException(
            status_code=409,
            detail="This inspection is already marked failed and is awaiting "
            "re-inspection.",
        )

    name = (payload.inspector_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Inspector name is required")
    reason = (payload.reason or "").strip()
    if not reason:
        raise HTTPException(
            status_code=400, detail="A reason is required to fail the inspection"
        )
    ncr_number = (payload.ncr_number or "").strip() or None

    fi.inspector_name = name
    fi.result = "failed"
    fi.failure_reason = reason
    fi.ncr_number = ncr_number
    fi.attempts += 1
    fi.failed_by_id = user.id
    fi.failed_at = datetime.now(timezone.utc)

    ordinal = _ordinal(fi.attempts)  # 1st / 2nd / 3rd failure

    attempt_no = await _next_attempt_number(db, fi.id)
    db.add(
        FinalInspectionAttempt(
            job_id=job_id,
            final_inspection_id=fi.id,
            attempt_number=attempt_no,
            result="failed",
            inspector_name=name,
            reason=reason,
            ncr_number=ncr_number,
            created_by_id=user.id,
        )
    )

    # Persist the reason as a numbered note so the order is clear in the notes,
    # and log it to the timeline.
    note_body = f"Final inspection failed ({ordinal} attempt) by {name}: {reason}"
    log_detail = note_body
    if ncr_number:
        note_body += f" (NCR {ncr_number})"
        log_detail += f" (NCR {ncr_number})"
    db.add(
        Note(
            job_id=job_id,
            note_type="action",
            body=note_body,
            author_id=user.id,
            author_name=actor_name(user),
        )
    )
    await log_event(
        db,
        job_id,
        "final_inspection",
        log_detail,
        user,
    )
    await _set_status(db, job, FAILED_STATUS, user)

    await db.commit()
    return await _get_fi_with_log(db, job_id)


# ---------------------------------------------------------------------------
# Request for closure — used when a client won't do the final inspection.
#
# Staff request closure; an admin approves it. On approval the inspection is
# passed *internally* (no client sign-off) and the job moves to Completed, the
# same terminal state as a normal client pass — so the review unlocks and the
# rest of the app behaves identically. The normal client submit/pass/fail flow
# above is left completely untouched; this is a separate, parallel path.
# ---------------------------------------------------------------------------

CLOSURE_PENDING = "pending"
CLOSURE_APPROVED = "approved"
CLOSURE_REJECTED = "rejected"


def _closure_inspector_label(admin: User) -> str:
    return f"Internal closure — approved by {actor_name(admin)}"


@router.post(
    "/jobs/{job_id}/final-inspection/closure-request",
    response_model=FinalInspectionOut,
)
async def request_closure(
    job_id: int,
    payload: ClosureRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    """Staff request to close a job out without a client final inspection.

    Creates the final-inspection record first if it doesn't exist yet (so a
    closure can be requested even before the inspection is released), but does
    NOT move the job into the Inspection stage and does NOT nag the client. The
    request then waits for an admin to approve or reject it.
    """
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    fi = await _get_fi(db, job_id)

    if fi and fi.completed:
        raise HTTPException(
            status_code=409,
            detail="This inspection has already passed — there's nothing to close.",
        )
    if fi and fi.closure_status == CLOSURE_PENDING:
        raise HTTPException(
            status_code=409,
            detail="A closure request is already pending admin approval.",
        )

    if not fi:
        # First time we touch this job's inspection — require the QR check-in,
        # same gate as releasing the inspection normally.
        if not await _is_checked_in(db, job_id):
            raise HTTPException(
                status_code=409,
                detail="Scan the QR code to check the job in before requesting "
                "closure.",
            )
        fi = FinalInspection(job_id=job_id, requested_by_id=user.id)
        db.add(fi)
        await db.flush()  # assign fi.id

    reason = (payload.reason or "").strip() or None

    fi.closure_status = CLOSURE_PENDING
    fi.closure_reason = reason
    fi.closure_requested_by_id = user.id
    fi.closure_requested_at = datetime.now(timezone.utc)
    # Clear any previous decision so a re-request starts clean.
    fi.closure_decided_by_id = None
    fi.closure_decided_at = None
    fi.closure_rejection_reason = None

    detail = "Closure requested (client to skip final inspection)"
    if reason:
        detail += f": {reason}"
    db.add(
        Note(
            job_id=job_id,
            note_type="action",
            body=detail,
            author_id=user.id,
            author_name=actor_name(user),
        )
    )
    await log_event(db, job_id, "final_inspection", detail, user)

    await db.commit()
    return await _get_fi_with_log(db, job_id)


@router.get(
    "/final-inspection/closure-pending",
    response_model=list[PendingClosureItem],
)
async def pending_closures(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Closure requests awaiting an admin decision (drives the admin banner)."""
    requester = User.__table__.alias("requester")
    query = (
        select(Job, FinalInspection, requester.c.full_name, requester.c.username)
        .join(FinalInspection, FinalInspection.job_id == Job.id)
        .join(
            requester,
            requester.c.id == FinalInspection.closure_requested_by_id,
            isouter=True,
        )
        .where(FinalInspection.closure_status == CLOSURE_PENDING)
        .order_by(FinalInspection.closure_requested_at.asc())
    )
    rows = (await db.execute(query)).all()
    return [
        PendingClosureItem(
            job_id=job.id,
            job_number=job.job_number,
            customer_name=job.customer_name,
            reason=fi.closure_reason,
            requested_by=full_name or username,
            requested_at=fi.closure_requested_at,
        )
        for job, fi, full_name, username in rows
    ]


@router.post(
    "/jobs/{job_id}/final-inspection/closure-approve",
    response_model=FinalInspectionOut,
)
async def approve_closure(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Admin approves a closure request: inspection passes internally."""
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    fi = await _get_fi(db, job_id)
    if not fi or fi.closure_status != CLOSURE_PENDING:
        raise HTTPException(
            status_code=409, detail="There's no pending closure request to approve."
        )
    if fi.completed:
        raise HTTPException(
            status_code=409, detail="This inspection has already passed."
        )

    label = _closure_inspector_label(user)
    now = datetime.now(timezone.utc)

    fi.result = "passed"
    fi.completed = True
    fi.completed_by_id = user.id
    fi.completed_at = now
    fi.inspector_name = label
    if not fi.internal_reference and fi.closure_reason:
        fi.internal_reference = fi.closure_reason

    fi.closure_status = CLOSURE_APPROVED
    fi.closure_decided_by_id = user.id
    fi.closure_decided_at = now

    attempt_no = await _next_attempt_number(db, fi.id)
    db.add(
        FinalInspectionAttempt(
            job_id=job_id,
            final_inspection_id=fi.id,
            attempt_number=attempt_no,
            result="passed",
            inspector_name=label,
            internal_reference=fi.closure_reason,
            created_by_id=user.id,
        )
    )

    detail = "Closure approved — final inspection passed internally"
    db.add(
        Note(
            job_id=job_id,
            note_type="action",
            body=detail,
            author_id=user.id,
            author_name=actor_name(user),
        )
    )
    await log_event(db, job_id, "final_inspection", detail, user)
    # Closure bypasses the client entirely, so there's no review coming to move
    # it Completed -> Closed the normal way — go straight to Closed.
    await _set_status(db, job, "Closed", user)

    await db.commit()
    return await _get_fi_with_log(db, job_id)


@router.post(
    "/jobs/{job_id}/final-inspection/closure-reject",
    response_model=FinalInspectionOut,
)
async def reject_closure(
    job_id: int,
    payload: ClosureReject,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Admin declines a closure request. The job is left where it is so staff
    can either re-request closure or run the normal client inspection."""
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    fi = await _get_fi(db, job_id)
    if not fi or fi.closure_status != CLOSURE_PENDING:
        raise HTTPException(
            status_code=409, detail="There's no pending closure request to reject."
        )

    reason = (payload.reason or "").strip() or None
    fi.closure_status = CLOSURE_REJECTED
    fi.closure_decided_by_id = user.id
    fi.closure_decided_at = datetime.now(timezone.utc)
    fi.closure_rejection_reason = reason

    detail = "Closure request declined by admin"
    if reason:
        detail += f": {reason}"
    db.add(
        Note(
            job_id=job_id,
            note_type="action",
            body=detail,
            author_id=user.id,
            author_name=actor_name(user),
        )
    )
    await log_event(db, job_id, "final_inspection", detail, user)

    await db.commit()
    return await _get_fi_with_log(db, job_id)
