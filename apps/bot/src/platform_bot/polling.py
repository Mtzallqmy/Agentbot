from __future__ import annotations

import asyncio
import logging

from .handlers import bot, dispatcher


async def main() -> None:
    """Development fallback; production uses the signed webhook and Worker."""
    logging.basicConfig(level=logging.INFO)
    try:
        await bot.delete_webhook(drop_pending_updates=False)
        await dispatcher.start_polling(bot, allowed_updates=dispatcher.resolve_used_update_types())
    finally:
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
