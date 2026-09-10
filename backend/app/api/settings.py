"""Application settings and self-update endpoints."""
import re
import subprocess
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_admin
from app.core.config import settings as app_settings
from app.core.database import get_db
from app.models import User
from app.schemas import SettingsOut, SettingsUpdate, TestEmailRequest, TestEmailResult
from app.services import email_service, file_service
from app.services.settings_service import get_all_settings, get_setting, set_setting

router = APIRouter(prefix="/settings", tags=["settings"])


async def _build_settings_out(db: AsyncSession) -> SettingsOut:
    s = await get_all_settings(db)
    return SettingsOut(
        company_name=s.get("company_name", "WorkshopIQ"),
        company_logo=s.get("company_logo") or None,
        dashboard_branding=s.get("dashboard_branding") or None,
        job_number_prefix=s.get("job_number_prefix", "Job"),
        email_host=s.get("email_host") or None,
        email_port=s.get("email_port") or None,
        email_user=s.get("email_user") or None,
        email_from=s.get("email_from") or None,
        email_password_set=bool(s.get("email_password")),
        whatsapp_country_code=s.get("whatsapp_country_code") or "27",
        github_repo_url=s.get("github_repo_url") or None,
        current_version=s.get("current_version", app_settings.APP_VERSION),
        available_version=s.get("available_version") or None,
        backup_before_update=str(s.get("backup_before_update", "1")).lower()
        not in ("0", "false", "no", ""),
        backup_keep=int(s.get("backup_keep", "2") or 2),
        maintenance_mode=str(s.get("maintenance_mode", "0")).lower()
        in ("1", "true", "yes", "on"),
        server_shutdown=str(s.get("server_shutdown", "0")).lower()
        in ("1", "true", "yes", "on"),
    )


@router.get("", response_model=SettingsOut)
async def read_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return await _build_settings_out(db)


@router.put("", response_model=SettingsOut)
async def update_settings(
    payload: SettingsUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    fields = payload.model_dump(exclude_none=True)
    for key, value in fields.items():
        if isinstance(value, bool):
            value = "1" if value else "0"
        await set_setting(db, key, str(value))
    await db.commit()
    if "maintenance_mode" in fields:
        from app.services.maintenance import bust_cache

        bust_cache(bool(fields["maintenance_mode"]))
    if "server_shutdown" in fields:
        from app.services.maintenance import bust_shutdown_cache

        bust_shutdown_cache(bool(fields["server_shutdown"]))
    return await _build_settings_out(db)


@router.post("/test-email", response_model=TestEmailResult)
async def test_email(
    payload: TestEmailRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Send a one-off test message using the currently saved SMTP settings.

    Defaults to the requesting administrator's own account email so there's
    no extra typing for the common case of "does this work at all".
    """
    to_addr = (payload.to or user.email or "").strip()
    if not to_addr:
        return TestEmailResult(
            success=False,
            detail="No recipient — set an email on your account or provide one.",
        )
    try:
        await email_service.send_email(
            db,
            [to_addr],
            subject="WorkshopIQ — test email",
            text_body=(
                "This is a test email from WorkshopIQ. If you're reading this, "
                "your SMTP settings are working."
            ),
        )
    except email_service.EmailNotConfigured as exc:
        return TestEmailResult(success=False, detail=str(exc))
    except Exception as exc:  # noqa: BLE001 — surface the SMTP error to the admin
        return TestEmailResult(success=False, detail=f"Send failed: {exc}")
    return TestEmailResult(success=True, detail=f"Test email sent to {to_addr}.")


@router.post("/logo", response_model=SettingsOut)
async def upload_logo(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    try:
        stored, _orig = await file_service.save_upload(file, 0)
    except ValueError as exc:
        raise HTTPException(status_code=413, detail=str(exc))
    await set_setting(db, "company_logo", stored)
    await db.commit()
    return await _build_settings_out(db)


@router.get("/logo/{filename}")
async def serve_logo(filename: str):
    from fastapi.responses import FileResponse

    path = file_service.file_path(filename)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Logo not found")
    return FileResponse(path)


def _parse_github_repo(url: str) -> str | None:
    """Extract owner/repo from the configured update-source URL."""
    m = re.search(r"github\.com[/:]([^/]+/[^/.]+)", url)
    return m.group(1) if m else None


@router.post("/check-updates", response_model=SettingsOut)
async def check_updates(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    s = await get_all_settings(db)
    repo_url = s.get("github_repo_url", "")
    repo = _parse_github_repo(repo_url) if repo_url else None
    if not repo:
        raise HTTPException(
            status_code=400,
            detail="Update source is not configured. Contact AR Smart Home Server support.",
        )
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "ARSmartHomeServer-Updater",
    }
    releases_url = f"https://api.github.com/repos/{repo}/releases/latest"
    tags_url = f"https://api.github.com/repos/{repo}/tags"
    try:
        async with httpx.AsyncClient(timeout=15, headers=headers) as client:
            resp = await client.get(releases_url)
            if resp.status_code == 403:
                raise HTTPException(
                    status_code=429,
                    detail="Update check is temporarily rate-limited. Try again later.",
                )
            if resp.status_code == 404:
                # No formal Release — fall back to the latest git tag.
                tags_resp = await client.get(tags_url)
                tags_resp.raise_for_status()
                tags = tags_resp.json()
                if not tags:
                    raise HTTPException(
                        status_code=404,
                        detail="No releases or tags found for that repository",
                    )
                latest = str(tags[0].get("name", "")).lstrip("v")
            else:
                resp.raise_for_status()
                latest = resp.json().get("tag_name", "").lstrip("v")
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Update check failed: {exc}")

    await set_setting(db, "available_version", latest or "")
    await db.commit()
    return await _build_settings_out(db)


UPLOAD_DIR = Path("/app/uploads")


@router.get("/update-status")
async def update_status(_: User = Depends(require_admin)):
    """Return the current update status and progress log for the UI to poll."""
    status_file = UPLOAD_DIR / ".update-status"
    log_file = UPLOAD_DIR / ".update-log"
    pct_file = UPLOAD_DIR / ".update-pct"
    status = "idle"
    log = ""
    pct: int | None = None
    try:
        if status_file.exists():
            status = status_file.read_text().strip() or "idle"
    except OSError:
        pass
    try:
        if log_file.exists():
            log = log_file.read_text()
    except OSError:
        pass
    try:
        if pct_file.exists():
            pct = max(0, min(100, int(pct_file.read_text().strip())))
    except (OSError, ValueError):
        pass
    return {"status": status, "log": log, "pct": pct}


@router.post("/apply-update")
async def apply_update(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Request a host-side update and seed initial progress state.

    The actual work (backup + pull + rebuild + restart) is performed by the
    host watcher (scripts/update.sh --watch), which streams progress back into
    the uploads volume for the UI to display. This avoids giving the container
    privileged Docker access.
    """
    try:
        pref = await get_setting(db, "backup_before_update", "1")
        do_backup = str(pref).lower() not in ("0", "false", "no", "")
        marker = "update" if do_backup else "update-nobackup"
        (UPLOAD_DIR / ".update-status").write_text("queued")
        (UPLOAD_DIR / ".update-pct").write_text("2")
        seed = (
            "[queued] Update requested. Waiting for the update service…\n"
            if do_backup
            else "[queued] Update requested (update only, no backup). Waiting for the update service…\n"
        )
        (UPLOAD_DIR / ".update-log").write_text(seed)
        (UPLOAD_DIR / ".update-requested").write_text(marker)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not request update: {exc}")
    return {
        "status": "requested",
        "detail": "Update requested. Watch the progress for live status.",
    }
