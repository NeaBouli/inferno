#!/usr/bin/env python3
"""Owner-only, read-only Benefits edge classification; NOT a privacy clearance.

Runbook prerequisite: reviewed source, separate owner GO, root on the intended
Docker host, Python >=3.11 and an owner-provisioned PyYAML SafeLoader. Nothing is
installed automatically. Run the adjacent shell wrapper with --owner-go only
after review. No public request, container exec, configuration write or export.

Supported: official traefik-central v3.6.x (exact tag, or the floating v3.6 tag with an exact
3.6.x image version label), compose project traefik, selected
default-location bind-mounted YAML static file; Docker provider with explicit
exposedByDefault=false; simple exact Host routers and explicit Docker networks.
Both Benefits compose services must exist in one project. A backend without a
public router is supported. File-provider directories are flat, bounded YAML; their routers
may narrow one exact non-Benefits Host with &&-joined Method/Path matchers.
Other providers, complex/competing rules and unproved source selection HOLD.

PASS means ONLY accessLog absent in the proved file and no literal
walletAddress= observed in this complete bounded Docker-log sample. It does not
cover prior containers, rotations, file logs, external ingress or whole history.
Enabled accessLog stays HOLD: v3.6 query handling depends on the exact version
and Fields.KeepQueryParameters(), not merely on logging being enabled.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import selectors
import signal
import stat
import subprocess
import sys
import tarfile
import time
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path, PurePosixPath
from types import ModuleType
from typing import Callable, Protocol, Sequence, cast

STATIC_BYTES = 262144
TAR_BYTES = STATIC_BYTES + 65536
LOG_BYTES = 2 * 1024 * 1024
ERROR_BYTES = 4096
TAIL = 5000
WINDOW = 3600
COMMAND_SECONDS = 30.0
TOTAL_SECONDS = 300.0
MAX_CONTAINERS = 128
MAX_DYNAMIC_FILES = 32
DOCKER = "/usr/bin/docker"
DOCKER_SOCKET = "unix:///var/run/docker.sock"
DOCKER_CONFIG = "/var/empty"
DOCKER_PREFIX = (DOCKER, "--host", DOCKER_SOCKET, "--config", DOCKER_CONFIG)
ID_RE = re.compile(r"[a-f0-9]{64}")
HOST_RE = re.compile(r"Host\(`([a-z0-9][a-z0-9.-]{0,252})`\)")
# Dynamic-file routers may narrow one exact Host with &&-joined request matchers (for example the
# Points issuance pause: Host && Method && PathRegexp). No ||, !, grouping or host-free rules.
ANCHORED_HOST_RE = re.compile(
    r"Host\(`([a-z0-9][a-z0-9.-]{0,252})`\)"
    r"(?:\s*&&\s*(?:Method|Path|PathPrefix|PathRegexp)\(`[^`]{1,256}`\)){0,4}"
)
VERSION_RE = re.compile(r"(?:docker\.io/)?(?:library/)?traefik:v?3\.6\.(\d+)(?:@sha256:[a-f0-9]{64})?")
# Floating v3.6 tag: accepted only with an exact 3.6.x image version label (checked below).
MINOR_TAG_RE = re.compile(r"(?:docker\.io/)?(?:library/)?traefik:v?3\.6")
LABEL_VERSION_RE = re.compile(r"v?3\.6\.\d+")

# Docker projects only route metadata, never the complete Config or environment.
LABELS_FMT = (
    "{ {{range $k, $v := .Config.Labels}}"
    '{{if or (and (ge (len $k) 8) (eq (slice (lower $k) 0 8) "traefik.")) '
    '(eq (lower $k) "com.docker.compose.project") (eq (lower $k) "com.docker.compose.service") '
    '(eq $k "org.opencontainers.image.version")}}'
    '{{json $k}}:{{json $v}},{{end}}{{end}}"__end__":null }'
)
PEER_FMT = (
    "[{{json .Id}},{{json .Name}},{{json .State.Running}},"
    "{{json .NetworkSettings.Networks}},{{json .NetworkSettings.Ports}}," + LABELS_FMT + "]"
)
CENTRAL_FMT = (
    "[{{json .Id}},{{json .Name}},{{json .State.Running}},"
    "{{json .State.StartedAt}},{{json .RestartCount}},{{json .Config.Image}},"
    "{{json .Args}},{{json .Mounts}},{{json .Config.WorkingDir}}," + LABELS_FMT + "]"
)
LOG_FMT = "[{{json .HostConfig.LogConfig}},{{json .State.StartedAt}},{{json .RestartCount}}]"
ENV_KEYS_FMT = (
    '{{range .Config.Env}}{{$k := index (split . "=") 0}}'
    '{{if and (ge (len $k) 8) (eq (slice (upper $k) 0 8) "TRAEFIK_")}}'
    'CONFIG_ENV_PRESENT{{"\\n"}}{{end}}{{end}}'
)


class Reason(str, Enum):
    OWNER_GO_REQUIRED = "OWNER_GO_REQUIRED"
    ROOT_REQUIRED = "ROOT_REQUIRED"
    PYYAML_REQUIRED = "PYYAML_REQUIRED"
    PYTHON_REQUIRED = "PYTHON_REQUIRED"
    ARGUMENTS = "ARGUMENTS"
    LIMIT = "LIMIT"
    COMMAND_FAILED = "COMMAND_FAILED"
    INPUT_INVALID = "INPUT_INVALID"
    YAML_UNSUPPORTED = "YAML_UNSUPPORTED"
    TOPOLOGY_UNPROVEN = "TOPOLOGY_UNPROVEN"
    CONFIG_UNPROVEN = "CONFIG_UNPROVEN"
    ROUTE_UNPROVEN = "ROUTE_UNPROVEN"
    FILE_LOG_GAP = "FILE_LOG_GAP"
    ACCESS_LOG_UNPROVEN = "ACCESS_LOG_UNPROVEN"
    GENERAL_LOG_UNPROVEN = "GENERAL_LOG_UNPROVEN"
    LOG_DRIVER_UNSUPPORTED = "LOG_DRIVER_UNSUPPORTED"
    TAIL_LIMIT = "TAIL_LIMIT"
    DRIFT = "DRIFT"
    MATCHES_OBSERVED = "MATCHES_OBSERVED"
    SAMPLE_COMPLETE = "SAMPLE_COMPLETE"
    UNEXPECTED = "UNEXPECTED"


class Hold(Exception):
    def __init__(self, reason: Reason) -> None:
        self.reason = reason
        super().__init__(reason.value)


def require(condition: bool, reason: Reason = Reason.TOPOLOGY_UNPROVEN) -> None:
    if not condition:
        raise Hold(reason)


class Helpers(Protocol):
    def _network_names(self, networks: object, code: str) -> frozenset[str]: ...
    def traefik_major(self, image: str, labels: dict[str, object]) -> int: ...
    def traefik_lookup_env(self, run: Callable[[Sequence[str]], str], container: str) -> tuple[str, str]: ...
    def static_search_paths(self, workdir: str, home: str, xdg: str) -> list[str]: ...
    def static_config_file(self, mounts: object, workdir: object) -> tuple[str, Path] | None: ...
    def prove_selected_config(
        self,
        copy: Callable[[str, str], bytes | None],
        container: str,
        lookup: list[str],
        selected: tuple[str, Path] | None,
        content: bytes | None,
    ) -> None: ...
    def _tar_single_file(self, content: bytes) -> bytes | None: ...
    def host_dir_for(self, directory: str, mounts: object) -> Path: ...


def helpers() -> Helpers:
    name = "benefits_edge_pause_helpers"
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name("points-issuance-pause.py"))
    require(spec is not None and spec.loader is not None, Reason.CONFIG_UNPROVEN)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return cast(Helpers, module)


def yaml_runtime() -> ModuleType | None:
    try:
        return __import__("yaml")
    except ImportError:
        return None


@dataclass(frozen=True)
class Raw:
    stdout: bytes = b""
    stderr: bytes = b""
    code: int = 0


class Runner:
    def __init__(self) -> None:
        self.deadline = time.monotonic() + TOTAL_SECONDS

    def __call__(self, cmd: Sequence[str], out_cap: int, err_cap: int) -> Raw:
        end = min(self.deadline, time.monotonic() + COMMAND_SECONDS)
        require(time.monotonic() < end, Reason.LIMIT)
        require(
            tuple(cmd[:5]) == DOCKER_PREFIX
            and len(cmd) > 5
            and cmd[5] in ("ps", "inspect", "cp", "logs"),
            Reason.COMMAND_FAILED,
        )
        trusted_transport()
        proc = subprocess.Popen(
            list(cmd),
            env={},
            cwd="/",
            close_fds=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
        assert proc.stdout is not None and proc.stderr is not None
        streams = (proc.stdout, proc.stderr)
        buffers = [bytearray(), bytearray()]
        try:
            with selectors.DefaultSelector() as selector:
                for index, stream in enumerate(streams):
                    os.set_blocking(stream.fileno(), False)
                    selector.register(stream, selectors.EVENT_READ, index)
                while selector.get_map():
                    remaining = end - time.monotonic()
                    require(remaining > 0, Reason.LIMIT)
                    for key, _ in selector.select(min(remaining, 0.1)):
                        index = cast(int, key.data)
                        chunk = os.read(key.fd, 8192)
                        if not chunk:
                            selector.unregister(key.fileobj)
                            continue
                        buffers[index].extend(chunk)
                        require(
                            len(buffers[index]) <= (out_cap, err_cap)[index],
                            Reason.LIMIT,
                        )
                        if out_cap == LOG_BYTES:
                            require(sum(map(len, buffers)) <= LOG_BYTES, Reason.LIMIT)
                require(end > time.monotonic(), Reason.LIMIT)
                code = proc.wait(timeout=max(0.001, end - time.monotonic()))
            return Raw(bytes(buffers[0]), bytes(buffers[1]), code)
        finally:
            # Descendants can hold pipes after the CLI process has already exited.
            try:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    proc.poll()
                proc.wait(timeout=2)
            finally:
                for stream in streams:
                    stream.close()


def pairs_unique(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    seen: set[str] = set()
    for key, value in pairs:
        require(isinstance(key, str) and key.lower() not in seen, Reason.INPUT_INVALID)
        seen.add(key.lower())
        result[key] = value
    return result


def parse_json(raw: bytes) -> object:
    require(len(raw) <= STATIC_BYTES, Reason.LIMIT)
    return cast(object, json.loads(raw, object_pairs_hook=pairs_unique))


def mapping(value: object) -> dict[str, object]:
    require(
        isinstance(value, dict) and all(isinstance(k, str) for k in value),
        Reason.INPUT_INVALID,
    )
    return cast(dict[str, object], value)


def sequence(value: object) -> list[object]:
    require(isinstance(value, list), Reason.INPUT_INVALID)
    return cast(list[object], value)


class Node(Protocol):
    value: list[tuple[Node, Node]]


class Loader(Protocol):
    def construct_object(self, node: Node, deep: bool = False) -> object: ...


def parse_yaml(raw: bytes, yaml: ModuleType) -> dict[str, object]:
    require(len(raw) <= STATIC_BYTES, Reason.LIMIT)
    text = raw.decode("utf-8")
    lines = text.splitlines()
    require(len(lines) <= 2048, Reason.YAML_UNSUPPORTED)
    # A deliberately small block-YAML envelope bounds work BEFORE SafeLoader.
    for full in lines:
        require(
            len(full) <= 2048 and len(full) - len(full.lstrip(" ")) <= 32,
            Reason.YAML_UNSUPPORTED,
        )
        require(not any(ord(char) < 32 for char in full), Reason.YAML_UNSUPPORTED)
        # A router rule in an escape-free double-quoted scalar is literal text: its && and
        # matcher syntax are not YAML syntax, so only the key part is envelope-checked.
        quoted_rule = re.fullmatch(r'( *rule: )"[^"\\]*"', full)
        line = quoted_rule.group(1) + '""' if quoted_rule else full
        stripped = line.strip()
        require(
            not any(char in line for char in "&*!|>") and "<<" not in line,
            Reason.YAML_UNSUPPORTED,
        )
        require(
            stripped not in ("---", "...") and not stripped.startswith("%"),
            Reason.YAML_UNSUPPORTED,
        )
        no_empty = line.replace("{}", "").replace("[]", "")
        require(not any(char in no_empty for char in "{}[]"), Reason.YAML_UNSUPPORTED)
        require(
            not stripped
            or stripped.startswith("#")
            or re.match(r"[A-Za-z][A-Za-z0-9_.-]*:(?: |$)", stripped) is not None
            or (
                stripped.startswith("- ")
                and ":" not in stripped[2:]
                and not stripped[2:].lstrip().startswith(("-", "?"))
            ),
            Reason.YAML_UNSUPPORTED,
        )

    def unique(loader: Loader, node: Node) -> dict[str, object]:
        fields: list[tuple[str, object]] = []
        for key_node, value_node in node.value:
            key = loader.construct_object(key_node, deep=True)
            require(isinstance(key, str), Reason.YAML_UNSUPPORTED)
            fields.append((cast(str, key), loader.construct_object(value_node, deep=True)))
        return pairs_unique(fields)

    safe = type("UniqueSafeLoader", (yaml.SafeLoader,), {})
    getattr(safe, "add_constructor")("tag:yaml.org,2002:map", unique)
    return mapping(yaml.load(text, Loader=safe))


def open_directory(path: Path) -> int:
    require(
        path.is_absolute() and len(str(path)) <= 1024 and ".." not in path.parts,
        Reason.CONFIG_UNPROVEN,
    )
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def read_file(path: Path, started: float | None = None) -> bytes:
    directory = open_directory(path.parent)
    try:
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        with os.fdopen(fd, "rb") as file:
            before = os.fstat(file.fileno())
            require(
                stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= STATIC_BYTES,
                Reason.CONFIG_UNPROVEN,
            )
            if started is not None:
                require(max(before.st_mtime, before.st_ctime) <= started, Reason.DRIFT)
            raw = file.read(STATIC_BYTES + 1)
            after = os.fstat(file.fileno())

            def identity(value: os.stat_result) -> tuple[int, ...]:
                return (
                    value.st_dev,
                    value.st_ino,
                    value.st_mode,
                    value.st_nlink,
                    value.st_size,
                    value.st_mtime_ns,
                    value.st_ctime_ns,
                )

            require(
                identity(before) == identity(after) and len(raw) == before.st_size,
                Reason.DRIFT,
            )
            return raw
    finally:
        os.close(directory)


def trusted_transport() -> None:
    # Fixed owner-provisioned paths only; no ambient Docker config/credentials.
    for path in ("/", "/usr", "/usr/bin", "/var", DOCKER_CONFIG, DOCKER):
        info = os.stat(path, follow_symlinks=False)
        require(
            info.st_uid == 0
            and not info.st_mode & 0o022
            and (stat.S_ISREG(info.st_mode) if path == DOCKER else stat.S_ISDIR(info.st_mode)),
            Reason.COMMAND_FAILED,
        )
        if path == DOCKER:
            require(bool(info.st_mode & 0o111), Reason.COMMAND_FAILED)
    fd = open_directory(Path(DOCKER_CONFIG))
    try:
        with os.scandir(fd) as entries:
            require(next(entries, None) is None, Reason.COMMAND_FAILED)
    finally:
        os.close(fd)


@dataclass
class Deps:
    run: Callable[[Sequence[str], int, int], Raw] = field(default_factory=Runner)
    uid: Callable[[], int] = os.geteuid
    clock: Callable[[], float] = time.time
    yaml: Callable[[], ModuleType | None] = yaml_runtime
    load_helpers: Callable[[], Helpers] = helpers

    def docker(self, cmd: Sequence[str], out_cap: int, err_cap: int) -> Raw:
        require(
            len(cmd) > 1 and cmd[0] == "docker" and cmd[1] in ("ps", "inspect", "cp", "logs"),
            Reason.COMMAND_FAILED,
        )
        return self.run([*DOCKER_PREFIX, *cmd[1:]], out_cap, err_cap)

    def text(self, cmd: Sequence[str]) -> str:
        raw = self.docker(cmd, STATIC_BYTES, ERROR_BYTES)
        require(raw.code == 0 and not raw.stderr, Reason.COMMAND_FAILED)
        require(len(raw.stdout) <= STATIC_BYTES, Reason.LIMIT)
        return raw.stdout.decode("utf-8")

    def inspect(self, ids: Sequence[str], fmt: str) -> list[list[object]]:
        raw = self.text(["docker", "inspect", "--type", "container", "--format", fmt, *ids])
        rows = [sequence(parse_json(line.encode())) for line in raw.splitlines()]
        require(len(rows) == len(ids), Reason.INPUT_INVALID)
        return rows


def copy_config(deps: Deps, helper: Helpers, container: str, path: str) -> bytes | None:
    raw = deps.docker(["docker", "cp", f"{container}:{path}", "-"], TAR_BYTES, ERROR_BYTES)
    require(len(raw.stdout) <= TAR_BYTES and len(raw.stderr) <= ERROR_BYTES, Reason.LIMIT)
    if raw.code != 0:
        missing = f"Could not find the file {path} in container ".encode()
        if not raw.stdout and raw.stderr.startswith(b"Error response from daemon: " + missing):
            return None
        raise Hold(Reason.COMMAND_FAILED)
    require(
        not raw.stderr and len(raw.stdout) >= 512 and raw.stdout[156:157] in (b"0", b"\0"),
        Reason.CONFIG_UNPROVEN,
    )
    # Reject extended/sparse archives and oversized declared members before tarfile.
    declared = int(raw.stdout[124:136].strip(b"\0 ") or b"0", 8)
    require(0 <= declared <= STATIC_BYTES, Reason.LIMIT)
    end = 512 + ((declared + 511) // 512) * 512
    require(len(raw.stdout) >= end + 1024 and not any(raw.stdout[end:]), Reason.CONFIG_UNPROVEN)
    data = helper._tar_single_file(raw.stdout)
    require(data is not None and len(data) == declared, Reason.CONFIG_UNPROVEN)
    return raw.stdout


def labels(row: list[object], position: int) -> dict[str, object]:
    return {key.lower(): value for key, value in mapping(row[position]).items() if key != "__end__"}


def service(row: list[object]) -> str:
    value = labels(row, 5).get("com.docker.compose.service")
    return value if isinstance(value, str) else ""


def host(rule: object) -> str:
    match = HOST_RE.fullmatch(rule) if isinstance(rule, str) else None
    require(match is not None, Reason.ROUTE_UNPROVEN)
    assert match is not None
    return match.group(1)


def anchored_host(rule: object) -> str:
    match = ANCHORED_HOST_RE.fullmatch(rule) if isinstance(rule, str) else None
    require(match is not None, Reason.ROUTE_UNPROVEN)
    assert match is not None
    return match.group(1)


def no_public_ports(ports: object) -> None:
    for bindings in mapping(ports).values():
        for binding in sequence(bindings) if bindings is not None else []:
            require(
                mapping(binding).get("HostIp") in ("127.0.0.1", "::1"),
                Reason.ROUTE_UNPROVEN,
            )


def prove_routes(
    peers: list[list[object]],
    central: list[object],
    cfg: dict[str, object],
    helper: Helpers,
) -> tuple[list[list[object]], set[str]]:
    providers = mapping(cfg.get("providers"))
    require(set(providers) <= {"docker", "file"}, Reason.ROUTE_UNPROVEN)
    docker = mapping(providers.get("docker"))
    require(
        docker.get("exposedByDefault") is False
        and not docker.get("constraints")
        and docker.get("useBindPortIP", False) is False
        and docker.get("watch", True) is True
        and docker.get("endpoint", "unix:///var/run/docker.sock") == "unix:///var/run/docker.sock",
        Reason.ROUTE_UNPROVEN,
    )
    apps = [row for row in peers if service(row) in ("benefits-frontend", "benefits-backend")]
    require(
        len(apps) == 2 and {service(row) for row in apps} == {"benefits-frontend", "benefits-backend"},
        Reason.ROUTE_UNPROVEN,
    )
    projects = {labels(row, 5).get("com.docker.compose.project") for row in apps}
    require(
        len(projects) == 1 and all(isinstance(p, str) and p for p in projects),
        Reason.ROUTE_UNPROVEN,
    )
    for app in apps:
        no_public_ports(app[4])
    edge = next(row for row in peers if row[0] == central[0])
    edge_networks = helper._network_names(edge[3], "unsupported")
    entrypoints = mapping(cfg.get("entryPoints"))
    rules: dict[str, str] = {}
    router_names: set[str] = set()
    service_names: set[str] = set()
    app_hosts: set[str] = set()
    for row in peers:
        meta = labels(row, 5)
        require(meta.get("traefik.enable") in (None, "true", "false"), Reason.ROUTE_UNPROVEN)
        if meta.get("traefik.enable") != "true":
            require(service(row) != "benefits-frontend", Reason.ROUTE_UNPROVEN)
            continue
        require(
            not any(key.startswith(("traefik.tcp.", "traefik.udp.")) for key in meta),
            Reason.ROUTE_UNPROVEN,
        )
        routers = {
            key.split(".")[3]
            for key in meta
            if key.startswith("traefik.http.routers.") and key.count(".") >= 4
        }
        require(
            bool(routers) and (row not in apps or len(routers) == 1),
            Reason.ROUTE_UNPROVEN,
        )
        own_services = {key.split(".")[3] for key in meta if key.startswith("traefik.http.services.")}
        require(
            not router_names.intersection(routers) and not service_names.intersection(own_services),
            Reason.ROUTE_UNPROVEN,
        )
        router_names.update(routers)
        service_names.update(own_services)
        for router in routers:
            prefix = f"traefik.http.routers.{router}."
            domain = host(meta.get(prefix + "rule"))
            require(domain not in rules, Reason.ROUTE_UNPROVEN)
            rules[domain] = router
            if row not in apps:
                continue
            require(
                not any(
                    key.startswith(prefix)
                    and key[len(prefix) :]
                    not in {"rule", "entrypoints", "service", "tls", "tls.certresolver"}
                    for key in meta
                ),
                Reason.ROUTE_UNPROVEN,
            )
            entry = meta.get(prefix + "entrypoints")
            require(isinstance(entry, str) and entry in entrypoints, Reason.ROUTE_UNPROVEN)
            selected_entry = mapping(entrypoints[cast(str, entry)])
            require(set(selected_entry) == {"address"}, Reason.ROUTE_UNPROVEN)
            address = selected_entry.get("address")
            require(
                address == ":443"
                and (
                    meta.get(prefix + "tls") == "true"
                    or meta.get(prefix + "tls.certresolver") in mapping(cfg.get("certificatesResolvers", {}))
                ),
                Reason.ROUTE_UNPROVEN,
            )
            bindings = sequence(mapping(edge[4]).get("443/tcp"))
            require(
                any(
                    mapping(b).get("HostPort") == "443" and mapping(b).get("HostIp") in ("0.0.0.0", "::")
                    for b in bindings
                ),
                Reason.ROUTE_UNPROVEN,
            )
            network = meta.get("traefik.docker.network")
            require(
                network in edge_networks
                and network in helper._network_names(row[3], "unsupported")
                and docker.get("network", network) == network,
                Reason.ROUTE_UNPROVEN,
            )
            ports = {
                key.split(".")[3]: value
                for key, value in meta.items()
                if key.startswith("traefik.http.services.") and key.endswith(".loadbalancer.server.port")
            }
            require(len(ports) == 1, Reason.ROUTE_UNPROVEN)
            target, port = next(iter(ports.items()))
            require(
                meta.get(prefix + "service", target) == target
                and isinstance(port, str)
                and port.isdigit()
                and 0 < int(port) < 65536
                and f"{port}/tcp" in mapping(row[4]),
                Reason.ROUTE_UNPROVEN,
            )
            require(
                all(
                    key == f"traefik.http.services.{target}.loadbalancer.server.port"
                    for key in meta
                    if key.startswith("traefik.http.services.")
                ),
                Reason.ROUTE_UNPROVEN,
            )
            no_public_ports(row[4])
            app_hosts.add(domain)
    require(bool(app_hosts), Reason.ROUTE_UNPROVEN)
    return apps, app_hosts


def dynamic_snapshot(
    deps: Deps,
    container: str,
    cfg: dict[str, object],
    mounts: object,
    helper: Helpers,
    yaml: ModuleType,
    domains: set[str],
) -> dict[str, bytes]:
    provider = mapping(cfg["providers"]).get("file")
    if provider is None:
        return {}
    options = mapping(provider)
    directory = options.get("directory")
    require(
        isinstance(directory, str)
        and directory.startswith("/")
        and directory != "/"
        and str(PurePosixPath(directory)) == directory
        and ".." not in PurePosixPath(directory).parts
        and len(directory) <= 1024
        and set(options) <= {"directory", "watch"}
        and options.get("watch", True) is True,
        Reason.ROUTE_UNPROVEN,
    )
    assert isinstance(directory, str)
    for mount in sequence(mounts):
        destination = mapping(mount).get("Destination")
        require(
            isinstance(destination, str)
            and destination.startswith("/")
            and str(PurePosixPath(destination)) == destination
            and ".." not in PurePosixPath(destination).parts
            and not destination.startswith(directory + "/"),
            Reason.ROUTE_UNPROVEN,
        )
    root = helper.host_dir_for(directory, mounts)
    fd = open_directory(root)
    try:
        with os.scandir(fd) as entries:
            names: list[str] = []
            for entry in entries:
                require(
                    len(names) < MAX_DYNAMIC_FILES
                    and entry.is_file(follow_symlinks=False)
                    and entry.name.endswith((".yml", ".yaml")),
                    Reason.ROUTE_UNPROVEN,
                )
                names.append(entry.name)
        snapshot: dict[str, bytes] = {}
        for name in sorted(names):
            raw = read_file(root / name)
            require(
                sum(map(len, snapshot.values())) + len(raw) <= STATIC_BYTES,
                Reason.LIMIT,
            )
            document = parse_yaml(raw, yaml)
            require(set(document) <= {"http", "tls"}, Reason.ROUTE_UNPROVEN)
            http = mapping(document.get("http", {}))
            for router in mapping(http.get("routers", {})).values():
                require(
                    anchored_host(mapping(router).get("rule")) not in domains,
                    Reason.ROUTE_UNPROVEN,
                )
            snapshot[name] = raw
        copied = deps.docker(["docker", "cp", f"{container}:{directory}", "-"], TAR_BYTES, ERROR_BYTES)
        require(copied.code == 0 and not copied.stderr, Reason.COMMAND_FAILED)
        require(len(copied.stdout) <= TAR_BYTES and len(copied.stderr) <= ERROR_BYTES, Reason.LIMIT)
        # Walk bounded physical headers only: no extraction or extended-header parsing.
        archive = copied.stdout
        offset, total, root_seen = 0, 0, False
        visible: dict[str, bytes] = {}
        basename = PurePosixPath(directory).name
        while offset + 512 <= len(archive) and any(archive[offset : offset + 512]):
            header = archive[offset : offset + 512]
            require(header[156:157] in (b"0", b"\0", b"5"), Reason.CONFIG_UNPROVEN)
            require(not header[124] & 0x80, Reason.CONFIG_UNPROVEN)
            member = tarfile.TarInfo.frombuf(header, "utf-8", "strict")
            require(not member.linkname and not member.pax_headers, Reason.CONFIG_UNPROVEN)
            offset += 512
            if member.isdir():
                require(
                    not root_seen and member.name.rstrip("/") == basename and member.size == 0,
                    Reason.CONFIG_UNPROVEN,
                )
                root_seen = True
            else:
                prefix = basename + "/"
                name = member.name[len(prefix) :]
                require(
                    root_seen
                    and member.name.startswith(prefix)
                    and name not in ("", ".", "..")
                    and "/" not in name
                    and name not in visible
                    and name.endswith((".yml", ".yaml"))
                    and len(visible) < MAX_DYNAMIC_FILES,
                    Reason.CONFIG_UNPROVEN,
                )
                total += member.size
                require(0 <= member.size <= STATIC_BYTES and total <= STATIC_BYTES, Reason.LIMIT)
                end = offset + member.size
                padded = offset + ((member.size + 511) // 512) * 512
                require(padded <= len(archive) and not any(archive[end:padded]), Reason.CONFIG_UNPROVEN)
                visible[name] = archive[offset:end]
                offset = padded
        require(
            root_seen
            and len(archive) % 512 == 0
            and len(archive) >= offset + 1024
            and not any(archive[offset:])
            and visible == snapshot,
            Reason.CONFIG_UNPROVEN,
        )
        return snapshot
    finally:
        os.close(fd)


@dataclass
class Result:
    reason: Reason = Reason.UNEXPECTED
    access: str = "UNKNOWN"
    sink: str = "UNKNOWN"
    start: int = 0
    end: int = 0
    containers: int = 0
    matches: int = 0
    edge_matches: int = 0
    app_matches: int = 0
    captured: int = 0

    def output(self) -> str:
        fields: dict[str, str | int] = {
            "status": "PASS" if self.reason == Reason.SAMPLE_COMPLETE else "HOLD",
            "reason": self.reason.value,
            "access_log": self.access,
            "sink": self.sink,
            "query_retention": "NOT_ASSESSED" if self.access == "ABSENT" else "UNPROVEN",
            "scope": "CONFIG_AND_BOUNDED_SAMPLE",
            "history": "NOT_ASSESSED",
            "zero_is_absence": "NO",
            "rotated_logs": "NOT_READ",
            "prior_containers": "NOT_READ",
            "external_ingress": "NOT_ASSESSED",
            "file_logs": "NOT_READ",
            "edge_attribution": "SHARED",
            "window_start_epoch": self.start,
            "window_end_epoch": self.end,
            "window_seconds": WINDOW,
            "tail_limit": TAIL,
            "byte_limit_per_container": LOG_BYTES,
            "containers_sampled": self.containers,
            "matches": self.matches,
            "edge_matches": self.edge_matches,
            "app_matches": self.app_matches,
            "captured_bytes": self.captured,
            "prerequisite": "OWNER_GO_ROOT_PYTHON_PYYAML",
        }
        return "\n".join(f"{key}={value}" for key, value in fields.items()) + "\n"


def check(deps: Deps, yaml: ModuleType, helper: Helpers, result: Result) -> None:
    ids = deps.text(["docker", "ps", "--no-trunc", "--format", "{{.ID}}"]).splitlines()
    require(
        0 < len(ids) <= MAX_CONTAINERS
        and len(set(ids)) == len(ids)
        and all(ID_RE.fullmatch(cid) for cid in ids),
        Reason.TOPOLOGY_UNPROVEN,
    )
    peers = deps.inspect(ids, PEER_FMT)
    require(
        all(len(row) == 6 and row[0] == cid and row[2] is True for row, cid in zip(peers, ids)),
        Reason.TOPOLOGY_UNPROVEN,
    )
    edges = [row for row in peers if row[1] == "/traefik-central"]
    require(len(edges) == 1, Reason.TOPOLOGY_UNPROVEN)
    cid = cast(str, edges[0][0])
    central = deps.inspect([cid], CENTRAL_FMT)[0]
    require(
        len(central) == 10
        and central[0] == cid
        and central[1] == "/traefik-central"
        and central[2] is True
        and labels(central, 9).get("com.docker.compose.project") == "traefik",
        Reason.TOPOLOGY_UNPROVEN,
    )
    image = central[5]
    version = labels(central, 9).get("org.opencontainers.image.version")
    floating = (
        isinstance(image, str)
        and MINOR_TAG_RE.fullmatch(image) is not None
        and isinstance(version, str)
        and LABEL_VERSION_RE.fullmatch(version) is not None
    )
    require(
        isinstance(image, str)
        and (VERSION_RE.fullmatch(image) is not None or floating)
        and helper.traefik_major(image, labels(central, 9)) == 3,
        Reason.CONFIG_UNPROVEN,
    )
    if version is not None and not floating:
        require(
            isinstance(version, str)
            and cast(str, image).split("@", 1)[0].endswith(":v" + version.lstrip("v")),
            Reason.CONFIG_UNPROVEN,
        )
    args = sequence(central[6])
    require(
        all(
            isinstance(arg, str)
            and len(arg) <= 2048
            and not arg.lower().startswith(("--configfile", "--config-file"))
            for arg in args
        ),
        Reason.CONFIG_UNPROVEN,
    )
    require(
        not deps.text(["docker", "inspect", "--type", "container", "--format", ENV_KEYS_FMT, cid]).strip(),
        Reason.CONFIG_UNPROVEN,
    )
    selected = helper.static_config_file(central[7], central[8])
    require(
        selected is not None and selected[0].endswith((".yml", ".yaml")),
        Reason.CONFIG_UNPROVEN,
    )
    assert selected is not None
    started = datetime.fromisoformat(cast(str, central[3]).replace("Z", "+00:00")).timestamp()
    content = read_file(selected[1], started)
    home, xdg = helper.traefik_lookup_env(deps.text, cid)
    lookup = helper.static_search_paths(cast(str, central[8]), home, xdg)

    def copy(container: str, path: str) -> bytes | None:
        return copy_config(deps, helper, container, path)

    helper.prove_selected_config(copy, cid, lookup, selected, content)
    cfg = parse_yaml(content, yaml)
    require(
        set(cfg)
        <= {
            "api",
            "global",
            "entryPoints",
            "providers",
            "certificatesResolvers",
            "log",
            "accessLog",
        },
        Reason.CONFIG_UNPROVEN,
    )
    apps, domains = prove_routes(peers, central, cfg, helper)
    dynamic = dynamic_snapshot(deps, cid, cfg, central[7], helper, yaml, domains)
    result.access = "ABSENT" if "accessLog" not in cfg else "ENABLED"
    result.sink = "NONE" if result.access == "ABSENT" else "STDOUT"
    candidate = Reason.SAMPLE_COMPLETE if result.access == "ABSENT" else Reason.ACCESS_LOG_UNPROVEN
    if "accessLog" in cfg:
        access = mapping(cfg["accessLog"])
        if access.get("filePath"):
            result.sink, candidate = "FILE", Reason.FILE_LOG_GAP
    general = mapping(cfg.get("log", {}))
    require(
        set(general) <= {"level", "format", "filePath", "noColor"},
        Reason.CONFIG_UNPROVEN,
    )
    if general.get("filePath"):
        candidate = Reason.FILE_LOG_GAP
    elif general.get("level", "INFO") not in (
        "INFO",
        "WARN",
        "ERROR",
        "FATAL",
        "PANIC",
    ):
        candidate = Reason.GENERAL_LOG_UNPROVEN
    sample_ids = [cid, *(cast(str, row[0]) for row in apps)]
    log_states = deps.inspect(sample_ids, LOG_FMT)
    for row in log_states:
        options = mapping(row[0])
        require(
            options.get("Type") == "json-file"
            and mapping(options.get("Config", {})).get("mode", "blocking") == "blocking",
            Reason.LOG_DRIVER_UNSUPPORTED,
        )
    result.end = int(deps.clock())
    result.start = result.end - WINDOW
    for container in sample_ids:
        raw = deps.docker(
            [
                "docker",
                "logs",
                "--timestamps",
                "--since",
                str(result.start),
                "--until",
                str(result.end),
                "--tail",
                str(TAIL),
                container,
            ],
            LOG_BYTES,
            LOG_BYTES,
        )
        require(raw.code == 0, Reason.COMMAND_FAILED)
        require(len(raw.stdout) + len(raw.stderr) <= LOG_BYTES, Reason.LIMIT)
        require(
            len(raw.stdout.splitlines()) + len(raw.stderr.splitlines()) < TAIL,
            Reason.TAIL_LIMIT,
        )
        count = raw.stdout.count(b"walletAddress=") + raw.stderr.count(b"walletAddress=")
        result.matches += count
        result.edge_matches += count if container == cid else 0
        result.app_matches += count if container != cid else 0
        result.captured += len(raw.stdout) + len(raw.stderr)
        result.containers += 1
    require(
        deps.text(["docker", "ps", "--no-trunc", "--format", "{{.ID}}"]).splitlines() == ids
        and deps.inspect(ids, PEER_FMT) == peers
        and deps.inspect([cid], CENTRAL_FMT)[0] == central
        and deps.inspect(sample_ids, LOG_FMT) == log_states,
        Reason.DRIFT,
    )
    require(
        read_file(selected[1], started) == content
        and dynamic_snapshot(deps, cid, cfg, central[7], helper, yaml, domains) == dynamic,
        Reason.DRIFT,
    )
    helper.prove_selected_config(copy, cid, lookup, selected, content)
    require(
        helper.traefik_lookup_env(deps.text, cid) == (home, xdg)
        and not deps.text(
            ["docker", "inspect", "--type", "container", "--format", ENV_KEYS_FMT, cid]
        ).strip(),
        Reason.DRIFT,
    )
    result.reason = Reason.MATCHES_OBSERVED if result.matches else candidate


def main(argv: Sequence[str], deps: Deps | None = None) -> int:
    result = Result()
    try:
        require(
            list(argv) == ["--owner-go"],
            Reason.OWNER_GO_REQUIRED if not argv else Reason.ARGUMENTS,
        )
        deps = deps or Deps()
        require(deps.uid() == 0, Reason.ROOT_REQUIRED)
        require(sys.version_info >= (3, 11), Reason.PYTHON_REQUIRED)
        yaml = deps.yaml()
        require(yaml is not None, Reason.PYYAML_REQUIRED)
        assert yaml is not None
        check(deps, yaml, deps.load_helpers(), result)
    except Hold as exc:
        result.reason = exc.reason
    except Exception:
        result.reason = Reason.UNEXPECTED
    sys.stdout.write(result.output())
    return 0 if result.reason == Reason.SAMPLE_COMPLETE else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
