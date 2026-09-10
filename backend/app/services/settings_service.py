"""Settings key/value helpers."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as app_settings
from app.models import Setting

DEFAULTS = {
    "company_name": "WorkshopIQ",
    "company_logo": "",
    "dashboard_branding": "Engineering Workshop Management",
    "job_number_prefix": "Job",
    "job_sequence": "0",
    "ncr_number_prefix": "NCR",
    "ncr_sequence": "0",
    # Inspection-report certificate numbering. Format: "<prefix> <YY><NNNN>"
    # e.g. ECE 260001. Bump ece_sequence in Settings if you need to continue an
    # existing run of numbers.
    "ece_number_prefix": "ECE",
    "ece_sequence": "0",
    "email_host": "",
    "email_port": "587",
    "email_user": "",
    "email_password": "",
    "email_from": "",
    "whatsapp_country_code": "27",
    "github_repo_url": "https://github.com/marsh4200/workshopiq-heli",
    "current_version": app_settings.APP_VERSION,
    "available_version": "",
    # Update behaviour: whether to take a (self-pruning) backup before applying
    # an update, and how many backups to keep on disk.
    "backup_before_update": "1",
    "backup_keep": "2",
    # Samba network-drive backup
    "smb_server": "",
    "smb_share": "",
    "smb_username": "",
    "smb_password": "",
    "smb_subpath": "",
    "smb_auto_backup": "0",
    # Maintenance mode: when "1", only administrators can sign in / use the
    # API. Staff and clients get a 503 with a friendly maintenance message.
    "maintenance_mode": "0",
    # Server shutdown: a deeper lock than maintenance. When "1", only
    # administrators can sign in / use the API and everyone else is told the
    # server has been shut down. Takes precedence over maintenance_mode.
    "server_shutdown": "0",
    "smb_last_backup_at": "",
    "smb_last_backup_status": "",
    # Offline license activation (see app.services.licensing). server_id is
    # generated once on first boot and never changes; license_key is what the
    # admin pastes in on the activation screen.
    "server_id": "",
    "license_key": "",
}


async def get_setting(db: AsyncSession, key: str, default: str | None = None) -> str | None:
    row = await db.get(Setting, key)
    if row is None:
        return DEFAULTS.get(key, default)
    return row.value


async def set_setting(db: AsyncSession, key: str, value: str) -> None:
    row = await db.get(Setting, key)
    if row is None:
        row = Setting(key=key, value=value)
        db.add(row)
    else:
        row.value = value
    await db.flush()


async def get_all_settings(db: AsyncSession) -> dict[str, str]:
    result = await db.execute(select(Setting))
    stored = {s.key: (s.value or "") for s in result.scalars().all()}
    merged = dict(DEFAULTS)
    merged.update(stored)
    return merged


async def ensure_defaults(db: AsyncSession) -> None:
    result = await db.execute(select(Setting.key))
    existing = {r for r in result.scalars().all()}
    for key, value in DEFAULTS.items():
        if key not in existing:
            db.add(Setting(key=key, value=value))
    await db.flush()


async def next_job_number(db: AsyncSession) -> tuple[str, int]:
    """Increment sequence and return (job_number, sequence)."""
    prefix = await get_setting(db, "job_number_prefix") or "Job"
    seq_raw = await get_setting(db, "job_sequence") or "0"
    try:
        seq = int(seq_raw)
    except ValueError:
        seq = 0
    seq += 1
    await set_setting(db, "job_sequence", str(seq))
    return f"{prefix} {seq}", seq


async def next_ncr_number(db: AsyncSession) -> tuple[str, int]:
    """Increment the NCR sequence and return (ncr_number, sequence)."""
    prefix = await get_setting(db, "ncr_number_prefix") or "NCR"
    seq_raw = await get_setting(db, "ncr_sequence") or "0"
    try:
        seq = int(seq_raw)
    except ValueError:
        seq = 0
    seq += 1
    await set_setting(db, "ncr_sequence", str(seq))
    return f"{prefix} {seq}", seq


async def next_ece_number(db: AsyncSession) -> tuple[str, int]:
    """Increment the inspection-report sequence and return (cert_number, seq).

    Format: ``<prefix> <YY><NNNN>`` (e.g. ``ECE 260001``) — a two-digit year
    followed by a zero-padded running number, matching the existing
    certificate convention (e.g. ECE 230168).
    """
    from datetime import datetime, timezone

    prefix = await get_setting(db, "ece_number_prefix") or "ECE"
    seq_raw = await get_setting(db, "ece_sequence") or "0"
    try:
        seq = int(seq_raw)
    except ValueError:
        seq = 0
    seq += 1
    await set_setting(db, "ece_sequence", str(seq))
    yy = datetime.now(timezone.utc).strftime("%y")
    return f"{prefix} {yy}{seq:04d}", seq
