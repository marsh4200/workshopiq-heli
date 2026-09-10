"""Maintenance-mode helpers.

The flag itself lives in the settings table (key: ``maintenance_mode``), but
the HTTP middleware can't afford a database round-trip on every request, so
each worker keeps a short TTL cache. Toggling the flag through the settings
API busts the cache immediately on the worker that handled the PUT; any other
workers pick the change up within ``CACHE_TTL`` seconds.
"""
import time

from app.core.database import AsyncSessionLocal
from app.services.settings_service import get_setting

MAINTENANCE_MESSAGE = (
    "This server is currently under maintenance. Please try again later. "
    "If this continues, please contact your system administrator."
)

# Server shutdown: a deeper lock than maintenance. Same admin-only behaviour,
# but the wording tells staff/clients the server has been shut down. Kept in
# its own flag/cache so it can be toggled independently of maintenance_mode.
SHUTDOWN_MESSAGE = "This server has been shut down. Please contact your administrator."

CACHE_TTL = 3.0
_cache: dict = {"value": False, "at": 0.0}
_shutdown_cache: dict = {"value": False, "at": 0.0}

_TRUTHY = ("1", "true", "yes", "on")


def bust_cache(value: bool | None = None) -> None:
    """Force the next check to hit the DB, or pin a known-fresh value."""
    if value is None:
        _cache["at"] = 0.0
    else:
        _cache["value"] = bool(value)
        _cache["at"] = time.monotonic()


def bust_shutdown_cache(value: bool | None = None) -> None:
    """Force the next shutdown check to hit the DB, or pin a fresh value."""
    if value is None:
        _shutdown_cache["at"] = 0.0
    else:
        _shutdown_cache["value"] = bool(value)
        _shutdown_cache["at"] = time.monotonic()


async def is_maintenance_on() -> bool:
    now = time.monotonic()
    if now - _cache["at"] < CACHE_TTL:
        return bool(_cache["value"])
    try:
        async with AsyncSessionLocal() as db:
            raw = await get_setting(db, "maintenance_mode", "0")
    except Exception:  # noqa: BLE001 — never let the gate take the app down
        return bool(_cache["value"])
    on = str(raw or "").lower() in _TRUTHY
    _cache["value"] = on
    _cache["at"] = now
    return on


async def is_shutdown_on() -> bool:
    now = time.monotonic()
    if now - _shutdown_cache["at"] < CACHE_TTL:
        return bool(_shutdown_cache["value"])
    try:
        async with AsyncSessionLocal() as db:
            raw = await get_setting(db, "server_shutdown", "0")
    except Exception:  # noqa: BLE001 — never let the gate take the app down
        return bool(_shutdown_cache["value"])
    on = str(raw or "").lower() in _TRUTHY
    _shutdown_cache["value"] = on
    _shutdown_cache["at"] = now
    return on
