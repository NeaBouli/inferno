// T-212b-data-integrity: failed reads must never turn into "0".
import assert from "node:assert/strict";
import {
  balanceEntry,
  explorerBalanceEntry,
  finalizeBalances,
  parseAddressParam,
  requireBaseUnits,
  unavailableEntry,
} from "../server/balance-integrity.js";

// A successful read keeps exact base units.
assert.deepEqual(balanceEntry(724992668043224n), { raw: "724992668043224", formatted: 724992.668043224 });

// A failed read is explicit, not zero.
const missing = unavailableEntry();
assert.equal(missing.raw, null);
assert.equal(missing.formatted, null);

// Explorer responses: only decimal strings with status 1 count.
assert.equal(explorerBalanceEntry({ status: "1", result: "5000000000" }).raw, "5000000000");
for (const bad of [
  { status: "0", result: "Max rate limit reached" },
  { status: "1", result: "" },
  { status: "1", result: "0x10" },
  { status: "1", result: 12 },
  null,
  undefined,
]) {
  assert.equal(explorerBalanceEntry(bad as never).raw, null, `explorer ${JSON.stringify(bad)} must be unavailable`);
}

// Complete response: not incomplete, nothing unavailable.
const ok = finalizeBalances({ IFRLock: balanceEntry(10n), FeeRouterV1: balanceEntry(20n) }, 3n);
assert.equal(ok.incomplete, false);
assert.deepEqual(ok.unavailable, []);
assert.equal(ok.ifrLock.lockedRaw, "10");
assert.equal(ok.ifrLock.unlockedRaw, "3");

// One failed balance: incomplete, listed, and the failed value stays null (never "0").
const partial = finalizeBalances({ IFRLock: balanceEntry(10n), FeeRouterV1: unavailableEntry() }, 3n);
assert.equal(partial.incomplete, true);
assert.deepEqual(partial.unavailable, ["FeeRouterV1"]);
assert.equal(partial.balances.FeeRouterV1.raw, null);
assert.notEqual(partial.balances.FeeRouterV1.raw, "0");

// Failed IFRLock read and failed unlocked total: both null, incomplete.
const lockDown = finalizeBalances({ IFRLock: unavailableEntry() }, null);
assert.equal(lockDown.incomplete, true);
assert.equal(lockDown.ifrLock.lockedRaw, null);
assert.equal(lockDown.ifrLock.lockedFormatted, null);
assert.equal(lockDown.ifrLock.unlockedRaw, null);

// Supply figures must be base-unit strings.
assert.equal(requireBaseUnits("996687518329891940", "totalSupply"), "996687518329891940");
for (const bad of [undefined, "", "Max rate limit reached", "1e18", 5]) {
  assert.throws(() => requireBaseUnits(bad, "totalSupply"), /totalSupply unavailable/);
}

// Address validation for /api/builders/check/:address.
assert.equal(
  parseAddressParam("0x6b36687b0cd4386fb14cf565b67d7862110fed67"),
  "0x6b36687b0cd4386fb14cf565B67D7862110Fed67",
);
assert.equal(
  parseAddressParam("0x6b36687b0cd4386fb14cf565B67D7862110Fed67"),
  "0x6b36687b0cd4386fb14cf565B67D7862110Fed67",
);
for (const bad of [
  "0x6b36687b0cd4386fb14cf565B67D7862110FED67", // broken checksum
  "0x6b36687b0cd4386fb14cf565b67d7862110fed6", // 39 hex chars
  "6b36687b0cd4386fb14cf565b67d7862110fed67", // no 0x
  "0x6b36687b0cd4386fb14cf565b67d7862110fed67zz",
  "0x6b36687b0cd4386fb14cf565b67d7862110fed67;drop",
  "",
  undefined,
]) {
  assert.equal(parseAddressParam(bad), null, `${String(bad)} must be rejected`);
}

console.log("[balance-integrity] PASS - failed reads stay null, incomplete responses flagged, addresses validated");
