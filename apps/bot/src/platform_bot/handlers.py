from __future__ import annotations

import os

from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    Update,
)

token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
if not token:
    raise RuntimeError("TELEGRAM_BOT_TOKEN is required")

proxy_url = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
bot = Bot(token, session=AiohttpSession(proxy=proxy_url) if proxy_url else None)
dispatcher = Dispatcher()
router = Router()


def menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="💬 الدردشة", callback_data="menu:chat"),
                InlineKeyboardButton(text="🤖 الوكيل", callback_data="menu:agent"),
            ],
            [InlineKeyboardButton(text="🎬 فيديو أو صوت", callback_data="menu:media")],
            [
                InlineKeyboardButton(text="📁 مشاريعي", callback_data="menu:projects"),
                InlineKeyboardButton(text="⚙️ الإعدادات", callback_data="menu:settings"),
            ],
        ]
    )


@router.message(Command("start", "menu"))
async def start(message: Message) -> None:
    await message.answer("مرحباً بك في منصة الوكيل الذكي. اختر مساراً:", reply_markup=menu())


@router.message(Command("help"))
async def help_command(message: Message) -> None:
    await message.answer("استخدم /menu للعودة إلى القائمة، و/cancel لإلغاء التدفق الحالي.")


@router.callback_query(F.data.startswith("menu:"))
async def menu_action(query: CallbackQuery) -> None:
    labels = {
        "menu:chat": "أرسل رسالتك بعد اختيار المزود والنموذج من الويب.",
        "menu:agent": "أنشئ مشروعاً وحدد أدوات الوكيل المسموحة من لوحة الويب.",
        "menu:media": "أرسل رابط محتوى تملك حق تنزيله ومعالجته.",
        "menu:projects": "تظهر مشاريع الوكيل من لوحة الويب.",
        "menu:settings": "إدارة المفاتيح والتكاملات متاحة في الإعدادات.",
    }
    await query.answer()
    if query.message:
        target_text = labels.get(query.data or "", "الخيار غير متاح")
        # Telegram rejects no-op edits with "message is not modified". Treat a
        # repeated tap (including concurrent taps) as an idempotent success.
        if query.message.text != target_text:
            try:
                await query.message.edit_text(target_text, reply_markup=menu())
            except TelegramBadRequest as exc:
                if "message is not modified" not in str(exc):
                    raise


dispatcher.include_router(router)


async def process_update(payload: dict) -> None:
    update = Update.model_validate(payload, context={"bot": bot})
    await dispatcher.feed_update(bot, update)
