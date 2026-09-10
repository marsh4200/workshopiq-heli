"""Full-system backup & restore.

A backup is a single .zip containing:
  - manifest.json   metadata (app version, timestamp, row counts)
  - database.json   every table's rows (logical dump, schema-independent)
  - uploads/        all uploaded photos, documents and the company logo

Restore wipes the current data and rebuilds it from the archive, then replaces
the uploads. The schema itself is (re)created on startup by the app, so the
logical dump restores cleanly even onto a freshly reinstalled system, and
tolerates additive schema changes between versions.
"""
import json
import os
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import DateTime, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as app_settings
from app.core.database import Base

UPLOAD_ROOT = Path(app_settings.UPLOAD_DIR)

# Transient control files used by the in-app updater — never part of a backup.
CONTROL_FILES = {
    ".update-status",
    ".update-log",
    ".update-requested",
    ".update-version",
}

FORMAT = "workshopiq-backup"
FORMAT_VERSION = 1


# ----------------------------- serialization helpers -----------------------------
def _json_default(value):
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _coerce_value(column, value):
    """Turn a JSON value back into something the DB column accepts."""
    if value is None:
        return None
    if isinstance(column.type, DateTime) and isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return value
    return value


# ----------------------------- backup -----------------------------
async def collect_database(db: AsyncSession) -> tuple[dict, dict]:
    """Return ({table: [rows]}, {table: count}) for every table."""
    data: dict[str, list] = {}
    counts: dict[str, int] = {}
    for table in Base.metadata.sorted_tables:
        result = await db.execute(select(table))
        rows = [dict(r) for r in result.mappings().all()]
        data[table.name] = rows
        counts[table.name] = len(rows)
    return data, counts


def write_archive(
    database: dict,
    counts: dict,
    app_version: str,
    dest_path: str | None = None,
    progress=None,
) -> str:
    """Write the backup zip (sync; run in a thread). Returns the path.

    ``dest_path`` — write to this exact path instead of a random temp file
    (used by the progress-tracked job flow so any worker can serve it).
    ``progress`` — optional ``callback(percent: int, stage: str)`` invoked as
    the database and each uploaded file are written, so the UI can show a real
    progress bar instead of an indeterminate spinner.
    """
    def _p(pct: int, stage: str) -> None:
        if progress:
            try:
                progress(pct, stage)
            except Exception:  # noqa: BLE001 — progress must never break a backup
                pass

    manifest = {
        "format": FORMAT,
        "format_version": FORMAT_VERSION,
        "app_version": app_version,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "counts": counts,
    }
    if dest_path:
        path = dest_path
    else:
        fd, path = tempfile.mkstemp(prefix="workshopiq-backup-", suffix=".zip")
        os.close(fd)

    # Enumerate upload files up front so progress can be proportional.
    upload_files = []
    if UPLOAD_ROOT.exists():
        upload_files = [
            item
            for item in UPLOAD_ROOT.iterdir()
            if item.is_file() and item.name not in CONTROL_FILES
        ]
    total = len(upload_files)

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        _p(8, "Writing database")
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))
        zf.writestr(
            "database.json", json.dumps(database, default=_json_default, indent=0)
        )
        if total == 0:
            _p(95, "No uploads to archive")
        for i, item in enumerate(upload_files, start=1):
            zf.write(item, arcname=f"uploads/{item.name}")
            # Uploads span 20%→95% of the bar.
            pct = 20 + int(75 * i / total)
            if i == 1 or i == total or i % 5 == 0:
                _p(pct, f"Archiving files ({i}/{total})")
    _p(99, "Finalising")
    return path


# ----------------------------- restore -----------------------------
def read_archive(file_bytes: bytes, work_dir: str) -> tuple[dict, dict, str]:
    """Extract a backup zip (sync; run in a thread).

    Returns (manifest, database, uploads_dir). Raises ValueError if malformed.
    """
    zip_path = Path(work_dir) / "backup.zip"
    zip_path.write_bytes(file_bytes)

    try:
        with zipfile.ZipFile(zip_path) as zf:
            names = set(zf.namelist())
            if "manifest.json" not in names or "database.json" not in names:
                raise ValueError("Not a valid WorkshopIQ backup file.")
            manifest = json.loads(zf.read("manifest.json"))
            if manifest.get("format") != FORMAT:
                raise ValueError("Unrecognised backup format.")
            database = json.loads(zf.read("database.json"))
            uploads_dir = Path(work_dir) / "uploads"
            uploads_dir.mkdir(exist_ok=True)
            for name in names:
                if name.startswith("uploads/") and not name.endswith("/"):
                    target = uploads_dir / Path(name).name
                    with zf.open(name) as src, open(target, "wb") as dst:
                        shutil.copyfileobj(src, dst)
    except zipfile.BadZipFile as exc:
        raise ValueError("The uploaded file is not a valid .zip archive.") from exc

    return manifest, database, str(uploads_dir)


async def restore_database(db: AsyncSession, database: dict) -> dict:
    """Wipe and rebuild every table from the dump. Returns restored counts."""
    tables = Base.metadata.sorted_tables

    # Clear children-first to respect foreign keys.
    for table in reversed(tables):
        await db.execute(table.delete())

    counts: dict[str, int] = {}
    for table in tables:
        rows = database.get(table.name) or []
        counts[table.name] = len(rows)
        if not rows:
            continue
        columns = list(table.columns)
        payload = [
            {col.name: _coerce_value(col, row.get(col.name)) for col in columns}
            for row in rows
        ]
        await db.execute(table.insert(), payload)

    await db.commit()

    # Re-sync auto-increment sequences so new inserts don't collide.
    for table in tables:
        if "id" not in table.columns:
            continue
        try:
            seq = (
                await db.execute(
                    text("SELECT pg_get_serial_sequence(:t, 'id')"), {"t": table.name}
                )
            ).scalar()
            if seq:
                await db.execute(
                    text(
                        f'SELECT setval(:s, GREATEST((SELECT COALESCE(MAX(id), 1) '
                        f'FROM "{table.name}"), 1))'
                    ),
                    {"s": seq},
                )
        except Exception:  # noqa: BLE001 — non-Postgres or no sequence; safe to skip
            await db.rollback()
            continue
    await db.commit()
    return counts


def replace_uploads(source_dir: str) -> None:
    """Swap the uploads directory contents (sync; run in a thread).

    Control files (updater state) are preserved; everything else is replaced.
    """
    UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    for item in UPLOAD_ROOT.iterdir():
        if item.name in CONTROL_FILES:
            continue
        try:
            if item.is_file() or item.is_symlink():
                item.unlink()
            else:
                shutil.rmtree(item, ignore_errors=True)
        except OSError:
            pass
    src = Path(source_dir)
    if src.exists():
        for item in src.iterdir():
            if item.is_file():
                shutil.copy2(item, UPLOAD_ROOT / item.name)
