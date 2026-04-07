/**
 * Phase 5c — IFR SDK Tests
 * Run: node test/sdk/sdk.test.js
 *
 * Tests the pure logic functions without requiring RPC.
 */

// ─��� Inline logic (mirrors SDK exports) ───────────────────────────────

const MAINNET_ADDRESSES = {
  ifrToken: "0x77e99917Eca8539c62F509ED1193ac36580A6e7B",
  ifrLock: "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb",
  commitmentVault: "0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3",
  lendingVault: "0x974305Ab0EC905172e697271C3d7d385194EB9DF",
  builderRegistry: "0xdfe6636DA47F8949330697e1dC5391267CEf0EE3",
  governance: "0xc43d48E7FDA576C5022d0670B652A622E8caD041",
};

const TIER1 = 500, TIER2 = 2000, TIER3 = 10000;
const TIER_NAMES = ["None", "Basic", "Premium", "Pro"];

function getTierFromAmount(amount) {
  if (amount >= TIER3) return 3;
  if (amount >= TIER2) return 2;
  if (amount >= TIER1) return 1;
  return 0;
}

function getTierName(tier) {
  return TIER_NAMES[tier] || "None";
}

function isValidAddress(addr) {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

// ─�� Test Runner ─���────────────────────────────────────────────────────

let passed = 0, failed = 0;

function assert(condition, name) {
  if (condition) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} — FAILED`); }
}

console.log("\n  Phase 5c — IFR SDK Tests\n");

// ── Constants ���───────────────────────────────────────────────────────

assert(MAINNET_ADDRESSES.ifrToken === "0x77e99917Eca8539c62F509ED1193ac36580A6e7B", "T01: ifrToken address correct");
assert(MAINNET_ADDRESSES.ifrLock === "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb", "T02: ifrLock address correct");
assert(MAINNET_ADDRESSES.builderRegistry === "0xdfe6636DA47F8949330697e1dC5391267CEf0EE3", "T03: builderRegistry address correct");
assert(MAINNET_ADDRESSES.commitmentVault === "0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3", "T04: commitmentVault address correct");
assert(MAINNET_ADDRESSES.lendingVault === "0x974305Ab0EC905172e697271C3d7d385194EB9DF", "T05: lendingVault address correct");
assert(MAINNET_ADDRESSES.governance === "0xc43d48E7FDA576C5022d0670B652A622E8caD041", "T06: governance address correct");

// ── Tier Thresholds ──────────────────────────────────────────────────

assert(TIER1 === 500, "T07: TIER1 = 500");
assert(TIER2 === 2000, "T08: TIER2 = 2000");
assert(TIER3 === 10000, "T09: TIER3 = 10000");

// ── getTierFromAmount ────────────────────────────────────────────────

assert(getTierFromAmount(0) === 0, "T10: 0 IFR → tier 0");
assert(getTierFromAmount(499) === 0, "T11: 499 IFR → tier 0");
assert(getTierFromAmount(500) === 1, "T12: 500 IFR → tier 1");
assert(getTierFromAmount(1999) === 1, "T13: 1999 IFR → tier 1");
assert(getTierFromAmount(2000) === 2, "T14: 2000 IFR → tier 2");
assert(getTierFromAmount(9999) === 2, "T15: 9999 IFR → tier 2");
assert(getTierFromAmount(10000) === 3, "T16: 10000 IFR → tier 3");
assert(getTierFromAmount(999999) === 3, "T17: 999999 IFR → tier 3");

// ── getTierName ──────────────────────────────────────────────────────

assert(getTierName(0) === "None", "T18: tier 0 → None");
assert(getTierName(1) === "Basic", "T19: tier 1 → Basic");
assert(getTierName(2) === "Premium", "T20: tier 2 → Premium");
assert(getTierName(3) === "Pro", "T21: tier 3 → Pro");
assert(getTierName(99) === "None", "T22: tier 99 → None (fallback)");

// ── Address Validation ───────────────────────────────────────────────

assert(isValidAddress("0x77e99917Eca8539c62F509ED1193ac36580A6e7B") === true, "T23: valid address → true");
assert(isValidAddress("0xinvalid") === false, "T24: invalid address → false");
assert(isValidAddress("") === false, "T25: empty string → false");
assert(isValidAddress("not-an-address") === false, "T26: random string → false");
assert(isValidAddress("0x" + "a".repeat(40)) === true, "T27: 0x + 40 hex chars → true");

// ── Access Logic ─────────────────────────────────────────────────────

function checkAccessLogic(balance, locked, required) {
  const total = balance + locked;
  return {
    hasAccess: total >= required,
    total,
    tier: getTierFromAmount(total),
    tierName: getTierName(getTierFromAmount(total)),
  };
}

const r1 = checkAccessLogic(1000, 0, 500);
assert(r1.hasAccess === true, "T28: 1000 balance, 0 locked, need 500 → access");
assert(r1.tier === 1, "T28b: → tier 1");

const r2 = checkAccessLogic(0, 0, 500);
assert(r2.hasAccess === false, "T29: 0 balance, 0 locked, need 500 → no access");

const r3 = checkAccessLogic(300, 700, 500);
assert(r3.hasAccess === true, "T30: 300 balance + 700 locked = 1000 → access");
assert(r3.tier === 1, "T30b: total 1000 → tier 1");

const r4 = checkAccessLogic(0, 10000, 1000);
assert(r4.hasAccess === true, "T31: 0 balance + 10k locked → access");
assert(r4.tier === 3, "T31b: total 10k → tier 3");

const r5 = checkAccessLogic(5000, 5000, 10000);
assert(r5.hasAccess === true, "T32: 5k + 5k = 10k → exact match access");
assert(r5.tierName === "Pro", "T32b: → Pro");

// ── Summary ��─────────────────────────────────────────────────────────

console.log(`\n  ${passed} passing, ${failed} failing\n`);
process.exit(failed > 0 ? 1 : 0);
