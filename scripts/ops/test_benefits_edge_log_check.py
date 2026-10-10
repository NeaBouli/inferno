#!/usr/bin/env python3
"""Dummy-only tests: no Docker, host, network, real wallet or production read."""

from __future__ import annotations

import copy
import importlib.util
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Callable, Protocol, Sequence, cast
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location(
    "benefits_edge_check", Path(__file__).with_name("benefits-edge-log-check.py")
)
assert SPEC is not None and SPEC.loader is not None
mod = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = mod
SPEC.loader.exec_module(mod)

EDGE = "a" * 64
FRONT = "b" * 64
BACK = "c" * 64
OTHER = "d" * 64
SENTINEL = "PRIVATE_SENTINEL_DO_NOT_EMIT"
BASE_CONFIG = (
    "entryPoints:\n  websecure:\n    address: ':443'\n"
    "providers:\n  docker:\n    exposedByDefault: false\n"
    "    endpoint: unix:///var/run/docker.sock\n"
    "  file:\n    directory: /etc/traefik/dynamic\n    watch: true\n"
    "certificatesResolvers:\n  fixture:\n    acme:\n      email: dummy@example.invalid\n"
    "log:\n  level: INFO\n"
)


class Captured(Protocol):
    stdout: bytes
    stderr: bytes
    code: int


def captured(stdout: bytes = b"", stderr: bytes = b"", code: int = 0) -> Captured:
    return cast(Captured, mod.Raw(stdout, stderr, code))


def peer(cid: str, service: str, port: str, public: str | None) -> list[object]:
    labels = {
        "com.docker.compose.service": service,
        "com.docker.compose.project": "fixture-project",
        "traefik.enable": "true" if public else "false",
        "traefik.docker.network": "fixture-net",
    }
    if public:
        prefix = f"traefik.http.routers.{service}."
        labels.update(
            {
                prefix + "rule": f"Host(`{public}`)",
                prefix + "entrypoints": "websecure",
                prefix + "tls.certresolver": "fixture",
                prefix + "service": service,
                f"traefik.http.services.{service}.loadbalancer.server.port": port,
            }
        )
    return [
        cid,
        "/" + service,
        True,
        {"fixture-net": {}},
        {port + "/tcp": None},
        labels,
    ]


class Fixture:
    def __init__(self, config: str = BASE_CONFIG) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="edge-fixture-")
        self.root = Path(self.temp.name).resolve()
        self.static = self.root / "traefik.yml"
        self.static.write_text(config)
        self.dynamic = self.root / "dynamic"
        self.dynamic.mkdir()
        self.peers = [
            [
                EDGE,
                "/traefik-central",
                True,
                {"fixture-net": {}},
                {"443/tcp": [{"HostIp": "0.0.0.0", "HostPort": "443"}]},
                {},
            ],
            peer(FRONT, "benefits-frontend", "3000", "benefits.example.invalid"),
            peer(BACK, "benefits-backend", "3001", None),
        ]
        self.started = datetime.now(timezone.utc).isoformat()
        self.central: list[object] = [
            EDGE,
            "/traefik-central",
            True,
            self.started,
            0,
            "traefik:v3.6.25",
            ["traefik"],
            [
                {
                    "Type": "bind",
                    "Source": str(self.static),
                    "Destination": "/traefik.yml",
                },
                {
                    "Type": "bind",
                    "Source": str(self.dynamic),
                    "Destination": "/etc/traefik/dynamic",
                },
            ],
            "",
            {
                "com.docker.compose.project": "traefik",
                "org.opencontainers.image.version": "3.6.25",
            },
        ]
        self.files: dict[str, bytes] = {"/traefik.yml": config.encode()}
        self.logs: dict[str, Captured] = {}
        self.driver = {
            "Type": "json-file",
            "Config": {"max-size": "1m", "max-file": "2"},
        }
        self.env = ""
        self.commands: list[list[str]] = []
        self.transport_commands: list[list[str]] = []
        self.raise_error = False
        self.drift = False
        self.inspect_peers = 0
        self.copy_override: bytes | None = None
        self.dynamic_visible: dict[str, bytes] = {}
        self.dynamic_archive: bytes | None = None
        self.helper = mod.helpers()

    def close(self) -> None:
        self.temp.cleanup()

    def run(self, command: Sequence[str], out_cap: int, err_cap: int) -> Captured:
        bound = list(command)
        self.transport_commands.append(bound)
        assert tuple(bound[:5]) == mod.DOCKER_PREFIX
        cmd = ["docker", *bound[5:]]
        self.assert_command(cmd)
        self.commands.append(cmd)
        if self.raise_error:
            raise RuntimeError(SENTINEL)
        if cmd[:2] == ["docker", "ps"]:
            return captured(("\n".join(str(row[0]) for row in self.peers) + "\n").encode())
        if cmd[:2] == ["docker", "inspect"]:
            fmt = cmd[cmd.index("--format") + 1]
            ids = cmd[cmd.index("--format") + 2 :]
            if fmt == mod.PEER_FMT:
                self.inspect_peers += 1
                rows = copy.deepcopy(self.peers)
                if self.drift and self.inspect_peers > 1:
                    rows[1][1] = "/changed"
                by_id = {str(row[0]): row for row in rows}
                output = "\n".join(json.dumps(by_id[cid]) for cid in ids)
            elif fmt == mod.CENTRAL_FMT:
                output = json.dumps(self.central)
            elif fmt == mod.LOG_FMT:
                output = "\n".join(json.dumps([self.driver, self.started, 0]) for _ in ids)
            elif fmt == mod.ENV_KEYS_FMT:
                output = self.env
            elif fmt == "{{json .Config.User}}":
                output = '"root"'
            elif fmt == self.helper._ENV_FMT:
                output = '"HOME=/root"\n'
            else:
                raise AssertionError("unapproved inspect")
            return captured(output.encode())
        if cmd[:2] == ["docker", "cp"]:
            path = cmd[2].split(":", 1)[1]
            if path == "/etc/traefik/dynamic":
                if self.dynamic_archive is not None:
                    return captured(self.dynamic_archive)
                buffer = io.BytesIO()
                with tarfile.open(fileobj=buffer, mode="w", format=tarfile.USTAR_FORMAT) as archive:
                    directory = tarfile.TarInfo("dynamic")
                    directory.type = tarfile.DIRTYPE
                    archive.addfile(directory)
                    for name, data in self.dynamic_visible.items():
                        info = tarfile.TarInfo("dynamic/" + name)
                        info.size = len(data)
                        archive.addfile(info, io.BytesIO(data))
                return captured(buffer.getvalue())
            if path not in self.files:
                return captured(
                    stderr=f"Error response from daemon: Could not find the file {path} in container {EDGE}\n".encode(),
                    code=1,
                )
            if self.copy_override is not None:
                return captured(self.copy_override)
            buffer = io.BytesIO()
            with tarfile.open(fileobj=buffer, mode="w", format=tarfile.USTAR_FORMAT) as archive:
                info = tarfile.TarInfo(Path(path).name)
                data = self.files[path]
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
            return captured(buffer.getvalue())
        if cmd[:2] == ["docker", "logs"]:
            assert out_cap == mod.LOG_BYTES and err_cap == mod.LOG_BYTES
            return self.logs.get(cmd[-1], captured())
        raise AssertionError("unapproved command")

    def assert_command(self, cmd: list[str]) -> None:
        assert cmd[0] == "docker" and cmd[1] in ("inspect", "ps", "cp", "logs")
        assert not any(word in cmd for word in ("exec", "run", "up", "rm", "curl", "sudo"))
        if cmd[1] == "inspect":
            assert cmd[2:4] == ["--type", "container"] and "--format" in cmd
            fmt = cmd[cmd.index("--format") + 1]
            assert fmt in (
                mod.PEER_FMT,
                mod.CENTRAL_FMT,
                mod.LOG_FMT,
                mod.ENV_KEYS_FMT,
                self.helper._ENV_FMT,
                "{{json .Config.User}}",
            )
            assert "{{json .Config.Env}}" not in fmt and "{{json .Config}}" not in fmt
        if cmd[1] == "logs":
            assert cmd[2] == "--timestamps" and "--since" in cmd and "--until" in cmd and "--tail" in cmd

    def check(
        self, uid: int = 0, parser: bool = True, args: Sequence[str] = ("--owner-go",)
    ) -> tuple[int, str]:
        out, err = io.StringIO(), io.StringIO()
        deps = mod.Deps(
            run=self.run,
            uid=lambda: uid,
            clock=lambda: time.time(),
            yaml=mod.yaml_runtime if parser else lambda: None,
            load_helpers=lambda: self.helper,
        )
        with redirect_stdout(out), redirect_stderr(err):
            code = mod.main(args, deps)
        assert not err.getvalue()
        text = out.getvalue()
        assert SENTINEL not in text and str(self.root) not in text and "example.invalid" not in text
        assert "walletAddress=" not in text and "unix:///" not in text
        for line in text.splitlines():
            key, value = line.split("=", 1)
            assert key.replace("_", "").isalpha()
            assert value.isdigit() or all(char.isupper() or char == "_" for char in value)
        return code, text


@unittest.skipIf(mod.yaml_runtime() is None, "owner must provision PyYAML for fixture tests")
class CheckerTests(unittest.TestCase):
    def fixture(self, config: str = BASE_CONFIG) -> Fixture:
        fixture = Fixture(config)
        self.addCleanup(fixture.close)
        return fixture

    def hold(self, fixture: Fixture, reason: str | None = None) -> str:
        code, text = fixture.check()
        self.assertEqual(code, 2)
        self.assertIn("status=HOLD\n", text)
        if reason:
            self.assertIn(f"reason={reason}\n", text)
        return text

    def test_absent_is_only_scoped_pass(self) -> None:
        fx = self.fixture()
        code, text = fx.check()
        self.assertEqual(code, 0)
        for value in (
            "status=PASS",
            "access_log=ABSENT",
            "query_retention=NOT_ASSESSED",
            "history=NOT_ASSESSED",
            "external_ingress=NOT_ASSESSED",
            "containers_sampled=3",
            "matches=0",
            "edge_attribution=SHARED",
            "file_logs=NOT_READ",
        ):
            self.assertIn(value + "\n", text)
        self.assertTrue(all(tuple(cmd[:5]) == mod.DOCKER_PREFIX for cmd in fx.transport_commands))
        formats = [cmd[cmd.index("--format") + 1] for cmd in fx.commands if cmd[1] == "inspect"]
        self.assertIn("{{json .Config.User}}", formats)
        self.assertIn(fx.helper._ENV_FMT, formats)

    def test_owner_and_root_gate_before_reads(self) -> None:
        for uid, parser, args, reason in (
            (1, True, (), "OWNER_GO_REQUIRED"),
            (1, True, ("--owner-go",), "ROOT_REQUIRED"),
            (0, False, ("--owner-go",), "PYYAML_REQUIRED"),
            (0, True, (SENTINEL,), "ARGUMENTS"),
        ):
            fx = self.fixture()
            code, text = fx.check(uid, parser, args)
            self.assertEqual(code, 2)
            self.assertIn("reason=" + reason + "\n", text)
            self.assertEqual(fx.commands, [])

    def test_enabled_does_not_assert_query_retention(self) -> None:
        for access in (
            "accessLog: {}\n",
            "accessLog:\n  fields:\n    defaultMode: drop\n",
            "accessLog:\n  fields:\n    queryParameters:\n      defaultMode: drop\n",
        ):
            text = self.hold(self.fixture(BASE_CONFIG + access), "ACCESS_LOG_UNPROVEN")
            self.assertIn("query_retention=UNPROVEN\n", text)
            self.assertIn("containers_sampled=3\n", text)

    def test_file_logs_and_debug_are_not_cleared(self) -> None:
        for config, reason in (
            (
                BASE_CONFIG + "accessLog:\n  filePath: /private-fixture/access.log\n",
                "FILE_LOG_GAP",
            ),
            (
                BASE_CONFIG.replace("level: INFO", "level: DEBUG"),
                "GENERAL_LOG_UNPROVEN",
            ),
            (
                BASE_CONFIG.replace("level: INFO", "level: INFO\n  filePath: /private-fixture/log"),
                "FILE_LOG_GAP",
            ),
            (BASE_CONFIG + "AccessLog: {}\n", "CONFIG_UNPROVEN"),
        ):
            self.hold(self.fixture(config), reason)

    def test_in_memory_stdout_and_stderr_counts(self) -> None:
        fx = self.fixture()
        fx.logs[EDGE] = mod.Raw(b"walletAddress=OPAQUE\n", b"walletAddress=OPAQUE\n")
        fx.logs[FRONT] = mod.Raw(b"walletAddress=OPAQUE walletAddress=OPAQUE\n")
        text = self.hold(fx, "MATCHES_OBSERVED")
        for value in ("matches=4", "edge_matches=2", "app_matches=2"):
            self.assertIn(value + "\n", text)

    def test_route_ambiguity_and_service_ownership(self) -> None:
        mutations: list[Callable[[Fixture], None]] = [
            lambda fx: fx.peers.append(peer(OTHER, "foreign", "3000", "benefits.example.invalid")),
            lambda fx: fx.peers.append(peer(OTHER, "benefits-frontend", "3000", "other.example.invalid")),
            lambda fx: cast(dict[str, object], fx.peers[1][5]).update(
                {"traefik.http.routers.benefits-frontend.rule": "HostRegexp(`.*`)"}
            ),
            lambda fx: cast(dict[str, object], fx.peers[1][5]).update(
                {"traefik.http.routers.benefits-frontend.service": "foreign@file"}
            ),
            lambda fx: cast(dict[str, object], fx.peers[1][5]).update({"traefik.docker.network": "foreign"}),
            lambda fx: cast(dict[str, object], fx.peers[1][5]).update(
                {"traefik.http.routers.benefits-frontend.middlewares": "foreign@file"}
            ),
            lambda fx: cast(dict[str, object], fx.peers[1][5]).update({"Traefik.enable": "false"}),
            lambda fx: cast(dict[str, object], fx.peers[1][4]).update(
                {"3000/tcp": [{"HostIp": "0.0.0.0", "HostPort": "3000"}]}
            ),
        ]
        for mutate in mutations:
            fx = self.fixture()
            mutate(fx)
            self.hold(fx)
            self.assertFalse(any(cmd[1] == "logs" for cmd in fx.commands))

    def test_backend_ingress_if_present_is_proved(self) -> None:
        fx = self.fixture()
        fx.peers[2] = peer(BACK, "benefits-backend", "3001", "api.example.invalid")
        self.assertEqual(fx.check()[0], 0)

    def test_dynamic_competing_or_complex_route_holds(self) -> None:
        for rule in ("Host(`benefits.example.invalid`)", "HostRegexp(`any`)"):
            fx = self.fixture()
            (fx.dynamic / "route.yml").write_text(f'http:\n  routers:\n    foreign:\n      rule: "{rule}"\n')
            self.hold(fx, "ROUTE_UNPROVEN")

    def test_dynamic_anchored_foreign_route_is_allowed(self) -> None:
        # The exact file rendered by the Points issuance pause (Traefik v3, TLS with resolver).
        spec = importlib.util.spec_from_file_location("edge_test_pause", Path(__file__).with_name("points-issuance-pause.py"))
        assert spec is not None and spec.loader is not None
        pause_mod = importlib.util.module_from_spec(spec)
        sys.modules["edge_test_pause"] = pause_mod
        spec.loader.exec_module(pause_mod)
        topo = SimpleNamespace(traefik_major=3, entrypoints=["websecure"], tls=True, certresolver="letsencrypt")
        pause = pause_mod.render(topo)
        self.assertIn(b"&& Method(`POST`) && PathRegexp(", pause)
        fx = self.fixture()
        (fx.dynamic / "points-issuance-pause.yml").write_bytes(pause)
        fx.dynamic_visible["points-issuance-pause.yml"] = pause
        # The file predates the edge start, as on the real host.
        fx.started = (datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat()
        fx.central[3] = fx.started
        self.assertEqual(fx.check()[0], 0)
        for rule in (
            "Host(`benefits.example.invalid`) && Method(`POST`)",
            "Host(`points.example.invalid`) || Host(`benefits.example.invalid`)",
            "Host(`points.example.invalid`) || PathPrefix(`/`)",
            "!Host(`points.example.invalid`)",
            "Method(`POST`) && Host(`points.example.invalid`)",
            "(Host(`points.example.invalid`)) && Method(`POST`)",
            "Host(`points.example.invalid`) && HostRegexp(`.*`)",
            "PathPrefix(`/`)",
        ):
            data = f'http:\n  routers:\n    foreign:\n      rule: "{rule}"\n'.encode()
            fx = self.fixture()
            (fx.dynamic / "route.yml").write_bytes(data)
            fx.dynamic_visible["route.yml"] = data
            self.hold(fx, "ROUTE_UNPROVEN")

    def test_foreign_docker_router_may_narrow_one_host(self) -> None:
        def foreign(rule: str) -> list[object]:
            row = peer(OTHER, "foreign", "8080", "media.example.invalid")
            cast(dict[str, object], row[5])["traefik.http.routers.foreign.rule"] = rule
            return row

        fx = self.fixture()
        fx.peers.append(foreign("Host(`media.example.invalid`) && PathPrefix(`/media`)"))
        self.assertEqual(fx.check()[0], 0)
        for rule in (
            "Host(`benefits.example.invalid`) && PathPrefix(`/x`)",
            "Host(`media.example.invalid`) || Host(`benefits.example.invalid`)",
            "Host(`media.example.invalid`) || PathPrefix(`/`)",
            "PathPrefix(`/`)",
        ):
            fx = self.fixture()
            fx.peers.append(foreign(rule))
            self.hold(fx, "ROUTE_UNPROVEN")
        fx = self.fixture()
        labels_front = cast(dict[str, object], fx.peers[1][5])
        labels_front["traefik.http.routers.benefits-frontend.rule"] = (
            "Host(`benefits.example.invalid`) && PathPrefix(`/`)"
        )
        self.hold(fx, "ROUTE_UNPROVEN")

    def dyn(self, fx: Fixture, name: str, data: bytes) -> None:
        (fx.dynamic / name).write_bytes(data)
        fx.dynamic_visible[name] = data
        # Files predate the edge start, as on the real host.
        fx.started = (datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat()
        fx.central[3] = fx.started

    def test_foreign_dynamic_yaml_uses_parser_envelope(self) -> None:
        realistic = (
            b"http:\n"
            b"  routers:\n"
            b"    media:\n"
            b"      rule: 'Host(`media.example.invalid`) && (PathPrefix(`/a`) || PathPrefix(`/b`))'\n"
            b"      entryPoints: [websecure]\n"
            b"      middlewares:\n"
            b"        - media-redirect\n"
            b"      tls:\n"
            b"        certResolver: fixture\n"
            b"    catchall:\n"
            b'      rule: "HostRegexp(`{any:.+}`)"\n'
            b"      priority: 1\n"
            b"      entryPoints:\n"
            b"        - websecure\n"
            b"  middlewares:\n"
            b"    media-redirect:\n"
            b"      redirectRegex:\n"
            b'        regex: "^https://www\\\\.(.*)"\n'
            b'        replacement: "https://${1}"\n'
            b"  services:\n"
            b"    media:\n"
            b"      loadBalancer:\n"
            b"        servers:\n"
            b'          - url: "http://media:8080"\n'
        )
        fx = self.fixture()
        self.dyn(fx, "media.yml", realistic)
        self.dyn(fx, "media.yml.bak-20260612", b"not: [loaded\n")
        self.assertEqual(fx.check()[0], 0)
        for body in (
            b"http:\n  routers: &r {}\n",
            b"base: &b {}\nhttp: *b\n",
            b"http: !!map {}\n",
            b"http:\n  <<: {routers: {}}\n",
            b"http: {}\n---\nhttp: {}\n",
            b"%YAML 1.1\n---\nhttp: {}\n",
            b"http:\n  routers:\n    a: {rule: 'Host(`x.example.invalid`)', rule: 'Host(`y.example.invalid`)'}\n",
        ):
            fx = self.fixture()
            self.dyn(fx, "route.yml", body)
            text = self.hold(fx)
            # Duplicate keys are refused by the unique-key loader (INPUT_INVALID).
            self.assertRegex(text, r"reason=(YAML_UNSUPPORTED|CONFIG_UNPROVEN|INPUT_INVALID)\n")

    def test_case_variants_and_merge_spellings_hold(self) -> None:
        fx = self.fixture()
        self.dyn(fx, "route.yml", b"http:\n  '<<': {routers: {}}\n")
        self.hold(fx, "YAML_UNSUPPORTED")
        for body in (
            b"http:\n  Routers:\n    x:\n      rule: 'Host(`benefits.example.invalid`)'\n",
            b"http:\n  routers:\n    x:\n      Rule: 'Host(`benefits.example.invalid`)'\n",
            b"http:\n  routers:\n    x:\n      rule: 'Host(`m.example.invalid`)'\n      ruleSyntax: v2\n",
            b"http:\n  routers:\n    x:\n      rule: 'Host(`m.example.invalid`)'\n      RULE: 'PathPrefix(`/`)'\n",
        ):
            fx = self.fixture()
            self.dyn(fx, "route.yml", body)
            # Case-duplicate keys may already be refused by the unique-key loader.
            self.assertRegex(self.hold(fx), r"reason=(ROUTE_UNPROVEN|INPUT_INVALID)\n")
        for key in (
            "Traefik.http.routers.hidden.rule",
            "traefik.HTTP.routers.hidden.rule",
            "traefik.http.routers.foreign.Rule",
            "traefik.Enable",
        ):
            fx = self.fixture()
            row = peer(OTHER, "foreign", "8080", "media.example.invalid")
            cast(dict[str, object], row[5])[key] = "Host(`benefits.example.invalid`)"
            fx.peers.append(row)
            self.assertRegex(self.hold(fx), r"reason=(ROUTE_UNPROVEN|INPUT_INVALID)\n")

    def test_dynamic_catchall_needs_low_priority_on_443(self) -> None:
        def catchall(priority: str, entry: str = "websecure") -> bytes:
            return (
                "http:\n  routers:\n    catchall:\n"
                f'      rule: "HostRegexp(`.+`)"\n      priority: {priority}\n'
                f"      entryPoints: [{entry}]\n"
            ).encode()

        fx = self.fixture()
        self.dyn(fx, "catchall.yml", catchall("1"))
        self.assertEqual(fx.check()[0], 0)
        floor = len("Host(`benefits.example.invalid`)")
        for body in (
            catchall(str(floor)),
            catchall("100000"),
            catchall("0"),
            catchall("true"),
            catchall("1", "web"),
            catchall("1", "missing"),
            b'http:\n  routers:\n    c:\n      rule: "HostRegexp(`.+`)"\n      priority: 1\n',
            b'http:\n  routers:\n    c:\n      rule: "HostRegexp(`.+`) || Host(`x.example.invalid`)"\n'
            b"      priority: 1\n      entryPoints: [websecure]\n",
        ):
            fx = self.fixture()
            self.dyn(fx, "catchall.yml", body)
            self.hold(fx, "ROUTE_UNPROVEN")

    def test_anchored_or_group(self) -> None:
        for rule, ok in (
            ("Host(`m.example.invalid`) && (PathPrefix(`/a`) || PathPrefix(`/b`))", True),
            ("Host(`m.example.invalid`) && (PathPrefix(`/a`) || Host(`benefits.example.invalid`))", False),
            ("Host(`m.example.invalid`) && (PathPrefix(`/a`))", False),
            ("Host(`m.example.invalid`) && ((PathPrefix(`/a`) || PathPrefix(`/b`)))", False),
            ("(Host(`m.example.invalid`) && PathPrefix(`/a`)) || PathPrefix(`/b`)", False),
            ("Host(`m.example.invalid`) && (PathPrefix(`/a`) || PathPrefix(`/b`)) || PathPrefix(`/`)", False),
        ):
            self.assertEqual(mod.ANCHORED_HOST_RE.fullmatch(rule) is not None, ok, rule)

    def test_bounded_dynamic_directory(self) -> None:
        for kind in ("symlink", "subdir", "too_many", "toml"):
            fx = self.fixture()
            if kind == "symlink":
                (fx.dynamic / "alias.yml").symlink_to(fx.static)
            elif kind == "subdir":
                (fx.dynamic / "nested").mkdir()
            elif kind == "toml":
                (fx.dynamic / "config.toml").write_text("fixture = true")
            else:
                for index in range(mod.MAX_DYNAMIC_FILES + 1):
                    (fx.dynamic / f"fixture-{index}.yml").write_text("http: {}\n")
            self.hold(fx, "ROUTE_UNPROVEN")

    def test_descendant_mounts_hold_before_copy_or_sampling(self) -> None:
        for destination in ("/etc/traefik/dynamic/foreign.yml", "/etc/traefik/dynamic/nested"):
            fx = self.fixture()
            (fx.dynamic / "foreign.yml").write_text("http: {}\n")
            fx.dynamic_visible["foreign.yml"] = b"http:\n  routers:\n    hidden:\n      rule: 'Host(`benefits.example.invalid`)'\n"
            cast(list[dict[str, object]], fx.central[7]).append(
                {"Type": "bind", "Source": str(fx.static), "Destination": destination}
            )
            self.hold(fx, "ROUTE_UNPROVEN")
            self.assertFalse(any(cmd[1] == "logs" for cmd in fx.commands))
            self.assertFalse(any(cmd[1] == "cp" and cmd[2].endswith(":/etc/traefik/dynamic") for cmd in fx.commands))

    def test_complete_container_directory_bytes_must_match(self) -> None:
        for visible in (
            {},
            {"foreign.yml": b"http: {}\n", "extra.yml": b"http: {}\n"},
            {"foreign.yml": b"http:\n  routers:\n    hidden:\n      rule: 'Host(`benefits.example.invalid`)'\n"},
        ):
            fx = self.fixture()
            (fx.dynamic / "foreign.yml").write_text("http: {}\n")
            fx.dynamic_visible = visible
            self.hold(fx, "CONFIG_UNPROVEN")
            self.assertFalse(any(cmd[1] == "logs" for cmd in fx.commands))
        fx = self.fixture()
        (fx.dynamic / "foreign.yml").write_text("http: {}\n")
        fx.dynamic_visible = {"foreign.yml": b"http: {}\n"}
        self.assertEqual(fx.check()[0], 0)
        copies = [cmd for cmd in fx.commands if cmd[1] == "cp" and cmd[2].endswith(":/etc/traefik/dynamic")]
        self.assertEqual(len(copies), 2)

    def test_dynamic_archive_envelope(self) -> None:
        for kind in ("symlink", "hardlink", "nested", "duplicate", "pax", "sparse", "wrong_root", "no_root", "bad_checksum", "truncated", "too_large", "too_many"):
            fx = self.fixture()
            buffer = io.BytesIO()
            with tarfile.open(fileobj=buffer, mode="w", format=tarfile.USTAR_FORMAT) as archive:
                directory = tarfile.TarInfo("wrong" if kind == "wrong_root" else "dynamic")
                directory.type = tarfile.DIRTYPE
                if kind != "no_root":
                    archive.addfile(directory)
                info = tarfile.TarInfo("dynamic/nested/entry.yml" if kind == "nested" else "dynamic/entry.yml")
                if kind in ("symlink", "hardlink"):
                    info.type = tarfile.SYMTYPE if kind == "symlink" else tarfile.LNKTYPE
                    info.linkname = "dummy.yml"
                elif kind in ("pax", "sparse"):
                    info.type = tarfile.XHDTYPE if kind == "pax" else tarfile.GNUTYPE_SPARSE
                archive.addfile(info)
                if kind == "duplicate":
                    archive.addfile(info)
                if kind == "too_many":
                    for index in range(mod.MAX_DYNAMIC_FILES):
                        archive.addfile(tarfile.TarInfo(f"dynamic/extra-{index}.yml"))
            data = buffer.getvalue()
            if kind == "bad_checksum":
                data = b"X" + data[1:]
            elif kind == "truncated":
                data = data[:1024]
            elif kind == "too_large":
                data = b"x" * (mod.TAR_BYTES + 1)
            fx.dynamic_archive = data
            self.hold(fx)
            self.assertFalse(any(cmd[1] == "logs" for cmd in fx.commands))

    def test_dynamic_visible_drift_holds(self) -> None:
        fx = self.fixture()
        (fx.dynamic / "foreign.yml").write_text("http: {}\n")
        fx.dynamic_visible = {"foreign.yml": b"http: {}\n"}
        original = fx.run

        def run(command: Sequence[str], out_cap: int, err_cap: int) -> Captured:
            if "logs" in command:
                fx.dynamic_visible["foreign.yml"] = b"http: {}\n# changed\n"
            return original(command, out_cap, err_cap)

        with patch.object(fx, "run", side_effect=run):
            self.hold(fx, "CONFIG_UNPROVEN")

    def test_selected_entrypoint_only_allows_address(self) -> None:
        for extra in (
            "    http:\n      middlewares:\n        - foreign@file\n",
            "    http:\n      redirections:\n        entryPoint:\n          to: elsewhere\n",
            "    http:\n      tls: {}\n",
            "    http: {}\n",
            "    asDefault: true\n",
            "    forwardedHeaders:\n      insecure: true\n",
            "    proxyProtocol: {}\n",
            "    unknown: true\n",
        ):
            fx = self.fixture(BASE_CONFIG.replace("    address: ':443'\n", "    address: ':443'\n" + extra))
            self.hold(fx, "ROUTE_UNPROVEN")
            self.assertFalse(any(cmd[1] == "logs" for cmd in fx.commands))

    def test_config_precedence_and_version_refusals(self) -> None:
        for path in (
            "/etc/traefik/traefik.toml",
            "/root/.config/traefik.yml",
            "/traefik.yaml",
        ):
            fx = self.fixture()
            fx.central[8] = "/config"
            cast(list[dict[str, object]], fx.central[7])[0]["Destination"] = "/config/traefik.yml"
            fx.files["/config/traefik.yml"] = fx.files.pop("/traefik.yml")
            fx.files[path] = b"earlier selected file"
            self.hold(fx)
        for field, value in (
            (5, "traefik:v2.11.0"),
            (5, "traefik:v3.5.0"),
            (6, ["--configFile=/private-fixture/config.yml"]),
        ):
            fx = self.fixture()
            fx.central[field] = value
            self.hold(fx, "CONFIG_UNPROVEN")
        fx = self.fixture()
        fx.env = "CONFIG_ENV_PRESENT\n"
        self.hold(fx, "CONFIG_UNPROVEN")
        fx = self.fixture()
        fx.files["/traefik.yml"] = b"log: {}\n"
        self.hold(fx)

    def test_floating_minor_tag_needs_exact_label(self) -> None:
        fx = self.fixture()
        fx.central[5] = "traefik:v3.6"
        cast(dict[str, object], fx.central[9])["org.opencontainers.image.version"] = "v3.6.24"
        self.assertEqual(fx.check()[0], 0)
        for label in (None, "v3.6", "3.5.9", "v3.6.24-rc1", "latest"):
            fx = self.fixture()
            fx.central[5] = "traefik:v3.6"
            lab = cast(dict[str, object], fx.central[9])
            if label is None:
                del lab["org.opencontainers.image.version"]
            else:
                lab["org.opencontainers.image.version"] = label
            self.hold(fx, "CONFIG_UNPROVEN")
        for image in ("traefik:v3", "traefik:latest", "traefik:v3.6@sha256:" + "0" * 64, "evil/traefik:v3.6"):
            fx = self.fixture()
            fx.central[5] = image
            cast(dict[str, object], fx.central[9])["org.opencontainers.image.version"] = "v3.6.24"
            self.hold(fx, "CONFIG_UNPROVEN")

    def test_selected_file_excludes_guessed_cli(self) -> None:
        fx = self.fixture()
        fx.central[6] = ["--accesslog=true"]
        self.assertEqual(fx.check()[0], 0)

    def test_bounded_archive_and_unreadable_file(self) -> None:
        fx = self.fixture()
        fx.copy_override = b"x" * (mod.TAR_BYTES + 1)
        self.hold(fx, "LIMIT")
        fx = self.fixture()
        fx.static.unlink()
        fx.static.symlink_to(fx.dynamic / "missing")
        self.hold(fx)

    def test_timestamp_and_drift(self) -> None:
        fx = self.fixture()
        fx.central[3] = "2000-01-01T00:00:00Z"
        self.hold(fx, "DRIFT")
        fx = self.fixture()
        fx.drift = True
        self.hold(fx, "DRIFT")

    def test_log_limits_and_errors_never_leak(self) -> None:
        for raw, reason in (
            (mod.Raw(b"x\n" * mod.TAIL), "TAIL_LIMIT"),
            (mod.Raw(b"x" * (mod.LOG_BYTES + 1)), "LIMIT"),
            (mod.Raw(stderr=SENTINEL.encode(), code=1), "COMMAND_FAILED"),
        ):
            fx = self.fixture()
            fx.logs[EDGE] = raw
            self.hold(fx, reason)
        fx = self.fixture()
        fx.raise_error = True
        self.hold(fx, "UNEXPECTED")

    def test_unsupported_driver_and_lossy_buffer(self) -> None:
        for driver in (
            {"Type": "syslog", "Config": {}},
            {"Type": "json-file", "Config": {"mode": "non-blocking"}},
        ):
            fx = self.fixture()
            fx.driver = driver
            self.hold(fx, "LOG_DRIVER_UNSUPPORTED")


@unittest.skipIf(mod.yaml_runtime() is None, "owner must provision PyYAML for fixture tests")
class ParserTests(unittest.TestCase):
    def test_resources_are_rejected_before_safe_loader(self) -> None:
        yaml = mod.yaml_runtime()
        assert yaml is not None
        malicious = [
            b"x: &a text\ny: *a\n",
            b"x: !!python/object:unsafe {}\n",
            b"x: [[[[[]]]]]\n",
            b"x:\n  - " + b"- " * 500 + b"value\n",
            b"? " * 500 + b"value\n",
            b"x:\n" + b" " * 33 + b"y: value\n",
            b"x: value\n" * 2049,
            b"x: " + b"a" * 2049,
            b"x: value\n---\ny: value\n",
            b"x: |\n  value\n",
            b"x: text\n\ty: value\n",
            b"<<: value\n",
        ]
        for raw in malicious:
            with patch.object(yaml, "load", side_effect=AssertionError("parser must not run")):
                with self.assertRaises(mod.Hold):
                    mod.parse_yaml(raw, yaml)

    def test_duplicate_keys_and_case_collisions(self) -> None:
        yaml = mod.yaml_runtime()
        assert yaml is not None
        for raw in (
            b"accessLog: {}\naccessLog: {}\n",
            b"accessLog: {}\nAccessLog: {}\n",
            b"providers:\n  docker:\n    watch: true\n    watch: false\n",
        ):
            with self.assertRaises(mod.Hold):
                mod.parse_yaml(raw, yaml)
        with self.assertRaises(mod.Hold):
            mod.parse_json(b'{"label":true,"LABEL":false}')


class RunnerTests(unittest.TestCase):
    def dummy(
        self, source: str, out_cap: int, err_cap: int,
        cmd: Sequence[str] = ("docker", "ps"),
    ) -> Captured:
        real_spawn = subprocess.Popen

        def spawn(
            command: Sequence[str], *, stdout: int, stderr: int, stdin: int,
            start_new_session: bool, env: dict[str, str], cwd: str, close_fds: bool,
        ) -> subprocess.Popen[bytes]:
            self.assertEqual(list(command), [*mod.DOCKER_PREFIX, *cmd[1:]])
            self.assertEqual(env, {})
            self.assertEqual(cwd, "/")
            self.assertTrue(close_fds and start_new_session)
            self.assertEqual((stdout, stderr, stdin), (subprocess.PIPE, subprocess.PIPE, subprocess.DEVNULL))
            return real_spawn(
                [sys.executable, "-I", "-B", "-c", source], stdout=stdout, stderr=stderr,
                stdin=stdin, env=env, cwd=cwd, close_fds=close_fds, start_new_session=start_new_session,
            )

        ambient = {
            "PATH": "/dummy", "HOME": "/dummy", "DOCKER_HOST": "ssh://dummy.invalid",
            "DOCKER_CONTEXT": "dummy", "DOCKER_CONFIG": "/dummy", "DOCKER_TLS_VERIFY": "1",
            "DOCKER_CERT_PATH": "/dummy", "SSH_AUTH_SOCK": "/dummy", "HTTP_PROXY": "http://dummy.invalid",
        }
        with patch.dict(os.environ, ambient, clear=True), patch.object(mod, "trusted_transport"), patch.object(mod.subprocess, "Popen", side_effect=spawn) as actual:
            raw = mod.Deps().docker(cmd, out_cap, err_cap)
            self.assertEqual(actual.call_count, 1)
        return cast(Captured, raw)

    def test_caps_timeout_and_error_stream(self) -> None:
        cases = [
            ("import sys;sys.stdout.write('x'*10000)", 10, 4096),
            ("import sys;sys.stderr.write('x'*10000)", 4096, 10),
            ("import time;time.sleep(5)", 4096, 4096),
        ]
        for source, out_cap, err_cap in cases:
            with patch.object(mod, "COMMAND_SECONDS", 0.1):
                with self.assertRaises(mod.Hold) as error:
                    self.dummy(source, out_cap, err_cap)
                self.assertEqual(error.exception.reason, mod.Reason.LIMIT)

    def test_match_split_across_transport_chunks(self) -> None:
        source = "import os;os.write(1,b'wallet');os.write(1,b'Address=OPAQUE');os.write(2,b'walletAddress=OPAQUE')"
        raw = self.dummy(source, mod.LOG_BYTES, mod.LOG_BYTES)
        self.assertEqual(raw.stdout.count(b"walletAddress=") + raw.stderr.count(b"walletAddress="), 2)
        self.assertEqual(raw.code, 0)

    def test_child_environment_is_empty_not_python_isolation(self) -> None:
        raw = self.dummy("import os;assert not (set(os.environ)-{'LC_CTYPE'});print('EMPTY')", 4096, 4096)
        # CPython may inject LC_CTYPE into an otherwise empty process environment.
        self.assertEqual(raw.stdout, b"EMPTY\n")
        self.assertEqual(raw.code, 0)

    def test_helper_lookup_reaches_bound_popen(self) -> None:
        helper = mod.helpers()

        def text(cmd: Sequence[str]) -> str:
            fmt = cmd[cmd.index("--format") + 1]
            self.assertIn(fmt, ("{{json .Config.User}}", helper._ENV_FMT))
            output = '"root"' if fmt == "{{json .Config.User}}" else '"HOME=/root"\n'
            raw = self.dummy("import sys;sys.stdout.write(" + repr(output) + ")", 4096, 4096, cmd)
            self.assertEqual(raw.code, 0)
            self.assertEqual(raw.stderr, b"")
            return raw.stdout.decode()

        self.assertEqual(helper.traefik_lookup_env(text, EDGE), ("/root", ""))

    def test_unbound_transport_never_spawns(self) -> None:
        for cmd in (
            ["docker", "ps"], [sys.executable, "-I", "-c", "pass"],
            [*mod.DOCKER_PREFIX, "--context", "dummy", "ps"],
            [mod.DOCKER, "--host", "ssh://dummy.invalid", "--config", mod.DOCKER_CONFIG, "ps"],
        ):
            with patch.object(mod.subprocess, "Popen") as spawn:
                with self.assertRaises(mod.Hold):
                    mod.Runner()(cmd, 4096, 4096)
                spawn.assert_not_called()
        with patch.object(mod.subprocess, "Popen") as spawn:
            with self.assertRaises(mod.Hold):
                mod.Deps().text(["docker", "--context", "dummy", "ps"])
            spawn.assert_not_called()

    def test_streams_close_even_when_cleanup_wait_times_out(self) -> None:
        streams = []
        for _ in range(2):
            read, write = os.pipe()
            os.close(write)
            streams.append(os.fdopen(read, "rb"))
        for stream in streams:
            self.addCleanup(stream.close)
        proc = Mock(stdout=streams[0], stderr=streams[1], pid=123456789)
        proc.wait.side_effect = [0, subprocess.TimeoutExpired("dummy", 2)]
        with patch.object(mod, "trusted_transport"), patch.object(mod.subprocess, "Popen", return_value=proc) as spawn, patch.object(mod.os, "killpg") as kill:
            with self.assertRaises(subprocess.TimeoutExpired):
                mod.Deps().docker(["docker", "ps"], 4096, 4096)
            self.assertEqual(spawn.call_args.kwargs["env"], {})
            kill.assert_called_once_with(proc.pid, mod.signal.SIGKILL)
        self.assertTrue(all(stream.closed for stream in streams))

    def test_transport_requires_trusted_executable_and_empty_config(self) -> None:
        with tempfile.TemporaryDirectory(prefix="transport-fixture-") as directory:
            root = Path(directory).resolve()

            def info(path: str, *, follow_symlinks: bool) -> os.stat_result:
                self.assertFalse(follow_symlinks)
                mode = mod.stat.S_IFREG | 0o755 if path == mod.DOCKER else mod.stat.S_IFDIR | 0o755
                return os.stat_result((mode, 1, 1, 1, 0, 0, 0, 0, 0, 0))

            real_open = mod.open_directory
            with patch.object(mod.os, "stat", side_effect=info), patch.object(mod, "open_directory", side_effect=lambda _: real_open(root)):
                mod.trusted_transport()
                (root / "config.json").write_text("dummy")
                with self.assertRaises(mod.Hold):
                    mod.trusted_transport()
            for mode, uid in ((mod.stat.S_IFREG | 0o777, 0), (mod.stat.S_IFLNK | 0o755, 0), (mod.stat.S_IFREG | 0o755, 1), (mod.stat.S_IFREG | 0o644, 0)):
                unsafe = os.stat_result((mode, 1, 1, 1, uid, 0, 0, 0, 0, 0))

                def unsafe_executable(path: str, *, follow_symlinks: bool) -> os.stat_result:
                    return unsafe if path == mod.DOCKER else info(path, follow_symlinks=follow_symlinks)

                with patch.object(mod.os, "stat", side_effect=unsafe_executable):
                    with self.assertRaises(mod.Hold):
                        mod.trusted_transport()

    def test_deadline_prevents_spawn(self) -> None:
        runner = mod.Runner()
        runner.deadline = 0
        with patch.object(mod.subprocess, "Popen") as spawn:
            with self.assertRaises(mod.Hold):
                runner(["FORBIDDEN"], 4096, 4096)
            spawn.assert_not_called()


if __name__ == "__main__":
    unittest.main()
