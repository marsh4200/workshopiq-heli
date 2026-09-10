"""Manual ("Back Up Now") Samba backup with live progress.

The 6-hourly auto-backup (samba_scheduler) is fire-and-forget. The manual
button instead runs the *same* backup as a tracked background task and
publishes its progress so the UI can show a progress bar.

Progress is stored in a settings row (``smb_backup_progress``) rather than in
worker memory because the API runs several uvicorn workers: the POST that
starts the backup lands on one worker, but the browser's progress polls may hit
any of them, so the state has to be somewhere they all share — the database.

Phase → percent budget:
    collecting records      4%
    packing the archive    12%
    uploading to the share 35% → 95%  (byte-accurate; the slow part)
    rotating old copies    96%
    done                  100%
"""
import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone

from fastapi.concurrency import run_in_threadpool

from app.core.config import settings as app_settings
from app.core.database import AsyncSessionLocal
from app.services import backup_service, samba_service
from app.services.samba_service import SambaConfig
from app.services.settings_service import get_setting, set_setting

logger = logging.getLogger("workshopiq.samba.manual")

PROGRESS_KEY = "smb_backup_progress"

# A "running" job whose progress hasn't been touched for this long is treated as
# dead (the worker likely crashed mid-backup), so it can't block new runs.
STALE_AFTER_SECONDS = 300

# Hold references to in-flight tasks so create_task() results aren't garbage
# collected before they finish.
_tasks: "set[asyncio.Task]" = set()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _payload(state: str, percent: float, phase: str, **extra) -> dict:
    body = {
        "state": state,
        "percent": max(0, min(100, int(percent))),
        "phase": phase,
        "updated_at": _now_iso(),
    }
    body.update(extra)
    return body


async def _write_progress(state: str, percent: float, phase: str, *, job_id: str, **extra) -> None:
    async with AsyncSessionLocal() as db:
        await set_setting(
            db, PROGRESS_KEY, json.dumps(_payload(state, percent, phase, job_id=job_id, **extra))
        )
        await db.commit()


async def read_progress(db) -> dict:
    """Current backup progress for the UI (safe default when none has run)."""
    raw = await get_setting(db, PROGRESS_KEY, "")
    if not raw:
        return {"state": "idle", "percent": 0, "phase": "", "job_id": None}
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return {"state": "idle", "percent": 0, "phase": "", "job_id": None}


def is_active(progress: dict) -> bool:
    """True if a backup is currently running and not stale."""
    if progress.get("state") != "running":
        return False
    raw = progress.get("updated_at")
    try:
        last = datetime.fromisoformat(raw) if raw else None
    except (ValueError, TypeError):
        last = None
    if last is None:
        return True
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - last).total_seconds() < STALE_AFTER_SECONDS


async def start_manual_backup(cfg: SambaConfig) -> str:
    """Kick off a backup in the background and return its job id immediately."""
    job_id = uuid.uuid4().hex
    await _write_progress("running", 1, "Preparing backup…", job_id=job_id)
    task = asyncio.create_task(_run(job_id, cfg))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return job_id


async def _run(job_id: str, cfg: SambaConfig) -> None:
    path = None
    try:
        # 1) Logical DB dump.
        await _write_progress("running", 4, "Collecting records…", job_id=job_id)
        async with AsyncSessionLocal() as db:
            database, counts = await backup_service.collect_database(db)

        # 2) Build the archive (DB JSON + every uploaded photo/document).
        await _write_progress("running", 12, "Packing files…", job_id=job_id)
        path = await run_in_threadpool(
            backup_service.write_archive, database, counts, app_settings.APP_VERSION
        )

        # 3) Upload to the share — byte-accurate, the part worth a progress bar.
        total = max(os.path.getsize(path), 1)
        shared = {"sent": 0, "total": total}
        await _write_progress("running", 35, "Uploading to share…", job_id=job_id)

        stop = asyncio.Event()

        async def pump() -> None:
            # Persist upload progress (mapped to 35→95%) until the upload ends.
            while not stop.is_set():
                frac = min(shared["sent"] / (shared["total"] or 1), 1.0)
                await _write_progress(
                    "running", 35 + 60 * frac, "Uploading to share…", job_id=job_id
                )
                try:
                    await asyncio.wait_for(stop.wait(), timeout=0.7)
                except asyncio.TimeoutError:
                    pass

        pump_task = asyncio.create_task(pump())

        def on_chunk(sent: int, tot: int) -> None:
            shared["sent"] = sent
            shared["total"] = tot or shared["total"]

        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        remote = f"{samba_service.AUTO_PREFIX}{stamp}{samba_service.AUTO_SUFFIX}"
        try:
            await run_in_threadpool(samba_service.push_file, cfg, path, remote, on_chunk)
        finally:
            stop.set()
            await pump_task

        # 4) Rotate so the share keeps only the newest copies.
        await _write_progress("running", 96, "Cleaning up old copies…", job_id=job_id)
        await run_in_threadpool(samba_service.rotate, cfg)

        # 5) Record success (same settings the auto-backup writes).
        finished = _now_iso()
        async with AsyncSessionLocal() as db:
            await set_setting(db, "smb_last_backup_at", finished)
            await set_setting(db, "smb_last_backup_status", "ok")
            await db.commit()

        await _write_progress(
            "done", 100, "Backup complete", job_id=job_id,
            detail=f"Backed up to {remote}", finished_at=finished,
        )
        logger.info("Manual Samba backup complete: %s", remote)
    except Exception as exc:  # noqa: BLE001 — surfaced to the UI via progress
        logger.warning("Manual Samba backup failed: %s", exc)
        try:
            async with AsyncSessionLocal() as db:
                await set_setting(db, "smb_last_backup_status", f"error: {exc}")
                await db.commit()
        except Exception:  # noqa: BLE001 — best effort; don't mask the original
            pass
        await _write_progress("error", 100, "Backup failed", job_id=job_id, error=str(exc))
    finally:
        if path:
            try:
                os.remove(path)
            except OSError:
                pass
