#!/usr/bin/env python3
"""Owner-only: set FEE_ROUTER_ADDRESS in the Points env file to the canonical router.

Run by the owner on the production host (needs Docker access and write access to
the Points env file). Default is a dry run; nothing is written without --apply.

    points-env-set-router.py                     # dry run (plan only)
    points-env-set-router.py --apply             # back up, replace one value, verify
    points-env-set-router.py --restore BACKUP    # dry run of a restore
    points-env-set-router.py --restore BACKUP --apply

The env file is never guessed. It is derived from the running container
`inferno-points-backend` (compose labels: project, service, working dir, single
config file), the `env_file:` entries of the `points-backend` service in that
compose file, and an in-memory equality check between the file value and the
running container's value. Any mismatch, duplicate, ambiguous spelling,
non-ASCII byte in the key line, symlink, hard link or unreadable file refuses.

Only categories, paths and status words are printed; never a value, never a hash
of a value, never raw error text. The env file is parsed as bytes, never sourced
as shell code. All bytes other than the one value (including the key, the line
ending, every other line and a missing final newline) are preserved, as are the
mode, owner, group and extended attributes (POSIX ACLs) of the file.

--apply also writes `<backup>.postapply-sha256` (0600) with the digest of the
file right after the change. --restore is key-scoped: it reverts only the
FEE_ROUTER_ADDRESS value to the backup's bytes, and only while every byte of the
current file still equals that recorded post-apply state; otherwise it refuses
with `restore_refused_file_changed` and leaves the file untouched.

Changing the file does NOT change the running container: compose reads env_file
only when the container is (re)created, i.e. at the next reviewed Points release.

Exit codes: 0 ok / nothing to do; 1 apply or verify failed (automatically restored
from the backup when possible); 2 refused (nothing written).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional, Sequence

CONTAINER = "inferno-points-backend"
COMPOSE_PROJECT = "inferno"
COMPOSE_SERVICE = "points-backend"
KEY = b"FEE_ROUTER_ADDRESS"
CANONICAL = "0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a"
_ASCII_WS = " \t\n\r\f\v"
_ASCII_WS_B = b" \t\n\r\f\v"
_BACKUP_TAG = ".router-backup-"
_STAMP_RE = re.compile(r"[0-9]{8}T[0-9]{6}Z")
_DIGEST_SUFFIX = ".postapply-sha256"
_DIGEST_RE = re.compile(rb"[0-9a-f]{64}\n?")
# Any line that a dotenv/compose parser could read as this key (indented, export
# prefix, spaces around "=" or ":"). Only the exact column-0 "KEY=" form is accepted.
_KEYLIKE_RE = re.compile(rb"^[ \t]*(?:export[ \t]+)?FEE_ROUTER_ADDRESS[ \t]*[=:]")

Inspector = Callable[[str], str]


class Refuse(Exception):
    """A refusal with a fixed, value-free reason code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _docker_inspect(container: str) -> str:
    result = subprocess.run(
        ["docker", "inspect", "--type", "container", container],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        raise Refuse("container_inspect_failed")
    return result.stdout


# ---------------------------------------------------------------- container


@dataclass(frozen=True)
class ContainerFacts:
    working_dir: Path
    compose_file: Path
    router_values: tuple[str, ...]


def container_facts(raw: str) -> ContainerFacts:
    try:
        data = json.loads(raw)
    except ValueError:
        raise Refuse("container_unreadable") from None
    if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
        raise Refuse("container_unreadable")
    obj = data[0]
    if obj.get("Name") != f"/{CONTAINER}":
        raise Refuse("container_name_mismatch")
    state = obj.get("State")
    if not isinstance(state, dict) or state.get("Running") is not True:
        raise Refuse("container_not_running")
    config = obj.get("Config")
    if not isinstance(config, dict):
        raise Refuse("container_unreadable")
    labels = config.get("Labels")
    env = config.get("Env")
    if not isinstance(labels, dict) or not isinstance(env, list):
        raise Refuse("container_unreadable")
    if labels.get("com.docker.compose.project") != COMPOSE_PROJECT:
        raise Refuse("compose_project_mismatch")
    if labels.get("com.docker.compose.service") != COMPOSE_SERVICE:
        raise Refuse("compose_service_mismatch")
    wd = labels.get("com.docker.compose.project.working_dir")
    files = labels.get("com.docker.compose.project.config_files")
    if not isinstance(wd, str) or not isinstance(files, str) or not wd.startswith("/"):
        raise Refuse("compose_labels_missing")
    if "," in files or files not in (f"{wd}/docker-compose.yml", f"{wd.rstrip('/')}/docker-compose.yml"):
        raise Refuse("compose_config_files_unexpected")  # overrides or another file: ambiguous
    values = []
    for item in env:
        if not isinstance(item, str):
            raise Refuse("container_unreadable")
        key, sep, value = item.partition("=")
        if sep and key == KEY.decode():
            values.append(value)
    return ContainerFacts(Path(wd), Path(files), tuple(values))


# ---------------------------------------------------------------- compose


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _scalar(text: str) -> str:
    text = text.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "'\"":
        text = text[1:-1]
    if not text or any(ch in text for ch in "$#{}[]*&!|>`") or "\t" in text:
        raise Refuse("compose_env_file_unsupported")
    return text


def compose_env_files(text: str) -> list[str]:
    """env_file entries of the points-backend service; refuses on anything unusual."""
    if "FEE_ROUTER_ADDRESS" in text:
        raise Refuse("compose_sets_router_inline")  # environment: would override env_file
    if "\t" in text:
        raise Refuse("compose_unsupported_syntax")
    lines = text.splitlines()
    tops = [i for i, ln in enumerate(lines) if ln.rstrip() == "services:"]
    if len(tops) != 1:
        raise Refuse("compose_services_ambiguous")
    svc_indent: Optional[int] = None
    starts: list[int] = []
    for i in range(tops[0] + 1, len(lines)):
        ln = lines[i]
        if not ln.strip() or ln.lstrip().startswith("#"):
            continue
        ind = _indent(ln)
        if ind == 0:
            break
        if svc_indent is None:
            svc_indent = ind
        if ind == svc_indent and ln.strip().split("#")[0].rstrip() == f"{COMPOSE_SERVICE}:":
            starts.append(i)
    if len(starts) != 1 or svc_indent is None:
        raise Refuse("compose_service_ambiguous")
    block: list[str] = []
    for ln in lines[starts[0] + 1:]:
        if ln.strip() and not ln.lstrip().startswith("#") and _indent(ln) <= svc_indent:
            break
        block.append(ln)
    body = [ln for ln in block if ln.strip() and not ln.lstrip().startswith("#")]
    if not body:
        raise Refuse("compose_service_ambiguous")
    if any("<<:" in ln or ln.strip().startswith("extends:") for ln in body):
        raise Refuse("compose_unsupported_syntax")
    key_indent = _indent(body[0])
    env_idx = [i for i, ln in enumerate(body) if _indent(ln) == key_indent and ln.strip().startswith("env_file:")]
    if len(env_idx) != 1:
        raise Refuse("compose_env_file_ambiguous")
    head = body[env_idx[0]].strip()[len("env_file:"):].strip()
    if head:
        return [_scalar(head)]
    entries: list[str] = []
    item_indent: Optional[int] = None
    for ln in body[env_idx[0] + 1:]:
        ind = _indent(ln)
        if ind <= key_indent:
            break
        s = ln.strip()
        if s.startswith("- "):
            if item_indent is None:
                item_indent = ind
            if ind != item_indent:
                raise Refuse("compose_env_file_unsupported")
            item = s[2:].strip()
            entries.append(_scalar(item[len("path:"):]) if item.startswith("path:") else _scalar(item))
        elif item_indent is not None and ind > item_indent and s.replace(" ", "") in ("required:true", "format:raw"):
            continue  # long syntax extras that do not change which file is read
        else:
            raise Refuse("compose_env_file_unsupported")
    if not entries:
        raise Refuse("compose_env_file_ambiguous")
    return entries


# ---------------------------------------------------------------- env bytes


@dataclass(frozen=True)
class KeyLine:
    start: int  # offset of the value
    end: int  # offset of the line ending (or EOF)


def find_key_line(data: bytes) -> Optional[KeyLine]:
    """Exactly one exact KEY= line -> its value span; none -> None; else refuse."""
    if b"\x00" in data:
        raise Refuse("env_unreadable")
    found: list[KeyLine] = []
    offset = 0
    # Split on LF only (bytes.splitlines would also split on a lone CR).
    for raw in data.split(b"\n"):
        content = raw[:-1] if raw.endswith(b"\r") else raw
        if b"\r" in content:
            raise Refuse("env_unreadable")  # lone CR inside a line: ambiguous line split
        if _KEYLIKE_RE.match(content):
            if not content.startswith(KEY + b"="):
                raise Refuse("env_key_ambiguous")
            found.append(KeyLine(offset + len(KEY) + 1, offset + len(content)))
        offset += len(raw) + 1
    if len(found) > 1:
        raise Refuse("env_key_duplicate")
    return found[0] if found else None


def file_value(data: bytes, line: KeyLine) -> str:
    raw = data[line.start:line.end]
    if not raw.isascii():
        raise Refuse("env_value_non_ascii")
    value = raw.decode("ascii").strip(_ASCII_WS)
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        value = value[1:-1]
    if any(ch in value for ch in "#'\"$\\` "):
        raise Refuse("env_value_ambiguous")  # comments, quoting or interpolation: do not guess
    return value


def category(value: str) -> str:
    if not value:
        return "empty"
    return "canonical" if value.lower() == CANONICAL.lower() else "noncanonical"


def replaced(data: bytes, line: KeyLine) -> bytes:
    return data[:line.start] + CANONICAL.encode("ascii") + data[line.end:]


# ---------------------------------------------------------------- files


def _check_regular(path: Path) -> os.stat_result:
    try:
        st = os.lstat(path)
    except OSError:
        raise Refuse("env_unreadable") from None
    if not stat.S_ISREG(st.st_mode):
        raise Refuse("env_not_regular_file")
    if st.st_nlink != 1:
        raise Refuse("env_hard_linked")
    return st


def _read(path: Path) -> bytes:
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError:
        raise Refuse("env_unreadable") from None
    try:
        chunks = []
        while True:
            chunk = os.read(fd, 1 << 16)
            if not chunk:
                break
            chunks.append(chunk)
        return b"".join(chunks)
    finally:
        os.close(fd)


# Linux-only xattr calls (POSIX ACLs live there); absent elsewhere, e.g. on macOS CI.
_LISTXATTR: Optional[Callable[..., list[str]]] = getattr(os, "listxattr", None)
_GETXATTR: Optional[Callable[..., bytes]] = getattr(os, "getxattr", None)
_SETXATTR: Optional[Callable[..., None]] = getattr(os, "setxattr", None)


def _xattrs(path: Path) -> dict[str, bytes]:
    if _LISTXATTR is None or _GETXATTR is None:
        return {}
    try:
        return {name: _GETXATTR(path, name, follow_symlinks=False) for name in _LISTXATTR(path, follow_symlinks=False)}
    except OSError:
        raise Refuse("env_xattr_unreadable") from None


def _write_new(path: Path, data: bytes, mode: int, uid: int, gid: int, xattrs: dict[str, bytes]) -> None:
    """Create path exclusively with data and the given metadata; fsync."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        view = memoryview(data)
        while view:
            written = os.write(fd, view)
            view = view[written:]
        st = os.fstat(fd)
        if (st.st_uid, st.st_gid) != (uid, gid):
            os.fchown(fd, uid, gid)
        os.fchmod(fd, mode)
        for name, value in xattrs.items():
            if _SETXATTR is None:
                raise OSError("xattr unsupported")
            _SETXATTR(path, name, value, follow_symlinks=False)
        os.fsync(fd)
    finally:
        os.close(fd)


def _fsync_dir(directory: Path) -> None:
    fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _same_meta(a: os.stat_result, b: os.stat_result) -> bool:
    return (stat.S_IMODE(a.st_mode), a.st_uid, a.st_gid) == (stat.S_IMODE(b.st_mode), b.st_uid, b.st_gid)


def _stamp(now: Callable[[], float]) -> str:
    return time.strftime("%Y%m%dT%H%M%SZ", time.gmtime(now()))


# ---------------------------------------------------------------- locate


def locate_env_file(facts: ContainerFacts) -> tuple[Path, bytes, KeyLine]:
    """The single env_file of the service that carries the key, verified against the container."""
    try:
        compose_text = facts.compose_file.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        raise Refuse("compose_unreadable") from None
    root = facts.compose_file.parent.resolve()
    carriers: list[tuple[Path, bytes, KeyLine]] = []
    for entry in compose_env_files(compose_text):
        candidate = Path(entry) if entry.startswith("/") else facts.compose_file.parent / entry
        if candidate.is_symlink():
            raise Refuse("env_symlink")
        resolved = candidate.resolve()
        if root not in resolved.parents:
            raise Refuse("env_outside_project")
        _check_regular(resolved)
        data = _read(resolved)
        line = find_key_line(data)
        if line is not None:
            carriers.append((resolved, data, line))
    if len(carriers) != 1:
        raise Refuse("env_key_absent" if not carriers else "env_key_in_several_files")
    if len(facts.router_values) != 1:
        raise Refuse("container_key_absent_or_duplicate")
    return carriers[0]


# ---------------------------------------------------------------- actions


@dataclass
class Deps:
    inspect: Inspector = _docker_inspect
    now: Callable[[], float] = time.time
    out: Callable[[str], None] = print


def _backup_path(env_path: Path, now: Callable[[], float]) -> Path:
    return env_path.with_name(f"{env_path.name}{_BACKUP_TAG}{_stamp(now)}")


def _backup(env_path: Path, data: bytes, st: os.stat_result, now: Callable[[], float]) -> Path:
    path = _backup_path(env_path, now)
    try:
        _write_new(path, data, 0o600, st.st_uid, st.st_gid, {})
    except FileExistsError:
        raise Refuse("backup_exists") from None
    except OSError:
        raise Refuse("backup_failed") from None
    if _read(path) != data or stat.S_IMODE(os.lstat(path).st_mode) != 0o600:
        raise Refuse("backup_verify_failed")
    return path


def _swap_in(env_path: Path, new_data: bytes, st: os.stat_result, xattrs: dict[str, bytes], tag: str,
             now: Callable[[], float]) -> None:
    """Write new_data next to env_path with env_path's metadata and atomically replace it."""
    tmp = env_path.with_name(f"{env_path.name}.{tag}-tmp-{_stamp(now)}")
    try:
        _write_new(tmp, new_data, stat.S_IMODE(st.st_mode), st.st_uid, st.st_gid, xattrs)
        if _read(tmp) != new_data:
            raise OSError("tmp verify")
        os.replace(tmp, env_path)
        _fsync_dir(env_path.parent)
    finally:
        if tmp.exists():
            tmp.unlink()


def _verify(env_path: Path, expected: bytes, st: os.stat_result, xattrs: dict[str, bytes]) -> bool:
    try:
        now_st = os.lstat(env_path)
        return _read(env_path) == expected and _same_meta(now_st, st) and _xattrs(env_path) == xattrs
    except (OSError, Refuse):
        return False


def set_router(apply: bool, deps: Deps) -> int:
    facts = container_facts(deps.inspect(CONTAINER))
    env_path, data, line = locate_env_file(facts)
    before = category(file_value(data, line))
    container_cat = category(facts.router_values[0].strip(_ASCII_WS)) if facts.router_values[0].isascii() else "unreadable"
    deps.out(f"env_file={env_path}")
    deps.out(f"before={before}")
    deps.out(f"container={container_cat}")
    if before == "canonical":
        deps.out("action=none")
        deps.out("after=canonical")
        deps.out("effective=after-next-container-recreate" if container_cat != "canonical" else "effective=running")
        return 0
    if file_value(data, line) != facts.router_values[0].strip(_ASCII_WS):
        raise Refuse("env_file_not_container_source")  # cannot prove this file feeds the container
    new_data = replaced(data, line)
    if find_key_line(new_data) is None or category(file_value(new_data, find_key_line(new_data) or line)) != "canonical":
        raise Refuse("internal_replace_check_failed")
    if not apply:
        deps.out("action=would-replace")
        deps.out("after=canonical")
        deps.out("mode=dry-run (nothing written; rerun with --apply)")
        return 0
    st = _check_regular(env_path)
    xattrs = _xattrs(env_path)
    backup = _backup(env_path, data, st, deps.now)
    deps.out(f"backup={backup}")
    if _read(env_path) != data:
        raise Refuse("env_changed_during_run")
    try:
        _swap_in(env_path, new_data, st, xattrs, "router", deps.now)
    except OSError:
        deps.out("action=failed")
        return _auto_restore(env_path, backup, data, st, xattrs, deps)
    if not _verify(env_path, new_data, st, xattrs):
        deps.out("action=verify-failed")
        return _auto_restore(env_path, backup, data, st, xattrs, deps)
    if _read(backup) != data:
        deps.out("restore_check=failed")
        return 1
    deps.out("action=replaced")
    deps.out("after=canonical")
    deps.out("restore_check=identical")
    digest = backup.with_name(backup.name + _DIGEST_SUFFIX)
    try:
        # Post-apply state for a later key-scoped restore; private, never printed.
        _write_new(digest, hashlib.sha256(new_data).hexdigest().encode("ascii") + b"\n", 0o600, st.st_uid, st.st_gid, {})
    except OSError:
        deps.out("postapply_digest=failed")
        return 1
    deps.out(f"postapply_digest={digest}")
    deps.out("effective=after-next-container-recreate")
    return 0


def _auto_restore(env_path: Path, backup: Path, original: bytes, st: os.stat_result, xattrs: dict[str, bytes],
                  deps: Deps) -> int:
    try:
        if _read(env_path) != original:
            _swap_in(env_path, _read(backup), st, xattrs, "restore", deps.now)
    except (OSError, Refuse):
        deps.out("auto_restore=failed")
        return 1
    deps.out("auto_restore=" + ("identical" if _verify(env_path, original, st, xattrs) else "failed"))
    return 1


def restore(backup_arg: str, apply: bool, deps: Deps) -> int:
    facts = container_facts(deps.inspect(CONTAINER))
    env_path, current, _line = locate_env_file(facts)
    backup = Path(backup_arg)
    prefix = f"{env_path.name}{_BACKUP_TAG}"
    if (backup.parent.resolve() != env_path.parent or not backup.name.startswith(prefix)
            or not _STAMP_RE.fullmatch(backup.name[len(prefix):])):
        raise Refuse("backup_path_unexpected")
    bst = _check_regular(backup)
    if stat.S_IMODE(bst.st_mode) != 0o600:
        raise Refuse("backup_mode_unexpected")
    data = _read(backup)
    line = find_key_line(data)
    if line is None:
        raise Refuse("backup_key_absent")
    cur_line = find_key_line(current)
    if cur_line is None:
        raise Refuse("restore_refused_file_changed")
    restore_to = category(file_value(data, line))
    if current == data:
        deps.out(f"env_file={env_path}")
        deps.out("action=none")
        return 0
    # Key-scoped: only when the whole file is still exactly the recorded post-apply state.
    digest = backup.with_name(backup.name + _DIGEST_SUFFIX)
    try:
        dst = os.lstat(digest)
    except OSError:
        raise Refuse("restore_digest_unexpected") from None
    if not stat.S_ISREG(dst.st_mode) or stat.S_IMODE(dst.st_mode) != 0o600:
        raise Refuse("restore_digest_unexpected")
    recorded = _read(digest)
    if not _DIGEST_RE.fullmatch(recorded):
        raise Refuse("restore_digest_unexpected")
    if hashlib.sha256(current).hexdigest().encode("ascii") != recorded.strip():
        raise Refuse("restore_refused_file_changed")
    data = current[:cur_line.start] + data[line.start:line.end] + current[cur_line.end:]
    if data != _read(backup):
        raise Refuse("restore_refused_file_changed")  # backup and post-apply differ outside the key
    deps.out(f"env_file={env_path}")
    deps.out(f"backup={backup}")
    deps.out(f"current={category(file_value(current, cur_line))}")
    deps.out(f"restore_to={restore_to}")
    deps.out("scope=key-only")
    if not apply:
        deps.out("action=would-restore")
        deps.out("mode=dry-run (nothing written; rerun with --apply)")
        return 0
    st = _check_regular(env_path)
    xattrs = _xattrs(env_path)
    if _read(env_path) != current:
        raise Refuse("restore_refused_file_changed")
    safety = _backup(env_path, current, st, deps.now)
    deps.out(f"pre_restore_backup={safety}")
    try:
        _swap_in(env_path, data, st, xattrs, "restore", deps.now)
    except OSError:
        deps.out("action=failed")
        return 1
    ok = _verify(env_path, data, st, xattrs)
    deps.out("action=restored" if ok else "action=verify-failed")
    deps.out("restore_check=" + ("identical" if ok else "failed"))
    return 0 if ok else 1


USAGE = "usage: points-env-set-router.py [--apply] | --restore <backup> [--apply]"


def main(argv: Sequence[str], deps: Optional[Deps] = None) -> int:
    deps = deps or Deps()
    args = list(argv[1:])
    apply = "--apply" in args
    if apply:
        args.remove("--apply")
    backup: Optional[str] = None
    if args[:1] == ["--restore"] and len(args) == 2:
        backup = args[1]
        args = []
    if args or (apply and argv[1:].count("--apply") != 1):
        print(USAGE, file=sys.stderr)
        return 2
    try:
        return restore(backup, apply, deps) if backup is not None else set_router(apply, deps)
    except Refuse as exc:
        deps.out(f"refuse={exc.code}")
        return 2
    except Exception:  # noqa: BLE001 - every unexpected failure maps to one constant line
        deps.out("refuse=unexpected_error")
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
