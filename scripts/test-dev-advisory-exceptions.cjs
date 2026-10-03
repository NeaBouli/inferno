// Self-test for scripts/check-dev-advisory-exceptions.cjs. Deterministic fixtures (no network):
// the dev-only braces chain passes; error/incomplete reports, inconsistent counts, unexplained or
// unmatched vulnerabilities, a changed advisory range, an expired exception and production placement fail.
// Set DEV_ADVISORY_LIVE=1 to additionally run the checker against throwaway npm projects (needs network).
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { evaluate, AUDIT_ARGS, auditEnv, assertDevCovered } = require("./check-dev-advisory-exceptions.cjs");

const ID = "GHSA-vfj7-8cjw-p6xm";
const TODAY = "2026-10-03";
const counts = (vulns) => {
  const c = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const v of Object.values(vulns)) c[v.severity] += 1;
  return { ...c, total: Object.keys(vulns).length };
};
const report = (vulns) => ({ auditReportVersion: 2, vulnerabilities: vulns, metadata: { vulnerabilities: counts(vulns) } });
const brace = (range = "<=3.0.3", url = `https://github.com/advisories/${ID}`, name = "braces") => ({
  source: 1, name, dependency: name, title: "braces stack exhaustion", url, severity: "high", range,
});
const devChain = () => ({
  braces: { name: "braces", severity: "high", via: [brace()], nodes: ["node_modules/braces"] },
  micromatch: { name: "micromatch", severity: "high", via: ["braces"], nodes: ["node_modules/micromatch"] },
});
const devLock = () => ({
  packages: { "": {}, "node_modules/braces": { dev: true }, "node_modules/micromatch": { devOptional: true } },
});
const input = (overrides = {}) => ({ prod: report({}), full: report(devChain()), lock: devLock(), today: TODAY, ...overrides });
const fails = (overrides, pattern, label) => assert.throws(() => evaluate(input(overrides)), pattern, label);

// Positive cases
assert.deepEqual(evaluate(input()), [ID], "dev-only braces chain passes");
assert.deepEqual(evaluate(input({ full: report({}) })), [], "a clean full audit passes");

// Error / incomplete JSON
fails({ full: { ...report(devChain()), error: { code: "ENOLOCK", summary: "lock missing" } } }, /reported an error/, "full audit error field");
fails({ prod: { error: { code: "EAUDITNOPJSON" } } }, /reported an error/, "production audit error field");
fails({ full: { auditReportVersion: 2, vulnerabilities: devChain() } }, /metadata\.vulnerabilities missing/, "missing metadata");
fails({ full: { ...report(devChain()), auditReportVersion: 1 } }, /auditReportVersion/, "old report format");
fails({ full: "not json object" }, /not a JSON object/, "non-object report");
{
  const r = report({});
  r.metadata.vulnerabilities = { ...r.metadata.vulnerabilities, high: 2, total: 2 };
  fails({ full: r }, /lists 0/, "nonzero metadata with empty vulnerabilities");
}
{
  const r = report(devChain());
  r.metadata.vulnerabilities.total = 3;
  fails({ full: r }, /sum to 2/, "severity sum does not match total");
}
{
  const r = report(devChain());
  delete r.vulnerabilities;
  fails({ full: r }, /vulnerabilities map missing/, "absent vulnerabilities map");
}
{
  const r = report(devChain());
  r.metadata.vulnerabilities.high = 1;
  r.metadata.vulnerabilities.moderate = 1;
  fails({ full: r }, /count/, "per-severity counts inconsistent");
}

// Unexplained or unmatched vulnerabilities
fails({ full: report({ ...devChain(), lodash: { name: "lodash", severity: "high", via: [brace("<4.17.21", "https://github.com/advisories/GHSA-p6mc-m468-83gw", "lodash")], nodes: ["node_modules/lodash"] } }) },
  /not an accepted exception/, "unmatched advisory");
fails({ full: report({ micromatch: { name: "micromatch", severity: "high", via: ["braces"], nodes: ["node_modules/micromatch"] } }) },
  /does not list/, "string-only via to an unlisted package");
fails({ full: report({
  a: { name: "a", severity: "low", via: ["b"], nodes: ["node_modules/braces"] },
  b: { name: "b", severity: "low", via: ["a"], nodes: ["node_modules/braces"] },
}) }, /no accepted root advisory/, "string-only via cycle without a root advisory");
fails({ full: report({ ...devChain(), braces: { ...devChain().braces, via: [] } }) }, /empty via list/, "empty via");
fails({ full: report({ braces: { name: "braces", severity: "high", via: [brace("<=3.0.3", `https://github.com/advisories/${ID}`, "picomatch")], nodes: ["node_modules/braces"] } }) },
  /accepted only for braces/, "allowed id on another package");
fails({ full: report({ braces: { ...devChain().braces, via: [{ ...brace(), url: "" }] } }) }, /not an accepted exception/, "advisory without id");

// Changed range / expiry
fails({ full: report({ braces: { ...devChain().braces, via: [brace("<3.0.4")] } }) }, /patched release exists/, "changed advisory range");
fails({ today: "2026-11-04" }, /expired/, "expired exception");

// Production placement
fails({ prod: report({ braces: devChain().braces }) }, /production dependencies have advisories/, "braces in production audit");
{
  const lock = devLock();
  lock.packages["node_modules/braces"] = {};
  fails({ lock }, /not development-only/, "lockfile marks braces as production");
}
fails({ full: report({ ...devChain(), braces: { ...devChain().braces, nodes: [] } }) }, /no lockfile nodes/, "missing nodes");
fails({ lock: {} }, /no packages map/, "lockfile without packages");

// Fixtures must not have been mutated by the checker.
assert.deepEqual(input().full, report(devChain()));

if (process.env.DEV_ADVISORY_LIVE === "1") {
  const checker = path.join(__dirname, "check-dev-advisory-exceptions.cjs");
  const project = (field) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-advisory-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", private: true, [field]: { braces: "3.0.3" } }));
    const lock = spawnSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: dir, encoding: "utf8" });
    assert.equal(lock.status, 0, lock.stderr);
    return dir;
  };
  const run = (dir) => spawnSync(process.execPath, [checker], { cwd: dir, encoding: "utf8" });
  const dev = run(project("devDependencies"));
  assert.equal(dev.status, 0, dev.stderr);
  assert.match(dev.stdout, new RegExp(ID));
  const prod = run(project("dependencies"));
  assert.equal(prod.status, 1, "a production braces dependency must fail");
  assert.match(prod.stderr, /production dependencies have advisories/);
}
console.log("[dev-advisory-exceptions self-test] PASS");

// NODE_ENV=production / npm omit config must not shrink the full audit (review T-203).
assert.deepEqual(AUDIT_ARGS.full, ["--include=dev"], "full audit must force dev dependencies in");
assert.deepEqual(AUDIT_ARGS.prod, ["--omit=dev"], "production audit must omit dev dependencies");
{
  const env = auditEnv({ PATH: "/bin", NODE_ENV: "production", npm_config_omit: "dev", npm_config_production: "true", NPM_CONFIG_INCLUDE: "prod", HOME: "/tmp" });
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "PATH"], "audit env must drop NODE_ENV and npm omit/include/production config");
}
{
  const lockWithDev = { packages: { "": {}, "node_modules/braces": { dev: true } } };
  assert.throws(() => assertDevCovered({ metadata: { dependencies: { prod: 3, dev: 0, total: 3 } } }, lockWithDev), /did not cover dev/);
  assert.throws(() => assertDevCovered({ metadata: {} }, lockWithDev), /did not cover dev/);
  assertDevCovered({ metadata: { dependencies: { prod: 3, dev: 5, total: 8 } } }, lockWithDev);
  assertDevCovered({ metadata: { dependencies: { prod: 3, dev: 0, total: 3 } } }, { packages: { "": {}, "node_modules/a": {} } });
}
console.log("[dev-advisory-exceptions-test] PASS - full audit forces dev, env cannot omit dev, dev coverage asserted");
