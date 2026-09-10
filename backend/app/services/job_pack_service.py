"""ZIP "job pack" bundling everything on file for a job.

Produces a single downloadable ZIP for a finished job — the same branded
cover PDF as ``/jobs/{id}/certificate`` (Certificate of Conformance or Job
Report), every photo that was uploaded (grouped Before / After / General,
using each photo's original filename where we have one) and every document
that was uploaded or filed (quotes, drawings, signed inspection reports).

This is the "give the client everything in one download" deliverable: no
back-and-forth about which photo or document belongs to which job — it's
all bundled from what the workshop actually attached to the job record, with
nothing re-typed or re-derived.

Pure ``zipfile`` — no extra dependency, runs anywhere the app already does.
"""
from __future__ import annotations

import re
import zipfile
from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING

from app.services import file_service
from app.services.certificate_service import build_job_certificate

if TYPE_CHECKING:  # pragma: no cover
    from app.models import Job

_UNSAFE = re.compile(r'[<>:"|?*\x00-\x1f]')


def _safe_name(name: str, fallback: str) -> str:
    name = (name or "").strip().replace("\\", "_").replace("/", "_")
    name = _UNSAFE.sub("_", name).strip()
    return name or fallback


def _unique(used: set[str], name: str) -> str:
    """Return `name`, or a "(2)", "(3)", ... suffixed variant if it collides."""
    if name not in used:
        used.add(name)
        return name
    stem, suffix = Path(name).stem, Path(name).suffix
    n = 2
    candidate = f"{stem} ({n}){suffix}"
    while candidate in used:
        n += 1
        candidate = f"{stem} ({n}){suffix}"
    used.add(candidate)
    return candidate


def build_job_pack_zip(
    job: "Job",
    company_name: str,
    logo_path: Path | None = None,
) -> bytes:
    """Render the complete job pack and return raw ZIP bytes.

    ``job`` must already have ``photos``, ``documents``, ``inspections``
    (+items), ``final_inspection`` (+attempts_log) and ``ncrs`` eager-loaded
    — the same relations ``build_job_certificate`` needs for the cover page.
    """
    company = company_name or "WorkshopIQ"
    buf = BytesIO()

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # 1) Cover document — the branded certificate / job report.
        pdf = build_job_certificate(job, company, logo_path)
        passed = bool(job.final_inspection and job.final_inspection.result == "passed")
        cover_name = "00 - Certificate of Conformance.pdf" if passed else "00 - Job Report.pdf"
        zf.writestr(cover_name, pdf)

        # 2) Photos, grouped by category, oldest first.
        cat_labels = {"before": "Before", "after": "After", "general": "General"}
        used_by_folder: dict[str, set[str]] = {}
        photos = sorted(job.photos or [], key=lambda p: p.created_at)
        for idx, photo in enumerate(photos, start=1):
            src = file_service.file_path(photo.filename)
            if not src.exists():
                continue
            folder = cat_labels.get((photo.category or "general").lower(), "General")
            used = used_by_folder.setdefault(folder, set())
            ext = Path(photo.filename).suffix or ".jpg"
            base = _safe_name(photo.original_name or "", f"Photo {idx}{ext}")
            if not Path(base).suffix:
                base += ext
            zf.write(src, f"Photos/{folder}/{_unique(used, base)}")

        # 3) Documents, as filed, oldest first (quotes, drawings, signed
        # inspection reports — anything that ended up in the job's Documents).
        used_docs: set[str] = set()
        for doc in sorted(job.documents or [], key=lambda d: d.created_at):
            src = file_service.file_path(doc.filename)
            if not src.exists():
                continue
            ext = Path(doc.filename).suffix
            base = _safe_name(doc.original_name or "", doc.filename)
            if not Path(base).suffix and ext:
                base += ext
            zf.write(src, f"Documents/{_unique(used_docs, base)}")

    return buf.getvalue()
