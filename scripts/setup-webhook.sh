#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${ENV_FILE:-$project_root/.env}"

if [[ -f "$env_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
fi

: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN is required}"
: "${TELEGRAM_WEBHOOK_URL:?TELEGRAM_WEBHOOK_URL is required}"
: "${TELEGRAM_WEBHOOK_SECRET:?TELEGRAM_WEBHOOK_SECRET is required}"

if [[ "$TELEGRAM_WEBHOOK_URL" != https://* ]]; then
  echo "Telegram requires an HTTPS webhook URL." >&2
  exit 1
fi

response="$(
  curl --fail-with-body --silent --show-error \
    --request POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
    --data-urlencode "url=${TELEGRAM_WEBHOOK_URL}" \
    --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
    --data-urlencode "allowed_updates=[\"message\",\"callback_query\",\"my_chat_member\"]" \
    --data-urlencode "drop_pending_updates=false"
)"

if [[ "$response" != *'"ok":true'* ]]; then
  echo "Telegram rejected the webhook request." >&2
  exit 1
fi
echo "Webhook configured successfully."

