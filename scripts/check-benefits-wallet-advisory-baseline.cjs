#!/usr/bin/env node

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const appRoot = path.resolve(__dirname, "../apps/benefits-wallet-prototype");
const lock = JSON.parse(fs.readFileSync(path.join(appRoot, "package-lock.json"), "utf8"));

const expectedChain = [
  ["", "@coinbase/cdp-core"],
  ["node_modules/@coinbase/cdp-core", "@solana/web3.js"],
  ["node_modules/@solana/web3.js", "jayson"],
  ["node_modules/jayson", "stream-json"],
];

for (const [packagePath, dependency] of expectedChain) {
  const entry = lock.packages?.[packagePath];
  assert.ok(entry, `Missing lockfile package entry: ${packagePath || "<root>"}`);
  assert.ok(
    entry.dependencies?.[dependency],
    `${packagePath || "<root>"} must depend on ${dependency}`,
  );
}

assert.equal(
  lock.packages?.["node_modules/query-string"]?.version,
  "9.5.1",
  "query-string must stay on the patched 9.5.1 release",
);
assert.equal(
  lock.packages?.["node_modules/decode-uri-component"]?.version,
  "0.5.0",
  "decode-uri-component must stay on the patched 0.5.0 release",
);
assert.equal(
  lock.packages?.["node_modules/stream-json"]?.version,
  "1.9.1",
  "Review the temporary stream-json exception when its transitive version changes",
);

const audit = spawnSync("npm", ["audit", "--json"], {
  cwd: appRoot,
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});

assert.ok(!audit.error, `npm audit could not start: ${audit.error?.message}`);
assert.ok(
  audit.status === 0 || audit.status === 1,
  `npm audit failed with status ${audit.status}: ${audit.stderr}`,
);

let report;
try {
  report = JSON.parse(audit.stdout);
} catch (error) {
  throw new Error(`npm audit returned invalid JSON: ${error.message}\n${audit.stderr}`);
}

const counts = report.metadata?.vulnerabilities || {};
for (const severity of ["high", "critical"]) {
  assert.equal(counts[severity] || 0, 0, `npm audit reports ${counts[severity]} ${severity} findings`);
}

const vulnerabilities = report.vulnerabilities || {};
const names = Object.keys(vulnerabilities).sort();
assert.deepEqual(
  names,
  ["jayson", "stream-json"],
  `Unexpected Benefits wallet advisory set: ${names.join(", ") || "none"}`,
);
assert.equal(audit.status, 1, "The temporary advisory exception no longer matches npm audit");

for (const [name, finding] of Object.entries(vulnerabilities)) {
  assert.equal(finding.severity, "moderate", `${name} must remain Moderate severity`);
}

const streamJsonAdvisory = vulnerabilities["stream-json"].via.find(
  (item) => typeof item === "object" && item.name === "stream-json",
);
assert.equal(
  streamJsonAdvisory?.url,
  "https://github.com/advisories/GHSA-528h-pc64-c93x",
  "The allowed stream-json advisory identity changed",
);
assert.deepEqual(
  vulnerabilities["stream-json"].nodes,
  ["node_modules/stream-json"],
  "The stream-json advisory path changed",
);

console.log(
  "Benefits wallet advisory baseline: patched URI decoder; one exact Moderate " +
    "browser-unreachable stream-json chain remains pending an upstream-compatible release.",
);
