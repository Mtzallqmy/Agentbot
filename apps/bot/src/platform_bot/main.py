from __future__ import annotations

import hmac
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings
from fastapi import FastAPI, Header, HTTPException

secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.redis = await create_pool(
        RedisSettings.from_dsn(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
    )
    yield
    await app.state.redis.aclose()


app = FastAPI(title="AI Agent Platform Telegram Bot", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/telegram/webhook", status_code=200)
async def webhook(
    payload: dict,
    x_telegram_bot_api_secret_token: Annotated[str | None, Header()] = None,
) -> dict[str, bool]:
    if not secret or not x_telegram_bot_api_secret_token or not hmac.compare_digest(
        secret, x_telegram_bot_api_secret_token
    ):
        raise HTTPException(401, "Invalid webhook secret")
    update_id = payload.get("update_id")
    if not isinstance(update_id, int):
        raise HTTPException(422, "Telegram update_id is required")
    redis: ArqRedis = app.state.redis
    key = f"telegram:update:{update_id}"
    inserted = await redis.set(key, "queued", ex=86400, nx=True)
    if not inserted:
        return {"accepted": True, "duplicate": True}
    try:
        await redis.enqueue_job(
            "process_telegram_update", payload, _job_id=f"telegram-{update_id}"
        )
    except Exception:
        await redis.delete(key)
        raise
    return {"accepted": True, "duplicate": False}
