from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from ..auth import COOKIE_NAME, decode_token, issue_token, token_id_hash, verify_password
from ..config import get_settings
from ..deps import CurrentUser, SessionDep
from ..models import User, UserSession

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=1024)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        if "@" not in value:
            raise ValueError("Invalid email")
        return value.strip().lower()


@router.post("/login")
async def login(
    payload: LoginRequest, response: Response, session: SessionDep
) -> dict[str, object]:
    settings = get_settings()
    expected_email = settings.owner_email
    password_hash = settings.owner_password_hash.get_secret_value()
    if not expected_email or not password_hash or not settings.jwt_secret.get_secret_value():
        raise HTTPException(503, "Owner login is not configured")
    email_matches = payload.email == expected_email.lower()
    try:
        password_matches = verify_password(payload.password, password_hash)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(503, "Owner authentication is misconfigured") from exc
    if not (email_matches and password_matches):
        raise HTTPException(401, "Invalid email or password")
    user = await session.scalar(select(User).where(User.email == expected_email.lower()))
    if not user:
        user = User(
            email=expected_email.lower(),
            display_name="Platform Owner",
            role="superadmin",
            is_active=True,
        )
        session.add(user)
        await session.flush()
    else:
        user.role = "superadmin"
        user.is_active = True
    token, token_id, expires = issue_token(user.id, settings)
    session.add(
        UserSession(
            user_id=user.id,
            token_id_hash=token_id_hash(token_id),
            expires_at=expires,
        )
    )
    await session.commit()
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=settings.auth_session_minutes * 60,
        httponly=True,
        secure=settings.auth_cookie_secure,
        # Cross-origin web deployments need SameSite=None; this is allowed only
        # with Secure cookies and an explicit CORS origin allowlist.
        samesite="none" if settings.auth_cookie_secure else "lax",
        path="/",
    )
    return {"id": str(user.id), "email": user.email, "role": user.role}


@router.get("/me")
async def me(user: CurrentUser) -> dict[str, object]:
    return {
        "id": str(user.id),
        "email": user.email,
        "display_name": user.display_name,
        "role": user.role,
    }


@router.post("/logout", status_code=204)
async def logout(
    request: Request, response: Response, session: SessionDep, _: CurrentUser
) -> Response:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        claims = decode_token(token, get_settings())
        db_session = await session.scalar(
            select(UserSession).where(
                UserSession.token_id_hash == token_id_hash(str(claims["jti"]))
            )
        )
        if db_session:
            db_session.revoked_at = datetime.now(UTC)
            await session.commit()
    response.delete_cookie(COOKIE_NAME, path="/")
    response.status_code = 204
    return response
