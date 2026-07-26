from __future__ import annotations

from functools import lru_cache

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: str = "development"
    app_name: str = "AI Agent Platform"
    app_secret_key: SecretStr = SecretStr("development-only-change-me")
    jwt_secret: SecretStr = SecretStr("")
    owner_email: str | None = None
    owner_password_hash: SecretStr = SecretStr("")
    auth_cookie_secure: bool = False
    auth_session_minutes: int = Field(30, ge=5, le=1440)
    encryption_master_key: SecretStr = SecretStr("")
    database_url: str = "sqlite+aiosqlite:///./platform.db"
    redis_url: str = "redis://localhost:6379/0"
    telegram_bot_token: SecretStr = SecretStr("")
    telegram_webhook_secret: SecretStr = SecretStr("")
    dev_auth_bypass_user_id: str | None = None
    allow_private_provider_urls: bool = False
    provider_timeout_seconds: float = Field(30.0, ge=1, le=300)
    cors_origins: list[str] = ["http://localhost:3000"]
    max_upload_size: int = Field(50 * 1024 * 1024, gt=0)
    agent_max_steps: int = Field(30, ge=1, le=200)
    agent_max_runtime: int = Field(1800, ge=30)
    media_max_duration: int = Field(7200, ge=1)
    media_max_file_size: int = Field(2 * 1024**3, ge=1)
    media_output_root: str = "/data/media"

    @field_validator("app_secret_key")
    @classmethod
    def production_secret_must_be_changed(cls, value: SecretStr, info: object) -> SecretStr:
        return value

    def validate_production(self) -> None:
        if self.app_env.lower() != "production":
            return
        if self.dev_auth_bypass_user_id:
            raise RuntimeError("DEV_AUTH_BYPASS_USER_ID is forbidden in production")
        if self.app_secret_key.get_secret_value() == "development-only-change-me":
            raise RuntimeError("APP_SECRET_KEY must be configured in production")
        if not self.jwt_secret.get_secret_value():
            raise RuntimeError("JWT_SECRET must be configured in production")
        if not self.owner_email or not self.owner_password_hash.get_secret_value():
            raise RuntimeError(
                "OWNER_EMAIL and OWNER_PASSWORD_HASH must be configured in production"
            )
        if not self.auth_cookie_secure:
            raise RuntimeError("AUTH_COOKIE_SECURE must be true in production")
        if not self.cors_origins or "*" in self.cors_origins:
            raise RuntimeError("CORS_ORIGINS must be an explicit non-empty allowlist")
        if not self.encryption_master_key.get_secret_value():
            raise RuntimeError("ENCRYPTION_MASTER_KEY must be configured in production")
        if not self.telegram_webhook_secret.get_secret_value():
            raise RuntimeError("TELEGRAM_WEBHOOK_SECRET must be configured in production")


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.validate_production()
    return settings
