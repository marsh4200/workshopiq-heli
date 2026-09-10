"""File storage helpers for photos and documents."""
import io
import logging
import os
import uuid
from pathlib import Path

from fastapi import UploadFile
from PIL import Image, ImageOps

from app.core.config import settings

logger = logging.getLogger("workshopiq.files")

UPLOAD_ROOT = Path(settings.UPLOAD_DIR)
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp"}

# Photos come straight off a phone camera — commonly several MB at full
# sensor resolution, which is far more than anyone needs to view on screen,
# zoom in on for inspection detail, or print in a job pack. Re-encoding to a
# capped size/quality on the way in (see _compact_image) is what keeps
# storage and backups small; nothing downstream (the gallery, job pack zips,
# full-system backups) needs the original bytes, only a good-looking image.
# Only NEW uploads are compacted this way — files already on disk from
# before this existed are left exactly as they are.
PHOTO_MAX_DIMENSION = 1920  # long edge, in pixels
PHOTO_JPEG_QUALITY = 85


def _ensure_dir() -> None:
    UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)


def _compact_image(content: bytes) -> bytes | None:
    """Re-encode an uploaded image to a capped-size, capped-quality JPEG.

    Returns the new bytes, or ``None`` if the image couldn't be processed —
    an unsupported format (e.g. HEIC; Pillow needs a separate plugin for
    that), a corrupt upload, etc. Callers fall back to storing the original
    bytes untouched in that case rather than fail the upload outright.
    """
    try:
        with Image.open(io.BytesIO(content)) as img:
            # Respect the phone's EXIF orientation tag first, or a photo
            # taken in portrait can end up saved sideways.
            img = ImageOps.exif_transpose(img) or img
            if img.mode in ("RGBA", "LA"):
                # JPEG has no alpha channel — flatten onto white so a
                # screenshot's transparency doesn't turn black.
                background = Image.new("RGB", img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[-1])
                img = background
            elif img.mode != "RGB":
                img = img.convert("RGB")
            # thumbnail() only ever shrinks — a photo already smaller than
            # the cap is left at its own size, never upscaled.
            img.thumbnail((PHOTO_MAX_DIMENSION, PHOTO_MAX_DIMENSION), Image.LANCZOS)
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=PHOTO_JPEG_QUALITY, optimize=True)
            return out.getvalue()
    except Exception:  # noqa: BLE001 — any decode failure just skips compaction
        logger.warning("Could not compact uploaded image; storing it as-is", exc_info=True)
        return None


async def save_upload(
    upload: UploadFile, job_id: int, *, compact_images: bool = False
) -> tuple[str, str]:
    """Persist an uploaded file. Returns (stored_filename, original_name).

    ``compact_images``: only the Photos endpoint passes this. A Document can
    legitimately be a scanned/photographed page where the browser-reported
    ``content_type`` is recorded and relied on when serving it back — if we
    silently re-encoded it to JPEG here that stored type would go stale.
    Photos have no such recorded type (they're served by guessing from the
    file extension), so it's safe to normalise them to a compact JPEG.
    """
    _ensure_dir()
    ext = Path(upload.filename or "").suffix.lower()
    content = await upload.read()
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise ValueError(f"File exceeds {settings.MAX_UPLOAD_MB} MB limit")

    if compact_images and is_image(upload.filename or ""):
        compacted = _compact_image(content)
        if compacted is not None:
            content = compacted
            ext = ".jpg"  # the stored bytes are now always a JPEG

    stored = f"job{job_id}_{uuid.uuid4().hex}{ext}"
    dest = UPLOAD_ROOT / stored
    with open(dest, "wb") as f:
        f.write(content)
    return stored, (upload.filename or stored)


def is_image(filename: str) -> bool:
    return Path(filename).suffix.lower() in IMAGE_EXTS


def delete_file(filename: str) -> None:
    try:
        path = UPLOAD_ROOT / filename
        if path.exists():
            os.remove(path)
    except OSError:
        pass


def file_path(filename: str) -> Path:
    return UPLOAD_ROOT / filename
