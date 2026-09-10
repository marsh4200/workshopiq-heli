"""Render the inspection report to a PDF that mirrors the workshop's paper sheet.

Pure reportlab (platypus) — no headless browser, so it runs on the VPS with no
extra system packages. Two entry points:

* :func:`render_report_pdf` — a filled report for a submitted inspection.
* :func:`render_blank_pdf` — a blank printable sheet for hand completion.

Company name and logo are supplied by the caller (sourced from Settings —
see ``company_name`` / ``company_logo`` in ``settings_service``), so the
certificate is branded per install rather than hardcoded to one company.
"""
from __future__ import annotations

import base64
import io
from datetime import datetime, timezone
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

INK = colors.HexColor("#111111")
GREY = colors.HexColor("#d9d9d9")
LIGHT = colors.HexColor("#eef0f3")
LINE = colors.HexColor("#000000")
ACCENT = colors.HexColor("#1f3fae")

USABLE_W = 180 * mm

# Measurement table columns (sum == USABLE_W).
COL_WIDTHS = [
    50 * mm,  # DESCRIPTION
    23 * mm,  # DRAWING SIZE TOL (1)
    23 * mm,  # DRAWING SIZE TOL (2)
    17 * mm,  # ACTUAL SIZE — REQ
    17 * mm,  # ACTUAL SIZE — ACT
    25 * mm,  # FINISHED
    25 * mm,  # ACCEPT (YES / NO)
]

BODY_ROW_H = 8.4 * mm   # comfortable, even for blank rows
HEAD_ROW_H = 7.2 * mm


def _esc(text: str) -> str:
    """Escape text for use inside a reportlab Paragraph (its mini XML markup)."""
    return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _styles() -> dict[str, ParagraphStyle]:
    return {
        "title": ParagraphStyle(
            "title", fontName="Helvetica-Bold", fontSize=13, leading=15,
            alignment=TA_CENTER, textColor=INK,
        ),
        "label": ParagraphStyle(
            "label", fontName="Helvetica-Bold", fontSize=8.5, leading=10,
            alignment=TA_LEFT, textColor=INK,
        ),
        "value": ParagraphStyle(
            "value", fontName="Helvetica", fontSize=9.5, leading=11,
            alignment=TA_LEFT, textColor=INK,
        ),
        "th": ParagraphStyle(
            "th", fontName="Helvetica-Bold", fontSize=8, leading=9.5,
            alignment=TA_CENTER, textColor=INK,
        ),
        "td": ParagraphStyle(
            "td", fontName="Helvetica", fontSize=9, leading=11,
            alignment=TA_LEFT, textColor=INK,
        ),
        "tdc": ParagraphStyle(
            "tdc", fontName="Helvetica", fontSize=9, leading=11,
            alignment=TA_CENTER, textColor=INK,
        ),
        "sign": ParagraphStyle(
            "sign", fontName="Helvetica-Oblique", fontSize=13, leading=15,
            alignment=TA_LEFT, textColor=ACCENT,
        ),
        "foot": ParagraphStyle(
            "foot", fontName="Helvetica", fontSize=7, leading=9,
            alignment=TA_CENTER, textColor=colors.HexColor("#888888"),
        ),
    }


def _logo_band(company_name: str, logo_path: Path | None) -> Table:
    cell = Paragraph(f"<b>{_esc(company_name)}</b>", _styles()["title"])
    if logo_path and logo_path.exists():
        try:
            img = Image(str(logo_path))
            ratio = img.imageHeight / float(img.imageWidth or 1)
            img.drawWidth = 150 * mm
            img.drawHeight = 150 * mm * ratio
            cell = img
        except Exception:
            pass  # fall back to the company-name text cell built above
    band = Table([[cell]], colWidths=[USABLE_W])
    band.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 3, LINE),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return band


def _title_band(st) -> Table:
    t = Table([[Paragraph("INSPECTION REPORT", st["title"])]], colWidths=[USABLE_W])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), GREY),
        ("BOX", (0, 0), (-1, -1), 1, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def _header_grid(h: dict, st) -> Table:
    """Label/value grid matching the sheet's field pairing exactly.

    Left labels : CERTIFICATE NUMBER, CUSTOMER, JOB DESC, DRAWING NUMBER, QUANTITY
    Right labels:        (none),       DATE,    JOB NO,     QCP NO,       (none)

    The QUANTITY row's right-hand pair used to carry EVE JOB — that field is no
    longer shown on the report (kept in ``h``/the DB for anything else that
    still wants it), so its cells are spanned into the QUANTITY value like the
    CERTIFICATE NUMBER row above, instead of leaving a blank label/box behind.
    """
    def L(t):
        return Paragraph(t, st["label"])

    def V(t):
        return Paragraph((t or "").replace("\n", "<br/>") or "&nbsp;", st["value"])

    rows = [
        [L("CERTIFICATE NUMBER"), V(h.get("certificate_number", "")), L(""), V("")],
        [L("CUSTOMER"), V(h.get("customer", "")), L("DATE"), V(h.get("date", ""))],
        [L("JOB DESC"), V(h.get("job_desc", "")), L("JOB NO"), V(h.get("job_no", ""))],
        [L("DRAWING NUMBER"), V(h.get("drawing_number", "")), L("QCP NO"), V(h.get("qcp_no", ""))],
        [L("QUANTITY"), V(h.get("quantity", "")), L(""), V("")],
    ]
    # No explicit rowHeights here: a fixed height forces the row to that size
    # regardless of content, so a long CUSTOMER or JOB DESC value that wraps to
    # two lines gets clipped and prints over the row below it. Leaving the
    # height unset lets each row grow to fit its Paragraph, while the
    # TOP/BOTTOMPADDING below reproduce the same ~8.4mm comfortable height for
    # the normal single-line case.
    t = Table(rows, colWidths=[34 * mm, 56 * mm, 24 * mm, 66 * mm])
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.75, LINE),
        ("BACKGROUND", (0, 0), (0, -1), LIGHT),
        ("BACKGROUND", (2, 0), (2, -1), LIGHT),
        ("SPAN", (1, 0), (3, 0)),          # certificate value spans the full right side
        ("SPAN", (1, 4), (3, 4)),          # quantity value spans the full right side (EVE JOB removed)
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def _measure_table(items: list[dict], st, *, rows_total: int) -> Table:
    head1 = [
        Paragraph("DESCRIPTION", st["th"]),
        Paragraph("DRAWING", st["th"]),
        Paragraph("DRAWING", st["th"]),
        Paragraph("ACTUAL SIZE", st["th"]),
        Paragraph("", st["th"]),
        Paragraph("FINISHED", st["th"]),
        Paragraph("ACCEPT", st["th"]),
    ]
    head2 = [
        Paragraph("", st["th"]),
        Paragraph("SIZE TOL (1)", st["th"]),
        Paragraph("SIZE TOL (2)", st["th"]),
        Paragraph("REQ", st["th"]),
        Paragraph("ACT", st["th"]),
        Paragraph("", st["th"]),
        Paragraph("YES / NO", st["th"]),
    ]
    data = [head1, head2]

    body = list(items)
    while len(body) < rows_total:
        body.append({})

    for it in body:
        accept = (it.get("accept") or "").upper()
        accept = {"YES": "Y", "NO": "N"}.get(accept, accept)
        data.append([
            Paragraph(str(it.get("description", "") or ""), st["td"]),
            Paragraph(str(it.get("tol1", "") or ""), st["tdc"]),
            Paragraph(str(it.get("tol2", "") or ""), st["tdc"]),
            Paragraph(str(it.get("req", "") or ""), st["tdc"]),
            Paragraph(str(it.get("act", "") or ""), st["tdc"]),
            Paragraph(str(it.get("finished", "") or ""), st["tdc"]),
            Paragraph(accept, st["tdc"]),
        ])

    # Fixed heights only for the two header rows (never wrap). Body rows are
    # left unset so a long DESCRIPTION Paragraph can wrap onto a second line
    # and the row grows to fit it — a fixed BODY_ROW_H forced every row to the
    # same height regardless of content, so a long description just wrapped
    # underneath itself and printed into the row below ("overwritten"). The
    # TOP/BOTTOMPADDING below reproduce the original ~8.4mm comfortable height
    # for the normal short/blank case.
    row_heights = [HEAD_ROW_H, HEAD_ROW_H] + [None] * len(body)
    t = Table(data, colWidths=COL_WIDTHS, rowHeights=row_heights, repeatRows=2)
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.75, LINE),
        ("BACKGROUND", (0, 0), (-1, 1), GREY),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 2), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 2), (-1, -1), 6),
        ("SPAN", (0, 0), (0, 1)),   # DESCRIPTION
        ("SPAN", (3, 0), (4, 0)),   # ACTUAL SIZE over REQ / ACT
        ("SPAN", (5, 0), (5, 1)),   # FINISHED
    ]))
    return t


def _yn(value: str | None) -> str:
    v = (value or "").strip().upper()
    if v in ("Y", "YES"):
        return "<b>Y</b>  /  <strike>N</strike>"
    if v in ("N", "NO"):
        return "<strike>Y</strike>  /  <b>N</b>"
    return "Y  /  N"


def _sig_image(data_url: str | None, max_w: float, max_h: float):
    """Decode a ``data:image/png;base64,...`` signature to a fitted reportlab
    Image, or ``None`` if it's empty/invalid. Scaled to fit the given box while
    preserving aspect ratio (drawn signatures are wide-and-short)."""
    if not data_url:
        return None
    try:
        raw_b64 = data_url.split(",", 1)[1] if "," in data_url else data_url
        raw = base64.b64decode(raw_b64)
        from reportlab.lib.utils import ImageReader

        iw, ih = ImageReader(io.BytesIO(raw)).getSize()
        if not iw or not ih:
            return None
        scale = min(max_w / iw, max_h / ih)
        img = Image(io.BytesIO(raw), width=iw * scale, height=ih * scale)
        img.hAlign = "LEFT"
        return img
    except Exception:
        return None


def _kv_row(label: str, value: str, st, *, sign: bool = False,
            sign_img=None, row_h: float = 8 * mm) -> Table:
    if sign_img is not None:
        rhs = sign_img
    elif sign:
        rhs = Paragraph(f"<i>{value}</i>" if value else "&nbsp;", st["sign"])
    else:
        rhs = Paragraph(value or "&nbsp;", st["value"])
    t = Table([[Paragraph(label, st["label"]), rhs]], colWidths=[26 * mm, 62 * mm],
              rowHeights=[row_h])
    t.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND", (0, 0), (0, 0), LIGHT),
        ("LINEBELOW", (0, 0), (-1, -1), 0.75, LINE),
        ("LINEAFTER", (0, 0), (0, 0), 0.75, LINE),
    ]))
    return t


def _signoff(d: dict, st) -> list:
    strip = Table(
        [[
            Paragraph("QCP-PASS", st["label"]),
            Paragraph(_yn(d.get("qcp_pass")), st["value"]),
            Paragraph("QC-REJECT", st["label"]),
            Paragraph(_yn(d.get("qc_reject")), st["value"]),
            Paragraph("REWORK", st["label"]),
            Paragraph(_yn(d.get("rework")), st["value"]),
        ]],
        colWidths=[26 * mm, 32 * mm, 26 * mm, 32 * mm, 24 * mm, 40 * mm],
        rowHeights=[9 * mm],
    )
    strip.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.75, LINE),
        ("BACKGROUND", (0, 0), (0, 0), LIGHT),
        ("BACKGROUND", (2, 0), (2, 0), LIGHT),
        ("BACKGROUND", (4, 0), (4, 0), LIGHT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))

    def col(title, name, date, *, sign_img_data: str | None = None):
        head = Table([[Paragraph(title, st["th"])]], colWidths=[88 * mm], rowHeights=[8 * mm])
        head.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), GREY),
            ("BOX", (0, 0), (-1, -1), 0.75, LINE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        # A drawn signature (client sign-off) gets a taller row so the scribble
        # is legible; a typed/blank signature keeps the compact 8mm line.
        sig_h = 14 * mm if sign_img_data else 8 * mm
        img = _sig_image(sign_img_data, 60 * mm, sig_h - 2 * mm) if sign_img_data else None
        inner = Table(
            [[head],
             [_kv_row("NAME", name, st)],
             [_kv_row("DATE", date, st)],
             [_kv_row("SIGNATURE", name, st, sign=True, sign_img=img, row_h=sig_h)]],
            colWidths=[88 * mm],
        )
        inner.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.75, LINE),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        return inner

    cols = Table(
        [[col("INSPECTION", d.get("inspector_name", ""), d.get("date", "")),
          col("CUSTOMER", d.get("customer_signed_name", ""), d.get("customer_date", ""),
              sign_img_data=d.get("customer_signature"))]],
        colWidths=[90 * mm, 90 * mm],
    )
    cols.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (0, 0), 0),
        ("RIGHTPADDING", (0, 0), (0, 0), 4),
        ("LEFTPADDING", (1, 0), (1, 0), 4),
        ("RIGHTPADDING", (1, 0), (1, 0), 0),
    ]))
    return [strip, Spacer(1, 6), cols]


def _build(
    report: dict, *, blank: bool, company_name: str, logo_path: Path | None
) -> bytes:
    st = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=15 * mm, rightMargin=15 * mm,
        topMargin=12 * mm, bottomMargin=12 * mm,
        title="Inspection Report",
    )
    header = report.get("header", {})
    items = [] if blank else report.get("items", [])
    signoff = report.get("signoff", {})
    rows_total = 14 if blank else max(len(items) + 2, 8)

    story = [
        _logo_band(company_name, logo_path), Spacer(1, 8),
        _title_band(st), Spacer(1, 8),
        _header_grid(header, st), Spacer(1, 10),
        _measure_table(items, st, rows_total=rows_total), Spacer(1, 10),
    ]
    story += _signoff(signoff, st)
    story += [
        Spacer(1, 10),
        Paragraph(
            f"{_esc(company_name)} · Generated by WorkshopIQ",
            st["foot"],
        ),
    ]
    doc.build(story)
    return buf.getvalue()


def render_report_pdf(
    report: dict, *, company_name: str = "WorkshopIQ", logo_path: Path | None = None
) -> bytes:
    """Render a filled inspection report.

    ``report`` shape::

        {"header": {certificate_number, date, customer, job_no, job_desc,
                    drawing_number, qcp_no, quantity, eve_job},
         "items": [{description, tol1, tol2, req, act, finished, accept}, ...],
         "signoff": {qcp_pass, qc_reject, rework, inspector_name, date,
                     customer_signed_name, customer_date}}

    ``company_name``/``logo_path`` brand the certificate — callers pass in the
    install's own Settings (``company_name`` / ``company_logo``) rather than
    anything hardcoded here.
    """
    return _build(report, blank=False, company_name=company_name, logo_path=logo_path)


def render_blank_pdf(
    certificate_number: str = "",
    *,
    company_name: str = "WorkshopIQ",
    logo_path: Path | None = None,
) -> bytes:
    """Render a blank printable sheet for hand completion."""
    return _build(
        {"header": {"certificate_number": certificate_number}, "items": [],
         "signoff": {}},
        blank=True,
        company_name=company_name,
        logo_path=logo_path,
    )
