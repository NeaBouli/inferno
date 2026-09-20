import assert from 'node:assert/strict';
import {
  DailyBudget,
  parseDailyBudgetMicroUsd,
  estimateReservationMicroUsd,
  actualCostMicroUsd,
  MICRO_USD_PER_USD,
  DEFAULT_DAILY_BUDGET_MICRO_USD,
  MAX_DAILY_BUDGET_MICRO_USD,
  CHAT_MAX_OUTPUT_TOKENS,
} from '../server/budget';

// CWA-12: deterministic unit tests — no model calls, no network, injected clock.

// ── Configuration parsing ─────────────────────────────────────────────
assert.equal(parseDailyBudgetMicroUsd(undefined), DEFAULT_DAILY_BUDGET_MICRO_USD, 'unset → conservative finite default');
assert.equal(DEFAULT_DAILY_BUDGET_MICRO_USD, 1 * MICRO_USD_PER_USD, 'prior 1 USD warning threshold is now a hard daily cutoff');
assert.equal(parseDailyBudgetMicroUsd('2'), 2 * MICRO_USD_PER_USD);
assert.equal(parseDailyBudgetMicroUsd('2.5'), 2_500_000);
assert.equal(parseDailyBudgetMicroUsd('2.50'), 2_500_000);
assert.equal(parseDailyBudgetMicroUsd('0.01'), 10_000);
assert.equal(parseDailyBudgetMicroUsd(' 3.25 '), 3_250_000, 'surrounding whitespace tolerated');
assert.equal(parseDailyBudgetMicroUsd('1000'), MAX_DAILY_BUDGET_MICRO_USD, 'upper sanity bound accepted');
for (const bad of ['', '   ', 'abc', '-1', '0', '0.00', '1.005', '.5', '5.', '1e3', 'Infinity', 'NaN', '1000.01', '1001', '$5', '5 USD', '0x10']) {
  assert.throws(() => parseDailyBudgetMicroUsd(bad), Error, `invalid config must throw: ${JSON.stringify(bad)}`);
}

// ── Integer cost accounting ───────────────────────────────────────────
assert.equal(actualCostMicroUsd(1_000_000, 0), 1 * MICRO_USD_PER_USD, 'Haiku input: $1 per 1M tokens');
assert.equal(actualCostMicroUsd(0, 1_000_000), 5 * MICRO_USD_PER_USD, 'Haiku output: $5 per 1M tokens');
assert.equal(actualCostMicroUsd(123, 45), 123 + 225);
assert.throws(() => actualCostMicroUsd(-1, 0), RangeError);
assert.throws(() => actualCostMicroUsd(1.5, 0), RangeError);

const reservation = estimateReservationMicroUsd(30_000);
assert.equal(reservation, 30_000 * 1 + CHAT_MAX_OUTPUT_TOKENS * 5, 'reservation = request UTF-8 bytes + max output');
assert.ok(Number.isSafeInteger(reservation));
assert.equal(
  estimateReservationMicroUsd(Buffer.byteLength('IFR 🔥', 'utf8')),
  Buffer.byteLength('IFR 🔥', 'utf8') + CHAT_MAX_OUTPUT_TOKENS * 5,
  'multi-byte input is reserved by bytes, not JavaScript character count',
);
assert.throws(() => estimateReservationMicroUsd(-1), RangeError);
assert.throws(() => estimateReservationMicroUsd(1, -1), RangeError);

// ── Helpers ───────────────────────────────────────────────────────────
function makeClock(startIso: string): { now: () => number; set: (iso: string) => void } {
  let current = Date.parse(startIso);
  return { now: () => current, set: (iso: string) => { current = Date.parse(iso); } };
}

// ── Exhaustion: fail-closed when budget is spent ──────────────────────
{
  const clock = makeClock('2026-01-01T00:00:00.000Z');
  const budget = new DailyBudget(10_000, clock.now);
  const r1 = budget.tryReserve(6_000);
  assert.ok(r1, 'first reservation fits');
  const r2 = budget.tryReserve(5_000);
  assert.equal(r2, null, 'spent+reserved+request over budget → no reservation');
  budget.settle(r1!, 6_000);
  assert.equal(budget.tryReserve(5_000), null, 'fully spent → fail-closed');
  assert.equal(budget.tryReserve(4_000)?.open, true, 'exactly remaining budget still fits');
}

// ── Concurrency: two reservations cannot pass the same remaining budget ──
{
  const clock = makeClock('2026-01-01T00:00:00.000Z');
  const budget = new DailyBudget(10_000, clock.now);
  const first = budget.tryReserve(6_000);
  const second = budget.tryReserve(6_000);
  assert.ok(first && !second, 'second concurrent reservation is blocked by the first');
  budget.release(first!);
  assert.ok(budget.tryReserve(6_000), 'release frees capacity for the next request');
}

// ── Settlement: actual usage frees the unused reservation remainder ────
{
  const clock = makeClock('2026-01-01T00:00:00.000Z');
  const budget = new DailyBudget(10_000, clock.now);
  const r = budget.tryReserve(9_000)!;
  budget.settle(r, 100); // actual far below the conservative reservation
  const snap = budget.snapshot();
  assert.equal(snap.spentMicroUsd, 100, 'only actual cost is charged');
  assert.equal(snap.reservedMicroUsd, 0, 'reservation dropped');
  assert.equal(budget.tryReserve(9_901), null, 'one micro-USD over the remaining budget fails');
  assert.equal(budget.tryReserve(9_900)?.open, true, 'remainder is available again');
}

// ── Missing usage → full reservation charged (fail-safe) ──────────────
{
  const clock = makeClock('2026-01-01T00:00:00.000Z');
  const budget = new DailyBudget(10_000, clock.now);
  const r = budget.tryReserve(9_000)!;
  budget.settle(r, undefined);
  assert.equal(budget.snapshot().spentMicroUsd, 9_000);
}

// ── Release before dispatch: nothing charged ─────────────────────────
{
  const clock = makeClock('2026-01-01T00:00:00.000Z');
  const budget = new DailyBudget(10_000, clock.now);
  const r = budget.tryReserve(9_000)!;
  budget.release(r);
  const snap = budget.snapshot();
  assert.equal(snap.spentMicroUsd, 0, 'failed upstream call is free');
  assert.equal(snap.reservedMicroUsd, 0);
  assert.equal(budget.tryReserve(10_000)?.open, true, 'full budget available after release');
}

// ── Double settle/release are safe no-ops ─────────────────────────────
{
  const clock = makeClock('2026-01-01T00:00:00.000Z');
  const budget = new DailyBudget(10_000, clock.now);
  const r = budget.tryReserve(1_000)!;
  budget.settle(r, 500);
  budget.settle(r, 500);
  budget.release(r);
  assert.equal(budget.snapshot().spentMicroUsd, 500, 'settled exactly once');
  const r2 = budget.tryReserve(1_000)!;
  budget.release(r2);
  budget.release(r2);
  assert.equal(budget.snapshot().reservedMicroUsd, 0, 'released exactly once');
}

// ── UTC reset boundary ────────────────────────────────────────────────
{
  const clock = makeClock('2026-01-01T23:59:59.000Z');
  const budget = new DailyBudget(10_000, clock.now);
  const r = budget.tryReserve(10_000)!;
  budget.settle(r, 10_000);
  assert.equal(budget.tryReserve(1), null, 'exhausted before midnight');
  clock.set('2026-01-02T00:00:00.000Z');
  assert.equal(budget.tryReserve(10_000)?.open, true, 'budget resets at 00:00:00 UTC');
  assert.equal(budget.snapshot().dayUtc, '2026-01-02');
}

// ── Reservation in flight across midnight stays consistent ────────────
{
  const clock = makeClock('2026-01-01T23:59:59.000Z');
  const budget = new DailyBudget(10_000, clock.now);
  const r = budget.tryReserve(8_000)!;
  clock.set('2026-01-02T00:00:01.000Z');
  // New day, old reservation still outstanding: it must not double-free.
  assert.equal(budget.tryReserve(3_000), null, 'carried-over reservation still counts');
  budget.settle(r, 7_000);
  const snap = budget.snapshot();
  assert.equal(snap.reservedMicroUsd, 0);
  assert.equal(snap.spentMicroUsd, 7_000, 'settled cost lands in the new UTC day');
}

// ── retryAfterSeconds points at the next UTC midnight ─────────────────
{
  const clock = makeClock('2026-01-01T23:59:30.000Z');
  const budget = new DailyBudget(10_000, clock.now);
  assert.equal(budget.retryAfterSeconds(), 30);
  clock.set('2026-01-01T00:00:00.000Z');
  assert.equal(budget.retryAfterSeconds(), 86_400);
  clock.set('2026-06-15T12:00:00.500Z');
  assert.equal(budget.retryAfterSeconds(), 43_200, 'ceil to full seconds');
}

// ── Constructor and reservation validation ────────────────────────────
assert.throws(() => new DailyBudget(0), RangeError);
assert.throws(() => new DailyBudget(-5), RangeError);
assert.throws(() => new DailyBudget(1.5), RangeError);
{
  const budget = new DailyBudget(10_000);
  assert.throws(() => budget.tryReserve(0), RangeError);
  assert.throws(() => budget.tryReserve(-1), RangeError);
  assert.throws(() => budget.tryReserve(1.5), RangeError);
}

console.log('PASS: daily budget — config, exhaustion, concurrency, settlement, pre-dispatch release, UTC reset; no model calls');
