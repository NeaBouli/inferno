#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  assertVersion,
  classifyGatedFindings,
  discoverContracts,
  evaluateBaseline,
  extractDetectors,
  fingerprintFinding,
  isDependencyOnly,
} = require("./check-slither-baseline.cjs");

const root = path.resolve(__dirname, "..");
const baseline = JSON.parse(
  fs.readFileSync(path.join(root, "audit", "slither-high-baseline.json"), "utf8"),
);
const workflow = fs.readFileSync(
  path.join(root, ".github", "workflows", "security-audit.yml"),
  "utf8",
);
const runnerSource = fs.readFileSync(
  path.join(root, "scripts", "check-slither-baseline.cjs"),
  "utf8",
);

function finding({ expression = "token.transfer(to,amount)", source = "contracts/Test.sol" } = {}) {
  return {
    check: "unchecked-transfer",
    confidence: "Medium",
    impact: "High",
    elements: [
      {
        type: "function",
        name: "withdraw",
        source_mapping: { filename_relative: source },
        type_specific_fields: { parent: { name: "Test" }, signature: "withdraw(address,uint256)" },
      },
      {
        type: "node",
        name: expression,
        source_mapping: { filename_relative: source },
        type_specific_fields: { parent: { name: "withdraw" } },
      },
    ],
  };
}

function criticalFinding() {
  return { ...finding(), impact: "Critical" };
}

const contracts = discoverContracts();
assert.equal(contracts.length, 21, "all current production Solidity files must be analyzed");
assert.ok(contracts.includes("contracts/token/InfernoToken.sol"));
assert.ok(contracts.includes("contracts/vault/LendingVault.sol"));
assert.equal(contracts.some((contract) => contract.includes("/mocks/")), false);

assert.equal(baseline.schemaVersion, 1);
assert.equal(baseline.tool.slither, "0.11.5");
assert.equal(baseline.tool.solc, "0.8.28");
assert.equal(baseline.findings.length, 6, "every reviewed source High signal must be explicit");
assert.equal(new Set(baseline.findings.map((entry) => entry.fingerprint)).size, 6);
for (const entry of baseline.findings) {
  assert.match(entry.fingerprint, /^[a-f0-9]{64}$/);
  assert.ok(entry.subject);
  assert.ok(entry.classification);
  assert.ok(entry.rationale);
}

const known = finding();
const knownFingerprint = fingerprintFinding(known);
assert.deepEqual(
  evaluateBaseline([known], { findings: [{ fingerprint: knownFingerprint }] }),
  { newFindings: [], staleEntries: [] },
);

const changed = finding({ expression: "otherToken.transfer(to,amount)" });
const changedResult = evaluateBaseline([changed], { findings: [{ fingerprint: knownFingerprint }] });
assert.equal(changedResult.newFindings.length, 1, "changed High signal must fail closed as new");
assert.equal(changedResult.staleEntries.length, 1, "superseded baseline entry must be reported as stale");
assert.notEqual(
  fingerprintFinding(criticalFinding()),
  knownFingerprint,
  "severity changes must alter the semantic fingerprint",
);

const dependencyFinding = finding({ source: "node_modules/example/Math.sol" });
assert.equal(isDependencyOnly(dependencyFinding), true);
assert.equal(isDependencyOnly(known), false);
const classified = classifyGatedFindings([known, criticalFinding(), dependencyFinding]);
assert.equal(classified.highFindings.length, 1);
assert.equal(
  classified.criticalFindings.length,
  1,
  "Critical signals must remain outside the reviewable High baseline",
);

assert.doesNotThrow(() => assertVersion("Slither", "0.11.5", "0.11.5"));
assert.doesNotThrow(() => assertVersion("solc", "Version: 0.8.28+commit.7893614a", "0.8.28"));
assert.throws(() => assertVersion("solc", "Version: 0.8.35", "0.8.28"), /0\.8\.28 required/);
assert.deepEqual(extractDetectors({ success: true, results: { detectors: [known] } }, "fixture"), [known]);
assert.throws(() => extractDetectors({ success: false }, "fixture"), /invalid report/);
assert.match(runnerSource, /--evm-version cancun/);

for (const marker of [
  "solidity-static-analysis:",
  "slither-analyzer==0.11.5",
  ".slither-venv/bin/solc-select install 0.8.28",
  'echo "$PWD/.slither-venv/bin" >> "$GITHUB_PATH"',
  "npm run test:slither-baseline",
  "npm run check:slither",
]) {
  assert.ok(workflow.includes(marker), `Security Audit must include ${marker}`);
}

console.log("[slither-baseline-test] PASS");
