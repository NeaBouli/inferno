#!/usr/bin/env python3
"""Data-only negative controls for the owned artifact boundary."""
from __future__ import annotations

import argparse
import gzip
import io
import json
from pathlib import Path
import tarfile
from typing import ClassVar
import unittest

import repack

UPSTREAM: Path


class ArtifactBoundaryTests(unittest.TestCase):
    raw: ClassVar[bytes]
    original: ClassVar[dict[str, repack.Member]]
    owned: ClassVar[dict[str, repack.Member]]

    @classmethod
    def setUpClass(cls) -> None:
        cls.raw = UPSTREAM.read_bytes()
        cls.original = repack.verify_upstream(cls.raw)
        cls.owned = dict(cls.original)
        package = cls.original[repack.PACKAGE]
        cls.owned[repack.PACKAGE] = repack.Member(
            repack.owned_metadata(package.data), package.mode
        )

    def changed_payload(self, suffix: str) -> dict[str, repack.Member]:
        result = dict(self.owned)
        name = next(path for path in result if path.endswith(suffix))
        result[name] = repack.Member(result[name].data + b"\nchanged", result[name].mode)
        return result

    def test_complete_expected_payload(self) -> None:
        hashes = repack.qualify(self.original, self.owned)
        self.assertEqual(len(hashes), 971)
        self.assertEqual(sum(record["unchanged"] for record in hashes.values()), 970)

    def test_rejects_upstream_integrity_change(self) -> None:
        changed = self.raw[:-1] + bytes([self.raw[-1] ^ 1])
        with self.assertRaisesRegex(ValueError, "SHA512"):
            repack.verify_upstream(changed)

    def test_rejects_runtime_javascript_change(self) -> None:
        with self.assertRaisesRegex(ValueError, "payload changed"):
            repack.qualify(self.original, self.changed_payload(".js"))

    def test_rejects_css_change(self) -> None:
        with self.assertRaisesRegex(ValueError, "payload changed"):
            repack.qualify(self.original, self.changed_payload(".css"))

    def test_rejects_type_declaration_change(self) -> None:
        with self.assertRaisesRegex(ValueError, "payload changed"):
            repack.qualify(self.original, self.changed_payload(".d.ts"))

    def test_rejects_missing_payload(self) -> None:
        result = dict(self.owned)
        del result[repack.LICENSE]
        with self.assertRaisesRegex(ValueError, "member set"):
            repack.qualify(self.original, result)

    def test_rejects_extra_payload(self) -> None:
        result = {**self.owned, "package/extra.js": repack.Member(b"", 0o644)}
        with self.assertRaisesRegex(ValueError, "member set"):
            repack.qualify(self.original, result)

    def changed_metadata(self, field: str) -> dict[str, repack.Member]:
        result = dict(self.owned)
        metadata = json.loads(result[repack.PACKAGE].data)
        metadata[field] = {}
        result[repack.PACKAGE] = repack.Member(
            repack.encoded_json(metadata), result[repack.PACKAGE].mode
        )
        return result

    def test_rejects_peer_contract_change(self) -> None:
        with self.assertRaisesRegex(ValueError, "metadata"):
            repack.qualify(self.original, self.changed_metadata("peerDependencies"))

    def test_rejects_export_change(self) -> None:
        with self.assertRaisesRegex(ValueError, "metadata"):
            repack.qualify(self.original, self.changed_metadata("exports"))

    def test_rejects_license_change(self) -> None:
        result = dict(self.owned)
        result[repack.LICENSE] = repack.Member(b"changed", result[repack.LICENSE].mode)
        with self.assertRaisesRegex(ValueError, "payload changed"):
            repack.qualify(self.original, result)

    def test_rejects_permission_change(self) -> None:
        result = dict(self.owned)
        result[repack.LICENSE] = repack.Member(result[repack.LICENSE].data, 0o755)
        with self.assertRaisesRegex(ValueError, "permissions"):
            repack.qualify(self.original, result)

    def test_rejects_wrong_upstream_package(self) -> None:
        changed = self.original[repack.PACKAGE].data.replace(
            b'"name": "@rainbow-me/rainbowkit"', b'"name": "another-package"'
        )
        with self.assertRaisesRegex(ValueError, "name mismatch"):
            repack.owned_metadata(changed)

    def test_rejects_traversal(self) -> None:
        data = repack.write_archive({"package/../escape": repack.Member(b"", 0o644)})
        with self.assertRaisesRegex(ValueError, "unsafe"):
            repack.read_archive(data)

    def test_rejects_symbolic_link(self) -> None:
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w") as archive:
            entry = tarfile.TarInfo("package/link")
            entry.type = tarfile.SYMTYPE
            entry.linkname = "/outside"
            archive.addfile(entry)
        with self.assertRaisesRegex(ValueError, "nonregular"):
            repack.read_archive(gzip.compress(buffer.getvalue(), mtime=0))

    def test_rejects_duplicate_path(self) -> None:
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w") as archive:
            for _ in range(2):
                entry = tarfile.TarInfo("package/duplicate")
                archive.addfile(entry, io.BytesIO(b""))
        with self.assertRaisesRegex(ValueError, "duplicate"):
            repack.read_archive(gzip.compress(buffer.getvalue(), mtime=0))

    def test_rejects_oversized_member(self) -> None:
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w") as archive:
            entry = tarfile.TarInfo("package/large")
            entry.size = repack.MAX_MEMBER + 1
            archive.addfile(entry, io.BytesIO(b"x" * entry.size))
        with self.assertRaisesRegex(ValueError, "member size"):
            repack.read_archive(gzip.compress(buffer.getvalue(), mtime=0))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", required=True, type=Path)
    args = parser.parse_args()
    UPSTREAM = args.upstream
    unittest.main(argv=[__file__], verbosity=2)
