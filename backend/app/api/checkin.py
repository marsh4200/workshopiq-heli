"""QR check-in: per-job one-time check-in via a public, app-free web form.

Flow
----
1. Each job gets a unique check-in token (created with the job, or lazily for
   jobs that predate this feature).
2. The token is encoded in a QR code that points at the PUBLIC form URL
   ``{base}/api/checkin/{token}``.
3. Any phone scans it -> opens the form (no login, no app) -> enters operator
   name + machine -> taps Submit. ONLY on submit is the check-in recorded.
4. The token then locks (one-time). A re-scan shows an "already checked in"
   page with who / when. The check-in is also written to the job timeline.

The public routes are intentionally unauthenticated and live under the ``/api``
prefix so they ride the existing nginx + Cloudflare proxy with no infra change.
"""
import base64
import html
import io
import secrets
from datetime import datetime, timezone

import qrcode
from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_staff
from app.core.config import settings
from app.core.database import get_db
from app.models import CheckinListItem, Inspection, Job, JobCheckin, TimelineEvent, User

router = APIRouter(tags=["checkin"])


async def _pick_lists(db: AsyncSession) -> tuple[list[str], list[str]]:
    """The check-in form's operator/machine dropdown options, in admin-set
    order. Editable under Administration -> Check-in Lists — see
    ``app.api.checkin_lists`` — instead of a fixed list baked into the code.
    """
    result = await db.execute(
        select(CheckinListItem).order_by(
            CheckinListItem.kind, CheckinListItem.order_index, CheckinListItem.id
        )
    )
    items = result.scalars().all()
    operators = [i.label for i in items if i.kind == "operator"]
    machines = [i.label for i in items if i.kind == "machine"]
    return operators, machines


def _options(values: list[str], placeholder: str) -> str:
    """Build <option> tags with a disabled placeholder selected first."""
    opts = [
        f'<option value="" disabled selected>{html.escape(placeholder)}</option>'
    ]
    opts += [
        f'<option value="{html.escape(v)}">{html.escape(v)}</option>'
        for v in values
    ]
    return "".join(opts)


# ----------------------------- helpers -----------------------------
def public_base_url(request: Request) -> str:
    """Best public origin for building the QR link.

    Prefers the configured PUBLIC_BASE_URL; otherwise reconstructs it from the
    forwarding headers set by nginx / Cloudflare, falling back to the raw
    request URL.
    """
    if settings.PUBLIC_BASE_URL:
        return settings.PUBLIC_BASE_URL.rstrip("/")
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or request.url.netloc
    )
    return f"{proto}://{host}".rstrip("/")


def checkin_url(request: Request, token: str) -> str:
    return f"{public_base_url(request)}{settings.API_PREFIX}/checkin/{token}"


def qr_data_uri(url: str) -> str:
    """Return a base64 PNG data URI of a QR code for ``url``."""
    qr = qrcode.QRCode(box_size=10, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


async def has_completed_inspection(db: AsyncSession, job_id: int) -> bool:
    """True once at least one normal inspection on the job has been completed.

    Check-in only opens after the workshop completes the (normal) inspection —
    it is not the final inspection, just the regular incoming/job inspection.
    """
    return bool(
        await db.scalar(
            select(Inspection.id)
            .where(Inspection.job_id == job_id)
            .where(Inspection.completed.is_(True))
            .limit(1)
        )
    )


async def get_or_create_checkin(db: AsyncSession, job_id: int) -> JobCheckin:
    """Return the job's check-in token row, creating one if it doesn't exist."""
    result = await db.execute(
        select(JobCheckin).where(JobCheckin.job_id == job_id)
    )
    checkin = result.scalar_one_or_none()
    if checkin:
        return checkin
    # Create a fresh token (retry on the rare collision).
    for _ in range(5):
        token = secrets.token_urlsafe(12)
        exists = await db.scalar(
            select(JobCheckin.id).where(JobCheckin.token == token)
        )
        if not exists:
            checkin = JobCheckin(job_id=job_id, token=token)
            db.add(checkin)
            await db.commit()
            await db.refresh(checkin)
            return checkin
    raise HTTPException(status_code=500, detail="Could not allocate check-in token")


# ----------------------------- authed: status + QR -----------------------------
@router.get("/jobs/{job_id}/checkin")
async def job_checkin_status(
    job_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_staff),
):
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    checkin = await get_or_create_checkin(db, job_id)
    url = checkin_url(request, checkin.token)
    qr_png = await run_in_threadpool(qr_data_uri, url)
    return {
        "token": checkin.token,
        "url": url,
        "qr_png": qr_png,
        "checked_in": checkin.checked_in,
        "inspection_complete": await has_completed_inspection(db, job_id),
        "operator_name": checkin.operator_name,
        "machine": checkin.machine,
        "checked_in_at": (
            checkin.checked_in_at.isoformat() if checkin.checked_in_at else None
        ),
    }


# ----------------------------- public form (no auth) -----------------------------
def _page(title: str, body: str, accent: str = "#14b8a6") -> str:
    """Render a self-contained, mobile-first WorkshopIQ-styled page."""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
<meta name="robots" content="noindex"/>
<title>{html.escape(title)} · WorkshopIQ</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
<style>
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; min-height: 100vh;
    font-family: 'Inter', system-ui, sans-serif;
    background: #0f1115; color: #e7eaf0;
    display: flex; align-items: flex-start; justify-content: center;
    padding: 24px 16px 48px;
  }}
  .card {{
    width: 100%; max-width: 460px;
    background: #171a21; border: 1px solid #262b35; border-radius: 16px;
    padding: 28px 24px; box-shadow: 0 16px 40px rgba(0,0,0,.45);
  }}
  .brand {{
    font-family: 'Space Grotesk', sans-serif; font-weight: 700;
    letter-spacing: .5px; font-size: 14px; color: {accent};
    text-transform: uppercase; margin-bottom: 4px;
  }}
  h1 {{
    font-family: 'Space Grotesk', sans-serif; font-weight: 700;
    font-size: 24px; margin: 0 0 6px;
  }}
  .sub {{ color: #9aa3b2; font-size: 14px; margin: 0 0 22px; }}
  .meta {{
    background: #0f1115; border: 1px solid #262b35; border-radius: 10px;
    padding: 12px 14px; margin-bottom: 22px; font-size: 14px;
  }}
  .meta b {{ color: #e7eaf0; }}
  label {{ display: block; font-size: 13px; color: #9aa3b2; margin: 0 0 6px; font-weight: 500; }}
  input[type=text], select {{
    width: 100%; padding: 13px 14px; margin-bottom: 18px;
    background: #0f1115; border: 1px solid #2d333f; border-radius: 10px;
    color: #e7eaf0; font-size: 16px; font-family: inherit;
  }}
  input[type=text]:focus, select:focus {{ outline: none; border-color: {accent}; }}
  select {{
    -webkit-appearance: none; -moz-appearance: none; appearance: none;
    padding-right: 40px; cursor: pointer;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%239aa3b2' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");
    background-repeat: no-repeat; background-position: right 14px center;
  }}
  select:invalid {{ color: #5b6373; }}
  select option {{ color: #e7eaf0; background: #171a21; }}
  button {{
    width: 100%; padding: 15px; border: none; border-radius: 10px;
    background: {accent}; color: #04201c; font-size: 16px; font-weight: 700;
    font-family: 'Space Grotesk', sans-serif; cursor: pointer;
  }}
  button:active {{ transform: translateY(1px); }}
  .ok {{ text-align: center; }}
  .tick {{
    width: 64px; height: 64px; border-radius: 50%; margin: 4px auto 16px;
    background: rgba(20,184,166,.15); color: {accent};
    display: flex; align-items: center; justify-content: center; font-size: 34px;
  }}
  .err .tick {{ background: rgba(245,158,11,.15); color: #f59e0b; }}
  .detail {{ color: #9aa3b2; font-size: 14px; line-height: 1.6; }}
  .detail b {{ color: #e7eaf0; }}
  .foot {{ text-align: center; color: #5b6373; font-size: 12px; margin-top: 22px; }}
</style>
</head>
<body>
  <div class="card">
    <div class="brand">WorkshopIQ</div>
    {body}
    <div class="foot">Powered by WorkshopIQ</div>
  </div>
</body>
</html>"""


def _job_line(job: Job) -> str:
    bits = [f"Job <b>{html.escape(job.job_number)}</b>"]
    if job.customer_name:
        bits.append(html.escape(job.customer_name))
    return " · ".join(bits)


def _already_page(job: Job, checkin: JobCheckin) -> str:
    when = ""
    if checkin.checked_in_at:
        when = checkin.checked_in_at.astimezone().strftime("%d %b %Y, %H:%M")
    body = f"""
    <div class="ok err">
      <div class="tick">!</div>
      <h1>Already checked in</h1>
      <p class="detail">
        <b>{html.escape(checkin.operator_name or '—')}</b> checked in on
        <b>{html.escape(checkin.machine or '—')}</b><br/>
        {html.escape(when)}
      </p>
      <p class="sub" style="margin-top:18px">{_job_line(job)}</p>
    </div>"""
    return _page("Already checked in", body, accent="#f59e0b")


def _not_configured_page(job: Job) -> str:
    body = f"""
    <div class="ok err">
      <div class="tick">!</div>
      <h1>Check-in not set up yet</h1>
      <p class="detail">
        No operators or machines have been configured for check-in yet.
        Please contact your system administrator.
      </p>
      <p class="sub" style="margin-top:18px">{_job_line(job)}</p>
    </div>"""
    return _page("Not set up", body, accent="#f59e0b")


def _not_ready_page(job: Job) -> str:
    body = f"""
    <div class="ok err">
      <div class="tick">!</div>
      <h1>Not ready for check-in</h1>
      <p class="detail">
        This job's inspection hasn't been completed yet. Check-in opens once the
        workshop has completed the inspection.
      </p>
      <p class="sub" style="margin-top:18px">{_job_line(job)}</p>
    </div>"""
    return _page("Not ready", body, accent="#f59e0b")


@router.get("/checkin/{token}", response_class=HTMLResponse)
async def checkin_form(token: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(JobCheckin).where(JobCheckin.token == token)
    )
    checkin = result.scalar_one_or_none()
    if not checkin:
        return HTMLResponse(
            _page(
                "Invalid code",
                '<div class="ok err"><div class="tick">!</div>'
                "<h1>Invalid QR code</h1>"
                '<p class="detail">This check-in link is not recognised.</p></div>',
                accent="#f59e0b",
            ),
            status_code=404,
        )
    job = await db.get(Job, checkin.job_id)
    if not job:
        return HTMLResponse(
            _page(
                "Job not found",
                '<div class="ok err"><div class="tick">!</div>'
                "<h1>Job not found</h1></div>",
                accent="#f59e0b",
            ),
            status_code=404,
        )
    if checkin.checked_in:
        return HTMLResponse(_already_page(job, checkin))
    if not await has_completed_inspection(db, checkin.job_id):
        return HTMLResponse(_not_ready_page(job), status_code=403)

    operators, machines = await _pick_lists(db)
    if not operators or not machines:
        return HTMLResponse(_not_configured_page(job), status_code=503)

    body = f"""
    <h1>Machine check-in</h1>
    <p class="sub">Confirm your details to check in on this job.</p>
    <div class="meta">{_job_line(job)}</div>
    <form method="post" action="{settings.API_PREFIX}/checkin/{html.escape(token)}">
      <label for="operator">Operator name</label>
      <select id="operator" name="operator" required>
        {_options(operators, "Select operator…")}
      </select>
      <label for="machine">Machine</label>
      <select id="machine" name="machine" required>
        {_options(machines, "Select machine…")}
      </select>
      <button type="submit">Check in</button>
    </form>"""
    return HTMLResponse(_page("Check-in", body))


@router.post("/checkin/{token}", response_class=HTMLResponse)
async def checkin_submit(
    token: str,
    request: Request,
    operator: str = Form(...),
    machine: str = Form(...),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(JobCheckin).where(JobCheckin.token == token)
    )
    checkin = result.scalar_one_or_none()
    if not checkin:
        raise HTTPException(status_code=404, detail="Invalid check-in code")
    job = await db.get(Job, checkin.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # One-time: if already used, show the locked page (do not overwrite).
    if checkin.checked_in:
        return HTMLResponse(_already_page(job, checkin))

    # Check-in only opens once the normal inspection has been completed.
    if not await has_completed_inspection(db, checkin.job_id):
        return HTMLResponse(_not_ready_page(job), status_code=403)

    operator = operator.strip()
    machine = machine.strip()
    if not operator or not machine:
        body = f"""
        <div class="ok err"><div class="tick">!</div>
          <h1>Missing details</h1>
          <p class="detail">Both operator name and machine are required.</p>
          <p style="margin-top:18px"><a href="{settings.API_PREFIX}/checkin/{html.escape(token)}"
             style="color:#14b8a6">Go back</a></p>
        </div>"""
        return HTMLResponse(_page("Missing details", body, accent="#f59e0b"), status_code=400)

    now = datetime.now(timezone.utc)
    fwd = request.headers.get("x-forwarded-for", "")
    ip = (fwd.split(",")[0].strip() if fwd else None) or (
        request.client.host if request.client else None
    )

    checkin.checked_in = True
    checkin.operator_name = operator
    checkin.machine = machine
    checkin.scanner_ip = ip
    checkin.checked_in_at = now

    db.add(
        TimelineEvent(
            job_id=job.id,
            event_type="checkin",
            description=f"Checked in on {machine}",
            actor_name=operator,
        )
    )

    # A check-in means work has started — move the job to Machining.
    if job.status != "Machining":
        old_status = job.status
        job.status = "Machining"
        db.add(
            TimelineEvent(
                job_id=job.id,
                event_type="status_change",
                description=f"Status changed: {old_status} → Machining",
                actor_name=operator,
            )
        )
    await db.commit()

    when = now.astimezone().strftime("%d %b %Y, %H:%M")
    body = f"""
    <div class="ok">
      <div class="tick">&#10003;</div>
      <h1>Checked in</h1>
      <p class="detail">
        <b>{html.escape(operator)}</b> on <b>{html.escape(machine)}</b><br/>
        {html.escape(when)}
      </p>
      <p class="sub" style="margin-top:18px">{_job_line(job)}</p>
    </div>"""
    return HTMLResponse(_page("Checked in", body))
