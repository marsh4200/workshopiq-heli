"""Password hashing (bcrypt) and JWT token helpers.

bcrypt is intentionally CPU-heavy (hundreds of milliseconds per call). Running
it directly inside an async request handler blocks the whole event loop, so
*every* concurrent request stalls behind it. The async wrappers below offload
hashing/verification to a worker thread via anyio so the loop stays responsive.
"""
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import anyio
import bcrypt
from jose import JWTError, jwt

from app.core.config import settings

_BCRYPT_MAX = 72  # bcrypt only uses the first 72 bytes

# A throwaway hash used to keep login timing uniform when a username does not
# exist, so response time can't be used to enumerate valid usernames.
_DUMMY_HASH = bcrypt.hashpw(b"timing-equalizer", bcrypt.gensalt()).decode("utf-8")


def _prepare(password: str) -> bytes:
    return password.encode("utf-8")[:_BCRYPT_MAX]


# ---------------- Synchronous (startup / non-request contexts) ----------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(_prepare(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_prepare(plain), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# ---------------- Async (request handlers — offloaded to a thread) ------------
async def hash_password_async(password: str) -> str:
    return await anyio.to_thread.run_sync(hash_password, password)


async def verify_password_async(plain: str, hashed: str | None) -> bool:
    """Verify a password without blocking the event loop.

    If ``hashed`` is falsy (e.g. the username didn't match a user), a dummy
    verification still runs so the timing matches the success path.
    """
    target = hashed or _DUMMY_HASH
    result = await anyio.to_thread.run_sync(verify_password, plain, target)
    return bool(hashed) and result


# ---------------- JWT ----------------
def create_access_token(subject: str | int, role: str, extra: Optional[dict] = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    to_encode: dict[str, Any] = {
        "sub": str(subject),
        "role": role,
        "exp": expire,
    }
    if extra:
        to_encode.update(extra)
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None
