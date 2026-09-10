"""Customer satisfaction review endpoints.

Staff/admin request a review on a job. The assigned client is nagged on every
login (via GET /reviews/pending) until they submit a 1-5 star rating plus
optional feedback, after which the job's review is marked complete and the nag
stops.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_staff
from app.api.jobs import (
    actor_name,
    assert_can_view,
    get_client_job_ids,
    job_has_client_access,
    log_event,
)
from app.core.database import get_db
from app.models import FinalInspection, Job, JobReview, ReviewSeen, User, UserRole
from app.schemas import (
    MarkSeenRequest,
    PendingReviewItem,
    ReviewNotification,
    ReviewOut,
    ReviewSubmit,
)

router = APIRouter(tags=["reviews"])


async def _get_review(db: AsyncSession, job_id: int) -> JobReview | None:
    result = await db.execute(
        select(JobReview).where(JobReview.job_id == job_id)
    )
    return result.scalar_one_or_none()


@router.post("/jobs/{job_id}/review", response_model=ReviewOut, status_code=201)
async def request_review(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    """Request a customer review for a job (idempotent)."""
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # The review is sent to the assigned client — there must be at least one.
    if not await job_has_client_access(db, job_id):
        raise HTTPException(
            status_code=409,
            detail="Assign at least one client under the Client Access tab before "
            "requesting a review.",
        )

    # A review can only be requested once the final inspection is complete.
    fi_result = await db.execute(
        select(FinalInspection).where(FinalInspection.job_id == job_id)
    )
    final_inspection = fi_result.scalar_one_or_none()
    if not final_inspection or not final_inspection.completed:
        raise HTTPException(
            status_code=409,
            detail="Complete the final inspection before requesting a review",
        )

    review = await _get_review(db, job_id)
    if review:
        return review  # already requested (completed or not)

    review = JobReview(job_id=job_id, requested_by_id=user.id)
    db.add(review)
    await log_event(db, job_id, "review", "Customer review requested", user)
    if job.status != "Awaiting Customer Review":
        old = job.status
        job.status = "Awaiting Customer Review"
        await log_event(
            db,
            job_id,
            "status_change",
            f"Status changed: {old} → Awaiting Customer Review",
            user,
        )
    await db.commit()
    await db.refresh(review)
    return review


@router.post(
    "/jobs/{job_id}/review/skip-inspection",
    response_model=ReviewOut,
    status_code=201,
)
async def skip_inspection_request_review(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    """Skip the final inspection and send the job straight to the client for a
    review.

    For jobs where no inspector is coming out: instead of a formal final
    inspection sign-off, the client's review becomes the acceptance. Submitting
    the review auto-closes the job the normal way (see submit_review). If the
    client never reviews, staff can still fall back to Request closure — that
    path is untouched. Any staff member can trigger this; no admin approval,
    because the client's own review is the sign-off.
    """
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status == "Closed":
        raise HTTPException(status_code=409, detail="This job is already closed.")

    # The review is sent to the assigned client — there must be at least one.
    if not await job_has_client_access(db, job_id):
        raise HTTPException(
            status_code=409,
            detail="Assign at least one client under the Client Access tab before "
            "sending the job for review.",
        )

    # Don't collide with the inspection / closure paths.
    fi_result = await db.execute(
        select(FinalInspection).where(FinalInspection.job_id == job_id)
    )
    final_inspection = fi_result.scalar_one_or_none()
    if final_inspection and final_inspection.completed:
        raise HTTPException(
            status_code=409,
            detail="The final inspection is already complete — request the review normally.",
        )
    if final_inspection and final_inspection.closure_status == "pending":
        raise HTTPException(
            status_code=409,
            detail="A closure request is pending admin approval — decide that first.",
        )

    review = await _get_review(db, job_id)
    if review:
        return review  # already requested (completed or not)

    review = JobReview(job_id=job_id, requested_by_id=user.id)
    db.add(review)
    await log_event(
        db,
        job_id,
        "review",
        "Final inspection skipped — job sent to customer for review",
        user,
    )
    if job.status != "Awaiting Customer Review":
        old = job.status
        job.status = "Awaiting Customer Review"
        await log_event(
            db,
            job_id,
            "status_change",
            f"Status changed: {old} → Awaiting Customer Review",
            user,
        )
    await db.commit()
    await db.refresh(review)
    return review


@router.get("/jobs/{job_id}/review", response_model=ReviewOut | None)
async def get_review(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await assert_can_view(db, job, user)
    return await _get_review(db, job_id)


@router.put("/jobs/{job_id}/review", response_model=ReviewOut)
async def submit_review(
    job_id: int,
    payload: ReviewSubmit,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Submit the review. The assigned client (or staff) records the rating."""
    if not 1 <= payload.rating <= 5:
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")

    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await assert_can_view(db, job, user)

    review = await _get_review(db, job_id)
    if not review:
        raise HTTPException(status_code=404, detail="No review has been requested for this job")
    if review.completed:
        raise HTTPException(status_code=409, detail="This review has already been submitted")

    review.rating = payload.rating
    review.feedback = (payload.feedback or "").strip() or None
    review.improvement = (payload.improvement or "").strip() or None
    review.completed = True
    review.reviewer_id = user.id
    review.reviewer_name = actor_name(user)
    review.completed_at = datetime.now(timezone.utc)

    await log_event(
        db, job_id, "review", f"Customer review submitted ({payload.rating}/5)", user
    )
    if job.status != "Closed":
        old = job.status
        job.status = "Closed"
        await log_event(
            db, job_id, "status_change", f"Status changed: {old} → Closed", user
        )
    await db.commit()
    await db.refresh(review)
    return review


@router.get("/reviews/pending", response_model=list[PendingReviewItem])
async def pending_reviews(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Jobs awaiting a review from the current user (drives the login nag)."""
    query = (
        select(Job)
        .join(JobReview, JobReview.job_id == Job.id)
        .where(JobReview.completed.is_(False))
        # A job that's already been closed by another path (e.g. an approved
        # closure request after a skipped inspection) should stop nagging for a
        # review it will never receive.
        .where(Job.status != "Closed")
        .order_by(Job.sequence.desc())
    )
    if user.role == UserRole.client.value:
        allowed = await get_client_job_ids(db, user.id)
        if not allowed:
            return []
        query = query.where(Job.id.in_(allowed))

    rows = (await db.execute(query)).scalars().all()
    return [
        PendingReviewItem(
            job_id=j.id, job_number=j.job_number, customer_name=j.customer_name
        )
        for j in rows
    ]


@router.get("/reviews/notifications", response_model=list[ReviewNotification])
async def review_notifications(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    """Completed reviews this staff/admin user hasn't been notified about yet.

    One-time per user: each completed review appears once per user, then is
    marked seen (via POST /reviews/notifications/seen) so it won't reappear.
    Other users still get their own first-time notice independently.
    """
    seen_subq = select(ReviewSeen.review_id).where(ReviewSeen.user_id == user.id)
    query = (
        select(JobReview, Job)
        .join(Job, Job.id == JobReview.job_id)
        .where(JobReview.completed.is_(True))
        .where(JobReview.id.notin_(seen_subq))
        .where(or_(JobReview.reviewer_id.is_(None), JobReview.reviewer_id != user.id))
        .order_by(JobReview.completed_at.desc())
    )
    rows = (await db.execute(query)).all()
    return [
        ReviewNotification(
            review_id=rev.id,
            job_id=job.id,
            job_number=job.job_number,
            customer_name=job.customer_name,
            rating=rev.rating,
            reviewer_name=rev.reviewer_name,
            completed_at=rev.completed_at,
        )
        for rev, job in rows
    ]


@router.post("/reviews/notifications/seen", status_code=204)
async def mark_notifications_seen(
    payload: MarkSeenRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    """Mark the given completed-review notifications as seen for this user."""
    if not payload.review_ids:
        return
    existing = set(
        (
            await db.execute(
                select(ReviewSeen.review_id).where(
                    ReviewSeen.user_id == user.id,
                    ReviewSeen.review_id.in_(payload.review_ids),
                )
            )
        ).scalars().all()
    )
    for rid in payload.review_ids:
        if rid not in existing:
            db.add(ReviewSeen(user_id=user.id, review_id=rid))
    await db.commit()
