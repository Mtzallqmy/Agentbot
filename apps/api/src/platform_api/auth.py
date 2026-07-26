from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
import uuid
from datetime import UTC, datetime, timedelta

from .config import Settings

COOKIE_NAME = "platform_session"


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def issue_token(user_id: uuid.UUID, settings: Settings) -> tuple[str, str, datetime]:
    secret = settings.jwt_secret.get_secret_value()
    if not secret:
        raise RuntimeError("JWT_SECRET is required")
    now = int(time.time())
    expires = datetime.now(UTC) + timedelta(minutes=settings.auth_session_minutes)
    token_id = secrets.token_urlsafe(24)
    header = _b64(b'{"alg":"HS256","typ":"JWT"}')
    payload = _b64(
        json.dumps(
            {"sub": str(user_id), "jti": token_id, "iat": now, "exp": int(expires.timestamp())},
            separators=(",", ":"),
        ).encode()
    )
    content = f"{header}.{payload}"
    signature = _b64(hmac.new(secret.encode(), content.encode(), hashlib.sha256).digest())
    return f"{content}.{signature}", token_id, expires


def decode_token(token: str, settings: Settings) -> dict[str, object]:
    secret = settings.jwt_secret.get_secret_value()
    if not secret:
        raise ValueError("JWT secret is not configured")
    try:
        header, payload, signature = token.split(".")
        content = f"{header}.{payload}"
        expected = _b64(hmac.new(secret.encode(), content.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            raise ValueError("Invalid signature")
        decoded = json.loads(_unb64(payload))
        if decoded.get("exp", 0) < int(time.time()):
            raise ValueError("Expired")
        uuid.UUID(str(decoded["sub"]))
        if not isinstance(decoded.get("jti"), str):
            raise ValueError("Missing token id")
        return decoded
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("Invalid session token") from exc


def token_id_hash(token_id: str) -> str:
    return hashlib.sha256(token_id.encode()).hexdigest()


def verify_password(password: str, encoded: str) -> bool:
    if not encoded.startswith("$argon2"):
        raise ValueError("OWNER_PASSWORD_HASH must be an Argon2 hash")
    try:
        from argon2 import PasswordHasher
        from argon2.exceptions import InvalidHashError, VerifyMismatchError
    except ImportError as exc:
        raise RuntimeError("argon2-cffi is required for owner authentication") from exc
    try:
        return PasswordHasher().verify(encoded, password)
    except (VerifyMismatchError, InvalidHashError):
        return False
