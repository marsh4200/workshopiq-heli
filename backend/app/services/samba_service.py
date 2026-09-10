"""Push WorkshopIQ backups to a Samba (SMB/CIFS) network share.

Uses smbprotocol's high-level ``smbclient`` API — a pure-Python SMB2/3 client,
so nothing has to be mounted and the container needs no special privileges.

All calls here are blocking (smbprotocol is synchronous); run them in a
threadpool from async code via ``fastapi.concurrency.run_in_threadpool``.

The auto-backup keeps the newest ``KEEP`` archives on the share and deletes
older ones, so the share always holds the two most recent backups (6h apart).
"""
import logging
import os

import smbclient

logger = logging.getLogger("workshopiq.samba")

# How many auto-backup archives to retain on the share. The scheduler runs
# every 6h, so KEEP=2 means "always the two most recent, ~6h apart".
KEEP = 2

# Auto-backups are written with this stem so rotation only ever touches files
# WorkshopIQ created — never anything else living on the same share.
AUTO_PREFIX = "workshopiq-auto-"
AUTO_SUFFIX = ".zip"


class SambaConfig:
    """Resolved connection settings for one share."""

    __slots__ = ("server", "share", "username", "password", "subpath")

    def __init__(self, server: str, share: str, username: str, password: str, subpath: str = ""):
        self.server = (server or "").strip()
        self.share = (share or "").strip().strip("/\\")
        self.username = (username or "").strip()
        self.password = password or ""
        # Optional folder inside the share, normalised to back-slashes, no
        # leading/trailing separators.
        self.subpath = (subpath or "").strip().strip("/\\").replace("/", "\\")

    @property
    def configured(self) -> bool:
        return bool(self.server and self.share)

    def unc_dir(self) -> str:
        base = rf"\\{self.server}\{self.share}"
        return rf"{base}\{self.subpath}" if self.subpath else base

    def unc_path(self, filename: str) -> str:
        return rf"{self.unc_dir()}\{filename}"


def _open_session(cfg: SambaConfig) -> None:
    """(Re)establish an authenticated session to the server.

    reset_connection_cache() drops any stale session/credentials from a
    previous config so a changed username/password takes effect immediately.
    """
    smbclient.reset_connection_cache()
    smbclient.register_session(
        cfg.server,
        username=cfg.username,
        password=cfg.password,
    )


def _ensure_dir(cfg: SambaConfig) -> None:
    """Create the target subfolder on the share if it doesn't exist."""
    if not cfg.subpath:
        return
    try:
        smbclient.makedirs(cfg.unc_dir(), exist_ok=True)
    except OSError as exc:  # noqa: BLE001 — surfaced to caller as a clean error
        raise OSError(f"Could not create folder '{cfg.subpath}' on the share: {exc}") from exc


def test_connection(cfg: SambaConfig) -> None:
    """Verify we can authenticate and reach the target folder.

    Raises OSError / ValueError with a human-readable message on failure.
    """
    if not cfg.configured:
        raise ValueError("Server and share name are required.")
    try:
        _open_session(cfg)
        _ensure_dir(cfg)
        # Listing the directory proves auth + path are good.
        smbclient.listdir(cfg.unc_dir())
    finally:
        smbclient.reset_connection_cache()


def push_file(cfg: SambaConfig, local_path: str, remote_filename: str, progress_cb=None) -> None:
    """Copy a local file onto the share as ``remote_filename``.

    ``progress_cb``, if given, is called as ``progress_cb(bytes_sent, total)``
    after each chunk so a caller can report upload progress. It must not raise;
    any exception from it is swallowed so a UI hiccup never breaks the backup.
    """
    _open_session(cfg)
    try:
        _ensure_dir(cfg)
        total = os.path.getsize(local_path)
        sent = 0
        if progress_cb:
            try:
                progress_cb(0, total)
            except Exception:  # noqa: BLE001 — progress is best-effort
                pass
        with open(local_path, "rb") as src, smbclient.open_file(
            cfg.unc_path(remote_filename), mode="wb"
        ) as dst:
            # Stream in chunks so a large backup never loads fully into memory.
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                dst.write(chunk)
                sent += len(chunk)
                if progress_cb:
                    try:
                        progress_cb(sent, total)
                    except Exception:  # noqa: BLE001 — progress is best-effort
                        pass
    finally:
        smbclient.reset_connection_cache()


def rotate(cfg: SambaConfig, keep: int = KEEP) -> list[str]:
    """Delete all but the newest ``keep`` auto-backups. Returns deleted names.

    'Newest' is decided by the timestamped filename (sortable), which avoids a
    stat() round-trip per file and is stable regardless of the server clock.
    """
    _open_session(cfg)
    deleted: list[str] = []
    try:
        names = [
            n
            for n in smbclient.listdir(cfg.unc_dir())
            if n.startswith(AUTO_PREFIX) and n.endswith(AUTO_SUFFIX)
        ]
        names.sort()  # lexicographic == chronological for our stamp format
        for old in names[:-keep] if keep > 0 else names:
            try:
                smbclient.remove(cfg.unc_path(old))
                deleted.append(old)
            except OSError as exc:  # noqa: BLE001 — keep going; log and move on
                logger.warning("Could not delete old backup %s: %s", old, exc)
    finally:
        smbclient.reset_connection_cache()
    return deleted
