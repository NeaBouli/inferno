#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { evaluateVaultInvariants, formatIfr, assertRpcIntegrity, CONFIRMATIONS } = require("./check-vault-invariants.js");

const workflow = fs.readFileSync(
  path.join(__dirname, "..", ".github/workflows/vault-invariant-monitor.yml"),
  "utf8",
);
const securityWorkflow = fs.readFileSync(
  path.join(__dirname, "..", ".github/workflows/security-audit.yml"),
  "utf8",
);
const monitorSource = fs.readFileSync(
  path.join(__dirname, "check-vault-invariants.js"),
  "utf8",
);
for (const marker of [
  "cron: '17 */4 * * *'",
  "workflow_dispatch:",
  "permissions:\n  contents: read",
  "run: npm ci",
  "run: npm run test:vault-invariants",
  "run: npm run check:vault-invariants",
]) {
  assert.ok(workflow.includes(marker), `vault monitor workflow must include ${marker}`);
}
assert.equal(/PRIVATE_KEY|mnemonic|wallet/i.test(workflow), false);
assert.ok(
  securityWorkflow.includes("run: npm run test:vault-invariants"),
  "security CI must test the vault monitor configuration on pushes and pull requests",
);
assert.doesNotMatch(
  monitorSource,
  /getSigner|sendTransaction|PrivateKey|setFeeExempt|\.transfer\s*\(/,
  "vault monitor must remain read-only",
);

assert.equal(formatIfr(0n), "0");
assert.equal(formatIfr(1_000_000_000n), "1");
assert.equal(formatIfr(1_234_000_000n), "1.234");
assert.equal(formatIfr(-1_680_000_000n), "-1.68");

function snapshot(overrides = {}) {
  return {
    ifrLock: {
      feeExempt: true,
      balance: 2_000n,
      totalLocked: 2_000n,
      ...overrides.ifrLock,
    },
    commitmentV2: {
      feeExempt: true,
      balance: 0n,
      totalLocked: 0n,
      ...overrides.commitmentV2,
    },
    commitment: {
      feeExempt: true,
      balance: 48_000n,
      totalLocked: 48_000n,
      ...overrides.commitment,
    },
    lending: {
      feeExempt: true,
      balance: 40_000n,
      totalAvailable: 40_000n,
      totalLent: 12_000n,
      ...overrides.lending,
    },
  };
}

const healthy = evaluateVaultInvariants(snapshot());
assert.equal(healthy.ok, true);
assert.equal(healthy.lendingPrincipalAccounting, 52_000n);
assert.equal(healthy.lendingTotalAssetCoverage, 52_000n);
assert.equal(
  healthy.lendingLiquidSurplus,
  0n,
  "active loans must not be incorrectly required in liquid token custody",
);

const commitmentDeficit = evaluateVaultInvariants(
  snapshot({ commitment: { balance: 46_320n } }),
);
assert.equal(commitmentDeficit.ok, false);
assert.match(commitmentDeficit.problems.join("\n"), /below totalLocked/);

const lendingDeficit = evaluateVaultInvariants(
  snapshot({ lending: { balance: 38_600n } }),
);
assert.equal(lendingDeficit.ok, false);
assert.match(lendingDeficit.problems.join("\n"), /below totalAvailable/);

for (const target of ["ifrLock", "commitment", "commitmentV2", "lending"]) {
  const result = evaluateVaultInvariants(
    snapshot({ [target]: { feeExempt: false } }),
  );
  assert.equal(result.ok, false);
  assert.match(result.problems.join("\n"), /fee exemption is not active/);
}

assert.throws(
  () => evaluateVaultInvariants(snapshot({ lending: { balance: "invalid" } })),
  /must be a non-negative integer/,
);

// IFRLock and CommitmentVault V2 (external audit IFR-DEV-01): both are required; V2's exemption was
// executed with proposal #17, so a missing exemption fails even while V2 holds no locks.
{
  assert.equal(evaluateVaultInvariants(snapshot()).ifrLockSurplus, 0n);
  const lockShort = evaluateVaultInvariants(snapshot({ ifrLock: { balance: 1_999n } }));
  assert.equal(lockShort.ok, false);
  assert.match(lockShort.problems.join("\n"), /IFRLock token balance is below totalLocked/);
  const v2EmptyNoExempt = evaluateVaultInvariants(snapshot({ commitmentV2: { feeExempt: false } }));
  assert.equal(v2EmptyNoExempt.ok, false, "an empty V2 without exemption is no longer a pending state");
  assert.match(v2EmptyNoExempt.problems.join("\n"), /CommitmentVault V2 fee exemption is not active/);
  const v2Short = evaluateVaultInvariants(snapshot({ commitmentV2: { balance: 90n, totalLocked: 100n } }));
  assert.equal(v2Short.ok, false);
  assert.match(v2Short.problems.join("\n"), /V2 token balance is below totalLocked/);
  for (const part of ["ifrLock", "commitmentV2"]) {
    const missing = snapshot();
    delete missing[part];
    assert.throws(() => evaluateVaultInvariants(missing), new RegExp(`snapshot\\.${part} is required`));
  }
  assert.equal(require("./check-vault-invariants.js").ADDRESSES.ifrLock, "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb");
  assert.doesNotMatch(monitorSource, /commitmentV2Pending|feeExemptPending/, "the stale V2 pending branch must stay removed");
}
// RPC integrity: chain ID 1, pinned confirmations, identical block hash before and after the reads.
{
  const hash = `0x${"ab".repeat(32)}`;
  const ok = { chainIdHex: "0x1", head: 1_000, pinned: 1_000 - CONFIRMATIONS, hashBefore: hash, hashAfter: hash };
  assert.doesNotThrow(() => assertRpcIntegrity(ok));
  assert.throws(() => assertRpcIntegrity({ ...ok, chainIdHex: "0xaa36a7" }), /expected 1/);
  assert.throws(() => assertRpcIntegrity({ ...ok, pinned: 1_000 }), /behind the head/);
  assert.throws(() => assertRpcIntegrity({ ...ok, hashAfter: `0x${"cd".repeat(32)}` }), /hash changed/);
  assert.throws(() => assertRpcIntegrity({ ...ok, hashBefore: undefined }), /no valid block hash/);
  assert.throws(() => assertRpcIntegrity({ ...ok, hashBefore: "0x1234" }), /no valid block hash/);
  assert.ok(CONFIRMATIONS >= 32, "reads must stay well behind the head");
  assert.match(monitorSource, /eth_chainId/, "the monitor must query the chain ID itself");
}
assert.equal(require("./check-vault-invariants.js").ADDRESSES.commitmentVaultV2, "0x8efae0C85ad6d44C731cAEDA1cBC275904Fc7c8F");

console.log("[vault-invariants-test] PASS");
