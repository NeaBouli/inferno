#!/usr/bin/env python3
"""Dummy-fixture tests for points-env-set-router.py (tmp dirs, fake docker; no real values)."""

from __future__ import annotations

import importlib.util
import io
import json
import os
import stat
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from typing import Any, Optional
from unittest import mock

_PATH = Path(__file__).with_name("points-env-set-router.py")
_SPEC = importlib.util.spec_from_file_location("points_env_set_router", _PATH)
assert _SPEC and _SPEC.loader
mod = importlib.util.module_from_spec(_SPEC)
sys.modules["points_env_set_router"] = mod
_SPEC.loader.exec_module(mod)

CANONICAL = "0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a"
OTHER = "0x1111111111111111111111111111111111111111"
SENTINELS = ("SENTINEL-SECRET-JWT", "SENTINEL-SIGNER-KEY", OTHER, OTHER.lower(), "1111111111")
BASE_ENV = (
    b"DATABASE_URL=file:/data/production.db\n"
    b"JWT_SECRET=SENTINEL-SECRET-JWT\n"
    b"VOUCHER_SIGNER_PRIVATE_KEY=SENTINEL-SIGNER-KEY\n"
    b"FEE_ROUTER_ADDRESS=" + OTHER.encode() + b"\n"
    b"# FEE_ROUTER_ADDRESS=commented-out-is-ignored\n"
    b"CHAIN_ID=1\n"
)
COMPOSE = """version: "3.8"
services:
  telegram-bot:
    build:
      context: ./telegram-bot
    env_file:
      - .env.production
  points-backend:
    build:
      context: ./points-backend
    container_name: inferno-points-backend
    restart: unless-stopped
    env_file:
      - .env.points-backend
    volumes:
      - points-data:/data
    labels:
      - traefik.enable=true
  ai-copilot:
    env_file: .env.ai-copilot
volumes:
  points-data: { name: inferno_points_data }
"""


class Fixture:
    def __init__(self, env: bytes = BASE_ENV, compose: str = COMPOSE, container_value: Optional[str] = OTHER,
                 running: bool = True, labels: Optional[dict[str, str]] = None) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "opt-inferno"
        self.root.mkdir()
        self.env_path = self.root / ".env.points-backend"
        self.env_path.write_bytes(env)
        os.chmod(self.env_path, 0o640)
        (self.root / ".env.production").write_bytes(b"BOT_TOKEN=SENTINEL-SECRET-JWT\n")
        (self.root / "docker-compose.yml").write_text(compose)
        self.container_value = container_value
        self.running = running
        self.labels = labels if labels is not None else {
            "com.docker.compose.project": "inferno",
            "com.docker.compose.service": "points-backend",
            "com.docker.compose.project.working_dir": str(self.root),
            "com.docker.compose.project.config_files": str(self.root / "docker-compose.yml"),
        }
        self.lines: list[str] = []
        self.now = 1791316800.0  # fixed clock; tests that need two stamps advance it

    def inspect(self, _name: str) -> str:
        env = ["NODE_ENV=production", "JWT_SECRET=SENTINEL-SECRET-JWT"]
        if self.container_value is not None:
            env.append(f"FEE_ROUTER_ADDRESS={self.container_value}")
        obj: dict[str, Any] = {
            "Name": "/inferno-points-backend",
            "State": {"Running": self.running, "Status": "running" if self.running else "exited"},
            "Config": {"Env": env, "Labels": self.labels},
        }
        return json.dumps([obj])

    def deps(self) -> Any:
        return mod.Deps(inspect=self.inspect, now=lambda: self.now, out=self.lines.append)

    def run(self, *args: str) -> int:
        self.lines.clear()
        err = io.StringIO()
        with redirect_stderr(err):
            code = mod.main(["points-env-set-router.py", *args], self.deps())
        self.err = err.getvalue()
        return int(code)

    def out(self) -> dict[str, str]:
        return dict(line.split("=", 1) for line in self.lines)

    def backups(self) -> list[Path]:
        return sorted(self.root.glob(".env.points-backend.router-backup-*"))

    def close(self) -> None:
        self.tmp.cleanup()


class EnvSetTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fx = Fixture()

    def tearDown(self) -> None:
        self.fx.close()

    def assertNoLeak(self, fx: Optional[Fixture] = None) -> None:
        fx = fx or self.fx
        text = "\n".join(fx.lines) + fx.err
        for s in SENTINELS:
            self.assertNotIn(s, text)
        self.assertNotIn("0x", text)
        self.assertNotIn(CANONICAL.lower()[2:], text.lower())

    def refused(self, fx: Fixture, code: str, *args: str) -> None:
        before = fx.env_path.read_bytes() if fx.env_path.exists() else None
        self.assertEqual(fx.run(*args), 2)
        self.assertEqual(fx.out().get("refuse"), code)
        if before is not None:
            self.assertEqual(fx.env_path.read_bytes(), before)
        self.assertNoLeak(fx)

    # ---------------------------------------------------------------- happy path

    def test_dry_run_writes_nothing(self) -> None:
        listing = sorted(os.listdir(self.fx.root))
        self.assertEqual(self.fx.run(), 0)
        out = self.fx.out()
        self.assertEqual(out["before"], "noncanonical")
        self.assertEqual(out["container"], "noncanonical")
        self.assertEqual(out["action"], "would-replace")
        self.assertEqual(out["env_file"], str(self.fx.env_path.resolve()))
        self.assertEqual(self.fx.env_path.read_bytes(), BASE_ENV)
        self.assertEqual(sorted(os.listdir(self.fx.root)), listing)
        self.assertNoLeak()

    def test_apply_replaces_only_the_value_and_keeps_metadata(self) -> None:
        st0 = os.lstat(self.fx.env_path)
        self.assertEqual(self.fx.run("--apply"), 0)
        out = self.fx.out()
        self.assertEqual((out["action"], out["after"], out["restore_check"]), ("replaced", "canonical", "identical"))
        self.assertEqual(out["effective"], "after-next-container-recreate")
        expected = BASE_ENV.replace(b"FEE_ROUTER_ADDRESS=" + OTHER.encode(), b"FEE_ROUTER_ADDRESS=" + CANONICAL.encode())
        self.assertEqual(self.fx.env_path.read_bytes(), expected)
        st1 = os.lstat(self.fx.env_path)
        self.assertEqual(stat.S_IMODE(st1.st_mode), 0o640)
        self.assertEqual((st1.st_uid, st1.st_gid), (st0.st_uid, st0.st_gid))
        backups = self.fx.backups()
        self.assertEqual(len(backups), 1)
        self.assertEqual(Path(out["backup"]).resolve(), backups[0].resolve())
        self.assertEqual(backups[0].read_bytes(), BASE_ENV)
        self.assertEqual(stat.S_IMODE(os.lstat(backups[0]).st_mode), 0o600)
        self.assertEqual((os.lstat(backups[0]).st_uid, os.lstat(backups[0]).st_gid), (st0.st_uid, st0.st_gid))
        self.assertFalse(list(self.fx.root.glob("*tmp*")))
        self.assertNoLeak()

    def test_apply_is_idempotent(self) -> None:
        self.assertEqual(self.fx.run("--apply"), 0)
        after = self.fx.env_path.read_bytes()
        self.fx.now += 5
        self.assertEqual(self.fx.run("--apply"), 0)
        self.assertEqual(self.fx.out()["action"], "none")
        self.assertEqual(self.fx.out()["before"], "canonical")
        self.assertEqual(self.fx.env_path.read_bytes(), after)
        self.assertEqual(len(self.fx.backups()), 1)
        self.assertNoLeak()

    def test_crlf_trailing_spaces_and_missing_final_newline(self) -> None:
        env = b"A=1\r\nFEE_ROUTER_ADDRESS=" + OTHER.encode() + b"   \r\nB=2"
        fx = Fixture(env=env)
        try:
            self.assertEqual(fx.run("--apply"), 0)
            self.assertEqual(fx.env_path.read_bytes(), b"A=1\r\nFEE_ROUTER_ADDRESS=" + CANONICAL.encode() + b"\r\nB=2")
            self.assertEqual(fx.backups()[0].read_bytes(), env)
            self.assertNoLeak(fx)
        finally:
            fx.close()

    def test_key_on_last_line_without_newline(self) -> None:
        env = b"A=1\nFEE_ROUTER_ADDRESS=" + OTHER.encode()
        fx = Fixture(env=env)
        try:
            self.assertEqual(fx.run("--apply"), 0)
            self.assertEqual(fx.env_path.read_bytes(), b"A=1\nFEE_ROUTER_ADDRESS=" + CANONICAL.encode())
        finally:
            fx.close()

    def test_quoted_value_is_compared_unquoted(self) -> None:
        fx = Fixture(env=b'FEE_ROUTER_ADDRESS="' + OTHER.encode() + b'"\n')
        try:
            self.assertEqual(fx.run("--apply"), 0)
            self.assertEqual(fx.env_path.read_bytes(), b"FEE_ROUTER_ADDRESS=" + CANONICAL.encode() + b"\n")
        finally:
            fx.close()

    def test_long_and_scalar_compose_env_file_syntax(self) -> None:
        long_form = COMPOSE.replace("      - .env.points-backend\n",
                                    "      - path: ./.env.points-backend\n        required: true\n")
        scalar = COMPOSE.replace("    env_file:\n      - .env.points-backend\n", "    env_file: .env.points-backend\n")
        for compose in (long_form, scalar):
            fx = Fixture(compose=compose)
            try:
                self.assertEqual(fx.run(), 0, compose)
                self.assertEqual(fx.out()["action"], "would-replace")
            finally:
                fx.close()

    def test_restore_round_trip_is_byte_identical(self) -> None:
        self.assertEqual(self.fx.run("--apply"), 0)
        backup = self.fx.out()["backup"]
        changed = self.fx.env_path.read_bytes()
        self.fx.now += 60
        self.assertEqual(self.fx.run("--restore", backup), 0)
        self.assertEqual(self.fx.out()["action"], "would-restore")
        self.assertEqual(self.fx.env_path.read_bytes(), changed)
        self.assertEqual(self.fx.run("--restore", backup, "--apply"), 0)
        out = self.fx.out()
        self.assertEqual((out["action"], out["restore_check"]), ("restored", "identical"))
        self.assertEqual(self.fx.env_path.read_bytes(), BASE_ENV)
        self.assertEqual(stat.S_IMODE(os.lstat(self.fx.env_path).st_mode), 0o640)
        self.assertEqual(Path(out["pre_restore_backup"]).read_bytes(), changed)
        self.assertNoLeak()

    # ---------------------------------------------------------------- failures

    def test_replace_failure_leaves_original(self) -> None:
        with mock.patch.object(mod.os, "replace", side_effect=OSError("boom SENTINEL-SECRET-JWT")):
            self.assertEqual(self.fx.run("--apply"), 1)
        self.assertEqual(self.fx.out()["auto_restore"], "identical")
        self.assertEqual(self.fx.env_path.read_bytes(), BASE_ENV)
        self.assertFalse(list(self.fx.root.glob("*tmp*")))
        self.assertNoLeak()

    def test_failure_after_replace_restores_from_backup(self) -> None:
        calls = {"n": 0}
        real = mod._fsync_dir

        def flaky(d: Path) -> None:
            calls["n"] += 1
            if calls["n"] == 1:
                raise OSError("fsync")
            real(d)

        with mock.patch.object(mod, "_fsync_dir", side_effect=flaky):
            self.assertEqual(self.fx.run("--apply"), 1)
        self.assertEqual(self.fx.out()["auto_restore"], "identical")
        self.assertEqual(self.fx.env_path.read_bytes(), BASE_ENV)
        self.assertEqual(stat.S_IMODE(os.lstat(self.fx.env_path).st_mode), 0o640)
        self.assertNoLeak()

    def test_refusals(self) -> None:
        o = OTHER.encode()
        cases: list[tuple[dict[str, Any], str]] = [
            ({"env": BASE_ENV + b"FEE_ROUTER_ADDRESS=" + o + b"\n"}, "env_key_duplicate"),
            ({"env": b"A=1\n"}, "env_key_absent"),
            ({"env": b"export FEE_ROUTER_ADDRESS=" + o + b"\n"}, "env_key_ambiguous"),
            ({"env": b"  FEE_ROUTER_ADDRESS=" + o + b"\n"}, "env_key_ambiguous"),
            ({"env": b"FEE_ROUTER_ADDRESS =" + o + b"\n"}, "env_key_ambiguous"),
            ({"env": b"FEE_ROUTER_ADDRESS=" + o + b"\xc2\xa0\n", "container_value": OTHER + " "},
             "env_value_non_ascii"),
            ({"env": b"FEE_ROUTER_ADDRESS=" + o + b" # old\n"}, "env_value_ambiguous"),
            ({"env": b"FEE_ROUTER_ADDRESS=${ROUTER}\n"}, "env_value_ambiguous"),
            ({"env": b"A=1\x00\nFEE_ROUTER_ADDRESS=" + o + b"\n"}, "env_unreadable"),
            ({"env": b"A=1\rFEE_ROUTER_ADDRESS=" + o + b"\n"}, "env_unreadable"),
            ({"container_value": "0x2222222222222222222222222222222222222222"}, "env_file_not_container_source"),
            ({"container_value": None}, "container_key_absent_or_duplicate"),
            ({"running": False}, "container_not_running"),
            ({"compose": COMPOSE.replace("    restart:", "    environment:\n      - FEE_ROUTER_ADDRESS=x\n    restart:")},
             "compose_sets_router_inline"),
            ({"compose": COMPOSE.replace("      - .env.points-backend", "      - ${ENV_FILE}")},
             "compose_env_file_unsupported"),
            ({"compose": COMPOSE.replace("    env_file:\n      - .env.points-backend\n", "")},
             "compose_env_file_ambiguous"),
            ({"compose": COMPOSE.replace("volumes:\n  points-data", "  points-backend:\n    image: x\nvolumes:\n  points-data")},
             "compose_service_ambiguous"),
            ({"compose": COMPOSE.replace("    restart:", "    <<: *defaults\n    restart:")},
             "compose_unsupported_syntax"),
            ({"compose": COMPOSE.replace("      - .env.points-backend", "      - ../outside.env")},
             "env_outside_project"),
        ]
        for kwargs, code in cases:
            fx = Fixture(**kwargs)
            try:
                for args in ((), ("--apply",)):
                    with self.subTest(code=code, args=args):
                        self.refused(fx, code, *args)
                    self.assertEqual(fx.backups(), [], (kwargs, code))
            finally:
                fx.close()

    def test_label_refusals(self) -> None:
        base = Fixture()
        try:
            good = dict(base.labels)
        finally:
            base.close()
        variants = [
            ({**good, "com.docker.compose.project": "other"}, "compose_project_mismatch"),
            ({**good, "com.docker.compose.service": "ai-copilot"}, "compose_service_mismatch"),
            ({k: v for k, v in good.items() if k != "com.docker.compose.project.working_dir"}, "compose_labels_missing"),
        ]
        for labels, code in variants:
            fx = Fixture(labels=labels)
            try:
                self.refused(fx, code, "--apply")
            finally:
                fx.close()
        fx = Fixture()
        try:
            fx.labels["com.docker.compose.project.config_files"] += "," + str(fx.root / "docker-compose.override.yml")
            self.refused(fx, "compose_config_files_unexpected", "--apply")
        finally:
            fx.close()

    def test_env_outside_project_symlink_and_hardlink(self) -> None:
        fx = Fixture()
        try:
            outside = Path(fx.tmp.name) / "outside.env"
            outside.write_bytes(BASE_ENV)
            (fx.root / "docker-compose.yml").write_text(COMPOSE.replace(".env.points-backend", str(outside)))
            self.refused(fx, "env_outside_project", "--apply")
        finally:
            fx.close()
        fx = Fixture()
        try:
            real = fx.root / "real.env"
            fx.env_path.rename(real)
            fx.env_path.symlink_to(real)
            self.assertEqual(fx.run("--apply"), 2)
            self.assertEqual(fx.out()["refuse"], "env_symlink")
            self.assertEqual(real.read_bytes(), BASE_ENV)
        finally:
            fx.close()
        fx = Fixture()
        try:
            os.link(fx.env_path, fx.root / "hard.env")
            self.refused(fx, "env_hard_linked", "--apply")
        finally:
            fx.close()

    def test_key_in_two_env_files(self) -> None:
        compose = COMPOSE.replace("      - .env.points-backend\n", "      - .env.production\n      - .env.points-backend\n")
        fx = Fixture(compose=compose)
        try:
            (fx.root / ".env.production").write_bytes(b"FEE_ROUTER_ADDRESS=" + OTHER.encode() + b"\n")
            self.refused(fx, "env_key_in_several_files", "--apply")
        finally:
            fx.close()

    def test_unreadable_env_file(self) -> None:
        if os.geteuid() == 0:
            self.skipTest("root can read 000 files")
        os.chmod(self.fx.env_path, 0)
        try:
            self.assertEqual(self.fx.run("--apply"), 2)
            self.assertEqual(self.fx.out()["refuse"], "env_unreadable")
        finally:
            os.chmod(self.fx.env_path, 0o640)

    def test_restore_refusals(self) -> None:
        self.assertEqual(self.fx.run("--apply"), 0)
        good = Path(self.fx.out()["backup"])
        bad_name = self.fx.root / ".env.points-backend.router-backup-x"
        bad_name.write_bytes(BASE_ENV)
        os.chmod(bad_name, 0o600)
        elsewhere = Path(self.fx.tmp.name) / good.name
        elsewhere.write_bytes(BASE_ENV)
        for path in (bad_name, elsewhere):
            self.refused(self.fx, "backup_path_unexpected", "--restore", str(path), "--apply")
        os.chmod(good, 0o644)
        self.refused(self.fx, "backup_mode_unexpected", "--restore", str(good), "--apply")

    def test_backup_collision_refuses(self) -> None:
        stamp = mod._stamp(lambda: self.fx.now)
        clash = self.fx.root / f".env.points-backend.router-backup-{stamp}"
        clash.write_bytes(b"x")
        self.refused(self.fx, "backup_exists", "--apply")
        self.assertEqual(clash.read_bytes(), b"x")

    def test_usage_and_unexpected_error(self) -> None:
        for args in (("--apply", "--apply"), ("--force",), ("--restore",), ("x",)):
            self.assertEqual(self.fx.run(*args), 2)
            self.assertIn("usage", self.fx.err)
        with mock.patch.object(mod, "locate_env_file", side_effect=RuntimeError("SENTINEL-SECRET-JWT")):
            self.assertEqual(self.fx.run("--apply"), 2)
        self.assertEqual(self.fx.out()["refuse"], "unexpected_error")
        self.assertNoLeak()
        self.assertEqual(self.fx.env_path.read_bytes(), BASE_ENV)

    def test_never_sources_env_as_shell(self) -> None:
        env = b"$(touch PWNED)\n`touch PWNED2`\nFEE_ROUTER_ADDRESS=" + OTHER.encode() + b"\n"
        fx = Fixture(env=env)
        try:
            with mock.patch.object(mod.subprocess, "run", side_effect=AssertionError("no subprocess")):
                self.assertEqual(fx.run("--apply"), 0)
            self.assertFalse((fx.root / "PWNED").exists())
            self.assertTrue(fx.env_path.read_bytes().startswith(b"$(touch PWNED)\n`touch PWNED2`\n"))
        finally:
            fx.close()


if __name__ == "__main__":
    unittest.main(verbosity=1)
