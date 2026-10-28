// Self-test for scripts/check-dev-advisory-exceptions.cjs. Deterministic fixtures (no network):
// the dev-only braces chain passes; error/incomplete reports, inconsistent counts, unexplained or
// unmatched vulnerabilities, a changed advisory range, an expired exception and production placement fail.
// Set DEV_ADVISORY_LIVE=1 to additionally run the checker against throwaway npm projects (needs network).
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { evaluate, AUDIT_ARGS, auditEnv, assertDevCovered, createAuditContext, EXCEPTIONS, POLICY_VERSION, SCOPED_DISPOSITIONS } = require("./check-dev-advisory-exceptions.cjs");

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

// Reviewed backend disposition: deterministic fixtures, never release-audit substitutes.
{
  const id = "GHSA-gcqx-w48m-w2h4";
  const record = EXCEPTIONS[id];
  const root = path.resolve(__dirname, "..");
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "dev-advisory-scope-"));
  const app = path.join(fixture, record.scope.repoRelativeApp);
  const originals = {};
  for (const file of Object.keys(record.scope.sourceSha256)) {
    const bytes = fs.readFileSync(path.join(root, file)); originals[file] = bytes;
    fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
    fs.writeFileSync(path.join(fixture, file), bytes);
  }
  const parents = {
    "@jest/core": ["jest-config"], "create-jest": ["jest-config"],
    deepmerge: [{ name: "deepmerge", url: `https://github.com/advisories/${id}`, range: record.range }],
    jest: ["@jest/core", "jest-cli"], "jest-cli": ["@jest/core", "create-jest", "jest-config"],
    "jest-config": ["deepmerge"], "ts-jest": ["jest"],
  };
  const full = () => ({ ...report(Object.fromEntries(Object.entries(structuredClone(parents)).map(([name, via]) =>
    [name, { name, severity: "low", via, nodes: [`node_modules/${name}`] }]))),
    metadata: { vulnerabilities: { info: 0, low: 7, moderate: 0, high: 0, critical: 0, total: 7 }, dependencies: { dev: 303 } } });
  const scopedInput = () => ({ prod: report({}), full: full(),
    lock: JSON.parse(originals[`${record.scope.repoRelativeApp}/package-lock.json`]),
    context: createAuditContext(app, fixture), today: "2026-10-28" });
  let checked = 0;
  const rejects = (change, pattern, label) => {
    const value = scopedInput(); change(value);
    assert.throws(() => evaluate(value), pattern, label); checked++;
  };
  try {
    assert.match(POLICY_VERSION, /^benefits-full52-policy-v3-reviewed-app-contexts-20261028$/);
    assert.deepEqual(evaluate(scopedInput()), [id]); checked++;
    assert.deepEqual(evaluate({ ...scopedInput(), today: "2026-11-03" }), [id]); checked++;
    rejects(x => delete x.context, /verified canonical context/, "missing context");
    rejects(x => { x.context = { ...x.context }; }, /verified canonical context/, "caller-supplied labels cannot forge verified context");
    rejects(x => { x.context = createAuditContext(fixture, fixture); }, /application context/, "wrong app path");
    rejects(x => { x.lock.name = "other"; }, /lock root package/, "wrong lock package");
    rejects(x => { x.lock.packages["node_modules/deepmerge"].version = "4.3.2"; }, /lock|version/, "changed lock/version");
    rejects(x => { x.lock.packages["node_modules/deepmerge"].dev = false; }, /lock|development/, "non-dev node");
    rejects(x => { x.prod = report({ deepmerge: full().vulnerabilities.deepmerge }); }, /production dependencies/, "production never exempt");
    rejects(x => { x.full.vulnerabilities.deepmerge.via[0].url = "https://github.com/advisories/GHSA-aaaa-bbbb-cccc"; }, /not an accepted exception/, "unknown advisory");
    rejects(x => { x.full.vulnerabilities.deepmerge.via[0].name = "other"; }, /accepted only for deepmerge/, "changed package");
    rejects(x => { x.full.vulnerabilities.deepmerge.via[0].range = "<4.3.2"; }, /range is now/, "changed range");
    rejects(x => { x.full.metadata.dependencies.dev = 0; }, /did not cover dev/, "omitted dev audit");
    rejects(x => { delete x.full.metadata.dependencies; }, /did not cover dev/, "missing dev coverage");
    rejects(x => { const v = x.full.vulnerabilities; delete v["ts-jest"]; x.full.metadata.vulnerabilities = counts(v); }, /incomplete reviewed/, "missing reviewed advisory node");
    rejects(x => { x.full.vulnerabilities["jest-util"] = { name: "jest-util", severity: "low", via: ["deepmerge"], nodes: ["node_modules/jest-util"] }; x.full.metadata.vulnerabilities = counts(x.full.vulnerabilities); }, /unreviewed affected/, "additional affected node");
    rejects(x => { x.today = "2026-11-04"; }, /expired/, "expiry");
    rejects(x => { x.today = "2026-10-27"; }, /premature/, "not effective before review");
    rejects(x => { x.today = "invalid"; }, /expired|invalid/, "invalid date");
    for (const file of Object.keys(record.scope.sourceSha256)) {
      fs.appendFileSync(path.join(fixture, file), "\n");
      assert.throws(() => evaluate(scopedInput()), /source pin mismatch/, `changed reviewed bytes: ${file}`); checked++;
      fs.writeFileSync(path.join(fixture, file), originals[file]);
    }
    const packageFile = `${record.scope.repoRelativeApp}/package.json`;
    const pkg = JSON.parse(originals[packageFile]); pkg.name = "another-backend";
    fs.writeFileSync(path.join(fixture, packageFile), JSON.stringify(pkg));
    assert.throws(() => evaluate(scopedInput()), /application context/, "wrong package name"); checked++;
    fs.writeFileSync(path.join(fixture, packageFile), originals[packageFile]);
    const docker = `${record.scope.repoRelativeApp}/Dockerfile`;
    const outside = path.join(os.tmpdir(), `dev-advisory-outside-${process.pid}`);
    fs.writeFileSync(outside, originals[docker]); fs.unlinkSync(path.join(fixture, docker));
    try {
      fs.symlinkSync(outside, path.join(fixture, docker));
      assert.throws(() => createAuditContext(app, fixture), /escapes checkout/, "source symlink cannot leave checkout"); checked++;
    } finally { fs.rmSync(outside, { force: true }); }
    console.log(`[dev-advisory-scoped self-test] PASS ${checked} scope/version/pin/coverage/expiry controls; fixture audits only`);
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
}

// Two reviewed consumers share an advisory id, never an application/context allowance.
{
  const id = 'GHSA-gcqx-w48m-w2h4';
  const creator = 'apps/creator-gateway';
  const backend = 'apps/benefits-network/backend';
  const root = path.resolve(__dirname, '..');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-advisory-apps-'));
  const originals = {};
  for (const records of Object.values(SCOPED_DISPOSITIONS)) {
    for (const file of Object.keys(records[id].scope.sourceSha256)) {
      const bytes = fs.readFileSync(path.join(root, file)); originals[file] = bytes;
      fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
      fs.writeFileSync(path.join(fixture, file), bytes);
    }
  }
  function appInput(app) {
    const record = SCOPED_DISPOSITIONS[app][id];
    const vulns = Object.fromEntries(Object.keys(record.scope.exactDevNodeVersions).map(node => {
      const name = node.slice('node_modules/'.length);
      const via = name === 'deepmerge'
        ? [{ name, range: record.range, url: `https://github.com/advisories/${id}` }]
        : [name === 'jest-config' ? 'deepmerge' : 'jest-config'];
      return [name, { name, severity: 'low', via, nodes: [node] }];
    }));
    const full = report(vulns); full.metadata.dependencies = { dev: 359 };
    return { prod: report({}), full, lock: JSON.parse(originals[`${app}/package-lock.json`]),
      context: createAuditContext(path.join(fixture, app), fixture), today: '2026-10-28' };
  }
  let checks = 0;
  const rejects = (change, pattern, label) => {
    const value = appInput(creator); change(value);
    assert.throws(() => evaluate(value), pattern, label); checks++;
  };
  try {
    assert.equal(POLICY_VERSION, 'benefits-full52-policy-v3-reviewed-app-contexts-20261028');
    assert.deepEqual(evaluate(appInput(creator)), [id]); checks++;
    assert.deepEqual(evaluate(appInput(backend)), [id]); checks++;
    assert.equal(Object.keys(SCOPED_DISPOSITIONS[creator][id].scope.exactDevNodeVersions).length, 6);
    assert.equal(Object.keys(EXCEPTIONS[id].scope.exactDevNodeVersions).length, 7);
    assert.equal(SCOPED_DISPOSITIONS[backend][id], EXCEPTIONS[id], 'same accepted backend record object');
    rejects(x => { x.context = appInput(backend).context; }, /lock root|source|application/, 'backend context cannot authorize Creator graph');
    const cross = appInput(backend); cross.context = appInput(creator).context;
    assert.throws(() => evaluate(cross), /lock root|source|application/, 'Creator context cannot authorize backend graph'); checks++;
    rejects(x => { delete x.context; }, /verified canonical context/, 'Creator needs actual context');
    rejects(x => { x.context = { ...x.context }; }, /verified canonical context/, 'scope labels cannot forge Creator context');
    const other = path.join(fixture, 'apps/other-app'); fs.mkdirSync(other, { recursive: true });
    rejects(x => { x.context = createAuditContext(other, fixture); }, /application context/, 'other apps inherit no disposition');
    rejects(x => { x.lock.name = 'other'; }, /lock root package/, 'wrong root package');
    for (const node of Object.keys(SCOPED_DISPOSITIONS[creator][id].scope.exactDevNodeVersions)) {
      rejects(x => { x.lock.packages[node].version = '0.0.0'; }, /lock|version/, `version change: ${node}`);
      rejects(x => { x.lock.packages[node].dev = false; }, /lock|development/, `non-dev node: ${node}`);
    }
    rejects(x => { x.prod = report({ deepmerge: x.full.vulnerabilities.deepmerge }); }, /production dependencies/, 'production is always zero');
    rejects(x => { x.full.vulnerabilities.deepmerge.via[0].url = 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc'; }, /not an accepted exception/, 'unknown root');
    rejects(x => { x.full.vulnerabilities.deepmerge.via[0].name = 'other'; }, /accepted only for deepmerge/, 'wrong advisory package');
    rejects(x => { x.full.vulnerabilities.deepmerge.via[0].range = '<4.3.2'; }, /range is now/, 'changed advisory range');
    rejects(x => { delete x.full.metadata.dependencies; }, /did not cover dev/, 'missing full dev coverage');
    rejects(x => { x.full.metadata.dependencies.dev = 0; }, /did not cover dev/, 'zero full dev coverage');
    rejects(x => { delete x.full.vulnerabilities['ts-jest']; x.full.metadata.vulnerabilities = counts(x.full.vulnerabilities); }, /incomplete reviewed/, 'missing reviewed node');
    rejects(x => { x.full.vulnerabilities['jest-util'] = { name: 'jest-util', severity: 'low', via: ['deepmerge'], nodes: ['node_modules/jest-util'] }; x.full.metadata.vulnerabilities = counts(x.full.vulnerabilities); }, /unreviewed affected/, 'unreviewed additional node');
    rejects(x => { x.today = '2026-11-04'; }, /expired/, 'Creator expiry');
    rejects(x => { x.today = '2026-10-27'; }, /premature/, 'Creator review not yet effective');
    assert.deepEqual(evaluate({ ...appInput(creator), today: '2026-11-03' }), [id]); checks++;
    for (const file of Object.keys(SCOPED_DISPOSITIONS[creator][id].scope.sourceSha256)) {
      fs.appendFileSync(path.join(fixture, file), '\n');
      assert.throws(() => evaluate(appInput(creator)), /source pin mismatch/, `changed Creator source/config/workflow: ${file}`); checks++;
      fs.writeFileSync(path.join(fixture, file), originals[file]);
    }
    const pkgFile = `${creator}/package.json`; const pkg = JSON.parse(originals[pkgFile]); pkg.name = 'other-app';
    fs.writeFileSync(path.join(fixture, pkgFile), JSON.stringify(pkg));
    assert.throws(() => evaluate(appInput(creator)), /application context/, 'actual Creator package identity'); checks++;
    fs.writeFileSync(path.join(fixture, pkgFile), originals[pkgFile]);
    console.log(`[dev-advisory-app-contexts self-test] PASS ${checks} both-consumer isolation/pin/version/prod/coverage/expiry controls; fixtures only`);
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
}
