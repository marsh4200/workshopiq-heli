"""Full-system backup & restore endpoints (administrator only)."""
import asyncio
import json
import os
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask

from app.api.deps import require_admin
from app.core.config import settings as app_settings
from app.core.database import AsyncSessionLocal, get_db
from app.models import User
from app.services import backup_service

router = APIRouter(prefix="/settings", tags=["backup"])

# Job workspace lives in the uploads volume so any uvicorn worker can read a
# job's progress file and serve its finished zip (progress is written by the
# worker that runs the build; downloads/polls may land on a different worker).
JOBS_DIR = Path(app_settings.UPLOAD_DIR) / ".backup-jobs"
JOB_TTL_SECONDS = 3600  # tidy up abandoned jobs after an hour

# Bundled Android app. Lives under app/static so it is COPYed into the backend
# image and travels with every git-tag deploy (no separate volume needed).
ANDROID_APK_PATH = Path(__file__).resolve().parent.parent / "static" / "WorkshopIQ.apk"


@router.get("/app/android")
async def download_android_app(
    _: User = Depends(require_admin),
):
    """Download the WorkshopIQ Android app (.apk). Administrators only."""
    if not ANDROID_APK_PATH.is_file():
        raise HTTPException(status_code=404, detail="Android app is not available.")
    return FileResponse(
        ANDROID_APK_PATH,
        media_type="application/vnd.android.package-archive",
        filename="WorkshopIQ.apk",
    )


@router.get("/backup")
async def download_backup(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Build and download a complete system backup (database + uploads)."""
    database, counts = await backup_service.collect_database(db)
    path = await run_in_threadpool(
        backup_service.write_archive, database, counts, app_settings.APP_VERSION
    )
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"workshopiq-backup-{stamp}.zip"
    return FileResponse(
        path,
        media_type="application/zip",
        filename=filename,
        background=BackgroundTask(_cleanup, path),
    )


def _cleanup(path: str) -> None:
    import os

    try:
        os.remove(path)
    except OSError:
        pass


# ----------------------- progress-tracked backup (job flow) -----------------------
def _job_paths(job_id: str) -> tuple[Path, Path]:
    safe = "".join(c for c in job_id if c.isalnum() or c in "-_")
    return JOBS_DIR / f"{safe}.json", JOBS_DIR / f"{safe}.zip"


def _write_progress(job_id: str, **fields) -> None:
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    prog, _ = _job_paths(job_id)
    try:
        prog.write_text(json.dumps(fields))
    except OSError:
        pass


def _read_progress(job_id: str) -> dict | None:
    prog, _ = _job_paths(job_id)
    try:
        if prog.exists():
            return json.loads(prog.read_text())
    except (OSError, ValueError):
        return None
    return None


def _sweep_old_jobs() -> None:
    """Best-effort cleanup of stale job files left by abandoned backups."""
    if not JOBS_DIR.exists():
        return
    cutoff = time.time() - JOB_TTL_SECONDS
    for item in JOBS_DIR.iterdir():
        try:
            if item.stat().st_mtime < cutoff:
                item.unlink()
        except OSError:
            pass


async def _run_backup_job(job_id: str) -> None:
    """Build the backup in the background, streaming progress to the job file."""
    _, zip_path = _job_paths(job_id)
    try:
        _write_progress(job_id, state="running", percent=3, phase="Reading database")
        async with AsyncSessionLocal() as db:
            database, counts = await backup_service.collect_database(db)
        _write_progress(job_id, state="running", percent=18, phase="Database read")

        def on_progress(pct: int, stage: str) -> None:
            _write_progress(job_id, state="running", percent=pct, phase=stage)

        await run_in_threadpool(
            backup_service.write_archive,
            database,
            counts,
            app_settings.APP_VERSION,
            str(zip_path),
            on_progress,
        )
        size = zip_path.stat().st_size if zip_path.exists() else 0
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        _write_progress(
            job_id,
            state="done",
            percent=100,
            phase="Backup ready",
            filename=f"workshopiq-backup-{stamp}.zip",
            size=size,
        )
    except Exception as exc:  # noqa: BLE001 — surface any failure to the UI
        _write_progress(job_id, state="error", percent=0, phase="Failed", error=str(exc))
        try:
            if zip_path.exists():
                zip_path.unlink()
        except OSError:
            pass


@router.post("/backup/start")
async def start_backup(_: User = Depends(require_admin)):
    """Kick off a backup build and return a job id to poll for progress."""
    _sweep_old_jobs()
    job_id = uuid.uuid4().hex
    _write_progress(job_id, state="running", percent=0, phase="Starting…")
    asyncio.create_task(_run_backup_job(job_id))
    return {"ok": True, "job_id": job_id}


@router.get("/backup/progress/{job_id}")
async def backup_progress(job_id: str, _: User = Depends(require_admin)):
    prog = _read_progress(job_id)
    if prog is None:
        raise HTTPException(status_code=404, detail="Unknown or expired backup job")
    return prog


@router.get("/backup/download/{job_id}")
async def download_backup_job(job_id: str, _: User = Depends(require_admin)):
    prog = _read_progress(job_id)
    prog_path, zip_path = _job_paths(job_id)
    if prog is None or prog.get("state") != "done" or not zip_path.exists():
        raise HTTPException(status_code=409, detail="Backup is not ready")
    filename = prog.get("filename") or "workshopiq-backup.zip"

    def _cleanup_job() -> None:
        for p in (zip_path, prog_path):
            try:
                p.unlink()
            except OSError:
                pass

    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=filename,
        background=BackgroundTask(_cleanup_job),
    )


@router.post("/restore")
async def restore_backup(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Restore the whole system from an uploaded backup .zip.

    This OVERWRITES all current data and uploads with the contents of the
    backup. Intended for disaster recovery onto a fresh install.
    """
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="No file uploaded.")

    with tempfile.TemporaryDirectory(prefix="workshopiq-restore-") as work:
        try:
            manifest, database, uploads_dir = await run_in_threadpool(
                backup_service.read_archive, file_bytes, work
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        try:
            counts = await backup_service.restore_database(db, database)
        except Exception as exc:  # noqa: BLE001
            await db.rollback()
            raise HTTPException(status_code=500, detail=f"Database restore failed: {exc}")

        await run_in_threadpool(backup_service.replace_uploads, uploads_dir)

    return {
        "status": "ok",
        "restored_from_version": manifest.get("app_version"),
        "created_at": manifest.get("created_at"),
        "counts": counts,
    }
