"""Startup bootstrap: create tables and seed default data."""
import logging

from sqlalchemy import func, select, text

from app.core.config import settings
from app.core.database import AsyncSessionLocal, Base, engine
from app.core.security import hash_password
from app.models import InspectionTemplate, TemplateItem, User, UserRole
from app.services.settings_service import ensure_defaults, get_all_settings, set_setting
from app.services.templates_data import DEFAULT_TEMPLATES

logger = logging.getLogger("workshopiq.bootstrap")


async def init_models() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


# Foreign-key / hot-path indexes that SQLAlchemy's create_all won't add to
# tables that already exist. These are the columns the job-detail loader and
# the dashboard filter/sort on; without them Postgres falls back to full table
# scans as rows accumulate (timeline_events grows on every action), which is
# the classic "snappy at first, then a tab hangs after a while" symptom.
#
# CREATE INDEX IF NOT EXISTS is idempotent (no-op once built) and the index
# names match SQLAlchemy's own convention (ix_<table>_<col>) so adding
# index=True in the models later won't create duplicates. Tables here are
# small (a workshop's jobs), so the brief build lock is negligible.
INDEX_STATEMENTS = (
    "CREATE INDEX IF NOT EXISTS ix_photos_job_id ON photos (job_id)",
    "CREATE INDEX IF NOT EXISTS ix_documents_job_id ON documents (job_id)",
    "CREATE INDEX IF NOT EXISTS ix_notes_job_id ON notes (job_id)",
    "CREATE INDEX IF NOT EXISTS ix_timeline_events_job_id ON timeline_events (job_id)",
    "CREATE INDEX IF NOT EXISTS ix_timeline_events_created_at ON timeline_events (created_at)",
    "CREATE INDEX IF NOT EXISTS ix_inspections_job_id ON inspections (job_id)",
    "CREATE INDEX IF NOT EXISTS ix_inspection_items_inspection_id ON inspection_items (inspection_id)",
    "CREATE INDEX IF NOT EXISTS ix_jobs_date_received ON jobs (date_received)",
)


async def ensure_indexes() -> None:
    async with engine.begin() as conn:
        for stmt in INDEX_STATEMENTS:
            await conn.execute(text(stmt))
    logger.info("Ensured performance indexes")


# Additive column migrations for tables that already exist (create_all won't
# alter them). ADD COLUMN IF NOT EXISTS is idempotent on Postgres 9.6+, so this
# is safe to run on every startup. Each new model column that ships after the
# table's first creation needs a line here.
COLUMN_STATEMENTS = (
    # Final-inspection fail / re-inspection path.
    "ALTER TABLE final_inspections ADD COLUMN IF NOT EXISTS result VARCHAR(10)",
    "ALTER TABLE final_inspections ADD COLUMN IF NOT EXISTS failure_reason TEXT",
    "ALTER TABLE final_inspections ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE final_inspections ADD COLUMN IF NOT EXISTS failed_by_id INTEGER REFERENCES users(id)",
    "ALTER TABLE final_inspections ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ",
    # Optional NCR number relating a failed attempt to a raised non-conformance report.
    "ALTER TABLE final_inspections ADD COLUMN IF NOT EXISTS ncr_number VARCHAR(120)",
    "ALTER TABLE final_inspection_attempts ADD COLUMN IF NOT EXISTS ncr_number VARCHAR(120)",
    # Final-inspection "request for closure" path (admin-approved internal pass).
    "ALTER TABLE final_inspections ADD COLUMN IF NOT EXISTS closure_status VARCHAR(10)",
    "ALTER TABLE final_inspections ADD COLUMN IF NOT EXISTS closure_reason TEXT",
    "ALTER TABLE final_inspections ADD COLUMN IF NOT EXISTS closure_requested_by_id INTEGER REFERENCES users(id)",
    "ALTER TABLE final_inspections ADD COLUMN IF NOT EXISTS closure_requested_at TIMESTAMPTZ",
    "ALTER TABLE final_inspections ADD COLUMN IF NOT EXISTS closure_decided_by_id INTEGER REFERENCES users(id)",
    "ALTER TABLE final_inspections ADD COLUMN IF NOT EXISTS closure_decided_at TIMESTAMPTZ",
    "ALTER TABLE final_inspections ADD COLUMN IF NOT EXISTS closure_rejection_reason TEXT",
    # Optional EQ number alongside the PO number.
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS eq_number VARCHAR(120)",
    # Optional target/promised completion date.
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS due_date DATE",
    # Number of identical items received under one job (intake quantity).
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1",
    # Per-user appearance preference (light / dark / system).
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_preference VARCHAR(10) NOT NULL DEFAULT 'dark'",
    # Most recent successful login timestamp (null until first sign-in).
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ",
    # First-login terms acceptance timestamp (null until accepted).
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ",
    # Client-portal inspection-report sign-off (client signs the filed report).
    "ALTER TABLE inspection_reports ADD COLUMN IF NOT EXISTS client_signed BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE inspection_reports ADD COLUMN IF NOT EXISTS client_signed_name VARCHAR(255)",
    "ALTER TABLE inspection_reports ADD COLUMN IF NOT EXISTS client_signature_png TEXT",
    "ALTER TABLE inspection_reports ADD COLUMN IF NOT EXISTS client_signed_at TIMESTAMPTZ",
    "ALTER TABLE inspection_reports ADD COLUMN IF NOT EXISTS client_signed_by_id INTEGER REFERENCES users(id)",
    # Header fields set by staff at generation time and locked (read-only) on
    # the public phone form.
    "ALTER TABLE inspection_reports ADD COLUMN IF NOT EXISTS drawing_number VARCHAR(120)",
    "ALTER TABLE inspection_reports ADD COLUMN IF NOT EXISTS qcp_no VARCHAR(120)",
    "ALTER TABLE inspection_reports ADD COLUMN IF NOT EXISTS quantity VARCHAR(60)",
    # Per-job manual email-notification toggles + last-sent timestamps.
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS notify_on_status_change BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS notify_on_job_completion BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_status_email_at TIMESTAMPTZ",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_completion_email_at TIMESTAMPTZ",
    # Optional free-text "login name" per email contact, so a drafted email can
    # reference {username} alongside {name} for contacts whose login differs
    # from their display name.
    "ALTER TABLE job_email_contacts ADD COLUMN IF NOT EXISTS username VARCHAR(255)",
)

# One-off data fixes after the columns exist. Backfill is idempotent (the WHERE
# clause only matches rows that haven't been set yet).
BACKFILL_STATEMENTS = (
    # Inspections completed before the result column existed were all passes.
    "UPDATE final_inspections SET result = 'passed' WHERE completed = TRUE AND result IS NULL",
    # job_email_contacts is a brand-new table (created by init_models()'s
    # create_all, which runs before this) that replaces the old single
    # Job.email field as the source of who gets notification emails. Give
    # every job that already had an email on file a starting contact so
    # existing jobs aren't left with nothing to pick from the first time
    # someone opens the new Send Email dialog. The NOT EXISTS guard makes
    # this safe to run on every startup.
    """
    INSERT INTO job_email_contacts (job_id, name, email, created_at)
    SELECT jobs.id,
           COALESCE(NULLIF(TRIM(jobs.contact_person), ''), NULLIF(TRIM(jobs.customer_name), ''), 'Contact'),
           jobs.email,
           NOW()
    FROM jobs
    WHERE jobs.email IS NOT NULL AND TRIM(jobs.email) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM job_email_contacts jec
        WHERE jec.job_id = jobs.id AND jec.email = jobs.email
      )
    """,
)


async def ensure_columns() -> None:
    async with engine.begin() as conn:
        for stmt in COLUMN_STATEMENTS:
            await conn.execute(text(stmt))
        for stmt in BACKFILL_STATEMENTS:
            await conn.execute(text(stmt))
    logger.info("Ensured additive column migrations")


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        # Default admin
        count = await db.scalar(select(func.count()).select_from(User))
        if not count:
            admin = User(
                username=settings.DEFAULT_ADMIN_USERNAME,
                full_name="Administrator",
                hashed_password=hash_password(settings.DEFAULT_ADMIN_PASSWORD),
                role=UserRole.administrator.value,
                is_active=True,
                must_change_password=True,
            )
            db.add(admin)
            logger.info("Seeded default admin user")

        # Settings defaults
        await ensure_defaults(db)

        # Inspection templates. Additive: only creates templates for
        # component types that don't have one yet, so shipping new entries
        # in DEFAULT_TEMPLATES (templates_data.py) picks them up on the next
        # restart of an already-seeded install, without touching any
        # template a user has already customized.
        existing_types = set(
            (await db.execute(select(InspectionTemplate.component_type))).scalars()
        )
        added = []
        for comp_type, items in DEFAULT_TEMPLATES.items():
            if comp_type in existing_types:
                continue
            template = InspectionTemplate(
                component_type=comp_type, name=f"{comp_type} Inspection"
            )
            db.add(template)
            await db.flush()
            for idx, label in enumerate(items):
                db.add(
                    TemplateItem(
                        template_id=template.id, label=label, order_index=idx
                    )
                )
            added.append(comp_type)
        if added:
            logger.info("Seeded default inspection templates: %s", ", ".join(added))

        await db.commit()


async def sync_current_version() -> None:
    """Set current_version from the applied-update marker if present, else from
    the build's APP_VERSION. Honors the updater handshake: scripts/update.sh
    writes the checked-out tag into .update-version, which we consume here so
    the UI reflects what was actually deployed. Clears a now-satisfied
    'available_version' if it matches.
    """
    from pathlib import Path

    version = settings.APP_VERSION
    marker = Path(settings.UPLOAD_DIR) / ".update-version"
    try:
        if marker.exists():
            applied = marker.read_text().strip()
            if applied:
                version = applied
            marker.unlink(missing_ok=True)  # consume it so it can't re-apply
    except OSError as exc:
        logger.warning("Could not read .update-version: %s", exc)

    try:
        async with AsyncSessionLocal() as db:
            await set_setting(db, "current_version", version)
            current = await get_all_settings(db)
            if current.get("available_version", "") == version:
                await set_setting(db, "available_version", "")
            await db.commit()
        logger.info("Current version set to %s", version)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not sync current version: %s", exc)


async def run_bootstrap() -> None:
    # With multiple uvicorn workers, this must run EXACTLY ONCE — not once per
    # worker. sync_current_version() consumes the one-shot .update-version
    # marker, so if every worker ran it, the first would set the new version
    # and the rest would find the marker gone and clobber it back to the
    # build's APP_VERSION (causing an update that "falls back" to the old
    # version, then loops).
    #
    # So: the first worker grabs a try-lock and does all the setup. The others
    # fail the try-lock, block on the same lock until the first is done (schema
    # guaranteed ready), then release and skip the setup.
    lock_key = 0x77081942
    async with engine.connect() as conn:
        won = await conn.scalar(select(func.pg_try_advisory_lock(lock_key)))
        if not won:
            await conn.execute(select(func.pg_advisory_lock(lock_key)))
            await conn.execute(select(func.pg_advisory_unlock(lock_key)))
            logger.info("Bootstrap already handled by another worker; skipping")
            return
        try:
            await init_models()
            await ensure_indexes()
            await ensure_columns()
            await seed()
            await sync_current_version()
        finally:
            await conn.execute(select(func.pg_advisory_unlock(lock_key)))
