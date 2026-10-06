#!/usr/bin/env python3
"""Owner-only, read-only classifier for the running Points backend configuration.

Run by the owner on the production host (needs Docker access). It inspects the
running container's effective environment IN MEMORY and prints categories only:

    fee_router=<absent|empty|canonical|noncanonical|duplicate|unreadable>
        (a router value containing any non-ASCII character is "unreadable")
    chain_mainnet=<true|false|unknown>
    mode=<production-safe|development|test|unknown>

It never prints, logs or writes any environment value, address, URL or raw
error text. Classification mirrors apps/points-backend/src/config/security.ts
(loadPointsSecurityConfig): the router value is trimmed, compared
case-insensitively with the canonical mainnet FeeRouterV1, NODE_ENV "test" and
"development" are the only non-production modes, CHAIN_ID follows
requiredValue (trim, test-mode fallback) and a CONSERVATIVE subset of parseChainId:
only 1-16 ASCII decimal digits are interpreted; any other spelling the JS loader
might accept (hex, exponent, Unicode digits) is reported as unknown (exit 2). The inspected object must be the named container and running.

Usage: python3 classify-points-config.py   (no arguments; fixed to inferno-points-backend)
Exit codes: 0 every field classified unambiguously; 2 unreadable, not the named
running container, or any ambiguous field (duplicate key, unknown chain/mode).
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from typing import Any, Callable, Optional, Sequence

DEFAULT_CONTAINER = "inferno-points-backend"
CANONICAL_FEE_ROUTER = "0x4807b77b2e25cd055da42b09ba4d0af9e580c60a"
_TRACKED = ("FEE_ROUTER_ADDRESS", "CHAIN_ID", "NODE_ENV")
# ASCII whitespace that both Python and JS String.prototype.trim remove.
_ASCII_WS = " \t\n\r\f\v"

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


def _env_entries(raw: str, container: str) -> Optional[list[str]]:
    """Extract Config.Env of the named, running container; None when ambiguous."""
    try:
        data: Any = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
        return None
    if data[0].get("Name") != f"/{container}":
        return None
    state = data[0].get("State")
    if not isinstance(state, dict) or state.get("Running") is not True or state.get("Status") != "running":
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
    raw = values[0]
    if not raw.isascii():
        # Python str.strip and JS String.prototype.trim disagree on Unicode
        # whitespace/separators; do not guess which value the loader would see.
        return "unreadable"
    value = raw.strip(_ASCII_WS)
    if not value:
        return "empty"
    return "canonical" if value.lower() == CANONICAL_FEE_ROUTER else "noncanonical"


_MAX_SAFE_INTEGER = 2**53 - 1
# Conservative subset of JS Number(): ASCII decimal digits only, at most 16 digits,
# so Python int and JS binary64 agree exactly. Anything else (hex/exponent/
# fraction/sign/Unicode digits) is reported as unknown instead of emulated.
_ASCII_DECIMAL_RE = re.compile(r"[0-9]{1,16}")


def _conservative_chain_id(text: str) -> Optional[int]:
    if not text.isascii() or not _ASCII_DECIMAL_RE.fullmatch(text):
        return None
    return int(text, 10)


def classify_chain(values: Sequence[str], mode: str) -> str:
    """Mirror requiredValue("CHAIN_ID", "11155111") + parseChainId."""
    if len(values) > 1:
        return "unknown"
    if values and not values[0].isascii():
        return "unknown"  # conservative: JS trim and Python strip differ on Unicode whitespace
    value = values[0].strip(_ASCII_WS) if values else ""
    if not value:
        if mode == "test":
            value = "11155111"
        else:
            return "unknown"  # loader throws: CHAIN_ID is required
    chain_id = _conservative_chain_id(value)
    if chain_id is None or chain_id <= 0 or chain_id > _MAX_SAFE_INTEGER:
        return "unknown"  # loader throws: not a positive safe integer
    return "true" if chain_id == 1 else "false"


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
    if container != DEFAULT_CONTAINER:
        return unreadable, 2  # bound to the Points container; never inspect anything else
    try:
        raw = inspector(container)
        env = _env_entries(raw, container)
        if env is None:
            return unreadable, 2
        found = _collect(env)
        fee_router = classify_fee_router(found["FEE_ROUTER_ADDRESS"])
        mode = classify_mode(found["NODE_ENV"])
        chain = classify_chain(found["CHAIN_ID"], mode)
    except Exception:  # noqa: BLE001 - every failure maps to one constant category
        return unreadable, 2
    lines = [f"fee_router={fee_router}", f"chain_mainnet={chain}", f"mode={mode}"]
    ambiguous = fee_router in ("duplicate", "unreadable") or chain == "unknown" or mode == "unknown"
    return lines, 2 if ambiguous else 0


def main(argv: Sequence[str]) -> int:
    if len(argv) != 1:
        print("usage: classify-points-config.py  (no arguments)", file=sys.stderr)
        return 2
    lines, code = classify(DEFAULT_CONTAINER)
    for line in lines:
        print(line)
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv))
