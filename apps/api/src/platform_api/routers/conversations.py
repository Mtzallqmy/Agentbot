from __future__ import annotations

import json
import time
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..config import get_settings
from ..deps import CurrentUser, SessionDep
from ..models import Conversation, Message, ProviderCredential
from ..providers import ProviderError
from ..schemas import ConversationCreate, ConversationRead, MessageCreate
from ..services import provider_adapter

router = APIRouter(prefix="/conversations", tags=["conversations"])


def _sse(event: str, data: dict[str, object]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _owned_conversation(
    session: SessionDep, user: CurrentUser, conversation_id: uuid.UUID
) -> Conversation:
    item = await session.scalar(
        select(Conversation)
        .options(selectinload(Conversation.messages))
        .where(Conversation.id == conversation_id, Conversation.user_id == user.id)
    )
    if not item:
        raise HTTPException(404, "Conversation not found")
    return item


@router.get("", response_model=list[ConversationRead])
async def list_conversations(session: SessionDep, user: CurrentUser) -> list[ConversationRead]:
    items = (
        await session.scalars(
            select(Conversation)
            .where(Conversation.user_id == user.id, Conversation.archived.is_(False))
            .order_by(Conversation.updated_at.desc())
        )
    ).all()
    return [
        ConversationRead(
            id=i.id,
            title=i.title,
            provider_id=i.provider_credential_id,
            model_id=i.model_id,
            archived=i.archived,
            created_at=i.created_at,
        )
        for i in items
    ]


@router.post("", response_model=ConversationRead, status_code=201)
async def create_conversation(
    payload: ConversationCreate, session: SessionDep, user: CurrentUser
) -> ConversationRead:
    provider_query = select(ProviderCredential).where(
        ProviderCredential.user_id == user.id, ProviderCredential.is_enabled.is_(True)
    )
    if payload.provider_id:
        provider_query = provider_query.where(ProviderCredential.id == payload.provider_id)
    else:
        provider_query = provider_query.order_by(ProviderCredential.created_at.asc())
    provider = await session.scalar(provider_query)
    if not provider:
        raise HTTPException(422, "No enabled AI provider exists; add a provider first")
    model_id = payload.model_id or provider.default_model
    if not model_id:
        raise HTTPException(422, "Select a model or configure a default model for the provider")
    item = Conversation(
        user_id=user.id,
        provider_credential_id=provider.id,
        title=payload.title,
        model_id=model_id,
        system_prompt=payload.system_prompt,
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return ConversationRead(
        id=item.id,
        title=item.title,
        provider_id=item.provider_credential_id,
        model_id=item.model_id,
        archived=item.archived,
        created_at=item.created_at,
    )


@router.post("/{conversation_id}/messages")
async def create_message(
    conversation_id: uuid.UUID,
    payload: MessageCreate,
    session: SessionDep,
    user: CurrentUser,
) -> StreamingResponse:
    conversation = await _owned_conversation(session, user, conversation_id)
    provider = await session.scalar(
        select(ProviderCredential).where(
            ProviderCredential.id == conversation.provider_credential_id,
            ProviderCredential.user_id == user.id,
        )
    )
    if not provider:
        raise HTTPException(409, "Conversation provider is unavailable")
    user_message = Message(conversation_id=conversation.id, role="user", content=payload.content)
    session.add(user_message)
    await session.commit()
    history = []
    if conversation.system_prompt:
        history.append({"role": "system", "content": conversation.system_prompt})
    history.extend({"role": m.role, "content": m.content} for m in conversation.messages)
    history.append({"role": "user", "content": payload.content})
    options = {
        key: value
        for key, value in {
            "temperature": payload.temperature,
            "top_p": payload.top_p,
            "max_tokens": payload.max_tokens,
        }.items()
        if value is not None
    }

    async def events() -> AsyncIterator[str]:
        chunks: list[str] = []
        started = time.perf_counter()
        try:
            async with provider_adapter(provider, get_settings()) as adapter:
                async for chunk in adapter.stream_chat(
                    model=conversation.model_id, messages=history, options=options
                ):
                    chunks.append(chunk)
                    yield _sse("delta", {"content": chunk})
            assistant = Message(
                conversation_id=conversation.id,
                role="assistant",
                content="".join(chunks),
                model_snapshot=conversation.model_id,
                latency_ms=int((time.perf_counter() - started) * 1000),
            )
            session.add(assistant)
            await session.commit()
            yield _sse("done", {"message_id": str(assistant.id)})
        except ProviderError as exc:
            yield _sse("error", {"code": exc.code, "message": str(exc)})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
