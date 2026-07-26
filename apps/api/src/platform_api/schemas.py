from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import AliasChoices, AnyHttpUrl, BaseModel, ConfigDict, Field


class ProviderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    base_url: AnyHttpUrl
    api_key: str = Field(min_length=1, max_length=4096)
    compatibility: str = Field(default="openai", pattern="^(openai|openai-compatible)$")
    organization_id: str | None = Field(default=None, max_length=160)
    extra_headers: dict[str, str] = Field(default_factory=dict)
    default_model: str | None = Field(default=None, max_length=160)


class ProviderRead(BaseModel):
    id: uuid.UUID
    name: str
    base_url: str
    compatibility: str
    default_model: str | None
    key_hint: str
    is_enabled: bool


class ConversationCreate(BaseModel):
    title: str = Field(default="محادثة جديدة", min_length=1, max_length=200)
    provider_id: uuid.UUID | None = None
    model_id: str | None = Field(default=None, min_length=1, max_length=160)
    system_prompt: str | None = Field(default=None, max_length=20_000)


class ConversationRead(BaseModel):
    id: uuid.UUID
    title: str
    provider_id: uuid.UUID | None
    model_id: str
    archived: bool
    created_at: datetime


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=200_000)
    temperature: float | None = Field(default=None, ge=0, le=2)
    top_p: float | None = Field(default=None, gt=0, le=1)
    max_tokens: int | None = Field(default=None, ge=1, le=100_000)


class MediaAnalyze(BaseModel):
    url: AnyHttpUrl


class MediaJobCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    url: AnyHttpUrl
    mode: str = Field(pattern="^(video|audio)$")
    format: str | None = Field(
        default=None,
        validation_alias=AliasChoices("format", "format_id", "output"),
        pattern="^(mp4|webm|mp3|m4a|wav|ogg)$",
    )
    quality: str | None = Field(default=None, max_length=30)
    start_seconds: float | None = Field(default=None, ge=0)
    end_seconds: float | None = Field(default=None, ge=0)
    idempotency_key: str = Field(min_length=8, max_length=120)


class AgentProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    allowed_tools: list[str] = Field(default_factory=list, max_length=30)


class AgentRunCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    prompt: str = Field(
        validation_alias=AliasChoices("prompt", "instruction"), min_length=1, max_length=100_000
    )
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=120)


class JobRead(BaseModel):
    id: uuid.UUID
    kind: str
    status: str
    progress: int
    current_stage: str
    result: dict[str, object] | None
    error_code: str | None
    retry_count: int
    cancellation_requested: bool
