from __future__ import annotations

import os
from types import SimpleNamespace
from unittest.mock import AsyncMock

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "123456789:test-token-for-unit-tests-only")

from aiogram.exceptions import TelegramBadRequest
from aiogram.methods import EditMessageText
from platform_bot.handlers import menu_action


async def test_repeated_menu_action_is_idempotent() -> None:
    text = "أرسل رسالتك بعد اختيار المزود والنموذج من الويب."
    message = SimpleNamespace(text=text, edit_text=AsyncMock())
    query = SimpleNamespace(data="menu:chat", message=message, answer=AsyncMock())

    await menu_action(query)

    query.answer.assert_awaited_once()
    message.edit_text.assert_not_awaited()


async def test_menu_action_edits_changed_content() -> None:
    message = SimpleNamespace(text="نص سابق", edit_text=AsyncMock())
    query = SimpleNamespace(data="menu:agent", message=message, answer=AsyncMock())

    await menu_action(query)

    query.answer.assert_awaited_once()
    message.edit_text.assert_awaited_once()


async def test_concurrent_repeated_tap_ignores_telegram_noop_error() -> None:
    error = TelegramBadRequest(
        method=EditMessageText(chat_id=1, message_id=1, text="اختبار"),
        message="Bad Request: message is not modified",
    )
    message = SimpleNamespace(text="نص قديم", edit_text=AsyncMock(side_effect=error))
    query = SimpleNamespace(data="menu:settings", message=message, answer=AsyncMock())

    await menu_action(query)

    query.answer.assert_awaited_once()
    message.edit_text.assert_awaited_once()
