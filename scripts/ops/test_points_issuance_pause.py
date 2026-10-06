#!/usr/bin/env python3
"""Dummy-fixture tests for points-issuance-pause.py (fake docker, fake edge; no network)."""

from __future__ import annotations

import importlib.util
import io
import json
import re
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from typing import Any, Optional, Sequence

_PATH = Path(__file__).with_name("points-issuance-pause.py")
_SPEC = importlib.util.spec_from_file_location("points_issuance_pause", _PATH)
assert _SPEC and _SPEC.loader
mod = importlib.util.module_from_spec(_SPEC)
sys.modules["points_issuance_pause"] = mod
_SPEC.loader.exec_module(mod)

NEW_SHA = "a" * 40
CANONICAL = "0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a"
OTHER = "0x1111111111111111111111111111111111111111"
SENTINELS = ("SENTINEL-SECRET-JWT", "SENTINEL-TRAEFIK-DNS-TOKEN", OTHER, CANONICAL, CANONICAL.lower())
POINTS_LABELS = {
    "com.docker.compose.project": "inferno",
    "com.docker.compose.service": "points-backend",
    "traefik.enable": "true",
    "traefik.http.routers.ifr-points.rule": "Host(`points-api.ifrunit.tech`)",
    "traefik.http.routers.ifr-points.entrypoints": "websecure",
    "traefik.http.routers.ifr-points.tls.certresolver": "letsencrypt",
    "traefik.http.services.ifr-points.loadbalancer.server.port": "3004",
    "traefik.docker.network": "traefik-public",
}


class Edge:
    """Fake Traefik + Points backend: 503 for matching POSTs while our file is loaded."""

    def __init__(self, fx: "Fixture") -> None:
        self.fx = fx
        self.honor = True
        self.preflight_issue = 401
        self.calls: list[tuple[str, str]] = []

    def probe(self, method: str, path: str) -> int:
        self.calls.append((method, path))
        if path == "/health":
            return 200
        pause = self.fx.dyn / mod.PAUSE_FILE
        if self.honor and pause.exists() and method == "POST" and re.search(r"(?i)voucher", path):
            return 503
        return self.preflight_issue


class Fixture:
    def __init__(self, args: Optional[list[str]] = None, image: str = "traefik:v3.1.4",
                 mounts: Optional[list[dict[str, Any]]] = None, labels: Optional[dict[str, str]] = None,
                 ports: Optional[dict[str, Any]] = None, router_value: str = OTHER,
                 traefik_rows: Optional[list[str]] = None, version_label: Optional[str] = "3.1.4") -> None:
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.root = base / "opt-inferno"
        (self.root / "points-backend").mkdir(parents=True)
        (self.root / "points-backend" / "RELEASE_SHA").write_text("3a3a6bda3cc237808517e60beb848f04ef8d50e8\n")
        self.dyn = base / "traefik" / "dynamic"
        self.dyn.mkdir(parents=True)
        (self.dyn / "other.yml").write_text("http:\n  middlewares:\n    sec:\n      headers: {}\n")
        self.args = args if args is not None else [
            "--providers.docker=true", "--providers.file.directory=/etc/traefik/dynamic",
            "--providers.file.watch=true", "--entrypoints.websecure.address=:443"]
        self.image = image
        self.mounts = mounts if mounts is not None else [
            {"Type": "bind", "Source": str(self.dyn), "Destination": "/etc/traefik/dynamic", "RW": False},
            {"Type": "bind", "Source": "/var/run/docker.sock", "Destination": "/var/run/docker.sock"},
        ]
        self.labels = dict(labels if labels is not None else POINTS_LABELS)
        self.labels["com.docker.compose.project.working_dir"] = str(self.root)
        self.ports = ports if ports is not None else {"3004/tcp": None}
        self.router_value = router_value
        self.traefik_rows = traefik_rows if traefik_rows is not None else ["tid1\ttraefik:v3.1.4"]
        self.version_label = version_label
        self.edge = Edge(self)
        self.lines: list[str] = []
        self.commands: list[list[str]] = []
        self.clock = 0.0

    def run_cmd(self, cmd: Sequence[str]) -> str:
        cmd = list(cmd)
        self.commands.append(cmd)
        if cmd[:4] == ["docker", "inspect", "--type", "container"] and cmd[-1] == "inferno-points-backend":
            assert "--format" not in cmd
            return json.dumps([{
                "Name": "/inferno-points-backend",
                "State": {"Running": True, "Status": "running"},
                "Config": {"Labels": self.labels, "Env": [
                    "JWT_SECRET=SENTINEL-SECRET-JWT", f"FEE_ROUTER_ADDRESS={self.router_value}"]},
                "NetworkSettings": {"Ports": self.ports},
            }])
        if cmd[:2] == ["docker", "ps"]:
            return "\n".join([*self.traefik_rows, "pid\tinferno-points-backend:latest"]) + "\n"
        if cmd[:4] == ["docker", "inspect", "--type", "container"] and "--format" in cmd:
            fmt = cmd[cmd.index("--format") + 1]
            assert "Env" not in fmt, "must never request the Traefik environment"
            return "\n".join(json.dumps(x) for x in (
                self.image, self.args, ({"org.opencontainers.image.version": self.version_label} if self.version_label else {}), self.mounts, True)) + "\n"
        raise AssertionError(f"unexpected command {cmd}")

    def tick(self) -> float:
        self.clock += 1.0
        return self.clock

    def run(self, *args: str) -> int:
        self.lines.clear()
        err = io.StringIO()
        deps = mod.Deps(run=self.run_cmd, probe=self.edge.probe, sleep=lambda _s: None,
                        monotonic=self.tick, out=self.lines.append, wait_seconds=5.0)
        with redirect_stderr(err):
            code = mod.main(["points-issuance-pause.py", *args], deps)
        self.err = err.getvalue()
        return int(code)

    def out(self) -> dict[str, str]:
        return dict(line.split("=", 1) for line in self.lines)

    @property
    def pause_file(self) -> Path:
        return self.dyn / str(mod.PAUSE_FILE)

    def close(self) -> None:
        self.tmp.cleanup()


class PauseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fx = Fixture()

    def tearDown(self) -> None:
        self.fx.close()

    def assertNoLeak(self, fx: Optional[Fixture] = None) -> None:
        fx = fx or self.fx
        text = "\n".join(fx.lines) + fx.err
        for s in SENTINELS:
            self.assertNotIn(s, text)

    def test_status_inactive(self) -> None:
        self.assertEqual(self.fx.run("--status"), 0)
        out = self.fx.out()
        self.assertEqual(out["mechanism"], "traefik-file-provider")
        self.assertEqual(out["pause"], "inactive")
        self.assertEqual(out["traefik_major"], "3")
        self.assertEqual(Path(out["pause_file"]), self.fx.pause_file)
        self.assertEqual(self.fx.edge.calls, [])  # status never probes
        self.assertNoLeak()

    def test_pause_writes_exact_router_and_verifies_503(self) -> None:
        self.assertEqual(self.fx.run("--pause"), 0)
        out = self.fx.out()
        self.assertEqual(out["pause"], "active")
        self.assertEqual(out["check_issue"], "503,503,503,503")
        self.assertEqual(out["check_health"], "200")
        text = self.fx.pause_file.read_text()
        self.assertIn('rule: "Host(`points-api.ifrunit.tech`) && Method(`POST`) && PathRegexp(`(?i)voucher`)"', text)
        self.assertIn("        - websecure\n", text)
        self.assertIn("        certResolver: letsencrypt\n", text)
        self.assertIn("        servers: []\n", text)
        self.assertEqual(self.fx.pause_file.stat().st_mode & 0o777, 0o644)
        self.assertEqual(self.fx.edge.calls[:2], [("POST", "/voucher/issue"), ("GET", "/health")])  # preflight
        self.assertEqual((self.fx.dyn / "other.yml").read_text(), "http:\n  middlewares:\n    sec:\n      headers: {}\n")
        self.assertEqual(self.fx.run("--status"), 0)
        self.assertEqual(self.fx.out()["pause"], "active")
        self.assertNoLeak()

    def test_pause_is_idempotent(self) -> None:
        self.assertEqual(self.fx.run("--pause"), 0)
        before = self.fx.pause_file.read_bytes()
        self.assertEqual(self.fx.run("--pause"), 0)
        self.assertEqual(self.fx.out()["action"], "none")
        self.assertEqual(self.fx.pause_file.read_bytes(), before)

    def test_edge_ignores_file_reverts(self) -> None:
        self.fx.edge.honor = False
        self.assertEqual(self.fx.run("--pause"), 1)
        out = self.fx.out()
        self.assertEqual((out["pause"], out["reverted"]), ("failed", "verified"))
        self.assertFalse(self.fx.pause_file.exists())

    def test_preflight_unexpected_writes_nothing(self) -> None:
        for code in (404, 200, 503, 0):
            self.fx.edge.preflight_issue = code
            self.assertEqual(self.fx.run("--pause"), 2)
            self.assertEqual(self.fx.out()["refuse"], "preflight_probe_unexpected")
            self.assertFalse(self.fx.pause_file.exists())

    def test_modified_file_refuses_everything(self) -> None:
        self.fx.pause_file.write_text("# hand edited\n")
        self.assertEqual(self.fx.run("--status"), 2)
        self.assertEqual(self.fx.out()["pause"], "modified")
        self.assertEqual(self.fx.run("--pause"), 2)
        self.assertEqual(self.fx.run("--resume", "--expected-release", NEW_SHA), 2)
        self.assertEqual(self.fx.pause_file.read_text(), "# hand edited\n")

    def test_resume_guards_and_success(self) -> None:
        self.assertEqual(self.fx.run("--pause"), 0)
        for sha, code in (("abc", "expected_release_invalid"),
                          ("3a3a6bda3cc237808517e60beb848f04ef8d50e8", "expected_release_invalid"),
                          (NEW_SHA, "live_release_mismatch")):
            self.assertEqual(self.fx.run("--resume", "--expected-release", sha), 2)
            self.assertEqual(self.fx.out()["refuse"], code)
            self.assertTrue(self.fx.pause_file.exists())
        (self.fx.root / "points-backend" / "RELEASE_SHA").write_text(NEW_SHA + "\n")
        self.assertEqual(self.fx.run("--resume", "--expected-release", NEW_SHA), 2)
        self.assertEqual(self.fx.out()["refuse"], "container_router_not_canonical")
        self.assertTrue(self.fx.pause_file.exists())
        self.fx.router_value = CANONICAL
        self.assertEqual(self.fx.run("--resume", "--expected-release", NEW_SHA), 0)
        out = self.fx.out()
        self.assertEqual((out["action"], out["issuance_reachable"]), ("removed", "verified"))
        self.assertFalse(self.fx.pause_file.exists())
        self.assertEqual(self.fx.run("--resume", "--expected-release", NEW_SHA), 0)
        self.assertEqual(self.fx.out()["action"], "none")
        self.assertNoLeak()

    def _ready_for_resume(self) -> bytes:
        self.assertEqual(self.fx.run("--pause"), 0)
        (self.fx.root / "points-backend" / "RELEASE_SHA").write_text(NEW_SHA + "\n")
        self.fx.router_value = CANONICAL
        return self.fx.pause_file.read_bytes()

    def test_resume_check_failure_restores_pause(self) -> None:
        content = self._ready_for_resume()
        self.fx.edge.preflight_issue = 502  # backend not answering 401 after the pause is lifted
        self.assertEqual(self.fx.run("--resume", "--expected-release", NEW_SHA), 1)
        out = self.fx.out()
        self.assertEqual(out["resume"], "resume_failed_pause_restored")
        self.assertEqual(out["restored_issue"], "503,503,503,503")
        self.assertEqual(out["restored_health"], "200")
        self.assertEqual(self.fx.pause_file.read_bytes(), content)
        self.assertEqual(self.fx.run("--status"), 0)
        self.assertEqual(self.fx.out()["pause"], "active")
        self.assertNoLeak()

    def test_resume_check_failure_and_restore_unverified(self) -> None:
        content = self._ready_for_resume()
        self.fx.edge.preflight_issue = 502
        self.fx.edge.honor = False  # edge no longer applies the file
        self.assertEqual(self.fx.run("--resume", "--expected-release", NEW_SHA), 1)
        out = self.fx.out()
        self.assertEqual(out["resume"], "resume_failed_pause_restore_unverified")
        self.assertEqual(self.fx.pause_file.read_bytes(), content)  # file kept in place, no further action
        self.assertNoLeak()

    def test_unavailable_topologies_change_nothing(self) -> None:
        dyn_bind = {"Type": "bind", "Destination": "/etc/traefik/dynamic"}
        cases: list[tuple[dict[str, Any], str]] = [
            ({"args": ["--providers.docker=true"]}, "file_provider_absent"),
            ({"args": ["--providers.file.filename=/etc/traefik/dyn.yml"]}, "file_provider_single_file"),
            ({"args": ["--providers.file.directory=/etc/traefik/dynamic", "--providers.file.watch=false"]},
             "file_provider_not_watched"),
            ({"args": ["--configFile=/etc/traefik/traefik.yml"]}, "traefik_static_config_file"),
            ({"mounts": [{"Type": "volume", "Source": "x", "Destination": "/etc/traefik/dynamic"}]},
             "file_provider_dir_not_bind_mount"),
            ({"mounts": []}, "file_provider_dir_not_on_host"),
            ({"mounts": [{**dyn_bind, "Source": "/nonexistent"},
                         {"Type": "bind", "Source": "/x/traefik.yml", "Destination": "/etc/traefik/traefik.yml"}]},
             "traefik_static_config_file"),
            ({"labels": {k: v for k, v in POINTS_LABELS.items() if k != "traefik.enable"}}, "points_not_traefik_routed"),
        ]
        for kwargs, reason in cases:
            fx = Fixture(**kwargs)
            try:
                with self.subTest(reason=reason):
                    for args in (("--status",), ("--pause",)):
                        self.assertEqual(fx.run(*args), 2)
                        self.assertEqual(fx.out().get("mechanism"), "unavailable")
                        self.assertEqual(fx.out().get("reason"), reason)
                    self.assertFalse(fx.pause_file.exists())
                    self.assertEqual(fx.edge.calls, [])
            finally:
                fx.close()

    def test_refused_topologies(self) -> None:
        two_hosts = {**POINTS_LABELS, "traefik.http.routers.b.rule": "Host(`points-api.ifrunit.tech`) && PathPrefix(`/x`)"}
        cases: list[tuple[dict[str, Any], str]] = [
            ({"traefik_rows": []}, "traefik_container_absent"),
            ({"traefik_rows": ["a\ttraefik:v3.1", "b\ttraefik:v3.1"]}, "traefik_container_ambiguous"),
            ({"image": "traefik:latest", "version_label": None}, "traefik_version_unknown"),
            ({"image": "traefik:v4.0", "version_label": None}, "traefik_version_unknown"),
            ({"labels": two_hosts}, "points_router_ambiguous"),
            ({"labels": {k: v for k, v in POINTS_LABELS.items() if not k.endswith("entrypoints")}},
             "points_router_entrypoints_missing"),
            ({"labels": {**POINTS_LABELS, "traefik.http.routers.ifr-points.tls.options": "x"}},
             "points_router_options_unsupported"),
            ({"ports": {"3004/tcp": [{"HostIp": "0.0.0.0", "HostPort": "3004"}]}}, "points_port_published"),
            ({"ports": {"3004/tcp": [{"HostIp": "", "HostPort": "3004"}]}}, "points_port_published"),
            ({"args": ["--providers.file.directory=/a", "--providers.file.directory=/b"]}, "file_provider_ambiguous"),
        ]
        for kwargs, code in cases:
            fx = Fixture(**kwargs)
            try:
                with self.subTest(code=code):
                    self.assertEqual(fx.run("--pause"), 2)
                    self.assertEqual(fx.out().get("refuse"), code)
                    self.assertFalse(fx.pause_file.exists())
            finally:
                fx.close()

    def test_loopback_port_space_arg_and_camelcase_labels_ok(self) -> None:
        labels = {k.replace("entrypoints", "entryPoints").replace("certresolver", "certResolver"): v
                  for k, v in POINTS_LABELS.items()}
        fx = Fixture(ports={"3004/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3004"}]}, labels=labels,
                     args=["--providers.file.directory", "/etc/traefik/dynamic"])
        try:
            self.assertEqual(fx.run("--pause"), 0)
            self.assertIn("certResolver: letsencrypt", fx.pause_file.read_text())
        finally:
            fx.close()

    def test_traefik_v2_rule(self) -> None:
        fx = Fixture(image="traefik:v2.11", traefik_rows=["t\ttraefik:v2.11"])
        try:
            # label version 3.1.4 conflicts with tag v2.11 -> refuse rather than guess
            self.assertEqual(fx.run("--status"), 2)
            self.assertEqual(fx.out()["refuse"], "traefik_version_unknown")
        finally:
            fx.close()
        topo = mod.Topology(("websecure",), True, None, 2, Path("/x"), Path("/y"))
        text = mod.render(topo).decode()
        self.assertIn("Path(`/{p:(?i).*voucher.*}`)", text)
        self.assertIn("      tls: {}\n", text)

    def test_name_clash_refuses(self) -> None:
        (self.fx.dyn / "zz.yml").write_text("http:\n  routers:\n    points-issuance-pause: {}\n")
        self.assertEqual(self.fx.run("--pause"), 2)
        self.assertEqual(self.fx.out()["refuse"], "pause_name_in_use")
        self.assertFalse(self.fx.pause_file.exists())

    def test_rule_scope_matches_only_issuance(self) -> None:
        # v3 PathRegexp is unanchored Go RE2; Python re agrees for this pattern.
        pattern = re.compile(r"(?i)voucher")
        for path in ("/voucher/issue", "/Voucher/Issue", "/voucher/issue/", "/VOUCHER/ISSUE", "/voucher//issue"):
            self.assertTrue(pattern.search(path))
        for path in ("/auth/siwe/nonce", "/auth/siwe/verify", "/points/event", "/points/balance", "/health"):
            self.assertFalse(pattern.search(path))
        text = mod.render(mod.Topology(("websecure",), True, "letsencrypt", 3, Path("/x"), Path("/y"))).decode()
        self.assertIn("Method(`POST`)", text)  # GET /voucher/validate stays reachable

    def test_usage_and_unexpected(self) -> None:
        for args in ((), ("--pause", "--status"), ("--resume",), ("--resume", NEW_SHA)):
            self.assertEqual(self.fx.run(*args), 2)
            self.assertIn("usage", self.fx.err)
        fx = Fixture()
        try:
            def boom(_cmd: Sequence[str]) -> str:
                raise RuntimeError("SENTINEL-SECRET-JWT")

            setattr(fx, "run_cmd", boom)
            self.assertEqual(fx.run("--pause"), 2)
            self.assertEqual(fx.out()["refuse"], "unexpected_error")
            self.assertNoLeak(fx)
        finally:
            fx.close()


if __name__ == "__main__":
    unittest.main(verbosity=1)
