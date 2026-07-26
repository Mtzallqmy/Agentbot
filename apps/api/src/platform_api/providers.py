from __future__ import annotations

import json
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from typing import Any

import httpx


class ProviderError(RuntimeError):
    def __init__(self, code: str, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class BaseAIProvider(ABC):
    @abstractmethod
    async def list_models(self) -> list[dict[str, Any]]: ...

    @abstractmethod
    def stream_chat(
        self, *, model: str, messages: list[dict[str, str]], options: dict[str, Any]
    ) -> AsyncIterator[str]: ...


class OpenAICompatibleProvider(BaseAIProvider):
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        organization_id: str | None = None,
        extra_headers: dict[str, str] | None = None,
        timeout: float = 30,
    ) -> None:
        headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
        if organization_id:
            headers["OpenAI-Organization"] = organization_id
        headers.update(extra_headers or {})
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/") + "/",
            headers=headers,
            timeout=httpx.Timeout(timeout, connect=min(timeout, 10)),
            follow_redirects=False,
        )

    async def __aenter__(self) -> OpenAICompatibleProvider:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self._client.aclose()

    async def list_models(self) -> list[dict[str, Any]]:
        try:
            response = await self._client.get("models")
            response.raise_for_status()
            payload = response.json()
            return [
                {"id": item["id"], "capabilities": item.get("capabilities", {})}
                for item in payload.get("data", [])
                if isinstance(item, dict) and isinstance(item.get("id"), str)
            ]
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            raise self._map_error(exc) from exc

    async def stream_chat(
        self, *, model: str, messages: list[dict[str, str]], options: dict[str, Any]
    ) -> AsyncIterator[str]:
        payload = {"model": model, "messages": messages, "stream": True, **options}
        try:
            async with self._client.stream("POST", "chat/completions", json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        return
                    parsed = json.loads(data)
                    delta = parsed.get("choices", [{}])[0].get("delta", {}).get("content")
                    if isinstance(delta, str):
                        yield delta
        except (httpx.HTTPError, ValueError, KeyError, IndexError) as exc:
            raise self._map_error(exc) from exc

    @staticmethod
    def _map_error(exc: Exception) -> ProviderError:
        if isinstance(exc, httpx.TimeoutException):
            return ProviderError("provider_timeout", "AI provider timed out", 504)
        if isinstance(exc, httpx.HTTPStatusError):
            status = exc.response.status_code
            code = "provider_rate_limited" if status == 429 else "provider_rejected_request"
            return ProviderError(
                code, f"AI provider returned HTTP {status}", 429 if status == 429 else 502
            )
        return ProviderError("provider_unavailable", "AI provider is unavailable")
