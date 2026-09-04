#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { evaluateVaultInvariants, formatIfr } = require("./check-vault-invariants.js");

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

for (const target of ["commitment", "lending"]) {
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

console.log("[vault-invariants-test] PASS");
