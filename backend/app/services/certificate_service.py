"""Branded PDF generation for a single job.

Produces a downloadable, logo'd document for the client:

* When the job's final inspection has PASSED -> a **Certificate of
  Conformance** with a green conformance stamp.
* Otherwise -> a neutral **Job Report** that still shows the full status,
  inspection history and details (so staff can hand a customer a progress /
  status sheet at any stage).

The renderer takes a Job instance that has already had its relations
eager-loaded (photos, documents, notes, inspections+items, final_inspection
+attempts_log, ncrs). It performs no DB access of its own. Output is raw PDF
bytes, ready to stream straight back to the browser.

Pure reportlab (platypus) — no headless browser, so it runs fine on the VPS
with nothing but the Python dependency installed.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

if TYPE_CHECKING:  # pragma: no cover
    from app.models import Job

# Brand palette — restrained, print-safe. Tweak here to restyle every document.
BRAND = colors.HexColor("#0b3d2e")        # deep workshop green (matches WA accent)
ACCENT = colors.HexColor("#1da851")       # pass / positive green
MUTED = colors.HexColor("#6b7280")        # secondary text
LIGHT = colors.HexColor("#f3f4f6")        # table zebra / fills
LINE = colors.HexColor("#d1d5db")         # hairlines
FAIL = colors.HexColor("#b91c1c")         # rejection red


def _fmt_dt(value, *, with_time: bool = False) -> str:
    if not value:
        return "—"
    if isinstance(value, datetime):
        return value.strftime("%d %b %Y %H:%M" if with_time else "%d %b %Y")
    return value.strftime("%d %b %Y")


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    body = base["BodyText"]
    body.fontSize = 9.5
    body.leading = 13
    return {
        "company": ParagraphStyle(
            "company", parent=body, fontName="Helvetica-Bold",
            fontSize=15, textColor=BRAND, leading=18,
        ),
        "title": ParagraphStyle(
            "title", parent=body, fontName="Helvetica-Bold",
            fontSize=18, textColor=BRAND, alignment=TA_CENTER, leading=22,
        ),
        "subtitle": ParagraphStyle(
            "subtitle", parent=body, fontSize=9, textColor=MUTED,
            alignment=TA_CENTER, leading=12,
        ),
        "section": ParagraphStyle(
            "section", parent=body, fontName="Helvetica-Bold",
            fontSize=11, textColor=BRAND, spaceBefore=4, spaceAfter=4,
        ),
        "label": ParagraphStyle(
            "label", parent=body, fontSize=8, textColor=MUTED,
            fontName="Helvetica-Bold", leading=11,
        ),
        "value": ParagraphStyle("value", parent=body, fontSize=10, leading=13),
        "body": body,
        "small": ParagraphStyle(
            "small", parent=body, fontSize=8, textColor=MUTED, leading=11,
        ),
        "stamp": ParagraphStyle(
            "stamp", parent=body, fontName="Helvetica-Bold",
            fontSize=20, alignment=TA_CENTER, leading=24,
        ),
        "cellL": ParagraphStyle("cellL", parent=body, fontSize=8.5, leading=11,
                                alignment=TA_LEFT),
    }


def _header(job: "Job", company: str, logo_path: Path | None, st) -> list:
    """Logo + company on the left, document meta on the right."""
    fi = job.final_inspection
    passed = bool(fi and fi.result == "passed")
    doc_title = "Certificate of Conformance" if passed else "Job Report"

    left_cells = []
    if logo_path and logo_path.exists():
        try:
            img = Image(str(logo_path))
            ratio = img.imageHeight / float(img.imageWidth or 1)
            img.drawWidth = 38 * mm
            img.drawHeight = min(38 * mm * ratio, 22 * mm)
            left_cells.append([img])
        except Exception:
            pass
    left_cells.append([Paragraph(company, st["company"])])
    left = Table(left_cells, colWidths=[70 * mm])
    left.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))

    meta = Table(
        [
            [Paragraph("DOCUMENT", st["label"]), Paragraph(doc_title, st["value"])],
            [Paragraph("JOB No.", st["label"]),
             Paragraph(f"<b>{job.job_number}</b>", st["value"])],
            [Paragraph("ISSUED", st["label"]),
             Paragraph(_fmt_dt(datetime.now(timezone.utc), with_time=True), st["value"])],
        ],
        colWidths=[20 * mm, 45 * mm],
    )
    meta.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))

    band = Table([[left, meta]], colWidths=[105 * mm, 65 * mm])
    band.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return [band, Spacer(1, 6),
            HRFlowable(width="100%", thickness=2, color=BRAND), Spacer(1, 8)]


def _stamp(job: "Job", st) -> list:
    fi = job.final_inspection
    if fi and fi.result == "passed":
        text, fg, bg, sub = (
            "✓  CONFORMING",
            ACCENT, colors.HexColor("#e7f6ee"),
            "This job has passed final inspection and conforms to requirements.",
        )
    elif fi and fi.result == "failed":
        text, fg, bg, sub = (
            "✕  NON-CONFORMING",
            FAIL, colors.HexColor("#fdeaea"),
            "This job did not pass its most recent final inspection.",
        )
    else:
        text, fg, bg, sub = (
            f"STATUS: {job.status.upper()}",
            BRAND, LIGHT,
            "Final inspection not yet completed — this is a progress report.",
        )
    stamp_style = ParagraphStyle("s", parent=st["stamp"], textColor=fg)
    cell = Table(
        [[Paragraph(text, stamp_style)],
         [Paragraph(sub, st["subtitle"])]],
        colWidths=[170 * mm],
    )
    cell.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 1, fg),
        ("TOPPADDING", (0, 0), (-1, 0), 10),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 8),
        ("TOPPADDING", (0, 1), (-1, 1), 0),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ]))
    return [cell, Spacer(1, 12)]


def _kv_grid(pairs: list[tuple[str, str]], st) -> Table:
    """Two-column label/value grid (4 logical columns across the page)."""
    rows = []
    for i in range(0, len(pairs), 2):
        left = pairs[i]
        right = pairs[i + 1] if i + 1 < len(pairs) else ("", "")
        rows.append([
            Paragraph(left[0], st["label"]), Paragraph(left[1] or "—", st["value"]),
            Paragraph(right[0], st["label"]), Paragraph(right[1] or "—", st["value"]),
        ])
    t = Table(rows, colWidths=[26 * mm, 59 * mm, 26 * mm, 59 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LINEBELOW", (0, 0), (-1, -2), 0.5, LINE),
    ]))
    return t


def _section(title: str, st) -> list:
    return [Spacer(1, 6), Paragraph(title, st["section"]),
            HRFlowable(width="100%", thickness=0.8, color=LINE), Spacer(1, 4)]


def _inspection_tables(job: "Job", st) -> list:
    out: list = []
    inspections = [i for i in job.inspections if i.items]
    if not inspections:
        return out
    out += _section("Inspection Checklists", st)
    for insp in inspections:
        head = insp.title or insp.component_type or "Inspection"
        meta = []
        if insp.inspector_name:
            meta.append(f"Inspector: {insp.inspector_name}")
        meta.append("Complete" if insp.completed else "In progress")
        out.append(Paragraph(
            f"<b>{head}</b> &nbsp;<font color='#6b7280' size=8>"
            f"({' · '.join(meta)})</font>", st["body"]))
        out.append(Spacer(1, 2))

        data = [[Paragraph("Check", st["label"]),
                 Paragraph("Result", st["label"]),
                 Paragraph("Notes", st["label"])]]
        for item in insp.items:
            res = (item.result or "").lower()
            label, col = {
                "pass": ("PASS", ACCENT),
                "fail": ("FAIL", FAIL),
                "na": ("N/A", MUTED),
            }.get(res, ("—", MUTED))
            data.append([
                Paragraph(item.label, st["cellL"]),
                Paragraph(f"<font color='{'#'+col.hexval()[2:]}'><b>{label}</b></font>",
                          st["cellL"]),
                Paragraph(item.notes or "", st["cellL"]),
            ])
        tbl = Table(data, colWidths=[80 * mm, 22 * mm, 68 * mm], repeatRows=1)
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
            ("GRID", (0, 0), (-1, -1), 0.4, LINE),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ]))
        out += [tbl, Spacer(1, 6)]
    return out


def _attempts_table(job: "Job", st) -> list:
    fi = job.final_inspection
    if not fi or not getattr(fi, "attempts_log", None):
        return []
    out = _section("Final Inspection History", st)
    data = [[Paragraph(h, st["label"]) for h in
             ("#", "Result", "Inspector", "Reason", "When")]]
    for a in sorted(fi.attempts_log, key=lambda x: x.attempt_number):
        col = ACCENT if a.result == "passed" else FAIL
        data.append([
            Paragraph(str(a.attempt_number), st["cellL"]),
            Paragraph(f"<font color='{'#'+col.hexval()[2:]}'><b>{a.result.upper()}</b>"
                      f"</font>", st["cellL"]),
            Paragraph(a.inspector_name or "—", st["cellL"]),
            Paragraph(a.reason or "—", st["cellL"]),
            Paragraph(_fmt_dt(a.created_at, with_time=True), st["cellL"]),
        ])
    tbl = Table(data, colWidths=[10 * mm, 24 * mm, 36 * mm, 64 * mm, 36 * mm],
                repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ]))
    return out + [tbl, Spacer(1, 6)]


def _ncr_table(job: "Job", st) -> list:
    ncrs = getattr(job, "ncrs", None) or []
    if not ncrs:
        return []
    out = _section("Linked Non-Conformance Reports", st)
    data = [[Paragraph(h, st["label"]) for h in
             ("NCR", "Title", "Severity", "Status")]]
    for n in ncrs:
        data.append([
            Paragraph(n.ncr_number, st["cellL"]),
            Paragraph(n.title, st["cellL"]),
            Paragraph(n.severity, st["cellL"]),
            Paragraph(n.status, st["cellL"]),
        ])
    tbl = Table(data, colWidths=[30 * mm, 80 * mm, 28 * mm, 32 * mm], repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ]))
    return out + [tbl, Spacer(1, 6)]


def _sign_off(job: "Job", st) -> list:
    fi = job.final_inspection
    out = _section("Sign-off", st)
    inspector = (fi.inspector_name if fi else None) or "—"
    ref = (fi.internal_reference if fi else None) or "—"
    completed = _fmt_dt(fi.completed_at, with_time=True) if fi else "—"
    info = _kv_grid([
        ("Inspector", inspector),
        ("Reference", ref),
        ("Signed off", completed),
        ("Attempts", str(fi.attempts) if fi else "0"),
    ], st)
    out.append(info)
    out.append(Spacer(1, 14))
    sig = Table(
        [[Paragraph("Authorised signature", st["small"]),
          Paragraph("Date", st["small"])]],
        colWidths=[100 * mm, 70 * mm],
    )
    sig.setStyle(TableStyle([
        ("LINEABOVE", (0, 0), (0, 0), 0.8, colors.black),
        ("LINEABOVE", (1, 0), (1, 0), 0.8, colors.black),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return out + [Spacer(1, 4), sig]


def _footer(canvas, doc, company: str):
    canvas.saveState()
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(
        18 * mm, 12 * mm,
        f"{company} — generated by WorkshopIQ on "
        f"{datetime.now(timezone.utc).strftime('%d %b %Y %H:%M UTC')}",
    )
    canvas.drawRightString(192 * mm, 12 * mm, f"Page {doc.page}")
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, 15 * mm, 192 * mm, 15 * mm)
    canvas.restoreState()


def build_job_certificate(
    job: "Job",
    company_name: str,
    logo_path: Path | None = None,
) -> bytes:
    """Render the job document to PDF and return the raw bytes."""
    company = company_name or "WorkshopIQ"
    st = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=16 * mm, bottomMargin=20 * mm,
        title=f"{job.job_number} — {company}",
        author=company,
    )

    fi = job.final_inspection
    passed = bool(fi and fi.result == "passed")
    title = "CERTIFICATE OF CONFORMANCE" if passed else "JOB REPORT"

    story: list = []
    story += _header(job, company, logo_path, st)
    story.append(Paragraph(title, st["title"]))
    story.append(Paragraph(
        f"Job {job.job_number} &nbsp;·&nbsp; {job.customer_name}", st["subtitle"]))
    story.append(Spacer(1, 10))
    story += _stamp(job, st)

    story += _section("Job Details", st)
    story.append(_kv_grid([
        ("Customer", job.customer_name),
        ("Contact", job.contact_person or "—"),
        ("Phone", job.phone or "—"),
        ("Email", job.email or "—"),
        ("PO Number", job.po_number or "—"),
        ("EQ Number", job.eq_number or "—"),
        ("Component", job.component_type or "—"),
        ("Status", job.status),
        ("Received", _fmt_dt(job.date_received)),
        ("Due", _fmt_dt(job.due_date)),
    ], st))
    if job.description:
        story.append(Spacer(1, 6))
        story.append(Paragraph("Description", st["label"]))
        story.append(Paragraph(job.description, st["value"]))

    story += _inspection_tables(job, st)
    story += _attempts_table(job, st)
    story += _ncr_table(job, st)
    story += _sign_off(job, st)

    doc.build(
        story,
        onFirstPage=lambda c, d: _footer(c, d, company),
        onLaterPages=lambda c, d: _footer(c, d, company),
    )
    return buf.getvalue()
