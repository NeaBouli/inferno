#!/usr/bin/env node
"use strict";

// Project-owned compatibility qualification, not upstream support or an audit waiver.
// No installer/network operation belongs here. Installed roots are explicit inputs.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const { spawn } = require("node:child_process");

const WORK_MS = 170000; // Reserve cleanup time inside the orchestrator's 180s bound.
const OUTPUT_LIMIT = 2 * 1024 * 1024;
const children = new Set();
const checks = [];
let deadline;
let work;
let output;
let report;
let interrupted = false;

function fault(code) {
  const error = new Error(code);
  error.safeCode = code;
  return error;
}
function demand(condition, code) {
  if (!condition) throw fault(code);
}
function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
function same(left, right, code) {
  demand(JSON.stringify(left) === JSON.stringify(right), code);
}
function remaining(cap) {
  demand(!interrupted, "INTERRUPTED");
  const left = deadline - Date.now();
  demand(left > 0, "TOTAL_DEADLINE");
  return Math.min(cap, left);
}
function argumentsOf(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    demand(["--baseline-root", "--candidate-root", "--output"].includes(key), "CLI_OPTION");
    demand(!Object.hasOwn(values, key) && typeof argv[i + 1] === "string", "CLI_VALUE");
    demand(path.isAbsolute(argv[i + 1]), "CLI_ABSOLUTE_PATH_REQUIRED");
    values[key] = argv[i + 1];
  }
  demand(Object.keys(values).length === 3, "CLI_REQUIRED_OPTIONS");
  return values;
}
function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}
function packageAt(root, name) {
  const req = createRequire(path.join(root, "package.json"));
  const file = fs.realpathSync(req.resolve(`${name}/package.json`));
  demand(inside(path.join(root, "node_modules"), file), "MODULE_OUTSIDE_INSTALLED_ROOT");
  return { directory: path.dirname(file), value: JSON.parse(fs.readFileSync(file, "utf8")) };
}
function binding(root, kind) {
  const expected = kind === "baseline"
    ? { mocha: "12.0.3", "markdownlint-cli": "0.49.1", glob: "13.0.6", minimatch: "10.2.6" }
    : { mocha: "12.0.3", "markdownlint-cli": "0.49.1", glob: "14.0.2", minimatch: "11.0.1" };
  const packages = {};
  for (const [name, version] of Object.entries(expected)) {
    const pkg = packageAt(root, name);
    demand(pkg.value.version === version, "INSTALLED_GRAPH_IDENTITY");
    packages[name] = { version, directory: pkg.directory };
  }
  const consumerResolution = {};
  for (const owner of ["mocha", "glob", "markdownlint-cli"]) {
    const req = createRequire(path.join(packages[owner].directory, "package.json"));
    const target = fs.realpathSync(req.resolve("minimatch/package.json"));
    demand(inside(path.join(root, "node_modules"), target), "CONSUMER_MODULE_OUTSIDE_ROOT");
    demand(JSON.parse(fs.readFileSync(target, "utf8")).version === expected.minimatch, "CONSUMER_MINIMATCH_IDENTITY");
    consumerResolution[owner] = { minimatch: target };
    if (owner === "mocha") {
      const globFile = fs.realpathSync(req.resolve("glob/package.json"));
      demand(inside(path.join(root, "node_modules"), globFile), "CONSUMER_MODULE_OUTSIDE_ROOT");
      demand(JSON.parse(fs.readFileSync(globFile, "utf8")).version === expected.glob, "CONSUMER_GLOB_IDENTITY");
      consumerResolution[owner].glob = globFile;
    }
  }
  return {
    root,
    kind,
    consumer_resolution: consumerResolution,
    package_sha256: digest(fs.readFileSync(path.join(root, "package.json"))),
    lock_sha256: digest(fs.readFileSync(path.join(root, "package-lock.json"))),
    packages,
  };
}
function childEnv(extra = {}) {
  const env = { ...process.env, CI: "true", NO_COLOR: "1", ...extra };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  delete env.MOCHA_OPTIONS;
  delete env.FORCE_COLOR;
  return env;
}
function start(command, args, cwd, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd,
    env: childEnv(extraEnv),
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const record = { child, stdout: "", stderr: "", started: Date.now(), overflow: false };
  children.add(record);
  record.closed = new Promise((resolve) => {
    child.once("error", () => resolve({ code: null, signal: null, spawnError: true }));
    child.once("close", (code, signal) => {
      record.ended = true;
      resolve({ code, signal, spawnError: false });
    });
  });
  for (const stream of ["stdout", "stderr"]) {
    child[stream].setEncoding("utf8");
    child[stream].on("data", (chunk) => {
      if (Buffer.byteLength(record[stream]) + Buffer.byteLength(chunk) > OUTPUT_LIMIT) {
        record.overflow = true;
        signalOwned(record, "SIGTERM");
      } else record[stream] += chunk;
    });
  }
  return record;
}
function signalOwned(record, signal) {
  // Only a still-live child created by this invocation can be signalled.
  const child = record.child;
  if (!children.has(record) || record.ended || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw fault("OWN_CHILD_SIGNAL_FAILED");
  }
}
async function terminate(record) {
  if (record.ended) return;
  signalOwned(record, "SIGTERM");
  await Promise.race([record.closed, new Promise((resolve) => setTimeout(resolve, 500))]);
  if (!record.ended) signalOwned(record, "SIGKILL");
  await Promise.race([record.closed, new Promise((resolve) => setTimeout(resolve, 1500))]);
  demand(record.ended || !record.child.pid, "OWN_CHILD_NOT_REAPED");
}
function receipt(record, result) {
  return {
    exit: result.code,
    signal: result.signal,
    duration_ms: Date.now() - record.started,
    stdout_sha256: digest(record.stdout),
    stderr_sha256: digest(record.stderr),
    output_limited: record.overflow,
  };
}
async function run(command, args, cwd, cap = 20000, env = {}, accepted = [0]) {
  const record = start(command, args, cwd, env);
  let timer;
  const result = await Promise.race([
    record.closed,
    new Promise((resolve) => { timer = setTimeout(() => resolve({ timeout: true }), remaining(cap)); }),
  ]);
  clearTimeout(timer);
  if (result.timeout) {
    await terminate(record);
    report.failed_process = { ...receipt(record, await record.closed), timeout: true };
    throw fault("CHILD_DEADLINE");
  }
  if (result.spawnError || record.overflow || !accepted.includes(result.code)) report.failed_process = receipt(record, result);
  demand(!result.spawnError, "CHILD_SPAWN_FAILED");
  demand(!record.overflow, "CHILD_OUTPUT_LIMIT");
  demand(accepted.includes(result.code), "CHILD_EXIT_FAILED");
  return { stdout: record.stdout, stderr: record.stderr, receipt: receipt(record, result) };
}
function put(relative, bytes) {
  const file = path.join(work, relative);
  demand(inside(work, file), "FIXTURE_PATH");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}
function testSource(id) {
  return `const assert = require('node:assert/strict');\ndescribe('fixture', function () { it(${JSON.stringify(id)}, function () { assert.equal(2 + 2, 4); if (process.env.MATCHER_PARALLEL === '1') assert.notEqual(process.env.MOCHA_WORKER_ID, undefined); }); });\n`;
}
function fixtures() {
  put("package.json", '{"type":"commonjs","private":true}\n');
  const definitions = {
    "cases/basic/alpha.test.cjs": "alpha",
    "cases/nested/deep/beta.test.cjs": "beta",
    "cases/space dir/space name.test.cjs": "space-name",
    "cases/brackets/literal[one].test.cjs": "bracket-name",
    "cases/.hidden/hidden.test.cjs": "hidden",
    "cases/ignore/ignored.test.cjs": "ignored",
    "cases/extensions/normal.js": "extension-js",
    "cases/extensions/normal.cjs": "extension-cjs",
  };
  for (const [file, id] of Object.entries(definitions)) put(file, testSource(id));
  put("cases/extensions/not-a-test.txt", "This must never be parsed as a test.\n");
  fs.mkdirSync(path.join(work, "links"));
  fs.symlinkSync("../cases/basic/alpha.test.cjs", path.join(work, "links/alias.test.cjs"));
  fs.symlinkSync("cases/basic", path.join(work, "directory-link"), "dir");
  put("markdown/good.md", "# Fixture heading\n\nA compact paragraph.\n");
  put("markdown/bad.md", "#Bad heading\n\n- first\n- second  \n\n## Lower heading\n\n# Fixture heading\n");
  put("markdown/space [one].md", "# Another heading\n\n\nText with  trailing spaces.  \n");
  return definitions;
}
function parseJSON(text, code) {
  try { return JSON.parse(text); } catch { throw fault(code); }
}
function identities(json) {
  demand(Array.isArray(json.tests), "MOCHA_TEST_IDENTITIES_MISSING");
  return json.tests.map((test) => {
    demand(typeof test.fullTitle === "string" && typeof test.file === "string", "MOCHA_IDENTITY_SHAPE");
    demand(inside(work, test.file), "MOCHA_FILE_OUTSIDE_FIXTURE");
    return { title: test.fullTitle, file: path.relative(work, test.file).split(path.sep).join("/") };
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en"));
}
async function mochaCase(bound, scenario) {
  report.active_installation = bound.kind;
  report.active_operation = "mocha-discovery-dry-run";
  const bin = path.join(bound.packages.mocha.directory, "bin/mocha.js");
  const base = ["--no-config", "--no-package", "--no-color", "--reporter", "json", "--timeout", "2000", ...scenario.args];
  const dry = await run(process.execPath, [bin, ...base, "--dry-run"], work);
  const dryJSON = parseJSON(dry.stdout, "MOCHA_DRY_JSON");
  const dryIds = identities(dryJSON);
  report.active_operation = "mocha-execution";
  const actual = await run(process.execPath, [bin, ...base, ...(scenario.parallel ? ["--parallel", "--jobs", "2"] : [])], work, 20000, { MATCHER_PARALLEL: scenario.parallel ? "1" : "0" });
  const actualJSON = parseJSON(actual.stdout, "MOCHA_RUN_JSON");
  const actualIds = identities(actualJSON);
  same(dryIds, actualIds, "MOCHA_DRY_RUN_IDENTITY_CHANGED");
  same(actualIds.map((entry) => entry.title).sort(), scenario.ids.map((id) => `fixture ${id}`).sort(), "MOCHA_EXPECTED_TEST_SET");
  demand(actualJSON.stats.failures === 0 && actualJSON.stats.pending === 0 && actualJSON.stats.passes === scenario.ids.length, "MOCHA_EXECUTION_COUNTS");
  return { identities: actualIds, dry: dry.receipt, actual: actual.receipt, passes: actualJSON.stats.passes };
}

// Executed only in a child with one explicitly resolved installation.
function matcherProbe(root, fixture) {
  const { createRequire } = require("node:module");
  const req = createRequire(require("node:path").join(root, "package.json"));
  const assert = require("node:assert/strict");
  const path = require("node:path");
  const glob = req("glob");
  const { minimatch } = req("minimatch");
  assert.equal(typeof minimatch.Minimatch, "function");
  const cases = [
    ["cases/basic/alpha.test.cjs", "cases/**/*.test.cjs", {}, true],
    ["cases/.hidden/hidden.test.cjs", "cases/**/*.test.cjs", {}, false],
    ["cases/.hidden/hidden.test.cjs", "cases/**/*.test.cjs", { dot: true }, true],
    ["cases/basic/alpha.test.cjs", "cases\\basic\\*.test.cjs", { windowsPathsNoEscape: true }, true],
    ["cases/brackets/literal[one].test.cjs", "cases/brackets/literal[[]one].test.cjs", {}, true],
    ["cases/extensions/normal.js", "cases/extensions/normal+(.js|.cjs)", {}, true],
    ["cases/extensions/not-a-test.txt", "cases/extensions/normal+(.js|.cjs)", {}, false],
  ];
  const matching = cases.map(([file, pattern, options, expected]) => {
    const direct = minimatch(file, pattern, options);
    const instance = new minimatch.Minimatch(pattern, options).match(file);
    assert.equal(direct, expected);
    assert.equal(instance, expected);
    return { direct, instance };
  });
  const patterns = ["watch/**/*.cjs", "cases/{basic,nested}/**/*.test.cjs", "cases\\basic\\*.test.cjs"];
  const internals = patterns.map((pattern) => {
    const value = new glob.Glob(pattern, { cwd: fixture, dot: true, magicalBraces: true, windowsPathsNoEscape: true });
    assert.ok(Array.isArray(value.patterns) && value.patterns.length > 0);
    return value.patterns.map((part) => {
      const original = part.globString();
      const segments = [];
      let current = part;
      while (current) {
        assert.ok(segments.length < 64);
        const item = current.pattern();
        segments.push(typeof item === "string" ? { literal: item } : { glob: true });
        current = current.rest();
      }
      return { original, segments };
    });
  });
  const discovery = [
    "cases/basic/*.test.cjs",
    "cases\\basic\\*.test.cjs",
    "cases/extensions/normal+(.js|.cjs)",
    "directory-link/*.test.cjs",
  ].map((pattern) => ({
    magic: glob.hasMagic(pattern, { windowsPathsNoEscape: true }),
    files: glob.sync(pattern, { cwd: fixture, nodir: true, windowsPathsNoEscape: true }).map((file) => file.split(path.sep).join("/")).sort(),
  }));
  return { matching, internals, discovery };
}
async function probe(bound) {
  report.active_installation = bound.kind;
  report.active_operation = "glob-minimatch-consumer-probe";
  const code = `try { const result = (${matcherProbe.toString()})(process.argv[1], process.argv[2]); process.stdout.write(JSON.stringify(result)); } catch { process.exitCode = 1; }`;
  const child = await run(process.execPath, ["-e", code, bound.root, work], work);
  return { data: parseJSON(child.stdout, "MATCHER_PROBE_JSON"), process: child.receipt };
}
function watchSource() {
  return "const fs = require('node:fs'); describe('watch fixture', function () { it('emits one owned run', function () { fs.appendFileSync(process.env.MATCHER_WATCH_LOG, JSON.stringify({ id: 'watch-run', value: fs.readFileSync('watch/value.txt', 'utf8') }) + '\\n'); }); });\n";
}
function watchEvents(log) {
  const text = fs.readFileSync(log, "utf8");
  return text.trim() ? text.trim().split("\n").map((line) => parseJSON(line, "WATCH_EVENT_JSON")) : [];
}
async function waitForWatch(record, log, count) {
  const cap = remaining(12000);
  return new Promise((resolve, reject) => {
    let timer;
    let watcher;
    let settled = false;
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (watcher) watcher.close();
      error ? reject(error) : resolve();
    }
    function inspect() {
      try {
        if (record.ended || record.overflow) return finish(fault("WATCH_CHILD_EARLY_EXIT"));
        const events = watchEvents(log);
        if (events.length > count) return finish(fault("WATCH_UNEXPECTED_RUN"));
        if (events.length === count) finish();
      } catch { finish(fault("WATCH_EVENT_INVALID")); }
    }
    watcher = fs.watch(log, inspect);
    watcher.once("error", () => finish(fault("WATCH_OBSERVER_FAILED")));
    timer = setTimeout(() => finish(fault("WATCH_EVENT_DEADLINE")), cap);
    record.closed.then(inspect);
    inspect();
  });
}
async function watchCase(bound) {
  report.active_installation = bound.kind;
  report.active_operation = "mocha-watch-ignore-rerun";
  put("watch/spec.test.cjs", watchSource());
  put("watch/ignored/noise.cjs", "// ignored initial file\n");
  put("watch/value.txt", "first");
  put("watch/events.ndjson", "");
  const log = path.join(work, "watch/events.ndjson");
  const bin = path.join(bound.packages.mocha.directory, "bin/mocha.js");
  const child = start(process.execPath, [bin, "--no-config", "--no-package", "--no-color", "--reporter", "dot", "--timeout", "2000", "--watch", "--watch-files", "watch/**/*.cjs", "--watch-ignore", "watch/ignored/**", "watch/spec.test.cjs"], work, { MATCHER_WATCH_LOG: log });
  try {
    await waitForWatch(child, log, 1);
    same(watchEvents(log), [{ id: "watch-run", value: "first" }], "WATCH_INITIAL_IDENTITY");
    fs.appendFileSync(path.join(work, "watch/ignored/noise.cjs"), "// ignored mutation\n");
    await new Promise((resolve) => setTimeout(resolve, remaining(1200)));
    demand(!child.ended, "WATCH_CHILD_EARLY_EXIT");
    demand(watchEvents(log).length === 1, "WATCH_IGNORE_TRIGGERED_RUN");
    put("watch/value.txt", "second");
    fs.appendFileSync(path.join(work, "watch/spec.test.cjs"), "// admitted watched mutation\n");
    await waitForWatch(child, log, 2);
    await new Promise((resolve) => setTimeout(resolve, remaining(400)));
    const events = watchEvents(log);
    same(events, [{ id: "watch-run", value: "first" }, { id: "watch-run", value: "second" }], "WATCH_RERUN_IDENTITY");
    return { events, ignored_change_reruns: 0, actual_change_reruns: 1 };
  } finally {
    await terminate(child);
  }
}
async function markdownCase(bound, wrapper, disabledRules) {
  report.active_installation = bound.kind;
  report.active_operation = "markdown-cli-fixture";
  const files = ["markdown/good.md", "markdown/bad.md", "markdown/space [one].md"];
  const cli = path.join(bound.packages["markdownlint-cli"].directory, "markdownlint.js");
  const child = await run(process.execPath, [cli, "--json", "--disable", ...disabledRules, "--", ...files], work, 25000, {}, [0, 1]);
  const issues = wrapper.parseMarkdownlintResult({ status: child.receipt.exit, stdout: child.stdout, stderr: child.stderr });
  demand(Array.isArray(issues) && issues.length > 0, "MARKDOWN_POSITIVE_FINDING_CONTROL");
  const loader = (file) => fs.readFileSync(path.isAbsolute(file) ? file : path.join(work, file), "utf8");
  const normalized = wrapper.createBaseline(files, issues, loader);
  demand(normalized.filesScanned === files.length && normalized.disabledRules.length === disabledRules.length, "MARKDOWN_WRAPPER_SHAPE");
  return { normalized, process: child.receipt };
}

async function main() {
  const args = argumentsOf(process.argv.slice(2));
  const baselineRoot = fs.realpathSync(args["--baseline-root"]);
  const candidateRoot = fs.realpathSync(args["--candidate-root"]);
  demand(baselineRoot !== candidateRoot, "DISTINCT_INSTALLED_ROOTS_REQUIRED");
  output = path.resolve(args["--output"]);
  demand(output !== baselineRoot && output !== candidateRoot, "OUTPUT_MUST_BE_OWNED_DIRECTORY");
  fs.mkdirSync(output, { recursive: true });
  demand(!fs.existsSync(path.join(output, "matcher-compat.json")), "REFUSE_EVIDENCE_OVERWRITE");
  deadline = Date.now() + WORK_MS;
  work = fs.mkdtempSync(path.join(os.tmpdir(), "inferno-matcher-compat-"));
  report = { schema: "root-matcher-compat/v1", status: "RUNNING", limits: { total_work_ms: WORK_MS, own_child_output_bytes: OUTPUT_LIMIT }, checks, full_markdown_wrapper_gate: "REQUIRED_SEPARATELY_IN_DOCS_CI", full_contract_gate: "REQUIRED_SEPARATELY_IN_CONTRACT_CI", cleanup: "PENDING" };
  const baseline = binding(baselineRoot, "baseline");
  const candidate = binding(candidateRoot, "candidate");
  report.bindings = { baseline, candidate, harness_sha256: digest(fs.readFileSync(__filename)) };
  fixtures();
  const scenarios = [
    { id: "nested-default-dot", args: ["cases/**/*.test.cjs"], ids: ["alpha", "beta", "space-name", "bracket-name", "ignored"] },
    { id: "ignore-rule", args: ["cases/**/*.test.cjs", "--ignore", "**/ignored.test.cjs"], ids: ["alpha", "beta", "space-name", "bracket-name"] },
    { id: "extension-fallback", args: ["cases/extensions/normal", "--extension", "js,cjs"], ids: ["extension-js", "extension-cjs"] },
    { id: "space-path", args: ["cases/space dir/space name.test.cjs"], ids: ["space-name"] },
    { id: "literal-bracket-glob", args: ["cases/brackets/literal[[]one].test.cjs"], ids: ["bracket-name"] },
    { id: "explicit-dot-path", args: ["cases/.hidden/*.test.cjs"], ids: ["hidden"] },
    { id: "windows-noescape-separator", args: ["cases\\basic\\*.test.cjs"], ids: ["alpha"] },
    { id: "symlink-file", args: ["links/alias.test.cjs"], ids: ["alpha"] },
    { id: "symlink-directory", args: ["directory-link/*.test.cjs"], ids: ["alpha"] },
    { id: "parallel-identities", args: ["cases/basic/*.test.cjs", "cases/nested/**/*.test.cjs"], ids: ["alpha", "beta"], parallel: true },
  ];
  for (const scenario of scenarios) {
    report.stage = scenario.id;
    const before = await mochaCase(baseline, scenario);
    const after = await mochaCase(candidate, scenario);
    same(before.identities, after.identities, "MOCHA_BASELINE_CANDIDATE_IDENTITIES");
    checks.push({ id: scenario.id, status: "PASS", baseline: before, candidate: after });
  }
  report.stage = "glob-and-minimatch-consumer-apis";
  const before = await probe(baseline);
  const after = await probe(candidate);
  same(before.data, after.data, "MATCHER_CONSUMER_BEHAVIOR_CHANGED");
  checks.push({ id: report.stage, status: "PASS", baseline: before, candidate: after });
  report.stage = "mocha-owned-watch-ignore-rerun";
  const watchBefore = await watchCase(baseline);
  const watchAfter = await watchCase(candidate);
  same(watchBefore, watchAfter, "WATCH_BASELINE_CANDIDATE_CHANGED");
  checks.push({ id: report.stage, status: "PASS", baseline: watchBefore, candidate: watchAfter });
  report.stage = "markdown-cli-wrapper-fixture-fingerprints";
  const wrapperPath = path.join(candidateRoot, "scripts/check-markdownlint-baseline.cjs");
  const baselinePath = path.join(candidateRoot, "audit/markdownlint-baseline.json");
  const originalBaseline = fs.readFileSync(baselinePath);
  const wrapperBytes = fs.readFileSync(wrapperPath);
  demand(digest(wrapperBytes) === "81fb214c8d25cc65d2cf762a384b0882eeb83b1221505f213701332c5ef20c33", "MARKDOWN_WRAPPER_SOURCE_CHANGED");
  demand(digest(originalBaseline) === "6586e2b4c51aa86ce14660021c0eecc5c5c1d6d34758ca2e74e1aef6befa610c", "MARKDOWN_ACCEPTED_BASELINE_CHANGED");
  const acceptedBaseline = parseJSON(originalBaseline, "MARKDOWN_BASELINE_JSON");
  const wrapper = require(wrapperPath);
  const disabledRules = wrapper.disabledRules;
  demand(Array.isArray(disabledRules), "MARKDOWN_RULE_CONTRACT_MISSING");
  same(disabledRules, acceptedBaseline.disabledRules, "MARKDOWN_ACCEPTED_RULES_CHANGED");
  report.markdown_owning_baseline = { files: acceptedBaseline.filesScanned, findings: acceptedBaseline.baselineIssues, tool: acceptedBaseline.tool, full_wrapper_result: "REQUIRED_SEPARATELY_IN_DOCS_CI" };
  const markdownBefore = await markdownCase(baseline, wrapper, disabledRules);
  const markdownAfter = await markdownCase(candidate, wrapper, disabledRules);
  same(markdownBefore.normalized, markdownAfter.normalized, "MARKDOWN_FIXTURE_FINGERPRINTS_CHANGED");
  demand(wrapper.compareBaseline(markdownBefore.normalized.fingerprints, markdownAfter.normalized.fingerprints).length === 0, "MARKDOWN_WRAPPER_COMPARISON_CHANGED");
  same(digest(fs.readFileSync(baselinePath)), digest(originalBaseline), "REPOSITORY_MARKDOWN_BASELINE_MUTATED");
  checks.push({ id: report.stage, status: "PASS", baseline: markdownBefore, candidate: markdownAfter, wrapper_sha256: digest(fs.readFileSync(wrapperPath)), repository_baseline_sha256: digest(originalBaseline), repository_baseline_regenerated: false });
  report.status = "PASS";
  delete report.stage;
  delete report.active_installation;
  delete report.active_operation;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    interrupted = true;
    for (const record of children) {
      try { signalOwned(record, "SIGTERM"); } catch { /* Cleanup records failure without raw error output. */ }
    }
  });
}
(async () => {
  let failed;
  try { await main(); }
  catch (error) { failed = error.safeCode || "UNEXPECTED_STATIC_OR_PROCESS_FAILURE"; }
  finally {
    let cleanupFailed = false;
    for (const record of children) {
      try { await terminate(record); } catch { cleanupFailed = true; }
    }
    if (work) {
      try {
        demand(path.dirname(work) === os.tmpdir() && path.basename(work).startsWith("inferno-matcher-compat-"), "OWN_TEMP_IDENTITY");
        fs.rmSync(work, { recursive: true, force: true });
      } catch { cleanupFailed = true; }
    }
    if (cleanupFailed) failed = "OWN_RESOURCE_CLEANUP_FAILED";
    if (report) {
      report.status = failed ? "FAIL" : "PASS";
      report.cleanup = cleanupFailed ? "FAIL" : "PASS";
      if (failed) report.failure_code = failed;
      try {
        fs.writeFileSync(path.join(output, "matcher-compat.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
      } catch { failed = "REPORT_WRITE_FAILED"; }
    }
    process.stdout.write(`root-matcher-compat: ${failed ? `FAIL (${failed})` : "PASS"}\n`);
    process.exitCode = failed ? 1 : 0;
  }
})();
