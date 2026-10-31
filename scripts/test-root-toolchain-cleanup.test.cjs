#!/usr/bin/env node

// SIMULATED PROCESS OUTCOMES / CALLER REGRESSION ONLY.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { test } = require("node:test");

assert(process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true");
assert.equal(process.platform, "linux");
assert.equal(Number(process.versions.node.split(".")[0]), 22);

const ROOT = path.resolve(__dirname, "..");
const CALLER = "scripts/test-root-toolchain-compat.cjs";
const FROZEN = {
  "package.json": "73bb47451b8fb424770c51ef0802f8bfc604a5caf5f890c18ca6e689ad77c61c",
  "package-lock.json": "a0ac9ef85f3c24df5c895cb549716739c0ef59c425fc802ef06e4a95633681e7",
};
const INPUTS = ["package.json", "package-lock.json", "playwright.config.js", CALLER,
  "scripts/test-root-matcher-compat.cjs", "scripts/test-docs-server-compat.cjs",
  "scripts/check-markdownlint-baseline.cjs", "audit/markdownlint-baseline.json"];
const PACKAGES = { mocha: "12.0.3", "markdownlint-cli": "0.49.1",
  glob: "14.0.2", minimatch: "11.0.1", "sirv-cli": "3.0.1" };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
let activeCallers = 0;
let maximumActiveCallers = 0, completedCallers = 0;

function regular(file, limit = 2 * 1024 * 1024) {
  const entry = fs.lstatSync(file);
  assert(entry.isFile() && !entry.isSymbolicLink() && entry.nlink === 1 && entry.size <= limit);
  assert.equal(fs.realpathSync(file), file);
  return fs.readFileSync(file);
}

function json(file) {
  try { return JSON.parse(regular(file)); }
  catch { throw new Error("CONTROL_JSON_INPUT_INVALID"); }
}

function inside(root, file) {
  const target = path.resolve(file);
  assert(target.startsWith(root + path.sep), "write must stay in the owned fixture");
  let current = root;
  for (const part of path.relative(root, path.dirname(target)).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink());
  }
  if (fs.existsSync(target)) assert(!fs.lstatSync(target).isSymbolicLink());
  return target;
}

function write(root, file, bytes) {
  const target = inside(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
}

function directory(root, target) {
  inside(root, path.join(target, ".directory-boundary"));
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
}

function realBaselineCaptures(runnerTemp) {
  // The preceding REAL qualification read these exact bytes from the local
  // af161 Git object, fetching it once if needed. Controls never fetch or spawn Git.
  const directory = path.join(runnerTemp, "root-toolchain-compat-evidence");
  const values = {};
  for (const [file, expected] of Object.entries(FROZEN)) {
    const label = "baseline-" + file.replaceAll(".", "-");
    const receipt = json(path.join(directory, label + ".json"));
    assert(receipt.exitCode === 0 && receipt.termination === null && !receipt.spawnFailed);
    const bytes = regular(path.join(directory, label + ".stdout.log"));
    assert(sha(bytes) === expected && receipt.stdoutSha256 === expected,
      "exact real Git-object capture is required");
    values[file] = bytes;
  }
  return values;
}

// This function is serialized into a TEST-ONLY preload, never into the caller.
function installStubs(config) {
  const assert = require("node:assert/strict");
  const fs = require("node:fs");
  const path = require("node:path");
  const { createHash } = require("node:crypto");
  const { EventEmitter } = require("node:events");
  const { PassThrough } = require("node:stream");
  const cp = require("node:child_process");
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const state = { simulation: true, blockedNativeOperations: 0, harnessOrder: [],
    fetches: 0, baselineObjectMissing: false, signalHandlerEmissions: 0, stubFailure: false };

  function owned(file) {
    const target = path.resolve(file);
    assert(target.startsWith(config.caseRoot + path.sep));
    let current = config.caseRoot;
    for (const part of path.relative(current, path.dirname(target)).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink());
    }
    if (fs.existsSync(target)) assert(!fs.lstatSync(target).isSymbolicLink());
    return target;
  }
  function save(file, value, replace = false) {
    const target = owned(file);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, typeof value === "string" || Buffer.isBuffer(value)
      ? value : JSON.stringify(value), { flag: replace ? "w" : "wx", mode: 0o600 });
  }
  function journal() { save(config.journal, state, true); }
  function blocked() {
    state.blockedNativeOperations++;
    journal();
    throw new Error("CONTROL_FORBIDS_NATIVE_OPERATION");
  }
  // No original process launcher or signal function is retained as a fallback.
  for (const name of ["exec", "execFile", "execSync", "execFileSync", "spawnSync", "fork"]) cp[name] = blocked;
  process.kill = blocked;
  assert.equal(hash(fs.readFileSync(config.caller)), config.sourceSha256);
  setTimeout(() => { state.watchdog = true; journal(); process.exit(97); }, 12_000).unref();

  cp.spawn = (command, args, options) => {
    assert.equal(options.cwd, config.candidate);
    const child = new EventEmitter();
    child.pid = undefined; // It must never be interpreted as an actual OS PID.
    child.exitCode = null; child.signalCode = null;
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.unref = () => {};
    child.kill = blocked;
    function close(code, stdout = "", signal = null) {
      if (stdout.length) child.stdout.write(stdout);
      child.exitCode = code; child.signalCode = signal;
      child.stdout.end(); child.stderr.end();
      journal();
      child.emit("close", code, signal);
    }
    setImmediate(() => {
      try {
        if (command === "git" && args[0] === "rev-parse") {
          return close(0, "0000000000000000000000000000000000000000\n");
        }
        if (command === "git" && args[0] === "cat-file") {
          assert.deepEqual(args, ["cat-file", "-e", config.baselineCommit + "^{commit}"]);
          state.baselineObjectMissing = config.id === "missing-object-then-pass";
          return close(state.baselineObjectMissing ? 128 : 0);
        }
        if (command === "git" && args[0] === "fetch") {
          assert.deepEqual(args, ["fetch", "--no-tags", "--depth=1",
            "https://github.com/NeaBouli/inferno.git", config.baselineCommit]);
          state.fetches++;
          return close(0);
        }
        if (command === "git" && args[0] === "show") {
          const file = args[1] === config.baselineCommit + ":package.json" ? "package.json"
            : args[1] === config.baselineCommit + ":package-lock.json" ? "package-lock.json" : null;
          assert(file);
          return close(0, fs.readFileSync(config.frozen[file]));
        }
        if (command === "npm" && args[0] === "--version") return close(0, "10.0.0\n");
        if (command === "npm" && args[0] === "ci") {
          for (const flag of ["--ignore-scripts", "--no-audit", "--no-fund", "--include=dev"]) assert(args.includes(flag));
          const baselineRoot = owned(args[args.indexOf("--prefix") + 1]);
          state.baselinePrefix = path.dirname(baselineRoot);
          const marker = path.join(state.baselinePrefix, ".owner");
          const entry = fs.lstatSync(marker);
          assert(entry.isFile() && !entry.isSymbolicLink());
          state.ownerMarkerObserved = true;
          state.ownerMarkerSha256 = hash(fs.readFileSync(marker));
          const packages = { mocha: "12.0.3", "markdownlint-cli": "0.49.1",
            glob: "13.0.6", minimatch: "10.2.6", serve: "14.2.6" };
          for (const [name, version] of Object.entries(packages)) {
            save(path.join(baselineRoot, "node_modules", name, "package.json"),
              { name, version, simulatedMetadataOnly: true });
          }
          return close(0);
        }
        if (command === process.execPath) {
          const name = args[0] === path.join(config.candidate, "scripts/test-root-matcher-compat.cjs")
            ? "matcher" : args[0] === path.join(config.candidate, "scripts/test-docs-server-compat.cjs")
              ? "docs-server" : null;
          assert(name);
          state.harnessOrder.push(name);
          const baselineRoot = args[args.indexOf("--baseline-root") + 1];
          assert.equal(path.dirname(baselineRoot), state.baselinePrefix);
          assert.equal(args[args.indexOf("--candidate-root") + 1], config.candidate);
          const destination = owned(args[args.indexOf("--output") + 1]);
          const fails = (config.id === "matcher-uncertain" && name === "matcher")
            || (config.id === "docs-uncertain" && name === "docs-server");
          const interrupted = config.id === "interrupted" && name === "matcher";
          save(path.join(destination, name === "matcher" ? "matcher-compat.json" : "docs-server-compat.json"), {
            schema: name === "matcher" ? "root-matcher-compat/v1" : 1,
            status: fails || interrupted ? "FAIL" : "PASS",
            cleanup: fails || interrupted ? "CLEANUP_UNCERTAIN" : "PASS",
            failureCode: fails || interrupted ? "CLEANUP_UNCERTAIN" : null,
            simulation: true,
          });
          if (interrupted) {
            state.signalHandlerEmissions++;
            journal();
            process.emit("SIGTERM"); // Only this copied child's JS handler; no OS signal.
            return setImmediate(() => close(1, "", "SIGTERM"));
          }
          return close(fails ? 1 : 0);
        }
        throw new Error("UNEXPECTED_SYNTHETIC_COMMAND");
      } catch {
        state.stubFailure = true;
        close(1);
      }
    });
    return child;
  };
  require("node:module").syncBuiltinESMExports();
  journal();
}

async function copiedCaller(caseRoot, candidate, preload) {
  activeCallers++;
  maximumActiveCallers = Math.max(maximumActiveCallers, activeCallers);
  assert.ok(activeCallers === 1, "only one actual copied caller may run at once");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--require", preload, path.join(candidate, CALLER)], {
      cwd: candidate, stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH, CI: "true", GITHUB_ACTIONS: "true",
        RUNNER_TEMP: path.join(caseRoot, "runner") },
    });
    const chunks = { stdout: [], stderr: [] }, sizes = { stdout: 0, stderr: 0 };
    let spawnFailed = false;
    for (const stream of ["stdout", "stderr"]) child[stream].on("data", (bytes) => {
      const room = 256 * 1024 - sizes[stream];
      if (room > 0) chunks[stream].push(bytes.subarray(0, room));
      sizes[stream] += bytes.length;
    });
    child.on("error", () => { spawnFailed = true; });
    child.on("close", (code, signal) => {
      activeCallers--;
      completedCallers++;
      const stdout = Buffer.concat(chunks.stdout), stderr = Buffer.concat(chunks.stderr);
      write(caseRoot, path.join(caseRoot, "caller.stdout.log"), stdout);
      write(caseRoot, path.join(caseRoot, "caller.stderr.log"), stderr);
      resolve({ code, signal, spawnFailed, overflow: Object.values(sizes).some(n => n > 256 * 1024),
        stdoutSha256: sha(stdout), stderrSha256: sha(stderr) });
    });
  });
}

test("SIMULATED caller baseline-disposal regression controls", { timeout: 150_000 }, async (t) => {
  const cases = [], token = randomUUID();
  const cleanupProof = { actualCallersClosed: false, ownerMarkerMatched: false, rootAbsent: false };
  let suiteRoot, sourceSha256, cleanup = "NOT_CREATED", setupFailure = false;
  try {
    const runnerTemp = fs.realpathSync(process.env.RUNNER_TEMP);
    const caller = regular(path.join(ROOT, CALLER));
    sourceSha256 = sha(caller);
    const frozen = realBaselineCaptures(runnerTemp);
    suiteRoot = fs.mkdtempSync(path.join(runnerTemp, "inferno-root-toolchain-controls-"));
    assert.ok(fs.realpathSync(suiteRoot) === suiteRoot && !fs.lstatSync(suiteRoot).isSymbolicLink());
    fs.chmodSync(suiteRoot, 0o700);
    write(suiteRoot, path.join(suiteRoot, ".owner"), token);
    const frozenPaths = {};
    for (const [file, bytes] of Object.entries(frozen)) {
      frozenPaths[file] = path.join(suiteRoot, "frozen", file);
      write(suiteRoot, frozenPaths[file], bytes);
    }
    for (const id of ["missing-object-then-pass", "matcher-uncertain", "docs-uncertain", "interrupted"]) {
      await t.test(id, { timeout: 20_000 }, async () => {
        const observation = { id, simulatedProcessOutcomes: true, baselineRetained: null, baselineDisposed: null };
        try {
          const caseRoot = path.join(suiteRoot, id);
          directory(suiteRoot, caseRoot);
          const candidate = path.join(caseRoot, "candidate");
          for (const input of INPUTS) write(caseRoot, path.join(candidate, input), regular(path.join(ROOT, input)));
          assert.ok(sha(regular(path.join(candidate, CALLER))) === sourceSha256, "caller copy must be byte exact");
          observation.callerCopyExact = true;
          directory(caseRoot, path.join(caseRoot, "runner"));
          directory(caseRoot, path.join(candidate, "docs"));
          for (const [name, version] of Object.entries(PACKAGES)) {
            write(caseRoot, path.join(candidate, "node_modules", name, "package.json"),
              JSON.stringify({ name, version, simulatedMetadataOnly: true }));
          }
          const journal = path.join(caseRoot, "journal.json"), preload = path.join(caseRoot, "preload.cjs");
          const config = { id, caseRoot, candidate, journal, frozen: frozenPaths,
            caller: path.join(candidate, CALLER), sourceSha256,
            baselineCommit: "af16107ae8f6aecff7308fa8ec4beb14aaa268be" };
          write(caseRoot, preload, "(" + installStubs.toString() + ")(" + JSON.stringify(config) + ");\n");
          const actual = await copiedCaller(caseRoot, candidate, preload);
          observation.actualCallerExit = actual.code;
          observation.privateStdoutSha256 = actual.stdoutSha256;
          observation.privateStderrSha256 = actual.stderrSha256;
          assert.ok(!actual.spawnFailed && !actual.overflow && actual.signal === null, "actual copied process must close normally");
          const state = json(journal);
          assert.ok(!state.stubFailure && !state.watchdog && state.blockedNativeOperations === 0, "native operations are forbidden");
          const result = json(path.join(caseRoot, "runner", "root-toolchain-compat-evidence", "root-toolchain-compat.json"));
          assert.ok(state.ownerMarkerObserved === true, "real caller owner marker must exist before disposal");
          const prefix = inside(caseRoot, state.baselinePrefix);
          // Observe the caller's action before the test owner cleans its fixture.
          const retained = fs.existsSync(prefix);
          observation.baselineRetained = retained;
          observation.baselineDisposed = !retained;
          observation.observedBeforeFixtureCleanup = true;
          const succeeds = id === "missing-object-then-pass";
          assert.ok(actual.code === (succeeds ? 0 : 1), "copied caller exit must match simulated outcome");
          assert.ok((result.status === "PASS") === succeeds, "caller must not turn simulated failure into success");
          assert.ok(result.processOutcomeUncleared === !succeeds, "overall disposal proof must match qualification");
          assert.ok(retained === !succeeds, "physical baseline retention/disposal is the regression oracle");
          if (retained) {
            assert.ok(sha(regular(path.join(prefix, ".owner"))) === state.ownerMarkerSha256, "retained owner marker must match");
            assert.ok(sha(regular(path.join(prefix, "baseline", "package-lock.json"))) === FROZEN["package-lock.json"], "retained baseline bytes must match");
          }
          if (succeeds) {
            assert.ok(state.baselineObjectMissing && state.fetches === 1, "allowed missing-object path must recover");
            assert.ok(result.cleanup.status === "PASS", "only successful qualification disposes baseline");
          } else {
            assert.ok(result.cleanup.status === "FAIL", "failed qualification must refuse disposal");
            assert.ok(state.fetches === 0, "failure controls must not need a fetch");
          }
          const order = id === "matcher-uncertain" || id === "interrupted" ? ["matcher"] : ["matcher", "docs-server"];
          assert.ok(JSON.stringify(state.harnessOrder) === JSON.stringify(order), "documented child order must be exercised");
          if (id === "matcher-uncertain" || id === "docs-uncertain") {
            const key = id === "matcher-uncertain" ? "matcher" : "docs";
            assert.ok(result.harnessReceipts[key].report.failureCode === "CLEANUP_UNCERTAIN", "normal exit1 must carry cleanup uncertainty");
          }
          if (id === "interrupted") {
            const step = result.steps.find(entry => entry.label === "matcher");
            assert.ok(state.signalHandlerEmissions === 1 && result.interrupted === true
              && step.termination === "INTERRUPTED" && step.processOutcomeUnknown === true,
            "forced-stop JS handler must retain unknown outcome");
          }
          cases.push({ ...observation, control: "PASS", ownerMarkerObserved: true, noNativeOperations: true });
        } catch (error) {
          cases.push({ ...observation, control: "FAIL", failureCode: "CALLER_CONTROL_ASSERTION_FAILED" });
          throw error;
        }
      });
    }
    assert.ok(sha(regular(path.join(ROOT, CALLER))) === sourceSha256, "checkout caller must remain unchanged");
  } catch (error) {
    setupFailure = true;
    throw error;
  } finally {
    if (suiteRoot) {
      try {
        assert.ok(activeCallers === 0);
        cleanupProof.actualCallersClosed = true;
        assert.ok(fs.realpathSync(suiteRoot) === suiteRoot && !fs.lstatSync(suiteRoot).isSymbolicLink());
        assert.ok(regular(path.join(suiteRoot, ".owner")).toString() === token);
        cleanupProof.ownerMarkerMatched = true;
        fs.rmSync(suiteRoot, { recursive: true, force: false });
        assert.ok(!fs.existsSync(suiteRoot));
        cleanupProof.rootAbsent = true;
        cleanup = "PASS";
      } catch { cleanup = "REFUSED"; }
    }
    const passed = !setupFailure && cases.length === 4 && cases.every(entry => entry.control === "PASS") && cleanup === "PASS";
    console.log("[root-toolchain-cleanup-controls] " + JSON.stringify({
      schema: "root-toolchain-cleanup-controls/v1", simulationOnly: true,
      status: passed ? "PASS" : "FAIL", sourceSha256, node: process.version, setupFailure,
      cases, ownedFixtureCleanup: cleanup,
      ownedCleanupProof: cleanupProof, maxConcurrentActualCallers: maximumActiveCallers,
      actualCopiedCallers: completedCallers, actualNpmServerWatchNetworkOrSignals: false,
      copiedCallerOutputEchoed: false, realMatcherServerQualification: "SEPARATE_REQUIRED_GATE",
    }));
    assert.ok(passed, "simulated caller controls and owned cleanup must all pass");
  }
});
