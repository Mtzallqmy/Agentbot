from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .auth import COOKIE_NAME, decode_token, token_id_hash
from .config import get_settings
from .db import get_session
from .models import User, UserSession

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def current_user(
    request: Request,
    session: SessionDep,
    x_user_id: Annotated[str | None, Header()] = None,
) -> User:
    settings = get_settings()
    identity: str | None = None
    session_token = request.cookies.get(COOKIE_NAME)
    if session_token:
        try:
            claims = decode_token(session_token, settings)
            identity = str(claims["sub"])
            db_session = await session.scalar(
                select(UserSession).where(
                    UserSession.token_id_hash == token_id_hash(str(claims["jti"])),
                    UserSession.revoked_at.is_(None),
                    UserSession.expires_at > datetime.now(UTC),
                )
            )
            if not db_session:
                raise HTTPException(401, "Session is expired or revoked")
        except ValueError as exc:
            raise HTTPException(401, "Invalid session") from exc
    elif settings.app_env.lower() != "production" and x_user_id:
        identity = x_user_id
    if not identity and settings.app_env.lower() != "production":
        identity = settings.dev_auth_bypass_user_id
    if not identity:
        raise HTTPException(401, "X-User-ID is required")
    try:
        user_id = uuid.UUID(identity)
    except ValueError as exc:
        raise HTTPException(401, "Invalid user identity") from exc
    user = await session.get(User, user_id)
    if not user and not session_token and settings.app_env.lower() != "production":
        user = User(id=user_id, display_name="Local Developer", role="admin", is_active=True)
        session.add(user)
        await session.commit()
    if not user or not user.is_active:
        raise HTTPException(401, "Unknown or inactive user")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def require_admin(user: CurrentUser) -> User:
    if user.role not in {"admin", "superadmin"}:
        raise HTTPException(403, "Admin role required")
    return user


AdminUser = Annotated[User, Depends(require_admin)]
