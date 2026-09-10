"""Training sign-off records — a lightweight audit trail for who's been
trained on which parts of WorkshopIQ, captured with a drawn signature.

Not a gate on anything else in the app; it's purely a compliance record for
store day sign-offs, so staff can log a session and admins can pull a report
of who's been trained on what.

Workers being trained are frequently workshop floor staff (e.g. Kevin,
Sammy, Hendrick) who don't have a WorkshopIQ login at all — training records
aren't tied to user accounts. `worker_name` is always the source of truth;
`user_id` is only set as a convenience link when the person happens to also
be a system user (staff/admin).
"""
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin, require_staff
from app.core.database import get_db
from app.models import TrainingRecord, User, UserRole

router = APIRouter(prefix="/training-records", tags=["training"])


class TrainingRecordCreate(BaseModel):
    worker_name: str
    user_id: int | None = None
    topics: list[str]
    signature_png: str
    notes: str | None = None


def _serialize(r: TrainingRecord) -> dict:
    try:
        topics = json.loads(r.topics)
        if not isinstance(topics, list):
            topics = []
    except (TypeError, ValueError):
        topics = []
    return {
        "id": r.id,
        "user_id": r.user_id,
        "worker_name": r.worker_name,
        "topics": topics,
        "signature_png": r.signature_png,
        "trained_by_name": r.trained_by_name,
        "notes": r.notes,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


@router.get("/workers")
async def list_workers(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_staff),
):
    """Names for the sign-off form's worker picker.

    Combines active staff/admin logins with every worker name that's ever
    been typed into a training record before — that second group is how
    floor staff with no WorkshopIQ account (Kevin, Sammy, Hendrick, etc.)
    show up and stay selectable on repeat visits, without needing a
    separate employee roster to maintain.
    """
    users = (
        await db.execute(
            select(User)
            .where(User.role.in_([UserRole.administrator.value, UserRole.staff.value]))
            .where(User.is_active.is_(True))
            .order_by(User.full_name)
        )
    ).scalars().all()

    seen: set[str] = set()
    workers: list[dict] = []
    for u in users:
        name = u.full_name or u.username
        workers.append({"id": u.id, "full_name": name})
        seen.add(name.strip().lower())

    prior_names = (
        await db.execute(select(TrainingRecord.worker_name).distinct())
    ).scalars().all()
    for name in prior_names:
        if name and name.strip().lower() not in seen:
            workers.append({"id": None, "full_name": name})
            seen.add(name.strip().lower())

    workers.sort(key=lambda w: w["full_name"].lower())
    return workers


@router.get("")
async def list_records(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    rows = (
        await db.execute(
            select(TrainingRecord).order_by(TrainingRecord.created_at.desc())
        )
    ).scalars().all()
    return [_serialize(r) for r in rows]


@router.post("", status_code=201)
async def create_record(
    payload: TrainingRecordCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    name = payload.worker_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Worker name is required")
    if not payload.topics:
        raise HTTPException(status_code=400, detail="Select at least one topic")
    if not payload.signature_png:
        raise HTTPException(status_code=400, detail="A signature is required")

    linked_user_id: int | None = None
    if payload.user_id is not None:
        linked = await db.get(User, payload.user_id)
        if linked:
            linked_user_id = linked.id
            name = linked.full_name or linked.username

    record = TrainingRecord(
        user_id=linked_user_id,
        worker_name=name,
        topics=json.dumps(payload.topics),
        signature_png=payload.signature_png,
        trained_by_id=user.id,
        trained_by_name=user.full_name or user.username,
        notes=(payload.notes or "").strip() or None,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return _serialize(record)


@router.delete("/{record_id}", status_code=204)
async def delete_record(
    record_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    record = await db.get(TrainingRecord, record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Record not found")
    await db.delete(record)
    await db.commit()
