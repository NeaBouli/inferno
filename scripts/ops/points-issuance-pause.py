#!/usr/bin/env python3
"""Owner-only: pause / resume ONLY Points voucher issuance at the Traefik edge.

Run by the owner on the production host (needs Docker access and write access to
the Traefik file-provider directory on the host).

    points-issuance-pause.py --status
    points-issuance-pause.py --pause
    points-issuance-pause.py --resume --expected-release <40-hex release sha>

Mechanism: one dedicated Traefik dynamic-configuration file,
`points-issuance-pause.yml`, in the directory the running Traefik already watches
(`--providers.file.directory`). It adds a router with a very high priority that
matches `POST` requests for `points-api.ifrunit.tech` whose path contains
"voucher" (case-insensitive, so `/Voucher/Issue` and `/voucher/issue/` are covered
as Express would route them) and sends them to a service without servers, which
Traefik answers with 503. The request never reaches the Points container, so it
stops before authentication, signing and the points debit. `/auth`, `/points`,
`/health` and `GET /voucher/validate` are untouched; other hosts are untouched.
The router is independent of the Points container, so it persists through a
Points rollout, a failed rollout and a rollback.

Nothing is guessed. Before writing, the tool verifies read-only on the host:
the Points container (running, exactly one Traefik router with rule
Host(`points-api.ifrunit.tech`), no non-loopback published port), exactly one
running central Traefik container (fixed identity, see below) with a known major version (2 or 3), a watched
file-provider DIRECTORY, taken from the CLI arguments or, when Traefik loads a bind-mounted YAML
static config file from its default lookup paths, from that file's providers.file block (strictly
parsed, never printed), and bind-mounted from the host,
no foreign config using our names, and public probes: GET /health is 200 and an
unauthenticated POST /voucher/issue is 401 (reaches the backend, rejected before
any signing). After writing, it waits until every probe variant answers 503 while
/health stays 200; otherwise it removes its file again and verifies the 401 is
back. If the topology does not provide this mechanism it prints
`mechanism=unavailable reason=<code>` and changes nothing.

--resume removes only a byte-identical file of ours, and only when the Points
build context carries the expected (new, reviewed) release and the running
container's FEE_ROUTER_ADDRESS is canonical (compared in memory, never printed).
It is fail-safe: if the check after removal (401 on all variants, /health 200)
fails, it reinstalls the identical pause file, re-verifies 503 + /health 200 and
exits 1 with `resume=resume_failed_pause_restored`, or with
`resume=resume_failed_pause_restore_unverified` (incident: stop, no further action).

Only status words, paths and HTTP status codes are printed. No container
environment, no Traefik environment and no foreign dynamic-config content is
printed or written.

Exit codes: 0 ok; 1 pause/resume failed (reverted where possible); 2 refused or
unavailable (nothing changed).
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional, Sequence

POINTS_CONTAINER = "inferno-points-backend"
# The host also runs other projects' Traefik instances (e.g. parlay-traefik). The edge that
# serves Points is identified by a fixed name and compose project, never chosen at run time.
TRAEFIK_CONTAINER = "traefik-central"
TRAEFIK_COMPOSE_PROJECT = "traefik"
PUBLIC_HOST = "points-api.ifrunit.tech"
HOST_RULE = f"Host(`{PUBLIC_HOST}`)"
PAUSE_NAME = "points-issuance-pause"
PAUSE_FILE = f"{PAUSE_NAME}.yml"
PRIORITY = 1000000
CANONICAL_ROUTER = "0x4807b77b2e25cd055da42b09ba4d0af9e580c60a"
# Releases whose voucher signing is known-incompatible with the deployed FeeRouterV1.
KNOWN_BAD_RELEASES = frozenset({
    "3a3a6bda3cc237808517e60beb848f04ef8d50e8",
    "5dbe1056a82691314a82b9a644c62c65e3eae650",
})
_SHA_RE = re.compile(r"[0-9a-f]{40}")
_TRAEFIK_IMAGE_RE = re.compile(r"^(?:docker\.io/)?(?:library/)?traefik(?::(?P<tag>[^@]+))?(?:@sha256:[0-9a-f]{64})?$")
_SAFE_TOKEN_RE = re.compile(r"[A-Za-z0-9_.-]{1,64}")
ISSUE_VARIANTS = ("/voucher/issue", "/Voucher/Issue", "/voucher/issue/", "/VOUCHER/ISSUE?probe=1")
WAIT_SECONDS = 30.0

Runner = Callable[[Sequence[str]], str]
Prober = Callable[[str, str], int]


class Refuse(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class Unavailable(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _run(cmd: Sequence[str]) -> str:
    result = subprocess.run(list(cmd), capture_output=True, text=True, timeout=30, check=False)
    if result.returncode != 0:
        raise Refuse("docker_failed")
    return result.stdout


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: object, **kwargs: object) -> None:
        return None


def _probe(method: str, path: str) -> int:
    """Public HTTPS status code for method+path on the Points host; 0 on transport error."""
    req = urllib.request.Request(
        f"https://{PUBLIC_HOST}{path}",
        method=method,
        data=b"{}" if method == "POST" else None,
        headers={"Content-Type": "application/json", "User-Agent": "points-issuance-pause/1"},
    )
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(req, timeout=10) as resp:
            return int(resp.status)
    except urllib.error.HTTPError as exc:
        return int(exc.code)
    except Exception:  # noqa: BLE001 - transport errors map to 0, never printed
        return 0


# ---------------------------------------------------------------- discovery


@dataclass(frozen=True)
class Topology:
    entrypoints: tuple[str, ...]
    tls: bool
    certresolver: Optional[str]
    traefik_major: int
    host_dir: Path
    release_file: Path


def _json(raw: str) -> object:
    try:
        return json.loads(raw)
    except ValueError:
        raise Refuse("docker_output_unreadable") from None


def points_router(raw_labels: dict[str, object]) -> tuple[tuple[str, ...], bool, Optional[str]]:
    # Traefik label keys are case-insensitive (entryPoints == entrypoints).
    labels = {k.lower(): v for k, v in raw_labels.items() if k.lower().startswith("traefik.")}
    if len(labels) != len([k for k in raw_labels if k.lower().startswith("traefik.")]):
        raise Refuse("points_router_labels_ambiguous")
    if labels.get("traefik.enable") != "true":
        raise Unavailable("points_not_traefik_routed")
    routers = sorted({k.split(".")[3] for k in labels if k.startswith("traefik.http.routers.") and k.count(".") >= 4})
    matching = [r for r in routers if labels.get(f"traefik.http.routers.{r}.rule") == HOST_RULE]
    others = [r for r in routers if PUBLIC_HOST in str(labels.get(f"traefik.http.routers.{r}.rule", ""))]
    if len(matching) != 1 or others != matching:
        raise Refuse("points_router_ambiguous")
    prefix = f"traefik.http.routers.{matching[0]}."
    eps_raw = labels.get(prefix + "entrypoints")
    if not isinstance(eps_raw, str) or not eps_raw:
        raise Refuse("points_router_entrypoints_missing")  # default = all entrypoints; do not guess
    eps = tuple(e.strip() for e in eps_raw.split(","))
    if not all(_SAFE_TOKEN_RE.fullmatch(e) for e in eps):
        raise Refuse("points_router_entrypoints_unexpected")
    resolver = labels.get(prefix + "tls.certresolver")
    tls_flag = labels.get(prefix + "tls")
    if resolver is not None and (not isinstance(resolver, str) or not _SAFE_TOKEN_RE.fullmatch(resolver)):
        raise Refuse("points_router_tls_unexpected")
    tls = resolver is not None or tls_flag == "true"
    if any(k.startswith(prefix + "tls.options") or k.startswith(prefix + "tls.domains") for k in labels):
        raise Refuse("points_router_options_unsupported")
    return eps, tls, resolver if isinstance(resolver, str) else None


def _network_names(networks: object, code: str) -> frozenset[str]:
    if not isinstance(networks, dict) or not all(isinstance(k, str) and k for k in networks):
        raise Refuse(code)
    return frozenset(networks)


def points_networks(raw: str) -> frozenset[str]:
    data = _json(raw)
    if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
        raise Refuse("points_container_unreadable")
    net = data[0].get("NetworkSettings")
    return _network_names(net.get("Networks") if isinstance(net, dict) else None, "points_networks_unreadable")


def points_facts(raw: str) -> tuple[dict[str, object], list[str]]:
    data = _json(raw)
    if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
        raise Refuse("points_container_unreadable")
    obj = data[0]
    if obj.get("Name") != f"/{POINTS_CONTAINER}":
        raise Refuse("points_container_mismatch")
    state = obj.get("State")
    if not isinstance(state, dict) or state.get("Running") is not True:
        raise Refuse("points_container_not_running")
    config = obj.get("Config")
    net = obj.get("NetworkSettings")
    if not isinstance(config, dict) or not isinstance(config.get("Labels"), dict):
        raise Refuse("points_container_unreadable")
    ports = net.get("Ports") if isinstance(net, dict) else None
    if isinstance(ports, dict):
        for bindings in ports.values():
            for b in bindings or []:
                if not isinstance(b, dict) or b.get("HostIp") not in ("127.0.0.1", "::1"):
                    raise Refuse("points_port_published")  # a direct path would bypass the edge pause
    env = config.get("Env")
    env_list = [e for e in env if isinstance(e, str)] if isinstance(env, list) else []
    labels: dict[str, object] = config["Labels"]
    return labels, env_list


def traefik_major(image: str, labels: dict[str, object]) -> int:
    m = _TRAEFIK_IMAGE_RE.match(image)
    candidates = []
    if m and m.group("tag"):
        candidates.append(m.group("tag"))
    version = labels.get("org.opencontainers.image.version")
    if isinstance(version, str):
        candidates.append(version)
    majors = set()
    for c in candidates:
        mm = re.match(r"^v?([0-9]+)(?:\.[0-9]+){0,2}$", c)
        if mm:
            majors.add(int(mm.group(1)))
    if len(majors) != 1 or not majors <= {2, 3}:
        raise Refuse("traefik_version_unknown")
    return majors.pop()


def file_provider_dir(args: Sequence[str]) -> str:
    dirs: list[str] = []
    it = iter(range(len(args)))
    for i in it:
        a = args[i]
        low = a.lower()
        if low.startswith("--providers.file.filename"):
            raise Unavailable("file_provider_single_file")
        if low.startswith("--providers.file.watch=") and low.split("=", 1)[1] != "true":
            raise Unavailable("file_provider_not_watched")
        if low.startswith("--providers.file.directory="):
            dirs.append(a.split("=", 1)[1])
        elif low == "--providers.file.directory" and i + 1 < len(args):
            dirs.append(args[i + 1])
            next(it, None)
        elif low.startswith("--configfile") or low.startswith("--config-file"):
            raise Unavailable("traefik_static_config_file")
    if not dirs:
        raise Unavailable("file_provider_absent")
    if len(dirs) != 1 or not dirs[0].startswith("/"):
        raise Refuse("file_provider_ambiguous")
    return dirs[0].rstrip("/") or "/"


_STATIC_EXTS = ("toml", "yaml", "yml")  # Traefik's own lookup order
_STATIC_NAMES = tuple(f"traefik.{e}" for e in _STATIC_EXTS)
STATIC_MAX_BYTES = 262144


def static_search_paths(workdir: str) -> list[str]:
    """Traefik v3 default static-config lookup (pkg/cli/loader_file.go, paerser cli.Finder):
    /etc/traefik/traefik, $XDG_CONFIG_HOME/traefik (unset in the official image -> /traefik),
    $HOME/.config/traefik, ./traefik; extensions toml, yaml, yml; the first existing path wins
    and a loaded file excludes CLI flags. $HOME/.config is not resolvable without reading the
    container environment, so any mount there is refused below instead of guessed."""
    cwd = (workdir or "/").rstrip("/")
    paths: list[str] = []
    for base in ("/etc/traefik/traefik", "/traefik", f"{cwd}/traefik"):
        for ext in _STATIC_EXTS:
            if f"{base}.{ext}" not in paths:
                paths.append(f"{base}.{ext}")
    return paths


def static_config_file(mounts: object, workdir: object) -> Optional[tuple[str, Path]]:
    """The bind-mounted static config file Traefik loads, as (container path, host path)."""
    if not isinstance(mounts, list) or not all(isinstance(m, dict) for m in mounts):
        raise Refuse("traefik_mounts_unreadable")
    if not isinstance(workdir, str) or (workdir and not workdir.startswith("/")):
        raise Refuse("traefik_inspect_unreadable")
    search = static_search_paths(workdir)
    hits: list[tuple[str, Path]] = []
    for m in mounts:
        dest = str(m.get("Destination", "")).rstrip("/") or "/"
        src = m.get("Source")
        if "/.config" in dest + "/" or (dest.rsplit("/", 1)[-1] in _STATIC_NAMES and dest not in search):
            raise Unavailable("traefik_static_config_location_unknown")
        for path in search:
            if path == dest or path.startswith(dest.rstrip("/") + "/"):
                if m.get("Type") != "bind" or not isinstance(src, str):
                    raise Unavailable("traefik_static_config_not_bind_mount")
                host = Path(src) / path[len(dest.rstrip("/")):].lstrip("/") if path != dest else Path(src)
                if path == dest or host.exists():
                    hits.append((path, host))
    if not hits:
        return None
    if len({h[0] for h in hits}) != 1:
        raise Refuse("traefik_static_config_ambiguous")
    path, host = hits[0]
    if host.is_symlink() or not host.is_file():
        raise Refuse("traefik_static_config_unreadable")
    return path, host


def read_static_config(host: Path) -> str:
    try:
        with open(host, "rb") as fh:
            data = fh.read(STATIC_MAX_BYTES + 1)
    except OSError:
        raise Refuse("traefik_static_config_unreadable") from None
    if len(data) > STATIC_MAX_BYTES:
        raise Refuse("traefik_static_config_too_large")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        raise Refuse("traefik_static_config_unreadable") from None


_YAML_KEY_RE = re.compile(r"^( *)([A-Za-z0-9_-]+):(?: +(.*))?$")
_SAFE_DIR_RE = re.compile(r"/[A-Za-z0-9_./-]*")


def _yaml_scalar(raw: str) -> str:
    value = raw.split(" #", 1)[0].strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        value = value[1:-1]
        if "'" in value or '"' in value or "\\" in value:
            raise Refuse("static_file_provider_unexpected")
    elif not value or value[0] in "'\"[{|>&*!%@`":
        raise Refuse("static_file_provider_unexpected")
    return value


def static_file_provider_dir(text: str) -> str:
    """providers.file.directory from a YAML static config, accepting only plain block mappings.
    Values are used in memory only and never printed."""
    content = [ln.rstrip() for ln in text.splitlines()
               if ln.strip() and not ln.lstrip().startswith("#")]
    if content and content[0] == "---":
        content = content[1:]
    for ln in content:
        stripped = ln.lstrip(" ")
        if ln.startswith("\t") or stripped.startswith(("\t", "---", "...")) or "<<:" in ln \
                or re.search(r"(?:^|\s)[&*][A-Za-z0-9_]", ln):
            raise Refuse("traefik_static_config_unsupported")
    tops = [(i, _YAML_KEY_RE.match(ln)) for i, ln in enumerate(content) if not ln.startswith(" ")]
    prov = [(i, m) for i, m in tops if m and m.group(2).lower() == "providers"]
    if not prov:
        raise Unavailable("file_provider_absent")
    if len(prov) != 1 or prov[0][1].group(3):
        raise Refuse("traefik_static_config_unsupported")
    start = prov[0][0] + 1
    end = next((i for i, _ in tops if i > prov[0][0]), len(content))
    block = content[start:end]
    if not block:
        raise Unavailable("file_provider_absent")
    child = len(block[0]) - len(block[0].lstrip(" "))
    files = [i for i, ln in enumerate(block)
             if len(ln) - len(ln.lstrip(" ")) == child and (m := _YAML_KEY_RE.match(ln)) and m.group(2).lower() == "file"]
    if not files:
        raise Unavailable("file_provider_absent")
    head = _YAML_KEY_RE.match(block[files[0]])
    if len(files) != 1 or head is None or head.group(3):
        raise Refuse("static_file_provider_unexpected")
    body = []
    for ln in block[files[0] + 1:]:
        if len(ln) - len(ln.lstrip(" ")) <= child:
            break
        body.append(ln)
    if not body:
        raise Unavailable("file_provider_absent")
    grand = len(body[0]) - len(body[0].lstrip(" "))
    fields: dict[str, str] = {}
    for ln in body:
        m = _YAML_KEY_RE.match(ln)
        if m is None or len(m.group(1)) != grand or m.group(3) is None:
            raise Refuse("static_file_provider_unexpected")
        k = m.group(2).lower()
        if k in fields or k not in ("directory", "watch", "filename"):
            raise Refuse("static_file_provider_unexpected")
        fields[k] = _yaml_scalar(m.group(3))
    if "filename" in fields:
        raise Unavailable("file_provider_single_file")
    if fields.get("watch", "true").lower() != "true":
        raise Unavailable("file_provider_not_watched")
    directory = fields.get("directory")
    if directory is None:
        raise Unavailable("file_provider_absent")
    if not _SAFE_DIR_RE.fullmatch(directory) or "/../" in directory + "/" or "//" in directory:
        raise Refuse("file_provider_ambiguous")
    return directory.rstrip("/") or "/"


def host_dir_for(container_dir: str, mounts: object) -> Path:
    if not isinstance(mounts, list):
        raise Refuse("traefik_mounts_unreadable")
    best: Optional[tuple[int, Path]] = None
    for m in mounts:
        if not isinstance(m, dict):
            continue
        dest = str(m.get("Destination", "")).rstrip("/")
        if dest and (container_dir == dest or container_dir.startswith(dest + "/")):
            if m.get("Type") != "bind" or not isinstance(m.get("Source"), str):
                raise Unavailable("file_provider_dir_not_bind_mount")
            rel = container_dir[len(dest):].lstrip("/")
            cand = (len(dest), Path(str(m["Source"])) / rel)
            if best is None or cand[0] > best[0]:
                best = cand
    if best is None:
        raise Unavailable("file_provider_dir_not_on_host")
    host = best[1]
    if host.is_symlink() or not host.is_dir():
        raise Refuse("file_provider_host_dir_unexpected")
    return host


def discover(run: Runner) -> Topology:
    raw = run(["docker", "inspect", "--type", "container", POINTS_CONTAINER])
    labels, _env = points_facts(raw)
    pnets = points_networks(raw)
    eps, tls, resolver = points_router(labels)
    wd = labels.get("com.docker.compose.project.working_dir")
    if not isinstance(wd, str) or not wd.startswith("/"):
        raise Refuse("points_compose_labels_missing")
    ps = run(["docker", "ps", "--no-trunc", "--format", "{{.ID}}\t{{.Image}}\t{{.Names}}"])
    traefik_rows = []
    for row in ps.splitlines():
        cid, _, rest = row.partition("\t")
        img, _, names = rest.partition("\t")
        if _TRAEFIK_IMAGE_RE.match(img.strip()):
            traefik_rows.append((cid.strip(), names.strip()))
    if not traefik_rows:
        raise Refuse("traefik_container_absent")
    central = [cid for cid, names in traefik_rows if names == TRAEFIK_CONTAINER]
    if len(central) != 1:
        raise Refuse("traefik_central_absent" if not central else "traefik_container_ambiguous")
    # Targeted fields only: never the Traefik container's environment.
    fmt = ("{{json .Config.Image}}\n{{json .Args}}\n{{json .Config.Labels}}\n{{json .Mounts}}\n"
           "{{json .State.Running}}\n{{json .Name}}\n{{json .NetworkSettings.Networks}}\n{{json .Config.WorkingDir}}")
    parts = run(["docker", "inspect", "--type", "container", "--format", fmt, central[0]]).splitlines()
    if len(parts) != 8:
        raise Refuse("traefik_inspect_unreadable")
    timage, args, tlabels, mounts, running, tname, tnets, workdir = (_json(p) for p in parts)
    if running is not True or not isinstance(timage, str) or not isinstance(args, list):
        raise Refuse("traefik_inspect_unreadable")
    if tname != f"/{TRAEFIK_CONTAINER}":
        raise Refuse("traefik_central_mismatch")
    if not isinstance(tlabels, dict) or tlabels.get("com.docker.compose.project") != TRAEFIK_COMPOSE_PROJECT:
        raise Refuse("traefik_central_project_mismatch")
    # The central edge must reach Points over the network Points' router names (or, without that
    # label, over at least one shared network); otherwise it is not the edge serving Points.
    shared = pnets & _network_names(tnets, "traefik_networks_unreadable")
    wanted = [v for k, v in labels.items() if k.lower() == "traefik.docker.network"]
    if len(wanted) > 1 or (wanted and wanted[0] not in shared) or not shared:
        raise Refuse("traefik_central_not_on_points_network")
    major = traefik_major(timage, tlabels)
    sargs = [str(a) for a in args]
    if any(a.lower().startswith(("--configfile", "--config-file")) for a in sargs):
        raise Unavailable("traefik_static_config_file")
    static = static_config_file(mounts, workdir)
    # A config file created inside the container's writable layer would be invisible to the
    # mount check and could take precedence; `docker diff` lists changed paths only (no content).
    search = static_search_paths(workdir if isinstance(workdir, str) else "/")
    for row in run(["docker", "diff", central[0]]).splitlines():
        changed = row[2:].strip() if len(row) > 2 else ""
        if changed in search or changed.startswith("/etc/traefik") or "/.config" in changed:
            raise Unavailable("traefik_static_config_unverifiable")
    if static is None:
        cdir = file_provider_dir(sargs)
    elif static[0].endswith(".toml"):
        raise Unavailable("traefik_static_config_toml")
    else:
        cdir = static_file_provider_dir(read_static_config(static[1]))
    host = host_dir_for(cdir, mounts)
    return Topology(eps, tls, resolver, major, host, Path(wd) / "points-backend" / "RELEASE_SHA")


# ---------------------------------------------------------------- config


def rule_for(major: int) -> str:
    if major == 3:
        path = "PathRegexp(`(?i)voucher`)"
    else:
        path = "Path(`/{p:(?i).*voucher.*}`)"
    return f"{HOST_RULE} && Method(`POST`) && {path}"


def render(topo: Topology) -> bytes:
    lines = [
        "# Managed by scripts/ops/points-issuance-pause.py (Points voucher incident 2026-10-06).",
        "# Temporary: answers POST voucher issuance on points-api.ifrunit.tech with 503 before",
        "# it reaches the Points backend. Remove only with: points-issuance-pause.py --resume",
        "http:",
        "  routers:",
        f"    {PAUSE_NAME}:",
        f"      rule: \"{rule_for(topo.traefik_major)}\"",
        f"      priority: {PRIORITY}",
        "      entryPoints:",
        *[f"        - {e}" for e in topo.entrypoints],
        f"      service: {PAUSE_NAME}",
    ]
    if topo.tls:
        lines += ["      tls:", f"        certResolver: {topo.certresolver}"] if topo.certresolver else ["      tls: {}"]
    lines += [
        "  services:",
        f"    {PAUSE_NAME}:",
        "      loadBalancer:",
        "        servers: []",
        "",
    ]
    return "\n".join(lines).encode("ascii")


def foreign_name_clash(host_dir: Path) -> bool:
    for entry in sorted(host_dir.iterdir()):
        if entry.name == PAUSE_FILE or not entry.is_file():
            continue
        try:
            if PAUSE_NAME.encode() in entry.read_bytes():
                return True
        except OSError:
            return True
    return False


# ---------------------------------------------------------------- actions


@dataclass
class Deps:
    run: Runner = _run
    probe: Prober = _probe
    sleep: Callable[[float], None] = time.sleep
    monotonic: Callable[[], float] = time.monotonic
    out: Callable[[str], None] = print
    wait_seconds: float = WAIT_SECONDS


def _state(path: Path, expected: bytes) -> str:
    if not path.exists() and not path.is_symlink():
        return "inactive"
    if path.is_symlink() or not path.is_file():
        return "modified"
    try:
        return "active" if path.read_bytes() == expected else "modified"
    except OSError:
        return "modified"


def _wait(deps: Deps, want_issue: int) -> tuple[bool, dict[str, int]]:
    deadline = deps.monotonic() + deps.wait_seconds
    while True:
        codes = {p: deps.probe("POST", p) for p in ISSUE_VARIANTS}
        codes["/health"] = deps.probe("GET", "/health")
        if all(codes[p] == want_issue for p in ISSUE_VARIANTS) and codes["/health"] == 200:
            return True, codes
        if deps.monotonic() >= deadline:
            return False, codes
        deps.sleep(2.0)


def _print_codes(deps: Deps, prefix: str, codes: dict[str, int]) -> None:
    deps.out(f"{prefix}_health={codes.get('/health', 0)}")
    deps.out(f"{prefix}_issue=" + ",".join(str(codes.get(p, 0)) for p in ISSUE_VARIANTS))


def status(deps: Deps) -> tuple[int, Optional[Topology]]:
    try:
        topo = discover(deps.run)
    except Unavailable as exc:
        deps.out("mechanism=unavailable")
        deps.out(f"reason={exc.code}")
        return 2, None
    deps.out("mechanism=traefik-file-provider")
    deps.out(f"traefik_major={topo.traefik_major}")
    deps.out(f"pause_file={topo.host_dir / PAUSE_FILE}")
    state = _state(topo.host_dir / PAUSE_FILE, render(topo))
    deps.out(f"pause={state}")
    return (2 if state == "modified" else 0), topo


def pause(deps: Deps) -> int:
    code, topo = status(deps)
    if topo is None or code != 0:
        return 2
    path = topo.host_dir / PAUSE_FILE
    content = render(topo)
    if _state(path, content) == "active":
        ok, codes = _wait(deps, 503)
        _print_codes(deps, "check", codes)
        deps.out("action=none" if ok else "action=none-but-probes-failed")
        return 0 if ok else 1
    if foreign_name_clash(topo.host_dir):
        raise Refuse("pause_name_in_use")
    pre = {p: deps.probe("POST", p) for p in ISSUE_VARIANTS[:1]}
    pre["/health"] = deps.probe("GET", "/health")
    if pre["/health"] != 200 or pre[ISSUE_VARIANTS[0]] != 401:
        _print_codes(deps, "preflight", pre)
        raise Refuse("preflight_probe_unexpected")
    _install(path, content)
    deps.out("action=written")
    ok, codes = _wait(deps, 503)
    _print_codes(deps, "check", codes)
    if ok:
        deps.out("pause=active")
        return 0
    path.unlink()
    back, codes = _wait(deps, 401)
    _print_codes(deps, "revert", codes)
    deps.out("pause=failed")
    deps.out("reverted=" + ("verified" if back else "file-removed-probes-unexpected"))
    return 1


def _install(path: Path, content: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o644)
    try:
        view = memoryview(content)
        while view:
            view = view[os.write(fd, view):]
        os.fchmod(fd, 0o644)  # no secret; Traefik must read it
        os.fsync(fd)
    finally:
        os.close(fd)


def _container_router_canonical(deps: Deps) -> bool:
    _labels, env = points_facts(deps.run(["docker", "inspect", "--type", "container", POINTS_CONTAINER]))
    values = [e.partition("=")[2] for e in env if e.partition("=")[0] == "FEE_ROUTER_ADDRESS" and "=" in e]
    return len(values) == 1 and values[0].isascii() and values[0].strip(" \t\n\r\f\v").lower() == CANONICAL_ROUTER


def resume(expected_release: str, deps: Deps) -> int:
    if not _SHA_RE.fullmatch(expected_release) or expected_release in KNOWN_BAD_RELEASES:
        raise Refuse("expected_release_invalid")
    code, topo = status(deps)
    if topo is None or code != 0:
        return 2
    path = topo.host_dir / PAUSE_FILE
    if _state(path, render(topo)) == "inactive":
        deps.out("action=none")
        return 0
    try:
        live = topo.release_file.read_text(encoding="ascii").strip()
    except (OSError, UnicodeDecodeError):
        raise Refuse("live_release_unreadable") from None
    if live != expected_release:
        raise Refuse("live_release_mismatch")
    if not _container_router_canonical(deps):
        raise Refuse("container_router_not_canonical")
    content = render(topo)
    path.unlink()
    deps.out("action=removed")
    try:
        ok, codes = _wait(deps, 401)
    except Exception:  # noqa: BLE001 - any check failure keeps issuance closed
        ok, codes = False, {}
    _print_codes(deps, "check", codes)
    if ok:
        deps.out("pause=inactive")
        deps.out("issuance_reachable=verified")
        return 0
    # Fail safe: the check after lifting the pause failed, so put the identical pause back.
    try:
        if _state(path, content) != "active":
            _install(path, content)
        back, codes = _wait(deps, 503)
    except Exception:  # noqa: BLE001 - constant category, never raw error text
        back, codes = False, {}
    _print_codes(deps, "restored", codes)
    if back:
        deps.out("pause=active")
        deps.out("resume=resume_failed_pause_restored")
    else:
        deps.out("resume=resume_failed_pause_restore_unverified")  # incident: stop, no further action
    return 1


USAGE = "usage: points-issuance-pause.py --status | --pause | --resume --expected-release <sha>"


def main(argv: Sequence[str], deps: Optional[Deps] = None) -> int:
    deps = deps or Deps()
    args = list(argv[1:])
    try:
        if args == ["--status"]:
            return status(deps)[0]
        if args == ["--pause"]:
            return pause(deps)
        if len(args) == 3 and args[0] == "--resume" and args[1] == "--expected-release":
            return resume(args[2], deps)
    except Refuse as exc:
        deps.out(f"refuse={exc.code}")
        return 2
    except Unavailable as exc:
        deps.out("mechanism=unavailable")
        deps.out(f"reason={exc.code}")
        return 2
    except Exception:  # noqa: BLE001 - one constant line, never raw error text
        deps.out("refuse=unexpected_error")
        return 2
    print(USAGE, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
