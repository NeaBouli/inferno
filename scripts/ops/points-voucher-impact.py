#!/usr/bin/env python3
"""Owner-only, read-only aggregate impact of the Points voucher incident (2026-10-06).

Run by the owner on the production host (needs Docker access to read the container's
mounts). It opens the Points SQLite database READ-ONLY and prints aggregate counts only:
no wallet address, wallet id, voucher nonce, signature, proof reference or raw row is
ever printed, written or logged.

    points-voucher-impact.py            (no arguments)

Data path (apps/points-backend at eb28c1ba, unchanged since Prisma 7 / bc4b6fd3):
- POST /voucher/issue debits `threshold` points in one transaction: Wallet.pointsTotal
  decrement, PointEvent(type="voucher_redemption", points=-threshold, proofRef=nonce),
  Voucher(nonce, discountBps, maxUses=1, expiresAt=now+expiryDays, used=false).
- Timestamps: the Prisma 7 adapter writes DATETIME columns as unix epoch milliseconds
  (db.ts timestampFormat "unixepoch-ms"); migration defaults (CURRENT_TIMESTAMP) would be
  TEXT. Both are normalised; anything else is counted as unparseable.
- Voucher.used / usedCount are backend bookkeeping, NOT on-chain redemption.
- Read path: SQLite `mode=ro` URI, `PRAGMA query_only=ON`, `temp_store=MEMORY`; rollback-journal
  databases only (WAL refused, since WAL readers write the -shm index). No copy, no checkpoint.

Window: vouchers issued before the issuance pause (PAUSE_MS, 2026-10-08T21:55:00Z) were
signed by a release using the wrong EIP-712 primary type ("Voucher" instead of
"DiscountVoucher") and cannot validate at the canonical FeeRouterV1. Rows at or after
PAUSE_MS are reported separately (expected 0 while paused).

Small cohorts: the weekly table is printed only when every cell is 0 or >= SUPPRESS_BELOW; otherwise it is withheld.
Expiry: a voucher is valid while expiresAt >= as_of (FeeRouterV1: block.timestamp <= expiry).

Exit codes: 0 report printed; 2 refused (container/mount/database/schema not exactly as
expected); nothing is ever written.
"""

from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import Callable, Optional, Sequence

CONTAINER = "inferno-points-backend"
DATA_DEST = "/data"
PAUSE_MS = 1791496500000  # 2026-10-08T21:55:00Z, issuance paused at the edge (step 2b, Bridge log)
# Fixed classification instant for "expired" (no implicit wall clock): the pause time.
AS_OF_MS = PAUSE_MS
# Start of mainnet (CHAIN_ID 1) issuance in production. No evidence-backed UTC cutoff exists in the
# release records, so it stays None and the mainnet cohort is reported as unknown (fail closed).
MAINNET_START_MS: "int | None" = None
DAILY_ISSUANCE_CAP = 100  # apps/points-backend/src/config/points.ts voucher.dailyIssuanceCap
SUPPRESS_BELOW = 5
# Declared column types from prisma/migrations/20260225070841_init/migration.sql (the only migration).
EXPECTED_COLUMNS = {
    "Voucher": {"id": "TEXT", "walletId": "TEXT", "nonce": "TEXT", "discountBps": "INTEGER", "maxUses": "INTEGER",
                "usedCount": "INTEGER", "expiresAt": "DATETIME", "used": "BOOLEAN", "createdAt": "DATETIME"},
    "PointEvent": {"id": "TEXT", "walletId": "TEXT", "type": "TEXT", "points": "INTEGER", "proofRef": "TEXT",
                   "createdAt": "DATETIME"},
}

Runner = Callable[[Sequence[str]], str]
# (container, absolute path) -> whether the path exists in the container's merged filesystem
# (image layers + writable layer + mounts); content is discarded, never read or printed.
Exists = Callable[[str, str], Optional[bool]]
Out = Callable[[str], None]


def _exists(container: str, path: str) -> Optional[bool]:
    """`docker cp <container>:<path> -` with stdout discarded; None on any other error or timeout."""
    try:
        result = subprocess.run(["docker", "cp", f"{container}:{path}", "-"], stdout=subprocess.DEVNULL,
                                stderr=subprocess.PIPE, timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode == 0:
        return True
    err = result.stderr[:4096]
    if b"Could not find the file" in err or b"No such file or directory" in err:
        return False
    return None


class Refuse(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _run(cmd: Sequence[str]) -> str:
    result = subprocess.run(list(cmd), capture_output=True, text=True, timeout=30, check=False)
    if result.returncode != 0:
        raise Refuse("docker_failed")
    return result.stdout


def data_dir(run: Runner) -> Path:
    """Host directory mounted at /data in the named, running container (targeted fields only)."""
    fmt = "{{json .Name}}\n{{json .State.Running}}\n{{json .Mounts}}"
    parts = run(["docker", "inspect", "--type", "container", "--format", fmt, CONTAINER]).splitlines()
    if len(parts) != 3:
        raise Refuse("inspect_unreadable")
    try:
        name, running, mounts = (json.loads(p) for p in parts)
    except ValueError:
        raise Refuse("inspect_unreadable") from None
    if name != f"/{CONTAINER}" or running is not True or not isinstance(mounts, list):
        raise Refuse("container_unexpected")
    hits = [m for m in mounts if isinstance(m, dict) and str(m.get("Destination", "")).rstrip("/") == DATA_DEST]
    if len(hits) != 1 or not isinstance(hits[0].get("Source"), str):
        raise Refuse("data_mount_ambiguous")
    host = Path(hits[0]["Source"])
    if host.is_symlink() or not host.is_dir():
        raise Refuse("data_dir_unexpected")
    return host


_TZ_FMT = '{{range .Config.Env}}{{if eq (index (split . "=") 0) "TZ"}}{{json .}}{{"\\n"}}{{end}}{{end}}'
_UTC_NAMES = {"", "UTC", "UTC0", "Etc/UTC", "Etc/UCT", "UCT", "Zulu", "Etc/Zulu", "GMT", "Etc/GMT", "GMT0"}


def container_day_is_utc(run: Runner, exists: Exists = _exists) -> Optional[bool]:
    """True when the container's local midnight is UTC midnight. Only the TZ variable is requested.
    An explicit UTC alias decides it; with TZ unset the C library falls back to /etc/localtime, so UTC is
    accepted only when /etc/localtime does not exist in the container's merged filesystem (image, layer
    or mount). Anything else is None (unknown)."""
    rows = [r for r in run(["docker", "inspect", "--type", "container", "--format", _TZ_FMT, CONTAINER]).splitlines()
            if r.strip()]
    if not rows:
        return True if exists(CONTAINER, "/etc/localtime") is False else None
    if len(rows) != 1:
        return None
    try:
        item = json.loads(rows[0])
    except ValueError:
        return None
    if not isinstance(item, str) or not item.startswith("TZ="):
        return None
    return True if item[3:] in _UTC_NAMES else None


def database_file(directory: Path) -> Path:
    candidates = [p for p in directory.iterdir()
                  if p.suffix == ".db" and p.is_file() and not p.is_symlink() and p.name != "build.db"]
    if len(candidates) != 1:
        raise Refuse("database_ambiguous")
    return candidates[0]


def open_readonly(path: Path) -> sqlite3.Connection:
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)
        conn.execute("PRAGMA query_only = ON")
        conn.execute("PRAGMA temp_store = MEMORY")
    except sqlite3.Error:
        raise Refuse("database_unreadable") from None
    return conn


def check_journal(conn: sqlite3.Connection) -> None:
    """Points uses SQLite's default rollback journal (db.ts sets no pragma). In WAL mode even a read-only
    reader updates the -shm index, which would break the no-write guarantee, so WAL is refused."""
    mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
    if str(mode).lower() == "wal":
        raise Refuse("journal_mode_wal_unsupported")


def check_schema(conn: sqlite3.Connection) -> None:
    for table, expected in EXPECTED_COLUMNS.items():
        cols = {row[1]: str(row[2]).upper() for row in conn.execute(f'PRAGMA table_info("{table}")')}
        if cols != expected:
            raise Refuse("schema_mismatch")


# Epoch-ms normalisation for both storage forms; NULL when neither.
def _ms(col: str) -> str:
    return (f"(CASE WHEN typeof({col}) = 'integer' THEN {col} "
            f"WHEN typeof({col}) = 'text' AND strftime('%s', {col}) IS NOT NULL "
            f"THEN CAST(strftime('%s', {col}) AS INTEGER) * 1000 ELSE NULL END)")


def weekly_table(rows: list[list[int]]) -> Optional[list[list[str]]]:
    """Weekly cells are published only when every cell is 0 or at least SUPPRESS_BELOW. Cell suppression
    is not used: with the published totals, hidden cells can be recovered (e.g. two hidden 1s next to a
    visible 10 and a total of 12). Any small cell therefore withholds the whole weekly table (None)."""
    if any(0 < v < SUPPRESS_BELOW for r in rows for v in r):
        return None
    return [[str(v) for v in r] for r in rows]


def report(conn: sqlite3.Connection, out: Out, day_is_utc: Optional[bool] = True) -> None:
    c, e = _ms('"createdAt"'), _ms('"expiresAt"')
    q = conn.execute
    types = dict(q('SELECT typeof("createdAt"), COUNT(*) FROM "Voucher" GROUP BY 1').fetchall())
    out("voucher_createdAt_types=" + ",".join(f"{k}:{types[k]}" for k in sorted(types)))
    unparseable = q(f'SELECT COUNT(*) FROM "Voucher" WHERE {c} IS NULL OR {e} IS NULL').fetchone()[0]
    out(f"voucher_timestamp_unparseable={unparseable}")
    created_unknown = q(f'SELECT COUNT(*) FROM "Voucher" WHERE {c} IS NULL').fetchone()[0]
    out(f"q1_vouchers_created_unknown={created_unknown}")
    out("scope=all_vouchers_before_pause_2026-10-08T21:55:00Z")
    out("mainnet_start=" + ("unknown" if MAINNET_START_MS is None else str(MAINNET_START_MS)))
    out("mainnet_cohort=" + ("unknown" if MAINNET_START_MS is None else "bounded"))
    lo = MAINNET_START_MS if MAINNET_START_MS is not None else 0
    win = f"{c} >= ? AND {c} < ?"
    args = (lo, PAUSE_MS)
    total, wallets, expired, unexpired, used, used_any = q(
        f'SELECT COUNT(*), COUNT(DISTINCT "walletId"), COALESCE(SUM({e} < ?), 0), COALESCE(SUM({e} >= ?), 0), '
        f'COALESCE(SUM("used" = 1), 0), COALESCE(SUM("usedCount" > 0), 0) FROM "Voucher" WHERE {win}',
        (AS_OF_MS, AS_OF_MS, *args)).fetchone()
    out(f"q1_vouchers_issued={total}")
    out(f"q2_wallets_affected={wallets}")
    debits, points = q(
        f'SELECT COUNT(*), COALESCE(SUM("points"), 0) FROM "PointEvent" WHERE "type" = \'voucher_redemption\' '
        f'AND {win}', args).fetchone()
    linked = q(
        f'SELECT COUNT(*) FROM "PointEvent" p JOIN "Voucher" v ON p."proofRef" = v."nonce" '
        f'WHERE p."type" = \'voucher_redemption\' AND {_ms("v.\"createdAt\"")} >= ? AND {_ms("v.\"createdAt\"")} < ?',
        args).fetchone()[0]
    out(f"q3_points_debited={-points}")
    out(f"q3_debit_events={debits}")
    out(f"q3_debit_events_linked_to_voucher={linked}")
    out("q4_as_of=2026-10-08T21:55:00Z")
    out(f"q4_vouchers_expired={expired}")
    out(f"q4_vouchers_unexpired={unexpired}")
    out(f"q4_vouchers_expiry_unknown={total - expired - unexpired}")
    out(f"q5_db_marked_used={used}")
    out(f"q5_db_usedcount_gt0={used_any}")
    out("q5_note=backend_bookkeeping_not_onchain_redemption")
    # Q7: issuance allows one voucher per wallet per rolling 24 h and DAILY_ISSUANCE_CAP per day overall
    # (routes/voucher.ts walletWindowStart / startOfDay). Each invalid voucher consumed one wallet window.
    day = f"date({c} / 1000, 'unixepoch')"
    cap_days, days = q(
        f'SELECT COALESCE(SUM(n >= ?), 0), COUNT(*) FROM (SELECT {day} d, COUNT(*) n FROM "Voucher" '
        f'WHERE {win} GROUP BY d)', (DAILY_ISSUANCE_CAP, *args)).fetchone()
    out(f"q7_wallet_24h_windows_consumed={total}")
    out(f"q7_issuance_days_utc={days}")
    # The global cap resets at the container's local midnight; UTC-day counts match it only when the
    # container runs on UTC, otherwise the figure is reported as unknown instead of approximated.
    out("q7_days_global_cap_reached=" + (str(cap_days) if day_is_utc else "unknown"))
    out("q7_container_day=" + ("utc" if day_is_utc else "unknown"))
    after = q(f'SELECT COUNT(*) FROM "Voucher" WHERE {c} >= ?', (PAUSE_MS,)).fetchone()[0]
    out(f"vouchers_at_or_after_pause={after}")
    if MAINNET_START_MS is not None:
        before = q(f'SELECT COUNT(*) FROM "Voucher" WHERE {c} < ?', (MAINNET_START_MS,)).fetchone()[0]
        out(f"vouchers_before_mainnet_start={before}")
    weeks = q(
        f'SELECT strftime(\'%Y-W%W\', {c} / 1000, \'unixepoch\') wk, COUNT(*), COUNT(DISTINCT "walletId"), '
        f'COALESCE(SUM({e} < ?), 0), COALESCE(SUM({e} >= ?), 0), SUM({e} IS NULL) FROM "Voucher" WHERE {win} '
        f'GROUP BY wk ORDER BY wk', (AS_OF_MS, AS_OF_MS, *args)).fetchall()
    cells = weekly_table([[n, w, ex, un, unk] for _, n, w, ex, un, unk in weeks])
    if cells is None:
        out("weekly=withheld_small_cells")
        return
    for (wk, *_), (n, w, ex, un, unk) in zip(weeks, cells):
        out(f"week={wk} vouchers={n} wallets={w} expired={ex} unexpired={un} expiry_unknown={unk}")


def main(argv: Sequence[str], run: Runner = _run, out: Out = print,
         db_override: Optional[Path] = None, exists: Exists = _exists) -> int:
    if len(argv) != 1:
        out("usage=points-voucher-impact.py (no arguments)")
        return 2
    try:
        db = db_override or database_file(data_dir(run))
        day_is_utc = True if db_override else container_day_is_utc(run, exists)
        conn = open_readonly(db)
        try:
            check_journal(conn)
            check_schema(conn)
            report(conn, out, day_is_utc)
        except sqlite3.Error:
            raise Refuse("query_failed") from None
        finally:
            conn.close()
    except Refuse as exc:
        out(f"refuse={exc.code}")
        out("exit=2")
        return 2
    out("exit=0")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
