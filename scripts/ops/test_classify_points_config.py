#!/usr/bin/env python3
"""Dummy-fixture tests for classify-points-config.py (no Docker, no real values)."""

from __future__ import annotations

import importlib.util
import io
import json
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from typing import Optional

_PATH = Path(__file__).with_name("classify-points-config.py")
_SPEC = importlib.util.spec_from_file_location("classify_points_config", _PATH)
assert _SPEC and _SPEC.loader
mod = importlib.util.module_from_spec(_SPEC)
sys.modules["classify_points_config"] = mod
_SPEC.loader.exec_module(mod)

CANONICAL = "0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a"
OTHER = "0x1111111111111111111111111111111111111111"
SENTINEL_URL = "https://user:SENTINEL-PASS@rpc.example.invalid/v3/SENTINEL-KEY"


def inspect_json(env: Optional[list[str]], name: str = "/inferno-points-backend",
                 running: bool = True, status: str = "running") -> str:
    config: dict[str, object] = {"Image": "dummy"}
    if env is not None:
        config["Env"] = env
    state = {"Running": running, "Status": status}
    return json.dumps([{"Id": "dummy", "Name": name, "State": state, "Config": config}])


def run(env: Optional[list[str]] = None, raw: Optional[str] = None) -> tuple[list[str], int]:
    payload = raw if raw is not None else inspect_json(env)
    return mod.classify("inferno-points-backend", lambda _name: payload)


def base(*extra: str) -> list[str]:
    return ["CHAIN_ID=1", "NODE_ENV=production", f"RPC_URL={SENTINEL_URL}", "SECRET_X=SENTINEL-SECRET", *extra]


class FeeRouterTests(unittest.TestCase):
    def test_canonical_checksum_and_lowercase_and_padded(self) -> None:
        for value in (CANONICAL, CANONICAL.lower(), f"  {CANONICAL}\t"):
            lines, code = run(base(f"FEE_ROUTER_ADDRESS={value}"))
            self.assertEqual(code, 0)
            self.assertIn("fee_router=canonical", lines)

    def test_noncanonical(self) -> None:
        for value in (OTHER, "not-an-address", CANONICAL[:-1]):
            lines, _ = run(base(f"FEE_ROUTER_ADDRESS={value}"))
            self.assertIn("fee_router=noncanonical", lines)

    def test_absent_empty_whitespace(self) -> None:
        self.assertIn("fee_router=absent", run(base())[0])
        self.assertIn("fee_router=empty", run(base("FEE_ROUTER_ADDRESS="))[0])
        self.assertIn("fee_router=empty", run(base("FEE_ROUTER_ADDRESS=   "))[0])

    def test_duplicate_is_ambiguous_exit_2(self) -> None:
        lines, code = run(base(f"FEE_ROUTER_ADDRESS={CANONICAL}", f"FEE_ROUTER_ADDRESS={OTHER}"))
        self.assertIn("fee_router=duplicate", lines)
        self.assertEqual(code, 2)

    def test_prefix_key_is_not_matched(self) -> None:
        lines, _ = run(base(f"FEE_ROUTER_ADDRESS_OLD={CANONICAL}"))
        self.assertIn("fee_router=absent", lines)


class ContextTests(unittest.TestCase):
    def test_chain_mirrors_js_number(self) -> None:
        # Values Number() + isSafeInteger accept as chain 1.
        for value in ("1", " 1 ", "01", "1.0", "1e0", "0x1", "0X01", "0b1", "0o1", "+1"):
            lines, code = run([f"CHAIN_ID={value}", "NODE_ENV=production"])
            self.assertIn("chain_mainnet=true", lines, value)
            self.assertEqual(code, 0, value)
        self.assertIn("chain_mainnet=false", run(["CHAIN_ID=11155111"])[0])
        # Values the loader rejects -> ambiguous.
        for value in ("one", "0", "-1", "1.5", "0x", "+0x1", "1_0", "0xg", "1e400", "Infinity", "9007199254740992"):
            lines, code = run([f"CHAIN_ID={value}", "NODE_ENV=production"])
            self.assertIn("chain_mainnet=unknown", lines, value)
            self.assertEqual(code, 2, value)

    def test_chain_missing(self) -> None:
        self.assertEqual(run(["NODE_ENV=production"])[1], 2)
        self.assertIn("chain_mainnet=unknown", run(["NODE_ENV=production"])[0])
        self.assertIn("chain_mainnet=false", run(["NODE_ENV=test"])[0])  # test fallback 11155111
        self.assertIn("chain_mainnet=unknown", run(["CHAIN_ID=1", "CHAIN_ID=1"])[0])

    def test_mode(self) -> None:
        self.assertIn("mode=production-safe", run(["NODE_ENV=production"])[0])
        self.assertIn("mode=production-safe", run([])[0])
        self.assertIn("mode=production-safe", run(["NODE_ENV=prod"])[0])
        self.assertIn("mode=development", run(["NODE_ENV=development"])[0])
        self.assertIn("mode=test", run(["NODE_ENV=test"])[0])


class FailClosedTests(unittest.TestCase):
    UNREADABLE = ["fee_router=unreadable", "chain_mainnet=unknown", "mode=unknown"]

    def test_bad_inputs(self) -> None:
        for raw in ("not json", "[]", "{}", json.dumps([{}, {}]), inspect_json(None),
                    json.dumps([{"Config": {"Env": [1, 2]}}])):
            self.assertEqual(run(raw=raw), (self.UNREADABLE, 2))

    def test_inspector_error(self) -> None:
        def boom(_name: str) -> str:
            raise RuntimeError(SENTINEL_URL)
        self.assertEqual(mod.classify("inferno-points-backend", boom), (self.UNREADABLE, 2))

    def test_not_the_named_running_container(self) -> None:
        env = base(f"FEE_ROUTER_ADDRESS={CANONICAL}")
        for raw in (inspect_json(env, name="/other"), inspect_json(env, running=False, status="exited"),
                    inspect_json(env, status="restarting")):
            self.assertEqual(run(raw=raw), (self.UNREADABLE, 2))

    def test_ambiguous_mode(self) -> None:
        lines, code = run(base("NODE_ENV=test"))
        self.assertIn("mode=unknown", lines)
        self.assertEqual(code, 2)

    def test_bad_container_name(self) -> None:
        for name in ("", "-x", "a b", "x;rm", "a" * 200):
            self.assertEqual(mod.classify(name, lambda _n: inspect_json(base())), (self.UNREADABLE, 2))


class NoLeakTests(unittest.TestCase):
    def test_main_output_contains_no_values(self) -> None:
        payload = inspect_json(base(f"FEE_ROUTER_ADDRESS={OTHER}"))
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            lines, code = mod.classify("inferno-points-backend", lambda _n: payload)
            for line in lines:
                print(line)
        text = out.getvalue() + err.getvalue()
        self.assertEqual(code, 0)
        for needle in ("SENTINEL", OTHER, OTHER.lower(), CANONICAL.lower(), "rpc.example", "0x"):
            self.assertNotIn(needle, text)
        self.assertEqual(text.strip().splitlines(),
                         ["fee_router=noncanonical", "chain_mainnet=true", "mode=production-safe"])

    def test_usage_error(self) -> None:
        err = io.StringIO()
        with redirect_stderr(err), redirect_stdout(io.StringIO()):
            self.assertEqual(mod.main(["x", "a", "b"]), 2)
        self.assertNotIn("SENTINEL", err.getvalue())


if __name__ == "__main__":
    unittest.main()
