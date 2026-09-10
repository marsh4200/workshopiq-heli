"""Outbound email (SMTP) — a generic sender, nothing job-specific here.

Uses the Python standard library's ``smtplib`` — nothing new to add to
requirements.txt. SMTP is blocking, so the actual send runs in a threadpool
from async code via ``fastapi.concurrency.run_in_threadpool``, matching the
pattern used for the Samba backup client elsewhere in this codebase.

Sending is always staff-initiated (a "Send Email" button on a job, or the
Settings test-email button) — nothing in this app calls send_email() on its
own in response to a status change. See app/api/jobs.py's
POST /jobs/{job_id}/send-email for the job-notification flow: the subject and
body are composed client-side (mirroring the existing WhatsApp message), sent
here as-is to the job's own contact email, and never sent automatically.
"""
import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.settings_service import get_all_settings

logger = logging.getLogger("workshopiq.email")


class EmailNotConfigured(Exception):
    """Raised when SMTP host/from-address settings are missing."""


def _send_sync(
    host: str,
    port: int,
    username: str,
    password: str,
    from_addr: str,
    to_addrs: list[str],
    subject: str,
    text_body: str,
) -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = ", ".join(to_addrs)
    msg.attach(MIMEText(text_body, "plain"))

    if port == 465:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, timeout=20, context=context) as server:
            if username:
                server.login(username, password or "")
            server.sendmail(from_addr, to_addrs, msg.as_string())
    else:
        with smtplib.SMTP(host, port, timeout=20) as server:
            server.ehlo()
            try:
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
            except smtplib.SMTPNotSupportedError:
                pass  # server doesn't offer STARTTLS (e.g. local relay) — send plain
            if username:
                server.login(username, password or "")
            server.sendmail(from_addr, to_addrs, msg.as_string())


async def send_email(
    db: AsyncSession, to_addrs: list[str], subject: str, text_body: str
) -> None:
    """Send a plain-text email via the SMTP settings configured in Settings.

    Raises EmailNotConfigured if host/from-address aren't set, or whatever
    smtplib raises on a connection/auth/send failure — callers decide what to
    do with that (the job send-email endpoint surfaces it to the staff member
    who clicked Send; nothing here swallows it silently).
    """
    to_addrs = [a for a in (to_addrs or []) if a]
    if not to_addrs:
        return

    s = await get_all_settings(db)
    host = (s.get("email_host") or "").strip()
    user = (s.get("email_user") or "").strip()
    password = s.get("email_password") or ""
    from_addr = (s.get("email_from") or user).strip()
    port_raw = (s.get("email_port") or "587").strip()

    if not host or not from_addr:
        raise EmailNotConfigured("SMTP host and From address must be configured in Settings")

    try:
        port = int(port_raw)
    except ValueError:
        port = 587

    await run_in_threadpool(
        _send_sync, host, port, user, password, from_addr, to_addrs, subject, text_body
    )
