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
drop_pending="${DROP_PENDING_UPDATES:-false}"

response="$(
  curl --fail-with-body --silent --show-error \
    --request POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook" \
    --data-urlencode "drop_pending_updates=${drop_pending}"
)"
if [[ "$response" != *'"ok":true'* ]]; then
  echo "Telegram rejected the deleteWebhook request." >&2
  exit 1
fi
echo "Webhook deleted successfully."

