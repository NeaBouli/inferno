#!/usr/bin/env python3
"""Owner-only, read-only classifier for the running Points backend configuration.

Run by the owner on the production host (needs Docker access). It inspects the
running container's effective environment IN MEMORY and prints categories only:

    fee_router=<absent|empty|canonical|noncanonical|duplicate|unreadable>
    chain_mainnet=<true|false|unknown>
    mode=<production-safe|development|test|unknown>

It never prints, logs or writes any environment value, address, URL or raw
error text. Classification mirrors apps/points-backend/src/config/security.ts
(loadPointsSecurityConfig): the router value is trimmed, compared
case-insensitively with the canonical mainnet FeeRouterV1, NODE_ENV "test" and
"development" are the only non-production modes, CHAIN_ID is parsed as a
decimal integer.

Usage: python3 classify-points-config.py [container-name]
Exit codes: 0 classified, 2 unreadable/ambiguous input.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from typing import Any, Callable, Optional, Sequence

DEFAULT_CONTAINER = "inferno-points-backend"
CANONICAL_FEE_ROUTER = "0x4807b77b2e25cd055da42b09ba4d0af9e580c60a"
_CONTAINER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
_TRACKED = ("FEE_ROUTER_ADDRESS", "CHAIN_ID", "NODE_ENV")

Inspector = Callable[[str], str]


def _docker_inspect(container: str) -> str:
    """Return raw `docker inspect` JSON; raises on any failure (caller maps it)."""
    result = subprocess.run(
        ["docker", "inspect", "--type", "container", container],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("inspect_failed")
    return result.stdout


def _env_entries(raw: str) -> Optional[list[str]]:
    """Extract Config.Env from inspect JSON; None when the shape is ambiguous."""
    try:
        data: Any = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
        return None
    config = data[0].get("Config")
    if not isinstance(config, dict):
        return None
    env = config.get("Env")
    if not isinstance(env, list) or not all(isinstance(item, str) for item in env):
        return None
    return env


def _collect(env: Sequence[str]) -> dict[str, list[str]]:
    found: dict[str, list[str]] = {key: [] for key in _TRACKED}
    for item in env:
        key, sep, value = item.partition("=")
        if sep and key in found:
            found[key].append(value)
    return found


def classify_fee_router(values: Sequence[str]) -> str:
    if len(values) == 0:
        return "absent"
    if len(values) > 1:
        return "duplicate"
    value = values[0].strip()
    if not value:
        return "empty"
    return "canonical" if value.lower() == CANONICAL_FEE_ROUTER else "noncanonical"


def classify_chain(values: Sequence[str]) -> str:
    if len(values) != 1:
        return "unknown"
    value = values[0].strip()
    if not value.isdigit():
        return "unknown"
    return "true" if int(value) == 1 else "false"


def classify_mode(values: Sequence[str]) -> str:
    if len(values) > 1:
        return "unknown"
    mode = values[0] if values else ""
    if mode == "test":
        return "test"
    if mode == "development":
        return "development"
    # Omitted or any other value is production-safe in security.ts.
    return "production-safe"


def classify(container: str, inspector: Inspector = _docker_inspect) -> tuple[list[str], int]:
    """Return the output lines and exit code. Never includes values."""
    unreadable = ["fee_router=unreadable", "chain_mainnet=unknown", "mode=unknown"]
    if not _CONTAINER_RE.fullmatch(container):
        return unreadable, 2
    try:
        raw = inspector(container)
    except Exception:  # noqa: BLE001 - every failure maps to one constant category
        return unreadable, 2
    env = _env_entries(raw)
    if env is None:
        return unreadable, 2
    found = _collect(env)
    lines = [
        f"fee_router={classify_fee_router(found['FEE_ROUTER_ADDRESS'])}",
        f"chain_mainnet={classify_chain(found['CHAIN_ID'])}",
        f"mode={classify_mode(found['NODE_ENV'])}",
    ]
    return lines, 0


def main(argv: Sequence[str]) -> int:
    if len(argv) > 2:
        print("usage: classify-points-config.py [container-name]", file=sys.stderr)
        return 2
    container = argv[1] if len(argv) == 2 else DEFAULT_CONTAINER
    lines, code = classify(container)
    for line in lines:
        print(line)
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv))
