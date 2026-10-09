#!/usr/bin/env python3
"""Dummy-only tests: no Docker, host, network, real wallet or production read."""

from __future__ import annotations

import copy
import importlib.util
import io
import json
import sys
import tarfile
import tempfile
import time
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Protocol, Sequence, cast
from unittest.mock import patch

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
        self.raise_error = False
        self.drift = False
        self.inspect_peers = 0
        self.copy_override: bytes | None = None
        self.helper = mod.helpers()

    def close(self) -> None:
        self.temp.cleanup()

    def run(self, command: Sequence[str], out_cap: int, err_cap: int) -> Captured:
        cmd = list(command)
        self.commands.append(cmd)
        self.assert_command(cmd)
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
        code, text = self.fixture().check()
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
    def test_caps_timeout_and_error_stream(self) -> None:
        cases = [
            ("import sys;sys.stdout.write('x'*10000)", 10, 4096),
            ("import sys;sys.stderr.write('x'*10000)", 4096, 10),
            ("import time;time.sleep(5)", 4096, 4096),
        ]
        for source, out_cap, err_cap in cases:
            with patch.object(mod, "COMMAND_SECONDS", 0.1):
                runner = mod.Runner()
                with self.assertRaises(mod.Hold) as error:
                    runner([sys.executable, "-I", "-c", source], out_cap, err_cap)
                self.assertEqual(error.exception.reason, mod.Reason.LIMIT)

    def test_match_split_across_transport_chunks(self) -> None:
        source = "import os;os.write(1,b'wallet');os.write(1,b'Address=OPAQUE');os.write(2,b'walletAddress=OPAQUE')"
        raw = mod.Runner()([sys.executable, "-I", "-c", source], mod.LOG_BYTES, mod.LOG_BYTES)
        self.assertEqual(raw.stdout.count(b"walletAddress=") + raw.stderr.count(b"walletAddress="), 2)
        self.assertEqual(raw.code, 0)

    def test_deadline_prevents_spawn(self) -> None:
        runner = mod.Runner()
        runner.deadline = 0
        with patch.object(mod.subprocess, "Popen") as spawn:
            with self.assertRaises(mod.Hold):
                runner(["FORBIDDEN"], 4096, 4096)
            spawn.assert_not_called()


if __name__ == "__main__":
    unittest.main()
