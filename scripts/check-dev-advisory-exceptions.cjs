#!/usr/bin/env node
// Strict npm audit for one app (run from the app directory), with a short, reviewed list of
// development-only advisories that have no patched release yet.
//
// - `npm audit --omit=dev` must be clean: production dependencies get no exceptions.
// - The full audit may only report the advisories listed below, and only through packages the lockfile marks dev.
// - Every reported vulnerability must resolve (directly or through npm's transitive `via` pointers) to an
//   accepted root advisory; anything unexplained fails.
// - Both reports must be complete audit-report v2 JSON: an `error` field, missing or inconsistent metadata fails.
// - An exception fails when its advisory range changes or after its review date. Range stability does
//   not prove that no patched release exists; scoped records also require an explicit upstream recheck.
//   npm "fixAvailable" is not used: for these advisories it only proposes semver-major tool migrations.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const POLICY_VERSION = "benefits-full52-policy-v2-reviewed-dev-20261028";
const verifiedContexts = new WeakMap();

const EXCEPTIONS = {
  // braces <= 3.0.3: stack exhaustion on deeply nested brace patterns. No patched release exists
  // (2026-10-03). Reached only through test/build tooling (jest, micromatch, chokidar); application
  // code never expands untrusted brace patterns.
  "GHSA-vfj7-8cjw-p6xm": { package: "braces", range: "<=3.0.3", reviewBy: "2026-11-03" },
  // Temporary backend-only disposition; not a vulnerability fix or global exception.
  "GHSA-gcqx-w48m-w2h4": {
    "package": "deepmerge",
    "range": ">=4.2.0 <=4.3.1",
    "reviewedOn": "2026-10-28",
    "reviewBy": "2026-11-03",
    "scope": {
      "repoRelativeApp": "apps/benefits-network/backend",
      "rootPackageName": "ifr-benefits-network-backend",
      "exactDevNodeVersions": {
        "node_modules/@jest/core": "29.7.0",
        "node_modules/create-jest": "29.7.0",
        "node_modules/deepmerge": "4.3.1",
        "node_modules/jest": "29.7.0",
        "node_modules/jest-cli": "29.7.0",
        "node_modules/jest-config": "29.7.0",
        "node_modules/ts-jest": "29.4.11"
      },
      "sourceSha256": {
        "apps/benefits-network/backend/package.json": "70f25c46de6cb7791bfc63e36be75dea08a0848a70b8155a3cda23dea1207b24",
        "apps/benefits-network/backend/package-lock.json": "309f47e197d2c5f4bd24400666fbe8c106438032f47e11837c8f6dab25bd3091",
        "apps/benefits-network/backend/jest.config.js": "171bcc553276995dbede6b66b386595c4445371ea814f4dc9ec98e198e1a02b2",
        "apps/benefits-network/backend/Dockerfile": "6ae5b5650303dbe3cfc6cfe552c2fda0ccb09b50f71e4e887ab5860fade44e83"
      }
    }
  },
};

const SEVERITIES = ["info", "low", "moderate", "high", "critical"];
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Build context from actual canonical paths and file bytes, never a caller-provided scope label.
// The optional root supports isolated filesystem selftests; the CLI always uses this checkout root.
function createAuditContext(appDir, root = path.resolve(__dirname, "..")) {
  const canonicalRoot = fs.realpathSync(root);
  const canonicalApp = fs.realpathSync(appDir);
  const relative = path.relative(canonicalRoot, canonicalApp).split(path.sep).join("/");
  const context = { repoRelativeApp: relative, rootPackageName: null, sourceSha256: {} };
  let lockSemanticSha256 = null;
  if (relative === "apps/benefits-network/backend") {
    for (const file of Object.keys(EXCEPTIONS["GHSA-gcqx-w48m-w2h4"].scope.sourceSha256)) {
      const resolved = fs.realpathSync(path.join(canonicalRoot, file));
      if (path.relative(canonicalRoot, resolved).startsWith("..") || path.isAbsolute(path.relative(canonicalRoot, resolved))) {
        throw new Error(`reviewed source escapes checkout: ${file}`);
      }
      const bytes = fs.readFileSync(resolved);
      if (file.endsWith("/package.json")) context.rootPackageName = JSON.parse(bytes.toString("utf8")).name;
      context.sourceSha256[file] = createHash("sha256").update(bytes).digest("hex");
      if (file.endsWith("/package-lock.json")) {
        lockSemanticSha256 = createHash("sha256").update(JSON.stringify(JSON.parse(bytes.toString("utf8")))).digest("hex");
      }
    }
  }
  Object.freeze(context.sourceSha256);
  Object.freeze(context);
  verifiedContexts.set(context, { lockSemanticSha256 });
  return context;
}

function checkScopedDisposition(id, exception, context, lock, full, today) {
  if (!context || !verifiedContexts.has(context)) throw new Error(`${id}: missing verified canonical context`);
  const scope = exception.scope;
  if (context.repoRelativeApp !== scope.repoRelativeApp || context.rootPackageName !== scope.rootPackageName) {
    throw new Error(`${id}: wrong reviewed application context`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || today < exception.reviewedOn) throw new Error(`${id}: invalid or premature review date`);
  if (lock.name !== scope.rootPackageName || lock.packages[""]?.name !== scope.rootPackageName) {
    throw new Error(`${id}: wrong lock root package`);
  }
  if (createHash("sha256").update(JSON.stringify(lock)).digest("hex") !== verifiedContexts.get(context).lockSemanticSha256) {
    throw new Error(`${id}: audited lock does not match verified source snapshot`);
  }
  for (const [file, digest] of Object.entries(scope.sourceSha256)) {
    if (context.sourceSha256[file] !== digest) throw new Error(`${id}: reviewed source pin mismatch: ${file}`);
  }
  for (const [node, version] of Object.entries(scope.exactDevNodeVersions)) {
    const entry = lock.packages[node];
    if (!entry || entry.version !== version || !(entry.dev === true || entry.devOptional === true)) {
      throw new Error(`${id}: reviewed development node/version mismatch: ${node}`);
    }
  }
  assertDevCovered(full, lock);
}

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
function evaluate({ prod, full, lock, today, context, exceptions = EXCEPTIONS }) {
  const prodVulns = validateReport(prod, "production audit");
  if (Object.keys(prodVulns).length !== 0) {
    throw new Error(`production dependencies have advisories: ${Object.keys(prodVulns).join(", ")}`);
  }
  const vulns = validateReport(full, "full audit");
  if (!isObject(lock) || !isObject(lock.packages)) throw new Error("package-lock.json has no packages map");

  const used = new Set();
  const scopedNodes = new Map();
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
      if (exception.scope) {
        checkScopedDisposition(id, exception, context, lock, full, today);
        if (!scopedNodes.has(id)) scopedNodes.set(id, new Set());
      }
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
      for (const id of roots) {
        const expected = exceptions[id].scope?.exactDevNodeVersions;
        if (!expected) continue;
        if (!Object.hasOwn(expected, node) || node !== `node_modules/${name}`) {
          throw new Error(`${id}: unreviewed affected node/package: ${name} at ${node}`);
        }
        scopedNodes.get(id).add(node);
      }
    }
  }
  for (const [id, nodes] of scopedNodes) {
    const expected = Object.keys(exceptions[id].scope.exactDevNodeVersions);
    if (nodes.size !== expected.length || expected.some((node) => !nodes.has(node))) {
      throw new Error(`${id}: incomplete reviewed advisory node coverage`);
    }
  }
  return [...used];
}

// Arguments are explicit so that NODE_ENV=production or npm omit/production config can never
// silently drop dev dependencies from the full audit, and project/user/global .npmrc settings
// (include=dev, production=false, dev=true, also=dev) can never add them to the production audit:
// npm drops an omitted type whenever any of those keys includes it, so each is overridden on the
// command line, which outranks every config file (verified against npm 10 effective config).
const AUDIT_ARGS = {
  prod: ["--omit=dev", "--include=prod", "--production", "--dev=false", "--also=null"],
  full: ["--include=dev"],
};

/** Environment for npm audit without variables that change which dependency types are audited. */
function auditEnv(env = process.env) {
  const clean = { ...env };
  for (const key of Object.keys(clean)) {
    if (/^(NODE_ENV|npm_config_(omit|include|production|only|dev|also))$/i.test(key)) delete clean[key];
  }
  return clean;
}

/** The full audit must actually cover dev dependencies whenever the lockfile has any. */
function assertDevCovered(full, lock) {
  const lockHasDev = Object.entries(lock.packages || {}).some(([key, entry]) => key !== "" && entry && entry.dev === true);
  const devCount = full && full.metadata && full.metadata.dependencies && full.metadata.dependencies.dev;
  if (lockHasDev && !(Number.isInteger(devCount) && devCount > 0)) {
    throw new Error("full audit did not cover dev dependencies (metadata.dependencies.dev is 0 or missing)");
  }
}

function runAudit(appDir, extra, label) {
  const result = spawnSync("npm", ["audit", "--json", ...extra], { cwd: appDir, encoding: "utf8", env: auditEnv(), maxBuffer: 20 * 1024 * 1024 });
  if (result.error) throw new Error(`npm audit could not start: ${result.error.message}`);
  if (result.status !== 0 && result.status !== 1) throw new Error(`npm audit exited with ${result.status}: ${result.stderr}`);
  try {
    const report = JSON.parse(result.stdout);
    validateReport(report, `${label} audit`);
    const digest = createHash("sha256").update(result.stdout).digest("hex");
    console.log(`[dev-advisory-audit] BEGIN label=${label} bytes=${Buffer.byteLength(result.stdout)} sha256=${digest} status=${result.status} policy=${POLICY_VERSION}`);
    process.stdout.write(result.stdout);
    if (!result.stdout.endsWith("\n")) process.stdout.write("\n");
    console.log(`[dev-advisory-audit] END label=${label}`);
    return report;
  } catch (error) {
    throw new Error(`npm audit returned invalid JSON: ${error.message}`);
  }
}

module.exports = { evaluate, validateReport, EXCEPTIONS, AUDIT_ARGS, auditEnv, assertDevCovered, createAuditContext, POLICY_VERSION };

if (require.main === module) {
  const appDir = process.cwd();
  const where = path.relative(path.resolve(__dirname, ".."), appDir) || ".";
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(appDir, "package-lock.json"), "utf8"));
    if (process.argv.length !== 2) throw new Error("run from the app directory; command-line context labels are not accepted");
    const full = runAudit(appDir, AUDIT_ARGS.full, "full");
    assertDevCovered(full, lock);
    const used = evaluate({
      prod: runAudit(appDir, AUDIT_ARGS.prod, "production"),
      full,
      lock,
      today: new Date().toISOString().slice(0, 10),
      context: createAuditContext(appDir),
    });
    console.log(`[dev-advisory-exceptions] PASS (${where}) - policy=${POLICY_VERSION}; production audit clean; dev exceptions used: ${used.join(", ") || "none needed"}`);
  } catch (error) {
    console.error(`[dev-advisory-exceptions] FAIL (${where}): ${error.message}`);
    process.exit(1);
  }
}
