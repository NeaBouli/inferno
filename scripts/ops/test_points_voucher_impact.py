#!/usr/bin/env python3
"""Dummy-DB tests for points-voucher-impact.py (fake docker, temporary SQLite; no production data)."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import sqlite3
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from typing import Any, Optional, Sequence

_PATH = Path(__file__).with_name("points-voucher-impact.py")
_SPEC = importlib.util.spec_from_file_location("points_voucher_impact", _PATH)
assert _SPEC and _SPEC.loader
mod = importlib.util.module_from_spec(_SPEC)
sys.modules["points_voucher_impact"] = mod
_SPEC.loader.exec_module(mod)

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "apps/points-backend/prisma/migrations/20260225070841_init/migration.sql"
DAY = 86_400_000
PAUSE = mod.PAUSE_MS
SECRET_WALLETS = [f"0x{i:040x}" for i in range(1, 9)]
SECRET_NONCES = [f"9{i:030d}" for i in range(1, 30)]


def snapshot(directory: Path) -> dict[str, tuple[str, int]]:
    """File digests and mtimes only, so a failing assertion never prints fixture content."""
    return {p.name: (hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_mtime_ns) for p in directory.iterdir()}


class Db:
    def __init__(self, wal: bool = False) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name) / "data"
        self.dir.mkdir()
        self.path = self.dir / "points.db"
        conn = sqlite3.connect(self.path, isolation_level=None)
        if wal:
            conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(MIGRATION.read_text())
        conn.execute("BEGIN")
        for i, w in enumerate(SECRET_WALLETS):
            conn.execute('INSERT INTO "Wallet"(id,address,pointsTotal,createdAt,updatedAt) VALUES (?,?,0,?,?)',
                         (f"w{i}", w, PAUSE - 30 * DAY, PAUSE - 30 * DAY))
        self.conn = conn
        self.n = 0

    def voucher(self, wallet: int, created: Any, expires: Any, used: int = 0, debit: bool = True) -> None:
        nonce = SECRET_NONCES[self.n]
        self.conn.execute(
            'INSERT INTO "Voucher"(id,walletId,nonce,discountBps,maxUses,usedCount,expiresAt,used,createdAt) '
            'VALUES (?,?,?,5,1,?,?,?,?)', (f"v{self.n}", f"w{wallet}", nonce, used, expires, used, created))
        if debit:
            self.conn.execute(
                'INSERT INTO "PointEvent"(id,walletId,type,points,proofRef,createdAt) VALUES (?,?,?,?,?,?)',
                (f"p{self.n}", f"w{wallet}", "voucher_redemption", -100, nonce, created))
        self.n += 1

    def commit(self) -> None:
        self.conn.execute("COMMIT")
        self.conn.close()

    def close(self) -> None:
        self.tmp.cleanup()


def fake_run(source: str, name: str = "/inferno-points-backend", running: bool = True,
             mounts: Optional[list[dict[str, Any]]] = None, tz_rows: Optional[list[str]] = None) -> Any:
    calls: list[list[str]] = []

    def run(cmd: Sequence[str]) -> str:
        cmd = list(cmd)
        calls.append(cmd)
        assert cmd[:4] == ["docker", "inspect", "--type", "container"], cmd
        fmt = cmd[cmd.index("--format") + 1]
        if fmt == mod._TZ_FMT:
            return "".join(json.dumps(r) + "\n" for r in (tz_rows or [])) + "\n"
        assert "Env" not in fmt and "Config" not in fmt, "must never request the container environment"
        m = mounts if mounts is not None else [{"Type": "volume", "Source": source, "Destination": "/data"}]
        return "\n".join(json.dumps(x) for x in (name, running, m)) + "\n"

    run.calls = calls  # type: ignore[attr-defined]
    return run


class ImpactTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = Db()

    def tearDown(self) -> None:
        self.db.close()

    def run_main(self, run: Any = None, localtime: Optional[bool] = False) -> tuple[int, dict[str, str], list[str]]:
        lines: list[str] = []
        err = io.StringIO()
        with redirect_stderr(err):
            code = mod.main(["x"], run=run or fake_run(str(self.db.dir)), out=lines.append,
                            exists=lambda c, p: localtime if p == "/etc/localtime" else False)
        lines.append("stderr=" + err.getvalue().replace("\n", " "))
        kv = {}
        for line in lines:
            if line.startswith("week="):
                continue
            k, _, v = line.partition("=")
            kv[k] = v
        return code, kv, lines

    def assertNoLeak(self, lines: list[str]) -> None:
        text = "\n".join(lines)
        for s in SECRET_WALLETS + SECRET_NONCES:
            self.assertNotIn(s, text)
        for i in range(len(SECRET_WALLETS)):
            self.assertNotIn(f"=w{i}\n", text + "\n")

    def test_aggregates_mixed_timestamp_forms(self) -> None:
        d = self.db
        d.voucher(0, PAUSE - 20 * DAY, PAUSE - 13 * DAY)             # expired at as_of, int ms
        d.voucher(0, PAUSE - 2 * DAY, PAUSE + 5 * DAY, used=1)       # unexpired, DB-used
        d.voucher(1, PAUSE - 1 * DAY, PAUSE)                         # expires exactly at as_of -> still valid
        d.voucher(2, "2026-10-07 10:00:00", "2026-10-14 10:00:00")   # TEXT form, unexpired
        d.voucher(3, PAUSE - 3 * DAY, PAUSE + 3_600_000, debit=False)  # no debit; expires 1 h after as_of
        d.voucher(4, PAUSE, PAUSE + 7 * DAY)                         # exactly at pause: out of window
        d.commit()
        code, kv, lines = self.run_main()
        self.assertEqual(code, 0)
        self.assertEqual(kv["q1_vouchers_issued"], "5")
        self.assertEqual(kv["q2_wallets_affected"], "4")
        self.assertEqual(kv["q3_points_debited"], "400")
        self.assertEqual(kv["q3_debit_events"], "4")
        self.assertEqual(kv["q3_debit_events_linked_to_voucher"], "4")
        self.assertEqual(kv["q4_vouchers_expired"], "1")
        self.assertEqual(kv["q4_vouchers_unexpired"], "4")
        self.assertEqual(kv["q4_vouchers_expiry_unknown"], "0")
        self.assertEqual(kv["q1_vouchers_created_unknown"], "0")
        self.assertEqual(kv["q5_db_marked_used"], "1")
        self.assertEqual(kv["q5_db_usedcount_gt0"], "1")
        self.assertEqual(kv["q7_wallet_24h_windows_consumed"], "5")
        self.assertEqual(kv["vouchers_at_or_after_pause"], "1")
        self.assertEqual(kv["mainnet_start"], "unknown")
        self.assertEqual(kv["mainnet_cohort"], "unknown")
        self.assertEqual(kv["voucher_timestamp_unparseable"], "0")
        self.assertEqual(kv["voucher_createdAt_types"], "integer:5,text:1")
        self.assertEqual(kv["exit"], "0")
        self.assertEqual(kv["weekly"], "withheld_small_cells")
        self.assertFalse([line for line in lines if line.startswith("week=")])
        self.assertNoLeak(lines)

    def test_weekly_table_rejects_any_small_cell(self) -> None:
        # adversarial: two hidden 1s next to a visible 10 with total 12 must not be publishable
        self.assertIsNone(mod.weekly_table([[1, 1, 0], [1, 1, 0], [10, 6, 5]]))
        self.assertIsNone(mod.weekly_table([[12, 9, 3]]))
        self.assertEqual(mod.weekly_table([[12, 9, 0], [20, 15, 7]]), [["12", "9", "0"], ["20", "15", "7"]])

    def test_weekly_table_published_when_all_cells_large(self) -> None:
        for i in range(10):
            self.db.voucher(i % 8, PAUSE - 30 * DAY + i * 60_000, PAUSE - 20 * DAY)
        self.db.commit()
        _, kv, lines = self.run_main()
        weeks = [line for line in lines if line.startswith("week=")]
        self.assertEqual(len(weeks), 1)
        self.assertIn("vouchers=10 wallets=8 expired=10", weeks[0])
        self.assertNotIn("weekly", kv)
        self.assertNoLeak(lines)

    def test_q7_global_cap_days(self) -> None:
        base = PAUSE - 10 * DAY - (PAUSE % DAY)  # a UTC midnight well inside the window
        for i in range(mod.DAILY_ISSUANCE_CAP):
            self.db.voucher(i % 8, base + i * 1000, base + 7 * DAY, debit=False) if i < len(SECRET_NONCES) else None
        self.db.commit()
        # the fixture holds fewer nonces than the cap: assert the boundary through a lowered cap instead
        old = mod.DAILY_ISSUANCE_CAP
        try:
            mod.DAILY_ISSUANCE_CAP = len(SECRET_NONCES)
            _, kv, _ = self.run_main()
            self.assertEqual(kv["q7_days_global_cap_reached"], "1")
            self.assertEqual(kv["q7_container_day"], "utc")
            self.assertEqual(kv["q7_issuance_days_utc"], "1")
            mod.DAILY_ISSUANCE_CAP = len(SECRET_NONCES) + 1
            _, kv, _ = self.run_main()
            self.assertEqual(kv["q7_days_global_cap_reached"], "0")
            for rows, want in ((["TZ=UTC"], "1"), (["TZ=Europe/Athens"], "unknown"), (["TZ=CET-1"], "unknown"),
                               (["TZ=UTC", "TZ=UTC"], "unknown")):
                mod.DAILY_ISSUANCE_CAP = len(SECRET_NONCES)
                _, kv, _ = self.run_main(fake_run(str(self.db.dir), tz_rows=rows))
                self.assertEqual(kv["q7_days_global_cap_reached"], want, rows)
            # TZ unset: UTC only if /etc/localtime is absent in the merged filesystem
            for localtime, want in ((False, "1"), (True, "unknown"), (None, "unknown")):
                _, kv, _ = self.run_main(localtime=localtime)
                self.assertEqual(kv["q7_days_global_cap_reached"], want, localtime)
            _, kv, _ = self.run_main(fake_run(str(self.db.dir), tz_rows=["TZ=UTC"]), localtime=True)
            self.assertEqual(kv["q7_days_global_cap_reached"], "1")
        finally:
            mod.DAILY_ISSUANCE_CAP = old

    def test_mainnet_start_bounds_the_cohort(self) -> None:
        self.db.voucher(0, PAUSE - 9 * DAY, PAUSE - 2 * DAY)
        self.db.voucher(1, PAUSE - 3 * DAY, PAUSE + 4 * DAY)
        self.db.commit()
        old = mod.MAINNET_START_MS
        try:
            mod.MAINNET_START_MS = PAUSE - 5 * DAY
            _, kv, lines = self.run_main()
        finally:
            mod.MAINNET_START_MS = old
        self.assertEqual(kv["mainnet_cohort"], "bounded")
        self.assertEqual(kv["q1_vouchers_issued"], "1")
        self.assertEqual(kv["vouchers_before_mainnet_start"], "1")
        self.assertNoLeak(lines)

    def test_no_files_written_rollback_journal(self) -> None:
        self.db.voucher(0, PAUSE - DAY, PAUSE + DAY)
        self.db.commit()
        snap = snapshot(self.db.dir)
        code, _, _ = self.run_main()
        self.assertEqual(code, 0)
        self.assertEqual(snapshot(self.db.dir), snap)

    def test_wal_database_is_refused_without_touching_files(self) -> None:
        self.db.close()
        self.db = Db(wal=True)
        self.db.voucher(0, PAUSE - DAY, PAUSE + DAY)
        self.db.conn.execute("COMMIT")  # writer stays open: -wal/-shm exist like on a live host
        try:
            names = {p.name for p in self.db.dir.iterdir()}
            self.assertIn("points.db-wal", names)
            db_digest = snapshot(self.db.dir)["points.db"]
            code, kv, _ = self.run_main()
            self.assertEqual((code, kv["refuse"]), (2, "journal_mode_wal_unsupported"))
            self.assertEqual({p.name for p in self.db.dir.iterdir()}, names)
            self.assertEqual(snapshot(self.db.dir)["points.db"], db_digest)
        finally:
            self.db.conn.close()

    def test_missing_database_is_not_created(self) -> None:
        missing = self.db.dir / "absent.db"
        with self.assertRaises(mod.Refuse):
            mod.open_readonly(missing).execute("SELECT 1 FROM sqlite_master").fetchall()
        self.assertFalse(missing.exists())

    def test_unparseable_expiry_is_not_counted_as_unexpired(self) -> None:
        self.db.voucher(0, PAUSE - 2 * DAY, "not-a-date")
        self.db.voucher(1, PAUSE - 2 * DAY, PAUSE + DAY)
        self.db.commit()
        _, kv, lines = self.run_main()
        self.assertEqual(kv["q1_vouchers_issued"], "2")
        self.assertEqual(kv["q4_vouchers_expired"], "0")
        self.assertEqual(kv["q4_vouchers_unexpired"], "1")
        self.assertEqual(kv["q4_vouchers_expiry_unknown"], "1")
        self.assertEqual(kv["voucher_timestamp_unparseable"], "1")
        self.assertNoLeak(lines)

    def test_single_small_week_withholds_weekly_table(self) -> None:
        self.db.voucher(0, PAUSE - 2 * DAY, PAUSE + DAY)
        self.db.commit()
        _, kv, lines = self.run_main()
        self.assertEqual(kv["weekly"], "withheld_small_cells")
        self.assertFalse([line for line in lines if line.startswith("week=")])

    def test_unparseable_timestamps_are_counted_not_guessed(self) -> None:
        self.db.voucher(0, "not-a-date", PAUSE + DAY)
        self.db.commit()
        code, kv, lines = self.run_main()
        self.assertEqual(code, 0)
        self.assertEqual(kv["voucher_timestamp_unparseable"], "1")
        self.assertEqual(kv["q1_vouchers_issued"], "0")
        self.assertEqual(kv["q1_vouchers_created_unknown"], "1")
        self.assertNoLeak(lines)

    def test_database_is_opened_read_only(self) -> None:
        self.db.voucher(0, PAUSE - DAY, PAUSE + DAY)
        self.db.commit()
        before = self.db.path.read_bytes()
        conn = mod.open_readonly(self.db.path)
        with self.assertRaises(sqlite3.Error):
            conn.execute('DELETE FROM "Voucher"')
        conn.close()
        self.run_main()
        self.assertEqual(self.db.path.read_bytes(), before)

    def test_refusals(self) -> None:
        self.db.commit()
        cases = [
            (fake_run(str(self.db.dir), name="/other"), "container_unexpected"),
            (fake_run(str(self.db.dir), running=False), "container_unexpected"),
            (fake_run(str(self.db.dir), mounts=[]), "data_mount_ambiguous"),
            (fake_run(str(self.db.dir), mounts=[{"Source": str(self.db.dir), "Destination": "/data"}] * 2),
             "data_mount_ambiguous"),
            (fake_run("/nonexistent-dir"), "data_dir_unexpected"),
        ]
        for run, code in cases:
            with self.subTest(code=code):
                rc, kv, lines = self.run_main(run)
                self.assertEqual(rc, 2)
                self.assertEqual(kv["refuse"], code)

    def test_database_must_be_unique(self) -> None:
        self.db.commit()
        (self.db.dir / "other.db").write_bytes(b"")
        rc, kv, _ = self.run_main()
        self.assertEqual((rc, kv["refuse"]), (2, "database_ambiguous"))

    def test_schema_mismatch_refuses(self) -> None:
        self.db.conn.execute('ALTER TABLE "Voucher" ADD COLUMN "walletAddress" TEXT')
        self.db.commit()
        rc, kv, _ = self.run_main()
        self.assertEqual((rc, kv["refuse"]), (2, "schema_mismatch"))

    def test_column_type_mismatch_refuses(self) -> None:
        self.db.conn.execute('DROP TABLE "PointEvent"')
        self.db.conn.execute('CREATE TABLE "PointEvent" (id TEXT, walletId TEXT, type TEXT, points TEXT, '
                             'proofRef TEXT, createdAt DATETIME)')
        self.db.commit()
        rc, kv, _ = self.run_main()
        self.assertEqual((rc, kv["refuse"]), (2, "schema_mismatch"))

    def test_usage(self) -> None:
        lines: list[str] = []
        self.assertEqual(mod.main(["x", "--anything"], out=lines.append), 2)


if __name__ == "__main__":
    unittest.main()
