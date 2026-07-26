#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example. Replace every CHANGE_ME value, then rerun." >&2
  exit 1
fi

if grep -q 'CHANGE_ME' .env; then
  echo "Refusing to start with CHANGE_ME values in .env." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a
for required_name in JWT_SECRET OWNER_EMAIL OWNER_PASSWORD_HASH; do
  if [[ -z "${!required_name:-}" ]]; then
    echo "Refusing to start until ${required_name} is set in .env." >&2
    exit 1
  fi
done

docker compose up --build "$@"
