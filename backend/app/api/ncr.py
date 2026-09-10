"""Non-Conformance Reports (NCRs) — internal quality records.

Staff/admin raise an NCR, optionally linked to a job, and work it through an
Open → In Progress → Closed lifecycle. NCRs are internal: clients have no
access. When linked to a job, key actions are logged to that job's timeline.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_admin, require_staff
from app.api.jobs import actor_name, log_event
from app.core.database import get_db
from app.models import NCR, Job, User
from app.schemas import NCRCreate, NCRListOut, NCROut, NCRUpdate
from app.services.settings_service import next_ncr_number
from app.services.templates_data import (
    NCR_CATEGORIES,
    NCR_DISPOSITIONS,
    NCR_SEVERITIES,
    NCR_SOURCES,
    NCR_STATUSES,
)

router = APIRouter(prefix="/ncrs", tags=["ncrs"])


def _validate(field: str, value: str | None, allowed: list[str]) -> None:
    if value is not None and value not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid {field}: {value}")


@router.get("/meta")
async def ncr_meta(_: User = Depends(require_staff)):
    """Option lists for the NCR form dropdowns."""
    return {
        "categories": NCR_CATEGORIES,
        "severities": NCR_SEVERITIES,
        "sources": NCR_SOURCES,
        "dispositions": NCR_DISPOSITIONS,
        "statuses": NCR_STATUSES,
    }


@router.get("", response_model=list[NCRListOut])
async def list_ncrs(
    status: str | None = None,
    job_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_staff),
):
    query = select(NCR).order_by(NCR.sequence.desc())
    if status:
        query = query.where(NCR.status == status)
    if job_id is not None:
        query = query.where(NCR.job_id == job_id)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("", response_model=NCROut, status_code=201)
async def create_ncr(
    payload: NCRCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="Title is required")
    if not payload.description.strip():
        raise HTTPException(status_code=400, detail="Description is required")
    _validate("category", payload.category, NCR_CATEGORIES)
    _validate("severity", payload.severity, NCR_SEVERITIES)
    _validate("source", payload.source, NCR_SOURCES)
    _validate("disposition", payload.disposition, NCR_DISPOSITIONS)

    job_number = None
    if payload.job_id is not None:
        job = await db.get(Job, payload.job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Linked job not found")
        job_number = job.job_number

    ncr_number, sequence = await next_ncr_number(db)
    ncr = NCR(
        ncr_number=ncr_number,
        sequence=sequence,
        job_id=payload.job_id,
        job_number=job_number,
        title=payload.title.strip(),
        description=payload.description.strip(),
        category=payload.category,
        severity=payload.severity,
        source=payload.source,
        disposition=payload.disposition,
        root_cause=(payload.root_cause or "").strip() or None,
        corrective_action=(payload.corrective_action or "").strip() or None,
        assigned_to=(payload.assigned_to or "").strip() or None,
        status="Open",
        raised_by_id=user.id,
        raised_by_name=actor_name(user),
    )
    db.add(ncr)

    if payload.job_id is not None:
        await log_event(
            db,
            payload.job_id,
            "ncr",
            f"{ncr_number} raised ({ncr.severity}): {ncr.title}",
            user,
        )

    await db.commit()
    await db.refresh(ncr)
    return ncr


@router.get("/{ncr_id}", response_model=NCROut)
async def get_ncr(
    ncr_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_staff),
):
    ncr = await db.get(NCR, ncr_id)
    if not ncr:
        raise HTTPException(status_code=404, detail="NCR not found")
    return ncr


@router.put("/{ncr_id}", response_model=NCROut)
async def update_ncr(
    ncr_id: int,
    payload: NCRUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    ncr = await db.get(NCR, ncr_id)
    if not ncr:
        raise HTTPException(status_code=404, detail="NCR not found")

    _validate("category", payload.category, NCR_CATEGORIES)
    _validate("severity", payload.severity, NCR_SEVERITIES)
    _validate("source", payload.source, NCR_SOURCES)
    _validate("disposition", payload.disposition, NCR_DISPOSITIONS)
    _validate("status", payload.status, NCR_STATUSES)

    # Re-link / unlink to a job (refresh the job_number snapshot).
    if payload.job_id is not None and payload.job_id != ncr.job_id:
        if payload.job_id == 0:
            ncr.job_id = None
            ncr.job_number = None
        else:
            job = await db.get(Job, payload.job_id)
            if not job:
                raise HTTPException(status_code=404, detail="Linked job not found")
            ncr.job_id = job.id
            ncr.job_number = job.job_number
            await log_event(
                db, job.id, "ncr", f"{ncr.ncr_number} linked to this job", user
            )

    for field in (
        "title",
        "description",
        "category",
        "severity",
        "source",
        "disposition",
        "root_cause",
        "corrective_action",
        "assigned_to",
    ):
        value = getattr(payload, field)
        if value is not None:
            cleaned = value.strip() if isinstance(value, str) else value
            if field in ("root_cause", "corrective_action", "assigned_to"):
                cleaned = cleaned or None
            setattr(ncr, field, cleaned)

    if payload.status is not None and payload.status != ncr.status:
        old = ncr.status
        ncr.status = payload.status
        if payload.status == "Closed":
            ncr.closed_at = datetime.now(timezone.utc)
            ncr.closed_by_name = actor_name(user)
        else:
            ncr.closed_at = None
            ncr.closed_by_name = None
        if ncr.job_id is not None:
            await log_event(
                db,
                ncr.job_id,
                "ncr",
                f"{ncr.ncr_number} status: {old} → {payload.status}",
                user,
            )

    await db.commit()
    await db.refresh(ncr)
    return ncr


@router.delete("/{ncr_id}", status_code=204)
async def delete_ncr(
    ncr_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    ncr = await db.get(NCR, ncr_id)
    if not ncr:
        raise HTTPException(status_code=404, detail="NCR not found")
    await db.delete(ncr)
    await db.commit()
