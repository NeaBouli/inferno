#!/usr/bin/env node
// Strict npm audit for one app (run from the app directory), with a short, reviewed list of
// development-only advisories that have no patched release yet.
//
// - `npm audit --omit=dev` must be clean: production dependencies get no exceptions.
// - The full audit may only report the advisories listed below, and only through packages the lockfile marks dev.
// - Every reported vulnerability must resolve (directly or through npm's transitive `via` pointers) to an
//   accepted root advisory; anything unexplained fails.
// - Both reports must be complete audit-report v2 JSON: an `error` field, missing or inconsistent metadata fails.
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

const SEVERITIES = ["info", "low", "moderate", "high", "critical"];
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Validates one `npm audit --json` report; returns its vulnerability map. Throws on anything incomplete.
function validateReport(report, label) {
  if (!isObject(report)) throw new Error(`${label}: audit output is not a JSON object`);
  if (report.error !== undefined) throw new Error(`${label}: npm audit reported an error: ${JSON.stringify(report.error)}`);
  if (report.auditReportVersion !== 2) throw new Error(`${label}: unsupported auditReportVersion ${report.auditReportVersion}`);
  const counts = report.metadata?.vulnerabilities;
  if (!isObject(counts)) throw new Error(`${label}: metadata.vulnerabilities missing`);
  for (const key of [...SEVERITIES, "total"]) {
    if (!Number.isInteger(counts[key]) || counts[key] < 0) throw new Error(`${label}: metadata.vulnerabilities.${key} invalid`);
  }
  const sum = SEVERITIES.reduce((acc, key) => acc + counts[key], 0);
  if (sum !== counts.total) throw new Error(`${label}: severity counts sum to ${sum}, total says ${counts.total}`);
  if (!isObject(report.vulnerabilities)) throw new Error(`${label}: vulnerabilities map missing`);
  const entries = Object.entries(report.vulnerabilities);
  if (entries.length !== counts.total) {
    throw new Error(`${label}: metadata reports ${counts.total} vulnerable packages, report lists ${entries.length}`);
  }
  const bySeverity = Object.fromEntries(SEVERITIES.map((key) => [key, 0]));
  for (const [name, vuln] of entries) {
    if (!isObject(vuln) || !SEVERITIES.includes(vuln.severity)) throw new Error(`${label}: ${name} has no valid severity`);
    bySeverity[vuln.severity] += 1;
  }
  for (const key of SEVERITIES) {
    if (bySeverity[key] !== counts[key]) throw new Error(`${label}: ${key} count ${counts[key]} does not match ${bySeverity[key]} listed`);
  }
  return report.vulnerabilities;
}

// Pure decision: returns the accepted advisory ids used; throws with the first reason to fail.
function evaluate({ prod, full, lock, today, exceptions = EXCEPTIONS }) {
  const prodVulns = validateReport(prod, "production audit");
  if (Object.keys(prodVulns).length !== 0) {
    throw new Error(`production dependencies have advisories: ${Object.keys(prodVulns).join(", ")}`);
  }
  const vulns = validateReport(full, "full audit");
  if (!isObject(lock) || !isObject(lock.packages)) throw new Error("package-lock.json has no packages map");

  const used = new Set();
  const rootsOf = (name, seen = new Set()) => {
    if (seen.has(name)) return new Set();
    seen.add(name);
    const vuln = vulns[name];
    if (!vuln) throw new Error(`via pointer to ${name}, which the report does not list`);
    if (!Array.isArray(vuln.via) || vuln.via.length === 0) throw new Error(`${name}: empty via list`);
    const roots = new Set();
    for (const via of vuln.via) {
      if (typeof via === "string") {
        for (const id of rootsOf(via, seen)) roots.add(id);
        continue;
      }
      if (!isObject(via)) throw new Error(`${name}: malformed via entry`);
      const id = String(via.url || "").split("/").pop();
      const exception = exceptions[id];
      if (!/^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/.test(id) || !exception) {
        throw new Error(`${name}: advisory ${id || via.title || "unknown"} is not an accepted exception`);
      }
      if (exception.package !== via.name) throw new Error(`${name}: ${id} reported for ${via.name}, accepted only for ${exception.package}`);
      if (via.range !== exception.range) throw new Error(`${id} range is now ${via.range}: a patched release exists, upgrade ${via.name}`);
      if (today > exception.reviewBy) throw new Error(`${id} exception expired on ${exception.reviewBy}; review it`);
      roots.add(id);
    }
    return roots;
  };

  for (const [name, vuln] of Object.entries(vulns)) {
    const roots = rootsOf(name);
    if (roots.size === 0) throw new Error(`${name}: no accepted root advisory explains this vulnerability`);
    for (const id of roots) used.add(id);
    if (!Array.isArray(vuln.nodes) || vuln.nodes.length === 0) throw new Error(`${name}: no lockfile nodes reported`);
    for (const node of vuln.nodes) {
      const entry = lock.packages[node];
      if (!entry || !(entry.dev === true || entry.devOptional === true)) throw new Error(`${name} at ${node} is not development-only`);
    }
  }
  return [...used];
}

function runAudit(appDir, extra) {
  const result = spawnSync("npm", ["audit", "--json", ...extra], { cwd: appDir, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.error) throw new Error(`npm audit could not start: ${result.error.message}`);
  if (result.status !== 0 && result.status !== 1) throw new Error(`npm audit exited with ${result.status}: ${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`npm audit returned invalid JSON: ${error.message}`);
  }
}

module.exports = { evaluate, validateReport, EXCEPTIONS };

if (require.main === module) {
  const appDir = process.cwd();
  const where = path.relative(path.resolve(__dirname, ".."), appDir) || ".";
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(appDir, "package-lock.json"), "utf8"));
    const used = evaluate({
      prod: runAudit(appDir, ["--omit=dev"]),
      full: runAudit(appDir, []),
      lock,
      today: new Date().toISOString().slice(0, 10),
    });
    console.log(`[dev-advisory-exceptions] PASS (${where}) - production audit clean; dev exceptions used: ${used.join(", ") || "none needed"}`);
  } catch (error) {
    console.error(`[dev-advisory-exceptions] FAIL (${where}): ${error.message}`);
    process.exit(1);
  }
}
