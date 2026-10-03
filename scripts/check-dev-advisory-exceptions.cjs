#!/usr/bin/env node
// Strict npm audit for one app (run from the app directory), with a short, reviewed list of
// development-only advisories that have no patched release yet.
//
// - `npm audit --omit=dev --audit-level=low` must be clean: production dependencies get no exceptions.
// - The full audit may only report the advisories listed below, and only through packages the lockfile marks dev.
// - An exception fails when the advisory range changes (a patched release appeared) or after its review date.
//   npm "fixAvailable" is not used: for these advisories it only proposes semver-major tool migrations.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const EXCEPTIONS = {
  // braces <= 3.0.3: stack exhaustion on deeply nested brace patterns. No patched release exists
  // (2026-10-03). Reached only through test/build tooling (jest, micromatch, chokidar); application
  // code never expands untrusted brace patterns.
  "GHSA-vfj7-8cjw-p6xm": { package: "braces", range: "<=3.0.3", reviewBy: "2026-11-03" },
};

const appDir = process.cwd();
const fail = (message) => {
  console.error(`[dev-advisory-exceptions] FAIL (${path.relative(path.resolve(__dirname, ".."), appDir) || "."}): ${message}`);
  process.exit(1);
};

const runAudit = (extra) => {
  const result = spawnSync("npm", ["audit", "--json", ...extra], { cwd: appDir, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.error) fail(`npm audit could not start: ${result.error.message}`);
  if (result.status !== 0 && result.status !== 1) fail(`npm audit exited with ${result.status}: ${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return fail(`npm audit returned invalid JSON: ${error.message}`);
  }
};

const prod = runAudit(["--omit=dev"]);
if ((prod.metadata?.vulnerabilities?.total ?? 1) !== 0) {
  fail(`production dependencies have advisories: ${JSON.stringify(prod.metadata?.vulnerabilities)}`);
}

const lock = JSON.parse(fs.readFileSync(path.join(appDir, "package-lock.json"), "utf8"));
const report = runAudit([]);
const today = new Date().toISOString().slice(0, 10);
const used = new Set();

for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via !== "object") continue; // transitive pointer; the root advisory is checked on its own package
    const id = String(via.url || "").split("/").pop();
    const exception = EXCEPTIONS[id];
    if (!exception || exception.package !== via.name) fail(`${name}: advisory ${id || via.title} is not an accepted exception`);
    if (via.range !== exception.range) fail(`${id} range is now ${via.range}: a patched release exists, upgrade ${via.name}`);
    if (today > exception.reviewBy) fail(`${id} exception expired on ${exception.reviewBy}; review it`);
    used.add(id);
  }
  for (const node of vuln.nodes ?? []) {
    const entry = lock.packages?.[node];
    if (!entry || !(entry.dev || entry.devOptional)) fail(`${name} at ${node} is not development-only`);
  }
}

const accepted = [...used].join(", ") || "none needed";
console.log(`[dev-advisory-exceptions] PASS - production audit clean; dev exceptions used: ${accepted}`);
