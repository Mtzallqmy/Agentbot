from __future__ import annotations

import os

from argon2 import PasswordHasher

os.environ.update(
    {
        "APP_ENV": "testing",
        "APP_SECRET_KEY": "test-app-secret",
        "JWT_SECRET": "test-jwt-secret-with-sufficient-entropy",
        "ENCRYPTION_MASTER_KEY": "test-encryption-master-key",
        "DATABASE_URL": "sqlite+aiosqlite://",
        "TELEGRAM_WEBHOOK_SECRET": "test-webhook-secret",
        "OWNER_EMAIL": "owner@example.test",
        "OWNER_PASSWORD_HASH": PasswordHasher().hash("correct horse battery staple"),
        "AUTH_COOKIE_SECURE": "false",
    }
)

import pytest
from fastapi.testclient import TestClient
from platform_api.db import engine
from platform_api.main import app
from platform_api.models import Base


@pytest.fixture(autouse=True)
async def database():
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client
