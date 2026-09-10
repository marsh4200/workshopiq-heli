"""Job reporting endpoints: monthly / yearly job summaries for printout."""
from calendar import month_name
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_staff
from app.core.config import settings as app_settings
from app.core.database import get_db
from app.models import Job, User
from app.schemas import JobReportItem, JobReportResponse
from app.services.settings_service import get_setting
from app.services.templates_data import JOB_STATUSES

router = APIRouter(prefix="/reports", tags=["reports"])


def _local_tz() -> timezone:
    return timezone(timedelta(hours=app_settings.REPORT_TZ_OFFSET_HOURS))


def _period_bounds(period: str, year: int, month: int | None):
    """Return (start, end, label) as timezone-aware datetimes in local time.

    The range is half-open: start <= date_received < end.
    """
    tz = _local_tz()
    if period == "month":
        if not month or not 1 <= month <= 12:
            raise HTTPException(status_code=400, detail="A valid month (1-12) is required")
        start = datetime(year, month, 1, tzinfo=tz)
        end = (
            datetime(year + 1, 1, 1, tzinfo=tz)
            if month == 12
            else datetime(year, month + 1, 1, tzinfo=tz)
        )
        label = f"{month_name[month]} {year}"
    elif period == "year":
        start = datetime(year, 1, 1, tzinfo=tz)
        end = datetime(year + 1, 1, 1, tzinfo=tz)
        label = str(year)
    elif period == "all":
        start = datetime(2000, 1, 1, tzinfo=tz)
        end = datetime(2100, 1, 1, tzinfo=tz)
        label = "All time"
    else:
        raise HTTPException(status_code=400, detail="period must be 'month', 'year' or 'all'")
    return start, end, label


@router.get("/jobs", response_model=JobReportResponse)
async def jobs_report(
    period: str = Query("month", pattern="^(month|year|all)$"),
    year: int | None = Query(None, ge=2000, le=2100),
    month: int | None = Query(None, ge=1, le=12),
    status: str | None = Query(None),
    customer: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_staff),
):
    """Basic job report for a calendar month, year, or all time.

    Returns job number, client name and PO number (plus component/status/date)
    for every job received in the selected period. An optional ``customer``
    filter narrows it to a single customer's jobs (customer report printouts).
    """
    if period != "all" and year is None:
        raise HTTPException(status_code=400, detail="A year is required for this period")
    start, end, label = _period_bounds(period, year or 2000, month)

    query = (
        select(Job)
        .where(Job.date_received >= start, Job.date_received < end)
        .order_by(Job.date_received.asc(), Job.sequence.asc())
    )
    if status:
        if status not in JOB_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        query = query.where(Job.status == status)
    if customer:
        query = query.where(Job.customer_name == customer)

    rows = (await db.execute(query)).scalars().all()

    breakdown = {s: 0 for s in JOB_STATUSES}
    for job in rows:
        breakdown[job.status] = breakdown.get(job.status, 0) + 1

    company_name = await get_setting(db, "company_name") or "WorkshopIQ"

    return JobReportResponse(
        period=period,
        year=year if period != "all" else None,
        month=month if period == "month" else None,
        period_label=label,
        generated_at=datetime.now(timezone.utc),
        company_name=company_name,
        total=len(rows),
        status_breakdown=breakdown,
        status_filter=status,
        customer_filter=customer,
        jobs=[JobReportItem.model_validate(j) for j in rows],
    )
