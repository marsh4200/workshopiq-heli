"""Background scheduler for the 6-hourly Samba auto-backup.

Runs as a single asyncio task per worker. Because the backend runs several
uvicorn workers, the actual backup is guarded by a Postgres advisory lock plus
a DB timestamp (``smb_last_backup_at``) so EXACTLY ONE backup happens per
interval no matter how many workers are alive — mirroring the bootstrap lock
pattern already used at startup.

Behaviour (only when a share is configured AND auto-backup is enabled):
  - every INTERVAL (6h) a full backup zip is built and pushed to the share
  - the share is rotated to keep only the newest 2 archives
  - success/failure and the timestamp are recorded in settings for the UI
"""
import asyncio
import logging
import os
import tempfile
from datetime import datetime, timezone

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, select

from app.core.config import settings as app_settings
from app.core.database import AsyncSessionLocal, engine
from app.services import backup_service, samba_service
from app.services.samba_service import SambaConfig
from app.services.settings_service import get_all_settings, set_setting

logger = logging.getLogger("workshopiq.samba.scheduler")

INTERVAL_SECONDS = 6 * 60 * 60          # back up every 6 hours
CHECK_EVERY_SECONDS = 5 * 60            # wake up this often to see if one is due
STARTUP_DELAY_SECONDS = 120            # let the app settle before the first check
LOCK_KEY = 0x77081943                   # distinct from bootstrap's 0x77081942


def _cfg_from_settings(s: dict) -> SambaConfig:
    return SambaConfig(
        server=s.get("smb_server", ""),
        share=s.get("smb_share", ""),
        username=s.get("smb_username", ""),
        password=s.get("smb_password", ""),
        subpath=s.get("smb_subpath", ""),
    )


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _is_due(s: dict, now: datetime) -> bool:
    last = _parse_dt(s.get("smb_last_backup_at"))
    if last is None:
        return True
    return (now - last).total_seconds() >= INTERVAL_SECONDS


async def run_backup_to_share(cfg: SambaConfig) -> str:
    """Build a backup and push it to the share. Returns the remote filename.

    Raises on any failure (caller records the error).
    """
    async with AsyncSessionLocal() as db:
        database, counts = await backup_service.collect_database(db)

    path = await run_in_threadpool(
        backup_service.write_archive, database, counts, app_settings.APP_VERSION
    )
    try:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        remote = f"{samba_service.AUTO_PREFIX}{stamp}{samba_service.AUTO_SUFFIX}"
        await run_in_threadpool(samba_service.push_file, cfg, path, remote)
        await run_in_threadpool(samba_service.rotate, cfg)
        return remote
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


async def _maybe_run_once() -> None:
    """Check whether a backup is due and, if so, run it under the lock."""
    async with AsyncSessionLocal() as db:
        s = await get_all_settings(db)

    if s.get("smb_auto_backup") != "1":
        return
    cfg = _cfg_from_settings(s)
    if not cfg.configured:
        return

    now = datetime.now(timezone.utc)
    if not _is_due(s, now):
        return

    # Only one worker should perform the backup. Grab a try-lock; if another
    # worker holds it, skip this cycle entirely.
    async with engine.connect() as conn:
        won = await conn.scalar(select(func.pg_try_advisory_lock(LOCK_KEY)))
        if not won:
            return
        try:
            # Re-read under the lock — another worker may have just finished.
            async with AsyncSessionLocal() as db:
                s2 = await get_all_settings(db)
            if s2.get("smb_auto_backup") != "1" or not _is_due(s2, datetime.now(timezone.utc)):
                return

            cfg = _cfg_from_settings(s2)
            logger.info("Starting scheduled Samba backup to %s", cfg.unc_dir())
            try:
                remote = await run_backup_to_share(cfg)
                status = "ok"
                logger.info("Scheduled Samba backup complete: %s", remote)
            except Exception as exc:  # noqa: BLE001 — record and retry next cycle
                status = f"error: {exc}"
                logger.warning("Scheduled Samba backup failed: %s", exc)

            async with AsyncSessionLocal() as db:
                await set_setting(
                    db, "smb_last_backup_at", datetime.now(timezone.utc).isoformat()
                )
                await set_setting(db, "smb_last_backup_status", status)
                await db.commit()
        finally:
            await conn.execute(select(func.pg_advisory_unlock(LOCK_KEY)))


async def scheduler_loop() -> None:
    """Long-running task: periodically check and run the auto-backup."""
    await asyncio.sleep(STARTUP_DELAY_SECONDS)
    logger.info("Samba auto-backup scheduler started")
    while True:
        try:
            await _maybe_run_once()
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let the loop die
            logger.warning("Samba scheduler tick errored: %s", exc)
        await asyncio.sleep(CHECK_EVERY_SECONDS)
