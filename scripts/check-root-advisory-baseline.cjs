#!/usr/bin/env node

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const lock = JSON.parse(
  fs.readFileSync(path.join(root, "package-lock.json"), "utf8")
);

const expectedVulnerabilities = new Set([
  "@ethersproject/abi",
  "@ethersproject/abstract-provider",
  "@ethersproject/abstract-signer",
  "@ethersproject/hash",
  "@ethersproject/signing-key",
  "@ethersproject/transactions",
  "@nomicfoundation/hardhat-verify",
  "elliptic",
]);

const expectedDevChain = [
  ["", "@nomicfoundation/hardhat-verify", true],
  ["node_modules/@nomicfoundation/hardhat-verify", "@ethersproject/abi"],
  ["node_modules/@ethersproject/abi", "@ethersproject/hash"],
  ["node_modules/@ethersproject/hash", "@ethersproject/abstract-signer"],
  ["node_modules/@ethersproject/abstract-signer", "@ethersproject/abstract-provider"],
  ["node_modules/@ethersproject/abstract-provider", "@ethersproject/transactions"],
  ["node_modules/@ethersproject/transactions", "@ethersproject/signing-key"],
  ["node_modules/@ethersproject/signing-key", "elliptic"],
];

function dependencyMap(packageEntry, rootDevDependency) {
  return rootDevDependency ? packageEntry.devDependencies : packageEntry.dependencies;
}

for (const [packagePath, dependency, rootDevDependency = false] of expectedDevChain) {
  const packageEntry = lock.packages?.[packagePath];
  assert.ok(packageEntry, `Missing lockfile package entry: ${packagePath || "<root>"}`);
  assert.ok(
    dependencyMap(packageEntry, rootDevDependency)?.[dependency],
    `${packagePath || "<root>"} must depend on ${dependency}`
  );

  if (packagePath) {
    assert.equal(packageEntry.dev, true, `${packagePath} must remain development-only`);
  }
}

for (const dependency of expectedVulnerabilities) {
  const packageEntry = lock.packages?.[`node_modules/${dependency}`];
  assert.equal(
    packageEntry?.dev,
    true,
    `${dependency} must remain development-only in package-lock.json`
  );
  assert.ok(
    !lock.packages[""].dependencies?.[dependency],
    `${dependency} must not become a production dependency`
  );
}

const audit = spawnSync("npm", ["audit", "--json"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});

assert.ok(!audit.error, `npm audit could not start: ${audit.error?.message}`);
assert.ok(
  audit.status === 0 || audit.status === 1,
  `npm audit failed with status ${audit.status}: ${audit.stderr}`
);

let report;
try {
  report = JSON.parse(audit.stdout);
} catch (error) {
  throw new Error(`npm audit returned invalid JSON: ${error.message}\n${audit.stderr}`);
}

const counts = report.metadata?.vulnerabilities || {};
for (const severity of ["moderate", "high", "critical"]) {
  assert.equal(counts[severity] || 0, 0, `npm audit reports ${counts[severity]} ${severity} findings`);
}

const vulnerabilities = report.vulnerabilities || {};
const names = Object.keys(vulnerabilities);

if (names.length === 0) {
  assert.equal(audit.status, 0, "npm audit failed without reporting vulnerabilities");
  console.log("Root dependency advisory baseline: no vulnerabilities reported.");
  process.exit(0);
}

assert.equal(audit.status, 1, "npm audit reported vulnerabilities with an unexpected status");

assert.deepStrictEqual(
  new Set(names),
  expectedVulnerabilities,
  `Unexpected root advisory set: ${names.sort().join(", ")}`
);

for (const [name, finding] of Object.entries(vulnerabilities)) {
  assert.equal(finding.severity, "low", `${name} must not exceed Low severity`);
  assert.equal(finding.fixAvailable, false, `${name} now has a fix and must be upgraded`);
}

const ellipticAdvisory = vulnerabilities.elliptic.via.find(
  (item) => typeof item === "object" && item.name === "elliptic"
);
assert.equal(
  ellipticAdvisory?.url,
  "https://github.com/advisories/GHSA-848j-6mx2-7j84",
  "The allowed elliptic advisory identity changed"
);

console.log(
  "Root dependency advisory baseline: known Low elliptic chain only; " +
    "development-only and no fix available."
);
