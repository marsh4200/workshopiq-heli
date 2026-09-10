"""Admin-editable pick-lists for the public QR check-in form.

Every deployment defines its own operators and machines here (Administration
-> Check-in Lists in the UI) instead of the code shipping a fixed list baked
in for one specific workshop. ``app.api.checkin`` reads these same rows to
build the two dropdowns on the public check-in page.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_admin
from app.core.database import get_db
from app.models import CheckinListItem, User

router = APIRouter(prefix="/checkin-lists", tags=["checkin-lists"])

KINDS = ("operator", "machine")


class ItemOut(BaseModel):
    id: int
    kind: str
    label: str
    order_index: int

    class Config:
        from_attributes = True


class ItemCreate(BaseModel):
    kind: str
    label: str = Field(min_length=1, max_length=255)


class ItemUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=255)
    order_index: int | None = None


def _check_kind(kind: str) -> None:
    if kind not in KINDS:
        raise HTTPException(
            status_code=400, detail="kind must be 'operator' or 'machine'"
        )


@router.get("", response_model=dict[str, list[ItemOut]])
async def list_checkin_lists(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Both lists at once, each already in display order."""
    result = await db.execute(
        select(CheckinListItem).order_by(
            CheckinListItem.kind, CheckinListItem.order_index, CheckinListItem.id
        )
    )
    items = result.scalars().all()
    return {
        "operators": [i for i in items if i.kind == "operator"],
        "machines": [i for i in items if i.kind == "machine"],
    }


@router.post("", response_model=ItemOut, status_code=201)
async def create_checkin_item(
    payload: ItemCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    _check_kind(payload.kind)
    label = payload.label.strip()
    if not label:
        raise HTTPException(status_code=400, detail="Label is required")
    existing = await db.scalar(
        select(CheckinListItem.id).where(
            CheckinListItem.kind == payload.kind, CheckinListItem.label == label
        )
    )
    if existing:
        raise HTTPException(status_code=400, detail="Already in the list")
    max_order = await db.scalar(
        select(func.max(CheckinListItem.order_index)).where(
            CheckinListItem.kind == payload.kind
        )
    )
    item = CheckinListItem(
        kind=payload.kind, label=label, order_index=(max_order or 0) + 1
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.put("/{item_id}", response_model=ItemOut)
async def update_checkin_item(
    item_id: int,
    payload: ItemUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    item = await db.get(CheckinListItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    if payload.label is not None:
        label = payload.label.strip()
        if not label:
            raise HTTPException(status_code=400, detail="Label is required")
        item.label = label
    if payload.order_index is not None:
        item.order_index = payload.order_index
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
async def delete_checkin_item(
    item_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    item = await db.get(CheckinListItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    await db.delete(item)
    await db.commit()
