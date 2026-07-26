from __future__ import annotations

import pytest
from platform_api.security import SecretBox, mask_secret, validate_outbound_url


def test_secret_box_round_trip_and_masking() -> None:
    box = SecretBox("unit-test-master-key")
    ciphertext = box.encrypt("sk-super-secret")
    assert b"sk-super-secret" not in ciphertext
    assert box.decrypt(ciphertext) == "sk-super-secret"
    assert mask_secret("sk-super-secret") == "••••cret"


@pytest.mark.asyncio
async def test_ssrf_blocks_loopback() -> None:
    with pytest.raises(ValueError, match="blocked"):
        await validate_outbound_url("https://127.0.0.1/v1")


@pytest.mark.asyncio
async def test_ssrf_requires_https() -> None:
    with pytest.raises(ValueError, match="HTTPS"):
        await validate_outbound_url("http://example.com/v1")
