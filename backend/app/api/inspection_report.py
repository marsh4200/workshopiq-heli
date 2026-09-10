"""QR-driven inspection reports.

Flow (mirrors the QR check-in pattern in ``checkin.py``)
-------------------------------------------------------
1. An admin/staff picks a job and generates a report — this allocates a unique
   token and a sequential certificate number (e.g. ``ECE 260001``).
2. The token is encoded in a QR pointing at the PUBLIC form URL
   ``{base}/api/inspection-report/{token}``.
3. An employee scans it (or the admin opens it on screen) -> a no-login form
   opens, pre-filled with the job header -> they fill the measurement rows and
   sign-off -> Submit. ONLY on submit is the report recorded.
4. On submit the report is rendered to a PDF, filed straight into that job's
   Documents, written to the job timeline, and the token LOCKED (one-time).
   The job status is intentionally left untouched.
5. To do another report, generate a fresh token for the job.

The public routes are unauthenticated and live under the ``/api`` prefix so
they ride the existing nginx + Cloudflare proxy with no infra change.
"""
import html
import json
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.checkin import (
    _job_line,
    _options,
    _page,
    _pick_lists,
    public_base_url,
    qr_data_uri,
)
from app.api.deps import (
    get_current_user,
    get_user_for_file,
    require_admin,
    require_staff,
)
from app.api.jobs import get_client_job_ids
from app.core.config import settings
from app.core.database import get_db
from app.models import Document, InspectionReport, Job, TimelineEvent, User, UserRole
from app.services import file_service, inspection_report_service
from app.services.settings_service import get_setting, next_ece_number

router = APIRouter(tags=["inspection-reports"])

YN_OPTIONS = ["Y", "N"]


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%d/%m/%Y")


def report_url(request: Request, token: str) -> str:
    return f"{public_base_url(request)}{settings.API_PREFIX}/inspection-report/{token}"


def _job_header_defaults(job: Job, cert: str, report: "InspectionReport | None" = None) -> dict:
    """Pre-fill the report header from the job.

    ``drawing_number``/``qcp_no``/``quantity`` have no job-level source — they
    are set by staff when the QR is generated (see ``generate_report``) and
    stored on the report row itself, so we source them from ``report`` when
    one is supplied. They're locked (read-only) on the public phone form.
    """
    return {
        "certificate_number": cert,
        "date": _today(),
        "customer": job.customer_name or "",
        "job_no": job.job_number or "",
        "job_desc": (job.description or job.component_type or "")[:255],
        "drawing_number": (report.drawing_number if report else "") or "",
        "qcp_no": (report.qcp_no if report else "") or "",
        "quantity": (report.quantity if report else "") or "",
        "eve_job": job.eq_number or "",
    }


def _serialize(report: InspectionReport, job: Job | None) -> dict:
    return {
        "id": report.id,
        "job_id": report.job_id,
        "job_number": job.job_number if job else None,
        "customer_name": job.customer_name if job else None,
        "token": report.token,
        "certificate_number": report.certificate_number,
        "submitted": report.submitted,
        "inspector_name": report.inspector_name,
        "qcp_pass": report.qcp_pass,
        "qc_reject": report.qc_reject,
        "rework": report.rework,
        "document_id": report.document_id,
        "drawing_number": report.drawing_number,
        "qcp_no": report.qcp_no,
        "quantity": report.quantity,
        "client_signed": report.client_signed,
        "client_signed_name": report.client_signed_name,
        "client_signed_at": report.client_signed_at.isoformat() if report.client_signed_at else None,
        "submitted_at": report.submitted_at.isoformat() if report.submitted_at else None,
        "created_at": report.created_at.isoformat() if report.created_at else None,
    }


# --------------------------- authed: list / generate ---------------------------
@router.get("/inspection-reports")
async def list_reports(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_staff),
):
    rows = (
        await db.execute(
            select(InspectionReport)
            .options(selectinload(InspectionReport.job))
            .order_by(InspectionReport.created_at.desc())
            .limit(200)
        )
    ).scalars().all()
    return [_serialize(r, r.job) for r in rows]


@router.post("/inspection-reports/generate", status_code=201)
async def generate_report(
    request: Request,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    job_id = body.get("job_id")
    if not job_id:
        raise HTTPException(status_code=400, detail="job_id is required")
    job = await db.get(Job, int(job_id))
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    cert, seq = await next_ece_number(db)
    for _ in range(5):
        token = secrets.token_urlsafe(12)
        if not await db.scalar(
            select(InspectionReport.id).where(InspectionReport.token == token)
        ):
            break
    else:
        raise HTTPException(status_code=500, detail="Could not allocate report token")

    report = InspectionReport(
        job_id=job.id,
        token=token,
        certificate_number=cert,
        sequence=seq,
        created_by_id=user.id,
        drawing_number=(str(body.get("drawing_number") or "").strip()[:120] or None),
        qcp_no=(str(body.get("qcp_no") or "").strip()[:120] or None),
        quantity=(str(body.get("quantity") or "").strip()[:60] or None),
    )
    db.add(report)
    db.add(
        TimelineEvent(
            job_id=job.id,
            event_type="inspection_report",
            description=f"Inspection report {cert} QR generated",
            actor_name=user.full_name or user.username,
        )
    )
    await db.commit()
    await db.refresh(report)

    url = report_url(request, token)
    qr_png = await run_in_threadpool(qr_data_uri, url)
    data = _serialize(report, job)
    data.update({"url": url, "qr_png": qr_png})
    return data


@router.get("/inspection-reports/blank.pdf")
async def blank_report_pdf(
    user: User = Depends(get_user_for_file),
    db: AsyncSession = Depends(get_db),
):
    # Auth via Authorization header OR ?token= query param (same pattern as
    # the job file endpoint). The query-param path is what lets Android open
    # the PDF with a plain navigation and hand it to the OS viewer — a plain
    # <a href> / new-tab navigation cannot attach an Authorization header.
    if user.role not in ("administrator", "staff"):
        raise HTTPException(status_code=403, detail="Staff only")
    company_name = await get_setting(db, "company_name") or "WorkshopIQ"
    logo_name = await get_setting(db, "company_logo")
    logo_path = file_service.file_path(logo_name) if logo_name else None
    if logo_path and not logo_path.exists():
        logo_path = None
    pdf = await run_in_threadpool(
        inspection_report_service.render_blank_pdf,
        "",
        company_name=company_name,
        logo_path=logo_path,
    )
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'inline; filename="Inspection Report (blank).pdf"'
        },
    )


# ------------------------- client portal: list / sign -------------------------
# These string-path routes are declared BEFORE the "/{report_id}" int route so
# "mine" / "pending-signatures" resolve here instead of failing int validation.


async def _client_report_ids(db: AsyncSession, user: User) -> set[int]:
    """Job ids this client may see reports for (empty for non-clients)."""
    if user.role != UserRole.client.value:
        return set()
    return await get_client_job_ids(db, user.id)


@router.get("/inspection-reports/mine")
async def my_reports(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Filed inspection reports on the jobs this client is assigned to.

    Only submitted (filed) reports are shown — a report that hasn't been filled
    in and filed by the workshop yet isn't something the client can sign.
    """
    if user.role != UserRole.client.value:
        raise HTTPException(status_code=403, detail="Clients only")
    job_ids = await _client_report_ids(db, user)
    if not job_ids:
        return []
    rows = (
        await db.execute(
            select(InspectionReport)
            .options(selectinload(InspectionReport.job))
            .where(InspectionReport.job_id.in_(job_ids))
            .where(InspectionReport.submitted.is_(True))
            .order_by(InspectionReport.submitted_at.desc())
            .limit(200)
        )
    ).scalars().all()
    return [_serialize(r, r.job) for r in rows]


@router.get("/inspection-reports/pending-signatures")
async def pending_signatures(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Filed-but-unsigned reports for the assigned client — drives the login nag."""
    job_ids = await _client_report_ids(db, user)
    if not job_ids:
        return []
    rows = (
        await db.execute(
            select(InspectionReport)
            .options(selectinload(InspectionReport.job))
            .where(InspectionReport.job_id.in_(job_ids))
            .where(InspectionReport.submitted.is_(True))
            .where(InspectionReport.client_signed.is_(False))
            .order_by(InspectionReport.submitted_at.desc())
        )
    ).scalars().all()
    return [
        {
            "report_id": r.id,
            "certificate_number": r.certificate_number,
            "job_id": r.job_id,
            "job_number": r.job.job_number if r.job else None,
            "customer_name": r.job.customer_name if r.job else None,
        }
        for r in rows
    ]


@router.post("/inspection-reports/{report_id}/client-sign")
async def client_sign_report(
    report_id: int,
    body: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """The assigned client signs an already-filed inspection report.

    Option A: the filed PDF is re-rendered with the client's signature embedded
    in the CUSTOMER sign-off block and REPLACED in place, so the job keeps one
    clean document. Also stamps the report as client-signed and writes the job
    timeline. Allowed for the assigned client (or an administrator).
    """
    report = await db.get(InspectionReport, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    is_client = user.role == UserRole.client.value
    if is_client:
        allowed = await get_client_job_ids(db, user.id)
        if report.job_id not in allowed:
            raise HTTPException(status_code=403, detail="Access denied")
    elif user.role != UserRole.administrator.value:
        raise HTTPException(status_code=403, detail="Only the assigned client can sign")

    if not report.submitted:
        raise HTTPException(
            status_code=409,
            detail="This report hasn't been filed by the workshop yet.",
        )

    job = await db.get(Job, report.job_id)
    if report.client_signed:
        # Idempotent: already signed — just return current state.
        return _serialize(report, job)

    signed_name = (body.get("signed_name") or "").strip()
    signature_png = (body.get("signature_png") or "").strip() or None
    if not signed_name and not signature_png:
        raise HTTPException(
            status_code=400, detail="A typed name or a drawn signature is required."
        )

    # Rebuild the report data from the stored payload and inject the client's
    # sign-off, then re-render the PDF.
    try:
        report_data = json.loads(report.payload or "{}")
        if not isinstance(report_data, dict):
            report_data = {}
    except (ValueError, TypeError):
        report_data = {}
    signoff = report_data.setdefault("signoff", {})
    signoff["customer_signed_name"] = signed_name or signoff.get("customer_signed_name") or ""
    signoff["customer_date"] = _today()
    if signature_png:
        signoff["customer_signature"] = signature_png

    company_name = await get_setting(db, "company_name") or "WorkshopIQ"
    logo_name = await get_setting(db, "company_logo")
    logo_path = file_service.file_path(logo_name) if logo_name else None
    if logo_path and not logo_path.exists():
        logo_path = None
    pdf = await run_in_threadpool(
        inspection_report_service.render_report_pdf,
        report_data,
        company_name=company_name,
        logo_path=logo_path,
    )

    # Replace the filed document in place (same stored filename) so there's one
    # clean document on the job. Fall back to creating one if it went missing.
    file_service.UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    doc = await db.get(Document, report.document_id) if report.document_id else None
    if doc:
        with open(file_service.file_path(doc.filename), "wb") as fh:
            fh.write(pdf)
    else:
        stored = f"job{job.id}_{uuid.uuid4().hex}.pdf"
        with open(file_service.file_path(stored), "wb") as fh:
            fh.write(pdf)
        doc = Document(
            job_id=job.id,
            filename=stored,
            original_name=f"Inspection Report {report.certificate_number}.pdf",
            content_type="application/pdf",
            uploaded_by_id=report.created_by_id,
        )
        db.add(doc)
        await db.flush()
        report.document_id = doc.id

    now = datetime.now(timezone.utc)
    report.client_signed = True
    report.client_signed_name = signed_name or None
    report.client_signature_png = signature_png
    report.client_signed_at = now
    report.client_signed_by_id = user.id
    report.customer_signed_name = signed_name or report.customer_signed_name
    report.payload = json.dumps(report_data)

    db.add(
        TimelineEvent(
            job_id=job.id,
            event_type="inspection_report",
            description=f"Inspection report {report.certificate_number} signed by client",
            actor_name=signed_name or user.full_name or user.username,
        )
    )
    await db.commit()
    await db.refresh(report)
    return _serialize(report, job)


@router.get("/inspection-reports/{report_id}")
async def report_status(
    report_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_staff),
):
    report = await db.get(InspectionReport, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    job = await db.get(Job, report.job_id)
    url = report_url(request, report.token)
    qr_png = await run_in_threadpool(qr_data_uri, url)
    data = _serialize(report, job)
    data.update({"url": url, "qr_png": qr_png})
    return data


@router.delete("/inspection-reports/{report_id}", status_code=204)
async def delete_report(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    report = await db.get(InspectionReport, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if report.submitted:
        raise HTTPException(
            status_code=409,
            detail="This report has been submitted and filed; delete the document on the job instead.",
        )
    await db.delete(report)
    await db.commit()


# ----------------------------- public form (no auth) -----------------------------
# The digital fill-in form is a faithful white "paper" replica of the
# workshop's inspection sheet — same logo banner, title bar, header grid,
# measurement table and sign-off block — with the cells turned into inputs.
# It is NOT the dark WorkshopIQ chrome; it deliberately looks like the
# printed form.

INITIAL_ROWS = 6  # empty measurement rows shown on load — "+ Add row" covers the
# rest. The paper sheet had 15 fixed rows, but the PDF is sized from whatever
# was actually filled in (see inspection_report_service), so pre-rendering 15
# blank rows only adds scrolling — especially painful on a phone.


def _hv(value: str) -> str:
    return html.escape(value or "", quote=True)


def _ta(name: str = "", value: str = "", *, data_k: str = "", css: str = "",
        placeholder: str = "", extra: str = "", readonly: bool = False) -> str:
    """Auto-growing single-row textarea, used instead of a plain text
    ``<input>`` for every free-text field on the form (not just DESCRIPTION):
    any of these can end up with more than a short word or two in it — a
    customer name, a drawing number, a signature — and a fixed single-line
    input just scrolls the extra text out of view. This grows to fit
    whatever's typed (see the autoGrow() delegation in the page script),
    and behaves exactly like a normal single-line box until content
    actually needs the extra room.

    ``readonly=True`` locks the field: the value still shows (and still
    submits with the form, unlike ``disabled``) but the person filling it in
    on their phone can't change it — used for header fields set by staff
    when the QR was generated, and for the on-site Customer sign-off block.
    """
    attrs = ['data-autogrow', 'rows="1"']
    if name:
        attrs.append(f'name="{name}"')
    if data_k:
        attrs.append(f'data-k="{data_k}"')
    if css:
        attrs.append(f'class="{css}"')
    if placeholder:
        attrs.append(f'placeholder="{_hv(placeholder)}"')
    if readonly:
        attrs.append('readonly tabindex="-1" aria-readonly="true"')
    if extra:
        attrs.append(extra)
    return f'<textarea {" ".join(attrs)}>{_hv(value)}</textarea>'


def _accept_select() -> str:
    return (
        '<select data-k="accept" class="acc">'
        '<option value=""></option>'
        '<option value="Y">Y</option>'
        '<option value="N">N</option>'
        "</select>"
    )


def _yn_select(name: str, value: str = "") -> str:
    sel_y = " selected" if value.upper() == "Y" else ""
    sel_n = " selected" if value.upper() == "N" else ""
    return (
        f'<select name="{name}" class="yn">'
        f'<option value=""></option>'
        f'<option value="Y"{sel_y}>Y</option>'
        f'<option value="N"{sel_n}>N</option>'
        "</select>"
    )


def _inspector_select(name: str, operators: list[str]) -> str:
    opts = ['<option value=""></option>']
    opts += [f'<option value="{_hv(v)}">{html.escape(v)}</option>' for v in operators]
    return f'<select name="{name}" class="cellsel">{"".join(opts)}</select>'


def _meas_row() -> str:
    """One measurement table row (matches the sheet's columns).

    Every cell is an auto-growing textarea rather than a single-line input —
    DESCRIPTION most often needs the room, but a tolerance or a finished-size
    note can run long too, and all of them now grow instead of scrolling out
    of view.

    Each ``<td>`` also carries a ``data-label`` — unused on a normal-width
    screen (the column headers already say it), but on a phone this same
    table collapses into one card per row with the label printed above each
    field (see the ``@media`` block in ``_form_html``), instead of the row
    staying 7 columns wide and forcing side-to-side scrolling to fill in a
    single measurement.
    """
    remove_btn = (
        '<button type="button" class="rm" title="Remove row" '
        'aria-label="Remove row" onclick="removeRow(this)">✕</button>'
    )
    return (
        '<tr>'
        f'<td data-label="Description">{_ta(data_k="description", css="desc")}</td>'
        f'<td data-label="Drawing size tol (1)">{_ta(data_k="tol1")}</td>'
        f'<td data-label="Drawing size tol (2)">{_ta(data_k="tol2")}</td>'
        f'<td data-label="Actual size — req">{_ta(data_k="req")}</td>'
        f'<td data-label="Actual size — act">{_ta(data_k="act")}</td>'
        f'<td data-label="Finished">{_ta(data_k="finished")}</td>'
        f'<td data-label="Accept" class="accept-cell">{_accept_select()}{remove_btn}</td>'
        '</tr>'
    )


def _form_html(
    token: str, job: Job, h: dict, company_name: str, operators: list[str]
) -> str:
    action = f"{settings.API_PREFIX}/inspection-report/{html.escape(token)}"
    logo = f"{settings.API_PREFIX}/inspection-report/{html.escape(token)}/logo.png"
    rows = "".join(_meas_row() for _ in range(INITIAL_ROWS))

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Inspection Report · {_hv(h['certificate_number'])}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Arimo:wght@400;700&display=swap" rel="stylesheet">
<style>
  * {{ box-sizing: border-box; }}
  body {{ margin:0; background:#e9ebee; color:#000;
    font-family:'Arimo','Liberation Sans',Arial,sans-serif; padding:14px 8px 60px; }}
  .sheet {{ max-width:880px; margin:0 auto; background:#fff; padding:14px;
    box-shadow:0 10px 30px rgba(0,0,0,.18); border-radius:4px; }}
  .logo-band {{ border:3px solid #000; padding:10px 8px; text-align:center; }}
  .logo-band img {{ max-width:100%; height:auto; display:block; margin:0 auto; }}
  .title-band {{ background:#d9d9d9; border:1px solid #000; border-top:none;
    text-align:center; font-weight:700; letter-spacing:.5px; padding:7px; font-size:15px; }}
  table {{ border-collapse:collapse; width:100%; }}
  td, th {{ border:1px solid #000; }}
  .grid {{ margin-top:10px; }}
  .grid td {{ padding:0; }}
  .grid .lbl {{ background:#f2f2f2; font-weight:700; font-size:11px; padding:7px 8px;
    white-space:nowrap; width:1%; }}
  .grid input, .grid textarea {{ width:100%; border:0; background:transparent; padding:9px 8px;
    font:inherit; font-size:14px; }}
  .grid input:focus, .grid textarea:focus {{ outline:none; background:#eef4ff; }}
  .grid input[readonly], .grid textarea[readonly],
  .grid input[readonly]:focus, .grid textarea[readonly]:focus {{
    background:#f7f7f7; font-weight:700; color:#333; cursor:default; }}
  .grid textarea {{ resize:none; overflow:hidden; display:block; line-height:1.3; }}

  .hscroll {{ overflow-x:auto; -webkit-overflow-scrolling:touch; margin-top:12px; }}
  table.meas {{ min-width:760px; }}
  table.meas th {{ background:#d9d9d9; font-size:11px; font-weight:700; padding:5px 4px;
    text-align:center; line-height:1.15; }}
  table.meas td {{ padding:0; }}
  table.meas input, table.meas select, table.meas textarea {{ width:100%; border:0;
    background:transparent; padding:11px 6px; font:inherit; font-size:14px; text-align:center; }}
  table.meas input:focus, table.meas select:focus, table.meas textarea:focus {{
    outline:none; background:#eef4ff; }}
  table.meas textarea {{ resize:none; overflow:hidden; display:block; line-height:1.3; }}
  table.meas textarea.desc {{ text-align:left; }}
  .acc {{ text-align:center; font-weight:700; flex:1; }}
  .accept-cell {{ display:flex; align-items:center; justify-content:center; }}
  .rm {{ border:0; background:transparent; color:#b3261e; font-size:15px; line-height:1;
    cursor:pointer; padding:4px; opacity:.55; flex-shrink:0; }}
  .rm:hover, .rm:active {{ opacity:1; }}
  /* column widths */
  .meas col.c-desc {{ width:30%; }}
  .meas col.c-sm {{ width:14%; }}
  .meas col.c-xs {{ width:9%; }}

  .addrow {{ margin-top:8px; }}
  .addrow button {{ background:#fff; border:1px dashed #1f3fae; color:#1f3fae;
    font-weight:700; padding:9px 14px; border-radius:6px; cursor:pointer; font:inherit; font-size:13px; }}

  table.result {{ margin-top:14px; }}
  table.result .lbl {{ background:#f2f2f2; font-weight:700; font-size:11px;
    padding:8px; white-space:nowrap; text-align:center; }}
  table.result td {{ text-align:center; }}
  .yn {{ border:0; background:transparent; padding:9px 6px; font:inherit; font-size:15px;
    font-weight:700; text-align:center; width:100%; }}
  .yn:focus {{ outline:none; background:#eef4ff; }}

  table.sign {{ margin-top:14px; }}
  table.sign th {{ background:#d9d9d9; font-size:12px; padding:7px; }}
  table.sign .lbl {{ background:#f2f2f2; font-weight:700; font-size:11px; padding:8px;
    white-space:nowrap; width:1%; }}
  table.sign input, table.sign textarea, table.sign select.cellsel {{ width:100%; border:0;
    background:transparent; padding:9px 8px; font:inherit; font-size:14px; }}
  table.sign input:focus, table.sign textarea:focus, table.sign select.cellsel:focus {{
    outline:none; background:#eef4ff; }}
  table.sign input[readonly], table.sign textarea[readonly],
  table.sign input[readonly]:focus, table.sign textarea[readonly]:focus {{
    background:#f7f7f7; font-weight:700; color:#333; cursor:default; font-style:normal; }}
  table.sign textarea {{ resize:none; overflow:hidden; display:block; line-height:1.3; }}
  .sig input, .sig textarea {{ font-style:italic; color:#1f3fae; font-size:16px; }}

  .submit-bar {{ max-width:880px; margin:16px auto 0; }}
  .submit-bar button {{ width:100%; padding:15px; border:none; border-radius:8px;
    background:#1f3fae; color:#fff; font-weight:700; font-size:16px; cursor:pointer; font:inherit; }}
  .submit-bar button:active {{ transform:translateY(1px); }}
  .hint {{ max-width:880px; margin:8px auto 0; font-size:12px; color:#555; text-align:center; }}
  .reqd {{ color:#c0392b; }}

  /* ---------------------------------------------------------------------
     Phone layout. Below this, the paper-sheet grids stop being "tables you
     scroll sideways to fill in" and become one full-width field/card per
     row — the layout still holds the same inputs, just stacked so nothing
     is off-screen. Also bumps every field to 16px so iOS Safari doesn't
     zoom the page in on focus (anything smaller triggers that).
  --------------------------------------------------------------------- */
  @media (max-width: 700px) {{
    body {{ padding:10px 6px 90px; }}
    .sheet {{ padding:10px; }}

    /* Header grid: CERTIFICATE/DATE/CUSTOMER/... one field per line
       instead of two label+value pairs squeezed side by side. */
    .grid, .grid tbody, .grid tr, .grid td {{ display:block; width:100% !important; }}
    .grid td.lbl {{ padding:6px 8px; }}
    .grid td.lbl:empty, .grid td.lbl:empty + td {{ display:none; }}

    /* Measurement table -> one card per row, with the column name shown
       above each field (from data-label) instead of only in a header row
       that would otherwise scroll off to the side. */
    .hscroll {{ overflow-x:visible; margin-top:14px; }}
    table.meas {{ min-width:0; }}
    table.meas thead {{ display:none; }}
    table.meas, table.meas tbody {{ display:block; width:100%; }}
    table.meas tbody {{ counter-reset:mrow; }}
    table.meas tr {{
      display:block; counter-increment:mrow; margin-bottom:14px; border:1px solid #000;
      border-radius:8px; overflow:hidden; background:#fff;
    }}
    table.meas tr::before {{
      content:"Measurement " counter(mrow); display:block; background:#1f3fae; color:#fff;
      font-weight:700; font-size:12px; letter-spacing:.03em; padding:7px 10px;
    }}
    table.meas td {{
      display:block; width:100% !important; border:0; border-top:1px solid #ddd;
    }}
    table.meas tr td:first-child {{ border-top:0; }}
    table.meas td::before {{
      content:attr(data-label); display:block; font-size:11px; font-weight:700;
      color:#555; text-transform:uppercase; letter-spacing:.03em; padding:7px 10px 0;
    }}
    table.meas input, table.meas select, table.meas textarea {{ text-align:left; padding:8px 10px 10px; }}
    .accept-cell {{ justify-content:flex-start; gap:10px; padding-bottom:6px; }}
    .acc {{ flex:0 0 auto; width:110px !important; }}
    .rm {{ font-size:19px; padding:8px; opacity:.75; }}

    /* Result + sign-off: stack instead of cramming 3 (or 2) blocks across
       a 390px screen. */
    table.result, table.result tbody, table.result tr, table.result td {{
      display:block; width:100% !important; text-align:left;
    }}
    table.result td.lbl {{ padding-top:10px; }}
    /* The sign-off table is 2 columns (Inspection | Customer), each
       column itself a 3-row name/date/signature block. A plain stack would
       interleave them (both names, then both dates, then both signatures) —
       confusing on a phone. Grid + order groups every Inspection field together,
       then every Customer field, while keeping name/date/signature in order
       within each (equal `order` falls back to source order). */
    /* Scoped to DIRECT children only (table.sign > tbody > tr > *) — these
       rows also contain a nested label/value table per field, and a plain
       descendant selector here would reach into those nested tables too and
       wreck their column widths. */
    table.sign {{ display:grid; grid-template-columns:1fr; row-gap:0; }}
    table.sign > tbody {{ display:contents; }}
    table.sign > tbody > tr {{ display:contents; }}
    table.sign > tbody > tr > * {{ width:100% !important; }}
    table.sign > tbody > tr > *:nth-child(1) {{ order:1; }}
    table.sign > tbody > tr > *:nth-child(2) {{ order:2; }}
    table.sign th {{ margin-top:14px; }}
    table.sign > tbody > tr:first-child th {{ margin-top:0; }}

    /* 16px stops Safari's auto-zoom-on-focus; padding gives real tap targets. */
    .grid input, .grid textarea,
    table.meas input, table.meas select, table.meas textarea,
    table.result select, .yn,
    table.sign input, table.sign textarea, table.sign select.cellsel {{
      font-size:16px; padding-top:11px; padding-bottom:11px;
    }}
    .addrow button {{ width:100%; padding:12px; font-size:14px; }}
  }}
</style>
</head>
<body>
<form method="post" action="{action}" onsubmit="return packRows()">
  <div class="sheet">
    <div class="logo-band"><img src="{logo}" alt="{_hv(company_name)}"/></div>
    <div class="title-band">INSPECTION REPORT</div>

    <table class="grid">
      <tr>
        <td class="lbl">CERTIFICATE NUMBER</td>
        <td><input name="certificate_number" value="{_hv(h['certificate_number'])}" readonly/></td>
        <td class="lbl">DATE</td>
        <td>{_ta("date", h['date'], readonly=True)}</td>
      </tr>
      <tr>
        <td class="lbl">CUSTOMER</td>
        <td>{_ta("customer", h['customer'], readonly=True)}</td>
        <td class="lbl">JOB NO</td>
        <td>{_ta("job_no", h['job_no'], readonly=True)}</td>
      </tr>
      <tr>
        <td class="lbl">JOB DESC</td>
        <td>{_ta("job_desc", h['job_desc'], readonly=True)}</td>
        <td class="lbl">QCP NO</td>
        <td>{_ta("qcp_no", h['qcp_no'], readonly=True)}</td>
      </tr>
      <tr>
        <td class="lbl">DRAWING NUMBER</td>
        <td colspan="3">{_ta("drawing_number", h['drawing_number'], readonly=True)}</td>
      </tr>
      <tr>
        <td class="lbl">QUANTITY</td>
        <td colspan="3">{_ta("quantity", h['quantity'], readonly=True)}</td>
      </tr>
    </table>
    <!-- EVE JOB is no longer shown on the report itself (was paired with
         DRAWING NUMBER above), but it's still posted with the form exactly as
         before so nothing downstream that reads it breaks. -->
    <input type="hidden" name="eve_job" value="{_hv(h['eve_job'])}"/>

    <div class="hscroll">
      <table class="meas">
        <colgroup>
          <col class="c-desc"/><col class="c-sm"/><col class="c-sm"/>
          <col class="c-xs"/><col class="c-xs"/><col class="c-sm"/><col class="c-xs"/>
        </colgroup>
        <thead>
          <tr>
            <th rowspan="2">DESCRIPTION</th>
            <th>DRAWING</th><th>DRAWING</th>
            <th colspan="2">ACTUAL SIZE</th>
            <th rowspan="2">FINISHED</th>
            <th>ACCEPT</th>
          </tr>
          <tr>
            <th>SIZE TOL (1)</th><th>SIZE TOL (2)</th>
            <th>REQ</th><th>ACT</th>
            <th>YES / NO</th>
          </tr>
        </thead>
        <tbody id="rows">{rows}</tbody>
      </table>
    </div>
    <div class="addrow"><button type="button" onclick="addRow()">+ Add row</button></div>

    <table class="result">
      <tr>
        <td class="lbl">QCP-PASS</td><td>{_yn_select("qcp_pass")}</td>
        <td class="lbl">QC-REJECT</td><td>{_yn_select("qc_reject")}</td>
        <td class="lbl">REWORK</td><td>{_yn_select("rework")}</td>
      </tr>
    </table>

    <table class="sign">
      <tr><th>INSPECTION</th><th>CUSTOMER</th></tr>
      <tr>
        <td><table><tr><td class="lbl">NAME <span class="reqd">*</span></td><td>{_inspector_select("inspector_name", operators)}</td></tr></table></td>
        <td><table><tr><td class="lbl">NAME</td><td>{_ta("customer_signed_name", readonly=True)}</td></tr></table></td>
      </tr>
      <tr>
        <td><table><tr><td class="lbl">DATE</td><td>{_ta("inspector_date", h['date'])}</td></tr></table></td>
        <td><table><tr><td class="lbl">DATE</td><td>{_ta("customer_date", readonly=True)}</td></tr></table></td>
      </tr>
      <tr>
        <td class="sig"><table><tr><td class="lbl">SIGNATURE</td><td>{_ta("inspector_sign", placeholder="Type name")}</td></tr></table></td>
        <td class="sig"><table><tr><td class="lbl">SIGNATURE</td><td>{_ta("customer_sign", readonly=True)}</td></tr></table></td>
      </tr>
    </table>
  </div>

  <div class="submit-bar"><button type="submit">Submit &amp; file to job</button></div>
  <div class="hint">On submit this files straight to the job's documents.</div>
  <input type="hidden" name="items_json" id="items_json"/>
</form>

<template id="rowtpl">{_meas_row()}</template>
<script>
  var tbody = document.getElementById('rows');
  var tpl = document.getElementById('rowtpl');
  function addRow() {{
    tbody.appendChild(tpl.content.cloneNode(true));
    // On a long phone form a row appended at the bottom is easy to miss —
    // bring it into view and drop the cursor straight into Description.
    var last = tbody.lastElementChild;
    if (last) {{
      last.scrollIntoView({{ block: 'center', behavior: 'smooth' }});
      var first = last.querySelector('[data-k=description]');
      if (first) first.focus();
    }}
  }}
  function removeRow(btn) {{
    var tr = btn.closest('tr');
    if (tr) tr.remove();
  }}
  // Description fields are auto-growing textareas so long text stays fully
  // visible instead of scrolling out of a single-line box. Delegated on the
  // form so it also covers rows added later via addRow().
  function autoGrow(el) {{
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }}
  document.querySelector('form').addEventListener('input', function(e) {{
    if (e.target.matches && e.target.matches('textarea[data-autogrow]')) autoGrow(e.target);
  }});
  document.querySelectorAll('textarea[data-autogrow]').forEach(autoGrow);
  function packRows() {{
    var out = [];
    tbody.querySelectorAll('tr').forEach(function(tr){{
      var o = {{}}, any = false;
      tr.querySelectorAll('[data-k]').forEach(function(el){{
        var v = (el.value || '').trim();
        o[el.getAttribute('data-k')] = v;
        if (v) any = true;
      }});
      if (any) out.push(o);
    }});
    document.getElementById('items_json').value = JSON.stringify(out);
    var insp = document.querySelector('[name=inspector_name]');
    if (insp && !insp.value) {{ alert('Please select the inspector.'); insp.focus(); return false; }}
    // Mirror the typed inspector signature from the name if left blank.
    var sign = document.querySelector('[name=inspector_sign]');
    if (sign && !sign.value && insp) {{ sign.value = insp.value; }}
    return true;
  }}
</script>
</body>
</html>"""


@router.get("/inspection-report/{token}", response_class=HTMLResponse)
async def report_form(token: str, db: AsyncSession = Depends(get_db)):
    report = (
        await db.execute(
            select(InspectionReport).where(InspectionReport.token == token)
        )
    ).scalar_one_or_none()
    if not report:
        return HTMLResponse(
            _page(
                "Invalid code",
                '<div class="ok err"><div class="tick">!</div>'
                "<h1>Invalid QR code</h1>"
                '<p class="detail">This inspection-report link is not recognised.</p></div>',
                accent="#f59e0b",
            ),
            status_code=404,
        )
    job = await db.get(Job, report.job_id)
    if not job:
        return HTMLResponse(
            _page(
                "Job not found",
                '<div class="ok err"><div class="tick">!</div><h1>Job not found</h1></div>',
                accent="#f59e0b",
            ),
            status_code=404,
        )
    if report.submitted:
        return HTMLResponse(_already_page(job, report))

    h = _job_header_defaults(job, report.certificate_number, report)
    company_name = await get_setting(db, "company_name") or "WorkshopIQ"
    operators, _machines = await _pick_lists(db)
    return HTMLResponse(_form_html(token, job, h, company_name, operators))


@router.get("/inspection-report/{token}/logo.png")
async def report_logo(token: str, db: AsyncSession = Depends(get_db)):
    """Serve the install's company logo for the public form (validated by token)."""
    exists = await db.scalar(
        select(InspectionReport.id).where(InspectionReport.token == token)
    )
    if not exists:
        raise HTTPException(status_code=404, detail="Not found")
    logo_name = await get_setting(db, "company_logo")
    logo_path = file_service.file_path(logo_name) if logo_name else None
    if not logo_path or not logo_path.exists():
        raise HTTPException(status_code=404, detail="Logo not found")
    return Response(
        content=logo_path.read_bytes(),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )


def _already_page(job: Job, report: InspectionReport) -> str:
    when = ""
    if report.submitted_at:
        when = report.submitted_at.astimezone().strftime("%d %b %Y, %H:%M")
    body = f"""
    <div class="ok err">
      <div class="tick">!</div>
      <h1>Already submitted</h1>
      <p class="detail">
        <b>{html.escape(report.certificate_number)}</b> was completed by
        <b>{html.escape(report.inspector_name or '—')}</b><br/>{html.escape(when)}<br/>
        It has been filed to the job's documents.
      </p>
      <p class="sub" style="margin-top:18px">{_job_line(job)}</p>
    </div>"""
    return _page("Already submitted", body, accent="#f59e0b")


@router.post("/inspection-report/{token}", response_class=HTMLResponse)
async def report_submit(
    token: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    report = (
        await db.execute(
            select(InspectionReport).where(InspectionReport.token == token)
        )
    ).scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Invalid report code")
    job = await db.get(Job, report.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if report.submitted:
        return HTMLResponse(_already_page(job, report))

    form = await request.form()

    def g(key: str) -> str:
        return (form.get(key) or "").strip()

    try:
        items = json.loads(form.get("items_json") or "[]")
        if not isinstance(items, list):
            items = []
    except (ValueError, TypeError):
        items = []

    inspector = g("inspector_name")
    if not inspector:
        body = f"""
        <div class="ok err"><div class="tick">!</div>
          <h1>Missing inspector</h1>
          <p class="detail">Please select the inspector before submitting.</p>
          <p style="margin-top:18px"><a href="{settings.API_PREFIX}/inspection-report/{html.escape(token)}"
             style="color:#14b8a6">Go back</a></p>
        </div>"""
        return HTMLResponse(_page("Missing details", body, accent="#f59e0b"), status_code=400)

    header = {
        "certificate_number": report.certificate_number,
        "date": g("date") or _today(),
        "customer": g("customer"),
        "job_no": g("job_no"),
        "job_desc": g("job_desc"),
        "drawing_number": g("drawing_number"),
        "qcp_no": g("qcp_no"),
        "quantity": g("quantity"),
        "eve_job": g("eve_job"),
    }
    signoff = {
        "qcp_pass": g("qcp_pass"),
        "qc_reject": g("qc_reject"),
        "rework": g("rework"),
        "inspector_name": inspector,
        "date": g("inspector_date") or header["date"],
        "customer_signed_name": g("customer_sign") or g("customer_signed_name"),
        "customer_date": g("customer_date"),
    }
    report_data = {"header": header, "items": items, "signoff": signoff}

    # Render the PDF and file it as a job document.
    company_name = await get_setting(db, "company_name") or "WorkshopIQ"
    logo_name = await get_setting(db, "company_logo")
    logo_path = file_service.file_path(logo_name) if logo_name else None
    if logo_path and not logo_path.exists():
        logo_path = None
    pdf = await run_in_threadpool(
        inspection_report_service.render_report_pdf,
        report_data,
        company_name=company_name,
        logo_path=logo_path,
    )
    stored = f"job{job.id}_{uuid.uuid4().hex}.pdf"
    dest = file_service.file_path(stored)
    file_service.UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as fh:
        fh.write(pdf)

    original = f"Inspection Report {report.certificate_number}.pdf"
    doc = Document(
        job_id=job.id,
        filename=stored,
        original_name=original,
        content_type="application/pdf",
        uploaded_by_id=report.created_by_id,
    )
    db.add(doc)
    await db.flush()  # get doc.id

    now = datetime.now(timezone.utc)
    fwd = request.headers.get("x-forwarded-for", "")
    ip = (fwd.split(",")[0].strip() if fwd else None) or (
        request.client.host if request.client else None
    )

    report.submitted = True
    report.inspector_name = inspector
    report.customer_signed_name = signoff["customer_signed_name"] or None
    report.qcp_pass = signoff["qcp_pass"] or None
    report.qc_reject = signoff["qc_reject"] or None
    report.rework = signoff["rework"] or None
    report.payload = json.dumps(report_data)
    report.scanner_ip = ip
    report.submitted_at = now
    report.document_id = doc.id

    db.add(
        TimelineEvent(
            job_id=job.id,
            event_type="inspection_report",
            description=f"Inspection report {report.certificate_number} completed and filed to documents",
            actor_name=inspector,
        )
    )
    await db.commit()

    when = now.astimezone().strftime("%d %b %Y, %H:%M")
    body = f"""
    <div class="ok">
      <div class="tick">&#10003;</div>
      <h1>Report filed</h1>
      <p class="detail">
        <b>{html.escape(report.certificate_number)}</b> by <b>{html.escape(inspector)}</b><br/>
        {html.escape(when)}<br/>
        Saved to this job's documents.
      </p>
      <p class="sub" style="margin-top:18px">{_job_line(job)}</p>
    </div>"""
    return HTMLResponse(_page("Report filed", body))
