from __future__ import annotations

import hmac
from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException
from sqlalchemy.exc import IntegrityError

from ..config import get_settings
from ..deps import SessionDep
from ..models import WebhookUpdate

router = APIRouter(prefix="/telegram", tags=["telegram"])


@router.post("/webhook", status_code=200)
async def telegram_webhook(
    update: dict[str, Any],
    session: SessionDep,
    x_telegram_bot_api_secret_token: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    expected = get_settings().telegram_webhook_secret.get_secret_value()
    if (
        not expected
        or not x_telegram_bot_api_secret_token
        or not hmac.compare_digest(expected, x_telegram_bot_api_secret_token)
    ):
        raise HTTPException(401, "Invalid Telegram webhook secret")
    update_id = update.get("update_id")
    if not isinstance(update_id, int):
        raise HTTPException(422, "Telegram update_id is required")
    session.add(WebhookUpdate(update_id=update_id, payload=update))
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        return {"accepted": True, "duplicate": True}
    # This row is a transactional outbox and idempotency boundary. The worker locks
    # and feeds unprocessed payloads into aiogram; failures remain eligible for retry.
    return {"accepted": True, "duplicate": False}
