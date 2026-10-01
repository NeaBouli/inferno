#!/usr/bin/env node

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

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
const names = Object.keys(vulnerabilities).sort();

// hardhat-verify 3.1.2 dropped the @ethersproject/elliptic chain (GHSA-848j-6mx2-7j84) that was
// previously allowlisted; any new advisory must now be triaged explicitly instead of baselined.
assert.deepStrictEqual(names, [], `npm audit reports root advisories: ${names.join(", ")}`);
assert.equal(audit.status, 0, "npm audit failed without reporting vulnerabilities");

console.log("Root dependency advisory baseline: no vulnerabilities reported.");
