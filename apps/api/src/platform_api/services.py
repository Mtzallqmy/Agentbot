from __future__ import annotations

from .config import Settings
from .models import ProviderCredential
from .providers import OpenAICompatibleProvider
from .security import SecretBox


def secret_box(settings: Settings) -> SecretBox:
    key = settings.encryption_master_key.get_secret_value()
    return SecretBox(key or settings.app_secret_key.get_secret_value())


def provider_adapter(
    credential: ProviderCredential, settings: Settings
) -> OpenAICompatibleProvider:
    box = secret_box(settings)
    headers = (
        box.decrypt_json(credential.extra_headers_encrypted)
        if credential.extra_headers_encrypted
        else {}
    )
    return OpenAICompatibleProvider(
        base_url=credential.base_url,
        api_key=box.decrypt(credential.encrypted_api_key),
        organization_id=credential.organization_id,
        extra_headers=headers,
        timeout=settings.provider_timeout_seconds,
    )
