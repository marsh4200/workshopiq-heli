"""Authentication endpoints."""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.security import (
    create_access_token,
    hash_password_async,
    verify_password_async,
)
from app.models import User, utcnow
from app.schemas import ChangePasswordRequest, PreferencesUpdate, Token, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])

VALID_THEMES = {"light", "dark", "system"}


@router.post("/login", response_model=Token)
async def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.username == form.username))
    user = result.scalar_one_or_none()
    password_ok = await verify_password_async(
        form.password, user.hashed_password if user else None
    )
    if not user or not password_ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")

    # Server shutdown / maintenance mode: only administrators may sign in while
    # either is active. Shutdown is the deeper lock and takes precedence.
    if user.role != "administrator":
        from app.services.maintenance import (
            MAINTENANCE_MESSAGE,
            SHUTDOWN_MESSAGE,
            is_maintenance_on,
            is_shutdown_on,
        )

        if await is_shutdown_on():
            raise HTTPException(status_code=503, detail=SHUTDOWN_MESSAGE)
        if await is_maintenance_on():
            raise HTTPException(status_code=503, detail=MAINTENANCE_MESSAGE)

    # Record this successful sign-in so admins can see who's active and when
    # each client/staff member last used the system.
    user.last_login_at = utcnow()
    await db.commit()

    token = create_access_token(user.id, user.role)
    return Token(
        access_token=token,
        must_change_password=user.must_change_password,
        role=user.role,
        username=user.username,
    )


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user


@router.patch("/preferences", response_model=UserOut)
async def update_preferences(
    payload: PreferencesUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Let any signed-in user store their own appearance preference.

    Available to every role (administrator, staff, client) so each person keeps
    their own light/dark choice, persisted across all their devices.
    """
    if payload.theme_preference not in VALID_THEMES:
        raise HTTPException(status_code=400, detail="Invalid theme preference")
    user.theme_preference = payload.theme_preference
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/accept-terms", response_model=UserOut)
async def accept_terms(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Record that the signed-in user accepted the first-login terms of use.

    Idempotent — the first acceptance timestamp is kept if called again.
    """
    if user.terms_accepted_at is None:
        user.terms_accepted_at = utcnow()
        await db.commit()
        await db.refresh(user)
    return user


@router.post("/change-password", response_model=UserOut)
async def change_password(
    payload: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not await verify_password_async(payload.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(payload.new_password) < 6:
        raise HTTPException(
            status_code=400, detail="New password must be at least 6 characters"
        )
    user.hashed_password = await hash_password_async(payload.new_password)
    user.must_change_password = False
    await db.commit()
    await db.refresh(user)
    return user
