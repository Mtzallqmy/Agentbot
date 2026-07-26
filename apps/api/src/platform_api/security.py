from __future__ import annotations

import base64
import hashlib
import ipaddress
import json
import socket
from collections.abc import Iterable
from urllib.parse import urlparse

from cryptography.fernet import Fernet, InvalidToken


class SecretBox:
    """Versioned authenticated encryption for application-managed credentials."""

    PREFIX = b"fernet:v1:"

    def __init__(self, master_key: str) -> None:
        if not master_key:
            raise ValueError("Encryption master key is required")
        try:
            raw = base64.urlsafe_b64decode(master_key.encode())
            if len(raw) != 32:
                raise ValueError
            key = master_key.encode()
        except (ValueError, TypeError):
            key = base64.urlsafe_b64encode(hashlib.sha256(master_key.encode()).digest())
        self._fernet = Fernet(key)

    def encrypt(self, value: str) -> bytes:
        return self.PREFIX + self._fernet.encrypt(value.encode())

    def decrypt(self, value: bytes) -> str:
        if not value.startswith(self.PREFIX):
            raise ValueError("Unknown ciphertext version")
        try:
            return self._fernet.decrypt(value[len(self.PREFIX) :]).decode()
        except InvalidToken as exc:
            raise ValueError("Credential cannot be decrypted") from exc

    def encrypt_json(self, value: dict[str, str]) -> bytes:
        return self.encrypt(json.dumps(value, separators=(",", ":"), sort_keys=True))

    def decrypt_json(self, value: bytes) -> dict[str, str]:
        decoded = json.loads(self.decrypt(value))
        if not isinstance(decoded, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in decoded.items()
        ):
            raise ValueError("Encrypted headers are invalid")
        return decoded


def mask_secret(value: str) -> str:
    return "••••" + value[-4:] if len(value) >= 4 else "••••"


def _is_forbidden(addresses: Iterable[str]) -> bool:
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            return True
    return False


async def validate_outbound_url(url: str, *, allow_private: bool = False) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"https", "http"} or not parsed.hostname:
        raise ValueError("Only absolute HTTP(S) URLs are allowed")
    if parsed.username or parsed.password:
        raise ValueError("Credentials in URLs are not allowed")
    if parsed.scheme != "https" and not allow_private:
        raise ValueError("HTTPS is required")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        infos = (
            await __import__("asyncio")
            .get_running_loop()
            .getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)
        )
    except socket.gaierror as exc:
        raise ValueError("Provider host cannot be resolved") from exc
    addresses = {item[4][0] for item in infos}
    if not allow_private and _is_forbidden(addresses):
        raise ValueError("Private, local, metadata, and reserved networks are blocked")
    return url.rstrip("/")


SENSITIVE_HEADERS = {"authorization", "proxy-authorization", "x-api-key", "api-key", "cookie"}


def redact_headers(headers: dict[str, str]) -> dict[str, str]:
    return {
        key: ("[REDACTED]" if key.lower() in SENSITIVE_HEADERS else val)
        for key, val in headers.items()
    }
