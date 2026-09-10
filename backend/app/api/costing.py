"""Per-job costing: internal supplier prices for staff/admin only.

Every route here is guarded by ``require_staff`` (administrator or staff), so a
client account is rejected with 403. Cost items are deliberately kept off the
job-detail payload and the job timeline (both of which clients can see), so this
data never leaks to a client by any path.
"""
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_staff
from app.core.database import get_db
from app.models import Job, JobCostItem, User
from app.schemas import JobCostItemCreate, JobCostItemOut, JobCostItemUpdate

router = APIRouter(prefix="/jobs", tags=["costing"])


def _actor(user: User) -> str:
    return user.full_name or user.username


def _to_decimal(value: float, field: str) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid {field}")


async def _require_job(db: AsyncSession, job_id: int) -> Job:
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/{job_id}/costs", response_model=list[JobCostItemOut])
async def list_costs(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_staff),
):
    await _require_job(db, job_id)
    result = await db.execute(
        select(JobCostItem)
        .where(JobCostItem.job_id == job_id)
        .order_by(JobCostItem.created_at)
    )
    return result.scalars().all()


@router.post("/{job_id}/costs", response_model=JobCostItemOut, status_code=201)
async def add_cost(
    job_id: int,
    payload: JobCostItemCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    await _require_job(db, job_id)
    description = payload.description.strip()
    if not description:
        raise HTTPException(status_code=400, detail="Description is required")
    item = JobCostItem(
        job_id=job_id,
        description=description,
        supplier=(payload.supplier or "").strip() or None,
        quantity=_to_decimal(payload.quantity, "quantity"),
        unit_cost=_to_decimal(payload.unit_cost, "unit cost"),
        note=(payload.note or "").strip() or None,
        created_by_id=user.id,
        created_by_name=_actor(user),
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.put("/{job_id}/costs/{item_id}", response_model=JobCostItemOut)
async def update_cost(
    job_id: int,
    item_id: int,
    payload: JobCostItemUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_staff),
):
    item = await db.get(JobCostItem, item_id)
    if not item or item.job_id != job_id:
        raise HTTPException(status_code=404, detail="Cost item not found")
    if payload.description is not None:
        desc = payload.description.strip()
        if not desc:
            raise HTTPException(status_code=400, detail="Description cannot be empty")
        item.description = desc
    if payload.supplier is not None:
        item.supplier = payload.supplier.strip() or None
    if payload.quantity is not None:
        item.quantity = _to_decimal(payload.quantity, "quantity")
    if payload.unit_cost is not None:
        item.unit_cost = _to_decimal(payload.unit_cost, "unit cost")
    if payload.note is not None:
        item.note = payload.note.strip() or None
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/{job_id}/costs/{item_id}", status_code=204)
async def delete_cost(
    job_id: int,
    item_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_staff),
):
    item = await db.get(JobCostItem, item_id)
    if not item or item.job_id != job_id:
        raise HTTPException(status_code=404, detail="Cost item not found")
    await db.delete(item)
    await db.commit()
