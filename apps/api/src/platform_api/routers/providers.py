from __future__ import annotations

import time
import uuid

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from ..config import get_settings
from ..deps import CurrentUser, SessionDep
from ..models import AuditLog, ProviderCredential
from ..schemas import ProviderCreate, ProviderRead
from ..security import mask_secret, validate_outbound_url
from ..services import provider_adapter, secret_box

router = APIRouter(prefix="/providers", tags=["providers"])


def _read(item: ProviderCredential, hint: str) -> ProviderRead:
    return ProviderRead(
        id=item.id,
        name=item.name,
        base_url=item.base_url,
        compatibility=item.compatibility,
        default_model=item.default_model,
        key_hint=hint,
        is_enabled=item.is_enabled,
    )


async def _owned(
    session: SessionDep, user: CurrentUser, provider_id: uuid.UUID
) -> ProviderCredential:
    item = await session.scalar(
        select(ProviderCredential).where(
            ProviderCredential.id == provider_id, ProviderCredential.user_id == user.id
        )
    )
    if not item:
        raise HTTPException(404, "Provider not found")
    return item


@router.get("", response_model=list[ProviderRead])
async def list_providers(session: SessionDep, user: CurrentUser) -> list[ProviderRead]:
    settings = get_settings()
    box = secret_box(settings)
    items = (
        await session.scalars(
            select(ProviderCredential)
            .where(ProviderCredential.user_id == user.id)
            .order_by(ProviderCredential.created_at.desc())
        )
    ).all()
    return [_read(item, mask_secret(box.decrypt(item.encrypted_api_key))) for item in items]


@router.post("", response_model=ProviderRead, status_code=201)
async def create_provider(
    payload: ProviderCreate, session: SessionDep, user: CurrentUser
) -> ProviderRead:
    settings = get_settings()
    try:
        base_url = await validate_outbound_url(
            str(payload.base_url), allow_private=settings.allow_private_provider_urls
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    box = secret_box(settings)
    item = ProviderCredential(
        user_id=user.id,
        name=payload.name,
        base_url=base_url,
        compatibility=payload.compatibility,
        encrypted_api_key=box.encrypt(payload.api_key),
        organization_id=payload.organization_id,
        extra_headers_encrypted=box.encrypt_json(payload.extra_headers)
        if payload.extra_headers
        else None,
        default_model=payload.default_model,
    )
    session.add(item)
    await session.flush()
    session.add(
        AuditLog(
            actor_user_id=user.id,
            action="provider.created",
            target_type="provider",
            target_id=str(item.id),
            details={"name": item.name, "base_url": item.base_url},
        )
    )
    await session.commit()
    return _read(item, mask_secret(payload.api_key))


@router.post("/{provider_id}/test")
async def test_provider(
    provider_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> dict[str, object]:
    item = await _owned(session, user, provider_id)
    started = time.perf_counter()
    try:
        async with provider_adapter(item, get_settings()) as adapter:
            models = await adapter.list_models()
        return {
            "ok": True,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "models_found": len(models),
        }
    except Exception as exc:
        return {
            "ok": False,
            "latency_ms": int((time.perf_counter() - started) * 1000),
            "error": getattr(exc, "code", "provider_unavailable"),
        }


@router.get("/{provider_id}/models")
async def list_models(
    provider_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> dict[str, object]:
    item = await _owned(session, user, provider_id)
    async with provider_adapter(item, get_settings()) as adapter:
        return {"data": await adapter.list_models()}
