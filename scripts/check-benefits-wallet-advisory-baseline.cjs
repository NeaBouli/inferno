#!/usr/bin/env node

const assert = require("node:assert/strict");

function checkAuditReport(status, stdout) {
  let report;
  try {
    report = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`npm audit returned invalid JSON: ${error.message}`);
  }

  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  assert.ok(isObject(report), "npm audit must return a report object");
  assert.equal(report.auditReportVersion, 2, "Unsupported npm audit report version");
  assert.ok(!Object.hasOwn(report, "error"), "npm audit returned an error report");
  assert.ok(isObject(report.metadata), "npm audit metadata is missing or malformed");
  const counts = report.metadata.vulnerabilities;
  assert.ok(isObject(counts), "npm audit vulnerability counts are missing or malformed");
  const severities = ["info", "low", "moderate", "high", "critical", "total"];
  assert.deepEqual(Object.keys(counts).sort(), [...severities].sort(), "Unexpected npm audit counters");
  for (const severity of severities) {
    assert.ok(Number.isSafeInteger(counts[severity]) && counts[severity] >= 0, "Invalid npm audit count");
    assert.equal(counts[severity], 0, `npm audit reports ${counts[severity]} ${severity} findings`);
  }

  assert.ok(isObject(report.vulnerabilities), "npm audit vulnerability map is missing or malformed");
  const vulnerabilities = report.vulnerabilities;
  const names = Object.keys(vulnerabilities).sort();
  assert.deepEqual(
    names,
    [],
    `Unexpected Benefits wallet advisory set: ${names.join(", ") || "none"}`,
  );
  assert.equal(status, 0, "npm audit must be clean for the scoped jayson 5.0.0 graph");
}

module.exports = { checkAuditReport };

if (require.main === module) {
  const { spawnSync } = require("node:child_process");
  const fs = require("node:fs");
  const path = require("node:path");

  const appRoot = path.resolve(__dirname, "../apps/benefits-wallet-prototype");
  const lock = JSON.parse(fs.readFileSync(path.join(appRoot, "package-lock.json"), "utf8"));

  const expectedChain = [
    ["", "@coinbase/cdp-core"],
    ["node_modules/@coinbase/cdp-core", "@solana/web3.js"],
    ["node_modules/@solana/web3.js", "jayson"],
  ];

  for (const [packagePath, dependency] of expectedChain) {
    const entry = lock.packages?.[packagePath];
    assert.ok(entry, `Missing lockfile package entry: ${packagePath || "<root>"}`);
    assert.ok(
      entry.dependencies?.[dependency],
      `${packagePath || "<root>"} must depend on ${dependency}`,
    );
  }

  const jayson = lock.packages["node_modules/jayson"];
  assert.ok(jayson, "Missing lockfile package entry: node_modules/jayson");
  assert.equal(jayson.version, "5.0.0", "jayson must stay on the scoped 5.0.0 candidate");
  assert.equal(
    jayson.resolved,
    "https://registry.npmjs.org/jayson/-/jayson-5.0.0.tgz",
    "jayson must resolve to the published 5.0.0 tarball",
  );
  assert.equal(
    jayson.integrity,
    "sha512-FghxOWlJB5ZPsRsuMF1U4GFHjkJfOEYSlIHpI6Wt6MXIzvqWVo0Kpl7/SMfY36vWggA+b+L09zRGP6m4ROVnKg==",
    "jayson 5.0.0 integrity must match the published registry SRI",
  );
  for (const dropped of ["stream-json", "uuid", "eyes"]) {
    assert.ok(
      !jayson.dependencies?.[dropped],
      `jayson 5.0.0 must not reintroduce the ${dropped} dependency`,
    );
  }
  for (const removed of ["node_modules/stream-json", "node_modules/stream-chain", "node_modules/eyes"]) {
    assert.ok(
      !lock.packages[removed],
      `${removed} must be absent once the jayson 4 chain is gone`,
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

  try {
    checkAuditReport(audit.status, audit.stdout);
  } catch (error) {
    if (error.message.startsWith("npm audit returned invalid JSON: ")) {
      throw new Error(`${error.message}\n${audit.stderr}`);
    }
    throw error;
  }

  console.log(
    "Benefits wallet advisory baseline: patched URI decoder; scoped jayson 5.0.0 graph " +
      "without the vulnerable stream-json chain; clean npm audit required.",
  );
}
