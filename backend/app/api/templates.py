"""Inspection template management."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user, require_admin
from app.core.database import get_db
from app.models import InspectionTemplate, TemplateItem, User
from app.schemas import TemplateCreate, TemplateOut, TemplateUpdate
from app.services.templates_data import COMPONENT_TYPES, JOB_STATUSES

router = APIRouter(prefix="/templates", tags=["templates"])


@router.get("/meta")
async def template_meta(_: User = Depends(get_current_user)):
    """Static metadata used across the UI."""
    return {"component_types": COMPONENT_TYPES, "statuses": JOB_STATUSES}


@router.get("", response_model=list[TemplateOut])
async def list_templates(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(InspectionTemplate)
        .options(selectinload(InspectionTemplate.items))
        .order_by(InspectionTemplate.component_type)
    )
    return result.scalars().all()


@router.get("/{template_id}", response_model=TemplateOut)
async def get_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(InspectionTemplate)
        .options(selectinload(InspectionTemplate.items))
        .where(InspectionTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.post("", response_model=TemplateOut, status_code=201)
async def create_template(
    payload: TemplateCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    existing = await db.execute(
        select(InspectionTemplate).where(
            InspectionTemplate.component_type == payload.component_type
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="A template for this component type already exists",
        )
    template = InspectionTemplate(
        component_type=payload.component_type, name=payload.name
    )
    db.add(template)
    await db.flush()
    for idx, label in enumerate(payload.items):
        db.add(TemplateItem(template_id=template.id, label=label, order_index=idx))
    await db.commit()
    return await get_template(template.id, db, _)


@router.put("/{template_id}", response_model=TemplateOut)
async def update_template(
    template_id: int,
    payload: TemplateUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    result = await db.execute(
        select(InspectionTemplate)
        .options(selectinload(InspectionTemplate.items))
        .where(InspectionTemplate.id == template_id)
    )
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    if payload.name is not None:
        template.name = payload.name
    if payload.items is not None:
        for item in list(template.items):
            await db.delete(item)
        await db.flush()
        for idx, label in enumerate(payload.items):
            db.add(TemplateItem(template_id=template.id, label=label, order_index=idx))
    await db.commit()
    return await get_template(template_id, db, admin)


@router.delete("/{template_id}", status_code=204)
async def delete_template(
    template_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    template = await db.get(InspectionTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    await db.delete(template)
    await db.commit()
