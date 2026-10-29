// Self-test for scripts/check-dev-advisory-exceptions.cjs. Deterministic fixtures (no network):
// the dev-only braces chain passes; error/incomplete reports, inconsistent counts, unexplained or
// unmatched vulnerabilities, a changed advisory range, an expired exception and production placement fail.
// Set DEV_ADVISORY_LIVE=1 to additionally run the checker against throwaway npm projects (needs network).
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { evaluate, AUDIT_ARGS, auditEnv, assertDevCovered, EXCEPTIONS, POLICY_VERSION } = require("./check-dev-advisory-exceptions.cjs");

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
assert.equal(AUDIT_ARGS.prod[0], "--omit=dev", "production audit must omit dev dependencies");
{
  const env = auditEnv({ PATH: "/bin", NODE_ENV: "production", npm_config_omit: "dev", npm_config_production: "true", NPM_CONFIG_INCLUDE: "prod", npm_config_also: "dev", HOME: "/tmp" });
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "PATH"], "audit env must drop NODE_ENV and npm omit/include/production/also config");
}

// .npmrc-sourced dev inclusion must not reach the production audit, and .npmrc/NODE_ENV omission must not
// shrink the full audit (review T-203). `npm ls --package-lock-only` applies the same omit/include resolution
// as `npm audit` but works offline on a hand-written lockfile, so npm's effective config is checked without network.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-advisory-config-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", private: true, dependencies: { ms: "2.1.3" }, devDependencies: { braces: "3.0.3" } }));
  fs.writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify({
    name: "fixture", version: "1.0.0", lockfileVersion: 3, requires: true,
    packages: {
      "": { name: "fixture", version: "1.0.0", dependencies: { ms: "2.1.3" }, devDependencies: { braces: "3.0.3" } },
      "node_modules/ms": { version: "2.1.3" },
      "node_modules/braces": { version: "3.0.3", dev: true },
    },
  }));
  const userrc = path.join(dir, "user.npmrc");
  const env = auditEnv({ ...process.env, NODE_ENV: "production", npm_config_userconfig: userrc, npm_config_globalconfig: path.join(dir, "global.npmrc") });
  const audited = (args, projectrc, userConfig = "") => {
    fs.writeFileSync(path.join(dir, ".npmrc"), projectrc);
    fs.writeFileSync(userrc, userConfig);
    const result = spawnSync("npm", ["ls", "--package-lock-only", "--offline", "--json", ...args], { cwd: dir, encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr);
    return Object.keys(JSON.parse(result.stdout).dependencies || {}).sort();
  };
  try {
    for (const rc of ["include=dev\n", "production=false\n", "dev=true\n", "also=dev\n", "include=dev\nproduction=false\ndev=true\nalso=dev\n"]) {
      // Negative control: a bare --omit=dev is contaminated by this config, so the fixture really exercises it.
      assert.deepEqual(audited(["--omit=dev"], rc), ["braces", "ms"], `bare --omit=dev should be contaminated by ${JSON.stringify(rc)}`);
      assert.deepEqual(audited(AUDIT_ARGS.prod, rc), ["ms"], `project .npmrc ${JSON.stringify(rc)} leaked dev deps into the production audit`);
      assert.deepEqual(audited(AUDIT_ARGS.prod, "", rc), ["ms"], `user .npmrc ${JSON.stringify(rc)} leaked dev deps into the production audit`);
    }
    for (const rc of ["", "omit=dev\n", "production=true\n", "only=prod\n"]) {
      assert.deepEqual(audited(AUDIT_ARGS.full, rc), ["braces", "ms"], `.npmrc ${JSON.stringify(rc)} with NODE_ENV=production dropped dev deps from the full audit`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
{
  const lockWithDev = { packages: { "": {}, "node_modules/braces": { dev: true } } };
  assert.throws(() => assertDevCovered({ metadata: { dependencies: { prod: 3, dev: 0, total: 3 } } }, lockWithDev), /did not cover dev/);
  assert.throws(() => assertDevCovered({ metadata: {} }, lockWithDev), /did not cover dev/);
  assertDevCovered({ metadata: { dependencies: { prod: 3, dev: 5, total: 8 } } }, lockWithDev);
  assertDevCovered({ metadata: { dependencies: { prod: 3, dev: 0, total: 3 } } }, { packages: { "": {}, "node_modules/a": {} } });
}
console.log("[dev-advisory-exceptions-test] PASS - full audit forces dev, production audit stays prod-only under .npmrc/env config, dev coverage asserted");

// The supported runner migration removes both deepmerge dispositions. These are
// deliberately historical fixture graphs, never substitutes for real app audits.
{
  const id = 'GHSA-gcqx-w48m-w2h4';
  const apps = {
    'apps/benefits-network/backend': {
      '@jest/core': '29.7.0', 'create-jest': '29.7.0', deepmerge: '4.3.1',
      jest: '29.7.0', 'jest-cli': '29.7.0', 'jest-config': '29.7.0', 'ts-jest': '29.4.11',
    },
    'apps/creator-gateway': {
      '@jest/core': '30.2.0', deepmerge: '4.3.1', jest: '30.2.0',
      'jest-cli': '30.2.0', 'jest-config': '30.2.0', 'ts-jest': '29.4.6',
    },
  };
  assert.equal(POLICY_VERSION, 'benefits-full52-policy-v4-supported-test-runners-20261029');
  assert.equal(Object.hasOwn(EXCEPTIONS, id), false, 'the former development allowance must stay removed');
  let checks = 2;
  for (const [app, versions] of Object.entries(apps)) {
    const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', app, 'package-lock.json'), 'utf8'));
    assert.equal(Object.keys(lock.packages).some(node => node === 'node_modules/deepmerge' || node.endsWith('/node_modules/deepmerge')), false);
    assert.deepEqual(evaluate({ prod: report({}), full: report({}), lock, today: '2026-11-04' }), [], 'clean graph needs no expired context reader');
    checks += 2;
    const legacyLock = structuredClone(lock);
    const vulns = {};
    for (const [name, version] of Object.entries(versions)) {
      legacyLock.packages[`node_modules/${name}`] = { version, dev: true };
      vulns[name] = { name, severity: 'low', nodes: [`node_modules/${name}`], via: name === 'deepmerge'
        ? [{ name, range: '>=4.2.0 <=4.3.1', url: `https://github.com/advisories/${id}` }]
        : [name === 'jest-config' ? 'deepmerge' : 'jest-config'] };
    }
    const full = report(vulns); full.metadata.dependencies = { dev: Object.keys(versions).length };
    const legacy = () => ({ prod: report({}), full: structuredClone(full), lock: structuredClone(legacyLock), today: '2026-10-29' });
    const reject = (change, pattern, label) => {
      const value = legacy(); change(value);
      assert.throws(() => evaluate(value), pattern, `${app}: ${label}`); checks++;
    };
    reject(() => {}, /not an accepted exception/, 'formerly accepted graph is rejected');
    for (const today of ['2026-10-27', '2026-11-03', '2026-11-04']) {
      reject(x => { x.today = today; }, /not an accepted exception/, 'no historical or renewed date allowance');
    }
    for (const repoRelativeApp of Object.keys(apps).concat('apps/other-app')) {
      reject(x => { x.context = { repoRelativeApp, rootPackageName: lock.name }; }, /not an accepted exception/, 'caller context cannot restore a removed allowance');
    }
    reject(x => { x.prod = report({ deepmerge: x.full.vulnerabilities.deepmerge }); }, /production dependencies/, 'production stays zero');
    reject(x => { x.full.vulnerabilities.deepmerge.via[0].url = 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc'; }, /not an accepted exception/, 'unknown advisory');
    reject(x => { x.full.vulnerabilities.deepmerge.via[0].range = '<4.3.2'; }, /not an accepted exception/, 'changed advisory range');
    reject(x => { x.lock.packages['node_modules/deepmerge'].dev = false; }, /not an accepted exception/, 'production-marked legacy node cannot restore allowance');
    reject(x => { x.lock.packages['node_modules/deepmerge'].version = '4.3.2'; }, /not an accepted exception/, 'changed legacy version cannot restore allowance');
    for (const dependencies of [undefined, { dev: 0 }]) {
      const omitted = structuredClone(full);
      if (dependencies) omitted.metadata.dependencies = dependencies;
      else delete omitted.metadata.dependencies;
      assert.throws(() => assertDevCovered(omitted, legacyLock), /did not cover dev/); checks++;
    }
  }
  console.log(`[dev-advisory-removed-contexts self-test] PASS ${checks} clean/legacy/prod/unknown/date/context/coverage controls; fixtures only`);
}
