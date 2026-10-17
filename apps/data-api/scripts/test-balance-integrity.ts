// T-212b-data-integrity: failed reads must never turn into "0".
import assert from "node:assert/strict";
import {
  balanceEntry,
  explorerBalanceEntry,
  CV01_LOST_RAW,
  finalizeBalances,
  IFRLOCK_UNLOCKED_LABEL,
  IFRLOCK_UNLOCKED_TOPIC,
  lostSupply,
  parseAddressParam,
  requireBaseUnits,
  sumUnlockedLogs,
  unavailableEntry,
} from "../server/balance-integrity.js";
import { Interface } from "ethers";
import { readFileSync } from "node:fs";

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
assert.deepEqual(lockDown.unavailable, ["IFRLock", IFRLOCK_UNLOCKED_LABEL]);

// T-262 D1: only the unlocked total failing still names its source; incomplete never comes with an empty list.
const unlockedDown = finalizeBalances({ IFRLock: balanceEntry(10n), FeeRouterV1: balanceEntry(20n) }, null);
assert.equal(unlockedDown.incomplete, true);
assert.deepEqual(unlockedDown.unavailable, [IFRLOCK_UNLOCKED_LABEL]);
assert.equal(unlockedDown.ifrLock.unlockedRaw, null);
for (const r of [ok, partial, lockDown, unlockedDown]) {
  assert.equal(r.incomplete, r.unavailable.length > 0, "incomplete must match a non-empty unavailable list");
}

// T-262 D1: zero IFRLock Unlocked events is a valid 0, not a failure.
assert.equal(IFRLOCK_UNLOCKED_TOPIC, new Interface(["event Unlocked(address indexed user, uint256 amount)"]).getEvent("Unlocked")!.topicHash);
const noRecords = { status: "0", message: "No records found", result: [] };
assert.equal(sumUnlockedLogs(noRecords), 0n);
const zeroUnlocks = finalizeBalances({ IFRLock: balanceEntry(10n) }, sumUnlockedLogs(noRecords));
assert.equal(zeroUnlocks.incomplete, false);
assert.deepEqual(zeroUnlocks.unavailable, []);
assert.equal(zeroUnlocks.ifrLock.unlockedRaw, "0");
assert.equal(sumUnlockedLogs({ status: "1", message: "OK", result: [] }), 0n);
assert.equal(sumUnlockedLogs({
  status: "1", message: "OK",
  result: [{ data: "0x" + (1000n * 10n ** 9n).toString(16).padStart(64, "0") }, { data: "0x" + "5".padStart(64, "0") }],
}), 1000n * 10n ** 9n + 5n);

// Real failures stay fail-closed (throw -> caller maps to null -> incomplete with a named source).
for (const bad of [
  { status: "0", message: "NOTOK", result: "Max rate limit reached" },
  { status: "0", message: "NOTOK", result: "Invalid API Key" },
  { status: "0", message: "NOTOK", result: [] },
  { status: "0", message: "No records found", result: [{ data: "0x01" }] },
  { status: "0", message: "No records found", result: "" },
  { status: "0", result: [] },
  { status: "1", message: "OK", result: "unexpected" },
  { status: "1", message: "OK", result: [{ data: "not-hex" }] },
  { status: "1", message: "OK", result: [{ data: "0x05" }] },
  { status: "1", message: "OK", result: [{ data: "0x" + "0".repeat(128) }] },
  { status: "1", message: "OK", result: [{}] },
  { message: "No records found", result: [] },
  null,
  undefined,
  "No records found",
]) {
  assert.throws(() => sumUnlockedLogs(bad), /Unlocked event/, `getLogs reply ${JSON.stringify(bad)} must fail closed`);
}

// The server has exactly one unlocked-total fetcher and it delegates parsing to sumUnlockedLogs.
const serverSource = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
assert.equal((serverSource.match(/function fetchIFRLockUnlockedTotal\(/g) ?? []).length, 1, "fetchIFRLockUnlockedTotal must be defined once");
assert.match(serverSource, /return sumUnlockedLogs\(data\);/);
assert.doesNotMatch(serverSource, /data\.status !== "1" \|\| !Array\.isArray\(data\.result\)\) throw new Error\("Unlocked events unavailable"\)/);

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

// Permanently lost = CV-01 only (CWA-02 owner decision): exact base units; the FeeRouterV1-held IFR was
// recovered to the Treasury Safe and must neither count as lost nor be able to alter the figure.
assert.equal(CV01_LOST_RAW, 26418467994338353n);
const TOTAL = "996687518329891940";
const lost = lostSupply(TOTAL);
assert.deepEqual(lost, {
  permanentlyLostRaw: "26418467994338353",
  permanentlyLost: 26418467.994338353,
  liveSupplyRaw: "970269050335553587",
  liveSupply: 970269050.335553587,
  permanentlyLostBreakdown: { cv01Raw: "26418467994338353" },
  permanentlyLostError: null,
});
assert.equal(BigInt(lost.liveSupplyRaw), BigInt(TOTAL) - CV01_LOST_RAW, "live = totalSupply - CV-01, exact bigint");
assert.equal(BigInt(lost.liveSupplyRaw) + BigInt(lost.permanentlyLostRaw), BigInt(TOTAL), "lost + live = totalSupply");
assert.ok(!("feeRouterV1Raw" in lost.permanentlyLostBreakdown), "no FeeRouterV1 entry with changed meaning");
assert.equal(lostSupply("1000000000000000000").liveSupplyRaw, (10n ** 18n - CV01_LOST_RAW).toString());
// The FeeRouterV1 balance is not an input: zero, nonzero or a failed read cannot change the result.
assert.equal(lostSupply.length, 1, "lostSupply takes totalSupply only");
const untyped = lostSupply as unknown as (...args: unknown[]) => unknown;
for (const feeRouter of [balanceEntry(0n), balanceEntry(724992668043224n), unavailableEntry(),
  explorerBalanceEntry({ status: "0", result: "rate limit" })]) {
  assert.deepEqual(untyped(TOTAL, feeRouter), lost);
}
// A malformed totalSupply fails closed instead of producing a number.
assert.throws(() => lostSupply("not-a-number"), /totalSupply unavailable/);
assert.throws(() => lostSupply(""), /totalSupply unavailable/);

// Source guards: /api/ifr/supply reads no FeeRouterV1 balance, so an RPC/explorer failure there cannot
// fail or alter the response; the lost/live fields come from lostSupply(totalSupplyRaw) alone.
{
  const readStart = serverSource.indexOf("async function readSupplyInputs");
  const fetchStart = serverSource.indexOf("async function fetchSupplyData");
  const fetchEnd = serverSource.indexOf("// GET /api/ifr/balances", fetchStart);
  assert.ok(readStart > -1 && fetchStart > readStart && fetchEnd > fetchStart);
  const supplyPath = serverSource.slice(readStart, fetchEnd);
  assert.ok(!/FeeRouter/.test(supplyPath), "supply path must not read FeeRouterV1");
  assert.ok(/lostSupply\(totalSupplyRaw\)/.test(supplyPath), "lost/live derive from totalSupply only");
  assert.ok(/\.\.\.lost,/.test(supplyPath), "response spreads the lostSupply fields");
  assert.ok(/requireBaseUnits\(supplyData\.result, "totalSupply"\)/.test(supplyPath), "totalSupply read stays fail-closed");
}

console.log("[balance-integrity] PASS - failed reads stay null, incomplete responses flagged, addresses validated, lost = CV-01 only");
