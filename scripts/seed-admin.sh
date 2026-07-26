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

: "${OWNER_EMAIL:?Set OWNER_EMAIL in .env first}"
export OWNER_BOOTSTRAP_URL="${OWNER_BOOTSTRAP_URL:-http://127.0.0.1:${HTTP_PORT:-8080}/api/v1/auth/login}"

python - <<'PY'
from __future__ import annotations

import getpass
import json
import os
import sys
import urllib.error
import urllib.request

password = getpass.getpass("Owner password: ")
payload = json.dumps({"email": os.environ["OWNER_EMAIL"], "password": password}).encode()
request = urllib.request.Request(
    os.environ["OWNER_BOOTSTRAP_URL"],
    data=payload,
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(request, timeout=15) as response:
        result = json.load(response)
except urllib.error.HTTPError as exc:
    print(f"Owner bootstrap failed with HTTP {exc.code}.", file=sys.stderr)
    raise SystemExit(1)
except urllib.error.URLError as exc:
    print(f"Cannot reach the local API: {exc.reason}", file=sys.stderr)
    raise SystemExit(1)
finally:
    password = ""
print(f"Owner initialized: {result['email']}")
PY

