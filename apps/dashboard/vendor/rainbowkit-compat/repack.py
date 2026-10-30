#!/usr/bin/env python3
"""Deterministically repackage pinned data; never extract or execute package code."""
from __future__ import annotations

import argparse
import base64
import copy
from dataclasses import dataclass
import gzip
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
from typing import Any
import zlib

UPSTREAM_NAME = "@rainbow-me/rainbowkit"
UPSTREAM_VERSION = "2.2.11"
UPSTREAM_URL = "https://registry.npmjs.org/@rainbow-me/rainbowkit/-/rainbowkit-2.2.11.tgz"
UPSTREAM_SRI = (
    "sha512-FHPsRHMBpuHHhuyKktAR13O9agmsUUunDnVEP4hG1dSZ2JojXLUSWyLG28VbGI"
    "JakHYylkNguiLFnqM/BM8ERA=="
)
UPSTREAM_SHA1 = "717265fcae250d3a6dfdf59177a1c9b828e038d7"
OWNED_NAME = "@ifr/rainbowkit-compat"
OWNED_VERSION = "2.2.11-ifr.1"
ARTIFACT_NAME = "ifr-rainbowkit-compat-2.2.11-ifr.1.tgz"
PACKAGE = "package/package.json"
LICENSE = "package/LICENSE"
MAX_COMPRESSED = 8 * 1024 * 1024
MAX_MEMBER = 1024 * 1024
MAX_TOTAL = 16 * 1024 * 1024
EXPECTED_FILES = 971


@dataclass(frozen=True)
class Member:
    data: bytes
    mode: int


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def integrity(data: bytes) -> str:
    return "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode("ascii")


def encoded_json(value: Any) -> bytes:
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def read_archive(data: bytes) -> dict[str, Member]:
    """Bounded regular-file reader, without filesystem extraction."""
    require(len(data) <= MAX_COMPRESSED, "compressed archive exceeds limit")
    result: dict[str, Member] = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for entry in archive:
            name = entry.name
            require(len(result) < 1200, "too many archive entries")
            require(
                name.startswith("package/")
                and "\\" not in name
                and len(name.encode()) <= 512
                and not any(ord(char) < 32 for char in name)
                and all(part not in ("", ".", "..") for part in name.split("/")),
                "unsafe archive path",
            )
            require(name not in result, "duplicate archive path")
            require(entry.isfile(), "nonregular archive entry")
            require(0 <= entry.size <= MAX_MEMBER, "member size exceeds limit")
            require(entry.mode & ~0o777 == 0, "special file permissions")
            total += entry.size
            require(total <= MAX_TOTAL, "total payload exceeds limit")
            stream = archive.extractfile(entry)
            require(stream is not None, "missing member data")
            assert stream is not None
            body = stream.read(MAX_MEMBER + 1)
            require(len(body) == entry.size, "member size mismatch")
            result[name] = Member(body, entry.mode)
    require(len(result) == EXPECTED_FILES, "unexpected pinned package file count")
    return result


def verify_upstream(data: bytes) -> dict[str, Member]:
    require(integrity(data) == UPSTREAM_SRI, "upstream SHA512 mismatch")
    require(hashlib.sha1(data).hexdigest() == UPSTREAM_SHA1, "upstream SHA1 mismatch")
    return read_archive(data)


def owned_metadata(original: bytes) -> bytes:
    metadata = json.loads(original)
    require(metadata["name"] == UPSTREAM_NAME, "upstream name mismatch")
    require(metadata["version"] == UPSTREAM_VERSION, "upstream version mismatch")
    require(
        metadata["dependencies"]["@vanilla-extract/css"] == "1.20.1",
        "upstream CSS dependency mismatch",
    )
    result = original
    replacements = (
        (b'"name": "@rainbow-me/rainbowkit"', b'"name": "@ifr/rainbowkit-compat"'),
        (b'"version": "2.2.11"', b'"version": "2.2.11-ifr.1"'),
        (b'"@vanilla-extract/css": "1.20.1"', b'"@vanilla-extract/css": "1.21.3"'),
    )
    for before, after in replacements:
        require(result.count(before) == 1, "metadata token is not unique")
        result = result.replace(before, after, 1)
    expected = copy.deepcopy(metadata)
    expected["name"] = OWNED_NAME
    expected["version"] = OWNED_VERSION
    expected["dependencies"]["@vanilla-extract/css"] = "1.21.3"
    require(json.loads(result) == expected, "unapproved metadata difference")
    # Every other byte in package.json, including exports/peers, is unchanged.
    return result


def write_archive(members: dict[str, Member]) -> bytes:
    output = io.BytesIO()
    with gzip.GzipFile(
        filename="", mode="wb", compresslevel=9, fileobj=output, mtime=0
    ) as compressed:
        with tarfile.open(
            fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT
        ) as archive:
            for name in sorted(members):
                member = members[name]
                header = tarfile.TarInfo(name)
                header.size, header.mode = len(member.data), member.mode
                header.uid = header.gid = header.mtime = 0
                header.uname = header.gname = ""
                archive.addfile(header, io.BytesIO(member.data))
    return output.getvalue()


def qualify(
    original: dict[str, Member], owned: dict[str, Member]
) -> dict[str, dict[str, Any]]:
    require(original.keys() == owned.keys(), "payload member set changed")
    require(
        owned[PACKAGE].data == owned_metadata(original[PACKAGE].data),
        "package metadata differs from approved token replacement",
    )
    hashes: dict[str, dict[str, Any]] = {}
    for name in sorted(original):
        before, after = original[name], owned[name]
        require(before.mode == after.mode, "payload permissions changed")
        if name != PACKAGE:
            require(before.data == after.data, "non-metadata payload changed")
        hashes[name] = {
            "bytes": len(after.data), "mode": oct(after.mode),
            "upstream_sha256": sha256(before.data),
            "owned_sha256": sha256(after.data),
            "unchanged": before.data == after.data,
        }
    metadata = json.loads(owned[PACKAGE].data)
    require(metadata["license"] == "MIT", "license declaration changed")
    require(
        b"Permission is hereby granted" in owned[LICENSE].data,
        "license text missing",
    )
    require(
        not {"preinstall", "install", "postinstall", "prepare", "prepack"}
        .intersection(metadata.get("scripts", {})),
        "unexpected automatic package lifecycle script",
    )
    return hashes


def expected_outputs(upstream: bytes) -> dict[str, bytes]:
    original = verify_upstream(upstream)
    owned = dict(original)
    owned[PACKAGE] = Member(owned_metadata(original[PACKAGE].data), original[PACKAGE].mode)
    artifact = write_archive(owned)
    hashes = qualify(original, read_archive(artifact))
    metadata = json.loads(original[PACKAGE].data)
    manifest = {
        "schemaVersion": 1,
        "status": "OWNED_COMPATIBILITY_CANDIDATE_NOT_RELEASED",
        "upstream": {
            "name": UPSTREAM_NAME, "version": UPSTREAM_VERSION,
            "tarball": UPSTREAM_URL, "integrity": UPSTREAM_SRI,
            "sha1": UPSTREAM_SHA1, "sha256": sha256(upstream),
            "license": "MIT", "license_sha256": sha256(original[LICENSE].data),
            "publisher_signature_verified": False,
        },
        "owned": {
            "name": OWNED_NAME, "version": OWNED_VERSION,
            "artifact": ARTIFACT_NAME, "sha256": sha256(artifact),
            "integrity": integrity(artifact), "registry_publication": False,
            "upstream_supported_release": False,
        },
        "allowed_metadata_delta": {
            "name": [UPSTREAM_NAME, OWNED_NAME],
            "version": [UPSTREAM_VERSION, OWNED_VERSION],
            "dependencies.@vanilla-extract/css": ["1.20.1", "1.21.3"],
        },
        "preserved_metadata": {
            key: metadata[key] for key in
            ("exports", "main", "types", "type", "peerDependencies", "scripts")
        },
        "invariants": {
            "files": len(hashes), "identical_non_metadata_files": len(hashes) - 1,
            "all_modes_and_other_package_json_bytes_preserved": True,
            "runtime_code_executed": False,
            "dependency_or_import_resolution_verified": False,
            "dashboard_compatibility_verified": False,
        },
        "recipe": {
            "file": "repack.py", "sha256": sha256(Path(__file__).read_bytes()),
            "format": "sorted PAX tar, zero uid/gid/mtime, empty owner names, gzip9/mtime0",
            "python": sys.version.split()[0], "zlib_runtime": zlib.ZLIB_RUNTIME_VERSION,
        },
    }
    return {
        ARTIFACT_NAME: artifact, "provenance.json": encoded_json(manifest),
        "payload-hashes.json": encoded_json(hashes),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("build", "verify"))
    parser.add_argument("--upstream", required=True, type=Path)
    parser.add_argument("--directory", required=True, type=Path)
    args = parser.parse_args()
    require(args.upstream.stat().st_size <= MAX_COMPRESSED, "input exceeds limit")
    outputs = expected_outputs(args.upstream.read_bytes())
    if args.operation == "build":
        args.directory.mkdir(parents=True, exist_ok=True)
        for name, data in outputs.items():
            with (args.directory / name).open("xb") as destination:
                destination.write(data)
    else:
        for name, expected in outputs.items():
            require(
                (args.directory / name).read_bytes() == expected,
                "artifact/provenance/payload record is not canonical",
            )
    print(json.dumps({
        "result": "PASS", "operation": args.operation,
        "files": EXPECTED_FILES, "identical_non_metadata_files": EXPECTED_FILES - 1,
        "artifact_sha256": sha256(outputs[ARTIFACT_NAME]),
        "application_or_dependency_acceptance": False,
    }))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, tarfile.TarError, KeyError) as error:
        print(f"repack: {error}", file=sys.stderr)
        raise SystemExit(1) from error
