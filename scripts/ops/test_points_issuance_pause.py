#!/usr/bin/env python3
"""Dummy-fixture tests for points-issuance-pause.py (fake docker, fake edge; no network)."""

from __future__ import annotations

import importlib.util
import io
import json
import os
import re
import sys
import tarfile
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
STATIC_OK = (
    "# static config\n"
    "api:\n  dashboard: false\n"
    "entryPoints:\n  websecure:\n    address: \":443\"\n"
    "providers:\n  docker:\n    endpoint: \"unix:///var/run/docker.sock\"\n    exposedByDefault: false\n"
    "  file:\n    directory: /etc/traefik/dynamic\n    watch: true\n"
    "certificatesResolvers:\n  letsencrypt:\n    acme:\n      email: SENTINEL-ACME-MAIL\n"
    "log:\n  level: INFO\n"
)
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
                 traefik_rows: Optional[list[str]] = None, version_label: Optional[str] = "3.1.4",
                 traefik_name: str = "/traefik-central", traefik_project: Optional[str] = "traefik",
                 traefik_networks: Any = None, points_networks: Any = None,
                 workdir: Any = "", static_yaml: Optional[str] = None, static_dest: str = "/traefik.yml",
                 container_files: Optional[dict[str, bytes]] = None, user: str = "",
                 env_rows: Optional[list[str]] = None) -> None:
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
        self.traefik_rows = traefik_rows if traefik_rows is not None else [
            "tid1\ttraefik:v3.1.4\ttraefik-central", "pid2\ttraefik:v3.1\tparlay-traefik"]
        self.version_label = version_label
        self.traefik_name = traefik_name
        self.traefik_project = traefik_project
        self.traefik_networks = traefik_networks if traefik_networks is not None else {
            "traefik-public": {"IPAddress": "172.18.0.2"}, "traefik-internal": {}}
        self.points_networks = points_networks if points_networks is not None else {
            "traefik-public": {"IPAddress": "172.18.0.5"}, "inferno-default": {}}
        self.inspected: list[str] = []
        self.workdir = workdir
        self.user = user
        self.env_rows = env_rows if env_rows is not None else []
        # what `docker cp` sees in the container's merged filesystem (image + layer + mounts)
        self.container_files: dict[str, bytes] = dict(container_files or {})
        self.copied: list[str] = []
        if static_yaml is not None:
            self.static = base / "traefik-static.yml"
            self.static.write_text(static_yaml)
            self.mounts = [*self.mounts, {"Type": "bind", "Source": str(self.static), "Destination": static_dest}]
            self.container_files.setdefault(static_dest, static_yaml.encode())
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
                "NetworkSettings": {"Ports": self.ports, "Networks": self.points_networks},
            }])
        if cmd[:2] == ["docker", "ps"]:
            assert cmd[-1] == "{{.ID}}\t{{.Image}}\t{{.Names}}"
            return "\n".join([*self.traefik_rows, "pid\tinferno-points-backend:latest\tinferno-points-backend"]) + "\n"
        if cmd[:4] == ["docker", "inspect", "--type", "container"] and "--format" in cmd:
            fmt = cmd[cmd.index("--format") + 1]
            if fmt == "{{json .Config.User}}":
                return json.dumps(self.user) + "\n"
            if fmt == mod._ENV_FMT:
                return "".join(json.dumps(r) + "\n" for r in self.env_rows) + "\n"  # docker's trailing newline
            assert "Env" not in fmt, "must never request the Traefik environment"
            self.inspected.append(cmd[-1])
            tlabels: dict[str, str] = {}
            if self.version_label:
                tlabels["org.opencontainers.image.version"] = self.version_label
            if self.traefik_project is not None:
                tlabels["com.docker.compose.project"] = self.traefik_project
            return "\n".join(json.dumps(x) for x in (
                self.image, self.args, tlabels, self.mounts, True, self.traefik_name,
                self.traefik_networks, self.workdir)) + "\n"

        raise AssertionError(f"unexpected command {cmd}")

    def copy(self, container: str, path: str) -> Optional[bytes]:
        assert container == "tid1" or container == "c", container
        self.copied.append(path)
        data = self.container_files.get(path)
        if data is None:
            return None
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w") as tf:
            info = tarfile.TarInfo(path.rsplit("/", 1)[-1])
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
        return buf.getvalue()

    def tick(self) -> float:
        self.clock += 1.0
        return self.clock

    def run(self, *args: str) -> int:
        self.lines.clear()
        err = io.StringIO()
        deps = mod.Deps(run=self.run_cmd, probe=self.edge.probe, sleep=lambda _s: None,
                        monotonic=self.tick, out=self.lines.append, wait_seconds=5.0,
                        copy=self.copy)
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


class CopyTests(unittest.TestCase):
    """The real `docker cp` wrapper against a fake docker binary: missing, ok, oversized, hung, error."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        fake = Path(self.tmp.name) / "docker"
        fake.write_text(
            "#!/bin/sh\n"
            'case "$2" in\n'
            '  c:/missing) echo "Error response from daemon: Could not find the file /missing in container c" >&2; exit 1;;\n'
            '  c:/ok) printf okdata; exit 0;;\n'
            '  c:/big) head -c 400000 /dev/zero; exit 0;;\n'
            '  c:/hang) sleep 30; exit 0;;\n'
            '  *) echo "permission denied" >&2; exit 1;;\n'
            "esac\n")
        fake.chmod(0o755)
        self.old_path = os.environ["PATH"]
        os.environ["PATH"] = f"{self.tmp.name}{os.pathsep}{self.old_path}"
        self.old_timeout = mod.COPY_TIMEOUT
        mod.COPY_TIMEOUT = 1.0

    def tearDown(self) -> None:
        os.environ["PATH"] = self.old_path
        mod.COPY_TIMEOUT = self.old_timeout
        self.tmp.cleanup()

    def test_copy_outcomes(self) -> None:
        self.assertIsNone(mod._copy("c", "/missing"))
        self.assertEqual(mod._copy("c", "/ok"), b"okdata")
        for path, code in (("/big", "traefik_static_config_too_large"), ("/hang", "docker_failed"),
                           ("/other", "docker_failed")):
            with self.subTest(path=path):
                with self.assertRaises(mod.Refuse) as ctx:
                    mod._copy("c", path)
                self.assertEqual(ctx.exception.code, code)


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
        cases: list[tuple[dict[str, Any], str]] = [
            ({"args": ["--providers.docker=true"]}, "file_provider_absent"),
            ({"args": ["--providers.file.filename=/etc/traefik/dyn.yml"]}, "file_provider_single_file"),
            ({"args": ["--providers.file.directory=/etc/traefik/dynamic", "--providers.file.watch=false"]},
             "file_provider_not_watched"),
            ({"args": ["--configFile=/etc/traefik/traefik.yml"]}, "traefik_static_config_file"),
            ({"mounts": [{"Type": "volume", "Source": "x", "Destination": "/etc/traefik/dynamic"}]},
             "file_provider_dir_not_bind_mount"),
            ({"mounts": []}, "file_provider_dir_not_on_host"),
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
            ({"traefik_rows": ["a\ttraefik:v3.1\tparlay-traefik", "b\ttraefik:v3.1\tother"]},
             "traefik_central_absent"),
            ({"traefik_rows": ["a\ttraefik:v3.1\ttraefik-central", "b\ttraefik:v3.1\ttraefik-central"]},
             "traefik_container_ambiguous"),
            ({"traefik_rows": ["a\tnginx:1\ttraefik-central"]}, "traefik_container_absent"),
            ({"traefik_name": "/parlay-traefik"}, "traefik_central_mismatch"),
            ({"traefik_project": "parlay"}, "traefik_central_project_mismatch"),
            ({"traefik_project": None}, "traefik_central_project_mismatch"),
            ({"traefik_networks": {"parlay-net": {}}}, "traefik_central_not_on_points_network"),
            ({"traefik_networks": {"inferno-default": {}}}, "traefik_central_not_on_points_network"),
            ({"points_networks": {}}, "traefik_central_not_on_points_network"),
            ({"traefik_networks": []}, "traefik_networks_unreadable"),
            ({"mounts": [{"Type": "bind", "Source": "/nonexistent", "Destination": "/etc/traefik/dynamic"},
                         {"Type": "bind", "Source": "/x/traefik.yml", "Destination": "/etc/traefik/traefik.yml"}]},
             "traefik_static_config_unreadable"),
            ({"points_networks": []}, "points_networks_unreadable"),
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

    def test_static_config_file_real_topology(self) -> None:
        # Host reality 2026-10-08: /traefik.yml bind mount, no --configfile, CLI args ignored by Traefik.
        for dest, workdir in (("/traefik.yml", ""), ("/traefik.yml", "/"), ("/etc/traefik/traefik.yml", ""),
                              ("/config/traefik.yaml", "/config")):
            fx = Fixture(static_yaml=STATIC_OK, static_dest=dest, workdir=workdir,
                         args=["--providers.file.directory=/elsewhere", "--providers.file.watch=false"])
            try:
                with self.subTest(dest=dest, workdir=workdir):
                    self.assertEqual(fx.run("--status"), 0)
                    self.assertEqual(fx.out()["mechanism"], "traefik-file-provider")
                    self.assertEqual(fx.run("--pause"), 0)
                    self.assertTrue(fx.pause_file.exists())
                    self.assertNoLeak(fx)
                    text = "\n".join(fx.lines) + fx.err
                    self.assertNotIn("SENTINEL-ACME-MAIL", text)
                    self.assertNotIn("/etc/traefik/dynamic", text)
            finally:
                fx.close()

    def test_static_config_file_refusals(self) -> None:
        ok = STATIC_OK
        refused = [
            (ok.replace("providers:", "providers: &p"), "traefik_static_config_unsupported"),
            (ok + "other: *p\n", "traefik_static_config_unsupported"),
            (ok + "x:\n  <<: {}\n", "traefik_static_config_unsupported"),
            (ok + "---\nproviders:\n  file:\n    directory: /x\n", "traefik_static_config_unsupported"),
            (ok.replace("    watch: true", "\twatch: true"), "traefik_static_config_unsupported"),
            ("providers: {file: {directory: /etc/traefik/dynamic}}\n", "traefik_static_config_unsupported"),
            (ok + "providers:\n  file:\n    directory: /x\n", "traefik_static_config_unsupported"),
            (ok.replace("    watch: true", "    watch: true\n    directory: /y"), "static_file_provider_unexpected"),
            (ok.replace("    watch: true", "    watch: true\n    debugLogGeneratedTemplate: true"),
             "static_file_provider_unexpected"),
            (ok.replace("    watch: true", "    watch: true\n      nested: x"), "static_file_provider_unexpected"),
            (ok.replace("  file:", "  file: {}"), "static_file_provider_unexpected"),
            (ok.replace("  file:", "  file:\n    directory: /a\n  FILE:"), "static_file_provider_unexpected"),
            (ok.replace("/etc/traefik/dynamic", "etc/traefik/dynamic"), "file_provider_ambiguous"),
            (ok.replace("/etc/traefik/dynamic", "/etc/traefik/../dynamic"), "file_provider_ambiguous"),
            (ok.replace("/etc/traefik/dynamic", "'/etc/tra\"efik'"), "static_file_provider_unexpected"),
            (ok.replace("/etc/traefik/dynamic", "*x"), "traefik_static_config_unsupported"),
            ("a" * 300000, "traefik_static_config_too_large"),
        ]
        unavailable = [
            (ok.replace("    watch: true", "    watch: false"), "file_provider_not_watched"),
            (ok.replace("    watch: true", "    filename: /etc/traefik/x.yml"), "file_provider_single_file"),
            (ok.replace("    directory: /etc/traefik/dynamic\n", ""), "file_provider_absent"),
            ("api:\n  dashboard: false\n", "file_provider_absent"),
            ("providers:\n  docker:\n    exposedByDefault: false\n", "file_provider_absent"),
        ]
        for text, code in refused + unavailable:
            fx = Fixture(static_yaml=text)
            try:
                with self.subTest(code=code, text=text[:60]):
                    self.assertEqual(fx.run("--pause"), 2)
                    out = fx.out()
                    self.assertEqual(out.get("refuse") or out.get("reason"), code)
                    self.assertFalse(fx.pause_file.exists())
                    self.assertEqual(fx.edge.calls, [])
            finally:
                fx.close()
        # the quoted-but-plain form is accepted
        fx = Fixture(static_yaml=ok.replace("/etc/traefik/dynamic", '"/etc/traefik/dynamic"  # edge'))
        try:
            self.assertEqual(fx.run("--status"), 0)
        finally:
            fx.close()

    def test_static_config_location_and_layer_refusals(self) -> None:
        cases: list[tuple[dict[str, Any], str, str]] = [
            ({"static_yaml": STATIC_OK, "static_dest": "/other/traefik.yml"}, "reason",
             "traefik_static_config_location_unknown"),
            ({"static_yaml": STATIC_OK, "static_dest": "/root/.config/traefik.yml"}, "reason",
             "traefik_static_config_location_unknown"),
            ({"static_yaml": STATIC_OK, "static_dest": "/traefik.toml"}, "reason", "traefik_static_config_toml"),
            ({"static_yaml": STATIC_OK, "args": ["--configFile=/traefik.yml"]}, "reason",
             "traefik_static_config_file"),
            # higher-priority config in an image layer / writable layer (not a mount)
            ({"static_yaml": STATIC_OK, "container_files": {"/etc/traefik/traefik.toml": b"x"}}, "reason",
             "traefik_static_config_not_selected"),
            ({"static_yaml": STATIC_OK, "container_files": {"/traefik.yaml": b"x"}}, "reason",
             "traefik_static_config_not_selected"),
            ({"static_yaml": STATIC_OK, "env_rows": ["XDG_CONFIG_HOME=/cfg", "HOME=/home/t"], "container_files": {
                "/home/t/.config/traefik.yml": b"x"}}, "reason", "traefik_static_config_not_selected"),
            ({"static_yaml": STATIC_OK, "env_rows": ["XDG_CONFIG_HOME=/cfg"],
              "container_files": {"/cfg/traefik.toml": b"x"}}, "reason", "traefik_static_config_not_selected"),
            # what the container sees differs from the host bind source
            ({"static_yaml": STATIC_OK, "container_files": {"/traefik.yml": b"providers: {}\n"}}, "refuse",
             "traefik_static_config_mismatch"),
            # no static mount, but Traefik would load a hidden file -> CLI args do not apply
            ({"container_files": {"/etc/traefik/traefik.yml": b"x"}}, "reason",
             "traefik_static_config_unverifiable"),
            ({"static_yaml": STATIC_OK, "user": "1000"}, "reason", "traefik_lookup_env_unknown"),
            ({"static_yaml": STATIC_OK, "env_rows": ["HOME=relative"]}, "reason", "traefik_lookup_env_unknown"),
            ({"static_yaml": STATIC_OK, "env_rows": ["HOME=/a", "HOME=/b"]}, "refuse", "traefik_inspect_unreadable"),

            ({"mounts": [{"Type": "bind", "Source": "/nonexistent-x", "Destination": "/etc/traefik/traefik.yml"}]},
             "refuse", "traefik_static_config_unreadable"),
            ({"static_yaml": STATIC_OK, "workdir": 5}, "refuse", "traefik_inspect_unreadable"),
        ]
        for kwargs, field, code in cases:
            fx = Fixture(**kwargs)
            try:
                with self.subTest(code=code):
                    self.assertEqual(fx.run("--pause"), 2)
                    self.assertEqual(fx.out().get(field), code)
                    self.assertFalse(fx.pause_file.exists())
            finally:
                fx.close()
        # Codex review d85655d8: an earlier XDG/HOME candidate supplied by a PARENT bind mount (or the
        # image) wins over a lower-priority /traefik.yml mount -> unavailable before any write/probe.
        parent_cases = [
            (["XDG_CONFIG_HOME=/custom"], "/custom", "/custom/traefik.yml"),
            (["XDG_CONFIG_HOME=/x", "HOME=/root"], "/root", "/root/.config/traefik.yml"),
            (["XDG_CONFIG_HOME=/x"], None, "/root/.config/traefik.yaml"),  # image layer, default HOME
        ]
        for env, parent, candidate in parent_cases:
            fx = Fixture(static_yaml=STATIC_OK, env_rows=env, container_files={candidate: b"providers: {}\n"})
            try:
                if parent is not None:
                    pdir = Path(fx.tmp.name) / "parent"
                    pdir.mkdir()
                    fx.mounts.append({"Type": "bind", "Source": str(pdir), "Destination": parent})
                with self.subTest(candidate=candidate):
                    for args in (("--status",), ("--pause",)):
                        self.assertEqual(fx.run(*args), 2)
                        self.assertEqual(fx.out().get("reason"), "traefik_static_config_not_selected")
                    self.assertFalse(fx.pause_file.exists())
                    self.assertEqual(fx.edge.calls, [])
            finally:
                fx.close()
        # two static files on the lookup path -> refuse rather than pick Traefik's first
        fx = Fixture(static_yaml=STATIC_OK)
        try:
            extra = fx.static.with_name("second.yml")
            extra.write_text(STATIC_OK)
            fx.mounts.append({"Type": "bind", "Source": str(extra), "Destination": "/etc/traefik/traefik.yml"})
            self.assertEqual(fx.run("--pause"), 2)
            self.assertEqual(fx.out().get("refuse"), "traefik_static_config_ambiguous")
            self.assertFalse(fx.pause_file.exists())
        finally:
            fx.close()
        # with XDG unset, /traefik.yml precedes $HOME/.config; with XDG set it is ./traefik.yml (cwd /)
        for env, files in ((["HOME=/home/t"], {"/home/t/.config/traefik.yml": b"x"}),
                           (["XDG_CONFIG_HOME=/cfg"], {})):
            fx = Fixture(static_yaml=STATIC_OK, env_rows=env, container_files=files)
            try:
                with self.subTest(env=env):
                    self.assertEqual(fx.run("--status"), 0)
            finally:
                fx.close()
        # lower-priority files and the walk order: /traefik.yml wins before ./ (cwd /) duplicates
        fx = Fixture(static_yaml=STATIC_OK, env_rows=["HOME=/root"], user="root",
                     container_files={"/other/traefik.yml": b"x"})
        try:
            self.assertEqual(fx.run("--status"), 0)
            self.assertEqual(fx.copied[:6], ["/etc/traefik/traefik.toml", "/etc/traefik/traefik.yaml",
                                             "/etc/traefik/traefik.yml", "/traefik.toml", "/traefik.yaml",
                                             "/traefik.yml"])
        finally:
            fx.close()

    def test_selects_central_traefik_among_several(self) -> None:
        # Host reality 2026-10-08: traefik-central (inferno edge) and parlay-traefik both running.
        for rows in (["p\ttraefik:v3.1\tparlay-traefik", "c\ttraefik:v3.6\ttraefik-central"],
                     ["c\ttraefik:v3.6\ttraefik-central"]):
            fx = Fixture(traefik_rows=rows, image="traefik:v3.6", version_label="3.6.0")
            try:
                with self.subTest(rows=len(rows)):
                    self.assertEqual(fx.run("--status"), 0)
                    self.assertEqual(fx.inspected, ["c"])
                    self.assertEqual(fx.out()["mechanism"], "traefik-file-provider")
                    self.assertEqual(fx.run("--pause"), 0)
                    self.assertEqual(fx.inspected, ["c", "c"])
                    self.assertTrue(fx.pause_file.exists())
                    self.assertNoLeak(fx)
            finally:
                fx.close()

    def test_router_network_label_must_be_shared(self) -> None:
        labels = {**POINTS_LABELS, "traefik.docker.network": "other-net"}
        fx = Fixture(labels=labels, points_networks={"other-net": {}, "traefik-public": {}})
        try:
            self.assertEqual(fx.run("--pause"), 2)
            self.assertEqual(fx.out()["refuse"], "traefik_central_not_on_points_network")
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
        fx = Fixture(image="traefik:v2.11", traefik_rows=["t\ttraefik:v2.11\ttraefik-central"])
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
