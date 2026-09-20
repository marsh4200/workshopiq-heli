"""License activation endpoints.

Deliberately unauthenticated: an unlicensed install can't log in at all (see
the ``license_gate`` middleware in ``main.py``), so activation itself can't
sit behind a login. The security boundary is the Ed25519 signature, not a
password — nothing reachable here lets a caller do anything except read this
install's own server_id or submit a license key for verification.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.services import licensing
from app.services.settings_service import set_setting

router = APIRouter(prefix="/license", tags=["license"])


@router.get("/status")
async def license_status():
    # get_status() resolves (and now properly persists) the server_id itself
    # — no separate DB session needed here.
    return await licensing.get_status()


@router.post("/activate")
async def activate(body: dict, db: AsyncSession = Depends(get_db)):
    license_key = (body.get("license_key") or "").strip()
    server_id = await licensing.get_or_create_server_id(db)
    # Commit here too (not only on a successful activation below) — if this
    # is the very first request this install has ever handled, this is what
    # persists the server_id it just generated instead of silently losing it
    # when an invalid/empty key on this same call means the code below never
    # commits.
    await db.commit()
    if not license_key:
        return {"activated": False, "reason": "empty", "server_id": server_id}

    result = licensing.evaluate(license_key, server_id)
    if result["activated"]:
        await set_setting(db, "license_key", license_key)
        await db.commit()
        licensing.bust_cache()
    return {**result, "server_id": server_id}


@router.post("/request")
async def request_license():
    """Ask the licence server for this install's key (same call AR HDL BUSPRO
    and GuestIQ make). Reachable while unlicensed — see license_gate."""
    return {**(await licensing.request_from_server()), **licensing.last_contact()}
