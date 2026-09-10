"""Customer directory.

A lightweight, *derived* directory built from existing job records — no new
table and therefore no migration. It powers the customer autocomplete on the
New Job intake form so repeat customers don't have to be retyped on a phone.

For each distinct customer name we surface the contact details from that
customer's most recent job, so selecting a name can pre-fill contact / phone /
email at intake.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_staff
from app.core.database import get_db
from app.models import Job, User
from app.schemas import CustomerOut

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("", response_model=list[CustomerOut])
async def list_customers(
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    """Distinct customers, newest contact details first.

    Optional ``q`` does a case-insensitive substring match on the name.
    """
    # Newest jobs first so the first time we see a name we capture its most
    # recent contact details.
    result = await db.execute(
        select(
            Job.customer_name,
            Job.contact_person,
            Job.phone,
            Job.email,
        ).order_by(Job.created_at.desc())
    )

    needle = (q or "").strip().lower()
    seen: dict[str, CustomerOut] = {}
    for name, contact, phone, email in result.all():
        if not name or not name.strip():
            continue
        key = name.strip().lower()
        if key in seen:
            # Already captured this customer from a more recent job; only
            # backfill any contact fields that were blank on the newer job.
            existing = seen[key]
            if not existing.contact_person and contact:
                existing.contact_person = contact
            if not existing.phone and phone:
                existing.phone = phone
            if not existing.email and email:
                existing.email = email
            continue
        if needle and needle not in key:
            continue
        seen[key] = CustomerOut(
            name=name.strip(),
            contact_person=contact or None,
            phone=phone or None,
            email=email or None,
        )

    return sorted(seen.values(), key=lambda c: c.name.lower())
