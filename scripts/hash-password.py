#!/usr/bin/env python3
"""Generate an Argon2id password hash without accepting secrets in argv."""

from __future__ import annotations

import getpass
import sys

try:
    from argon2 import PasswordHasher
except ImportError:
    print(
        "argon2-cffi is required. Install backend dev dependencies first.",
        file=sys.stderr,
    )
    raise SystemExit(1)


def main() -> int:
    first = getpass.getpass("Owner password: ")
    second = getpass.getpass("Confirm password: ")
    if first != second:
        print("Passwords do not match.", file=sys.stderr)
        return 2
    if len(first) < 14:
        print("Use at least 14 characters.", file=sys.stderr)
        return 2

    password_hash = PasswordHasher().hash(first)
    print(password_hash)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

