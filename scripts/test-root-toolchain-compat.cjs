#!/usr/bin/env node

// CI-only comparison setup. The affected baseline is never a shipped graph.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = "af16107ae8f6aecff7308fa8ec4beb14aaa268be";
const FROZEN = {
  "package.json": "73bb47451b8fb424770c51ef0802f8bfc604a5caf5f890c18ca6e689ad77c61c",
  "package-lock.json": "a0ac9ef85f3c24df5c895cb549716739c0ef59c425fc802ef06e4a95633681e7",
};
const REPOSITORY = "https://github.com/NeaBouli/inferno.git";
const OUTPUT_LIMIT = 1024 * 1024;
const OVERALL_MS = 780_000;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const fixedFailure = (code) => Object.assign(new Error(code), { failureCode: code });
let output, temporary, ownerToken, active, deadline, interrupted = false;
let processOutcomeUnknown = false;
const steps = [];
const source = { baselineCommit: BASELINE, baselineFiles: FROZEN, candidateFiles: {} };

function write(file, value) {
  fs.writeFileSync(file, typeof value === "string" || Buffer.isBuffer(value)
    ? value : `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

function environment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(NODE_ENV|NODE_OPTIONS|HOST|PORT|npm_config_.*)$/i.test(key)) delete env[key];
  }
  return {
    ...env,
    HARDHAT_FORK: "false",
    HARDHAT_DISABLE_TELEMETRY_PROMPT: "true",
    NO_UPDATE_CHECK: "1",
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
    npm_config_cache: path.join(temporary, "cache"),
    npm_config_userconfig: path.join(temporary, "empty-user.npmrc"),
    npm_config_globalconfig: path.join(temporary, "empty-global.npmrc"),
    npm_config_registry: "https://registry.npmjs.org",
    npm_config_update_notifier: "false",
  };
}

async function run(label, command, args, limit, allowFailure = false) {
  if (interrupted) throw fixedFailure("INTERRUPTED");
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0) throw fixedFailure("OVERALL_DEADLINE");
  const timeout = Math.min(limit, remaining);
  const started = performance.now();
  const result = await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: ROOT, env: environment(), detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const buffers = { stdout: [], stderr: [] };
    const sizes = { stdout: 0, stderr: 0 };
    let reason = null, spawnFailed = false, killTimer, closeTimer, settled = false;
    const finish = (code, signal, outcomeUnknown = false) => {
      if (settled) return;
      settled = true;
      const unknown = outcomeUnknown || reason !== null;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (closeTimer) clearTimeout(closeTimer);
      if (active?.child === child) active = null;
      if (unknown) processOutcomeUnknown = true;
      resolve({ code, signal, reason, spawnFailed, outcomeUnknown: unknown,
        stdout: Buffer.concat(buffers.stdout), stderr: Buffer.concat(buffers.stderr) });
    };
    const stop = (code) => {
      if (reason) return;
      reason = code;
      // Harnesses may own other detached groups. Direct-child close after a
      // forced stop is not their teardown proof, so always retain the baseline.
      processOutcomeUnknown = true;
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try { process.kill(-child.pid, "SIGTERM"); } catch {}
        killTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            try { process.kill(-child.pid, "SIGKILL"); } catch {}
          }
        }, 3000);
      }
      // Never wait indefinitely for inherited pipes after a timeout. Unknown
      // process outcome fails the run and prevents deletion of its baseline.
      closeTimer = setTimeout(() => {
        child.stdout.destroy(); child.stderr.destroy(); child.unref();
        finish(child.exitCode, child.signalCode, true);
      }, 4000);
    };
    active = { child, stop };
    const timer = setTimeout(() => stop("STEP_DEADLINE"), timeout);
    for (const stream of ["stdout", "stderr"]) {
      child[stream].on("data", (chunk) => {
        const room = OUTPUT_LIMIT - sizes[stream];
        if (room > 0) buffers[stream].push(chunk.subarray(0, room));
        sizes[stream] += chunk.length;
        if (sizes[stream] > OUTPUT_LIMIT) stop("OUTPUT_LIMIT");
      });
    }
    child.on("error", () => { spawnFailed = true; });
    child.on("close", (code, signal) => finish(code, signal));
  });
  const receipt = {
    label, exitCode: result.code, signal: result.signal,
    termination: result.reason, spawnFailed: result.spawnFailed,
    processOutcomeUnknown: result.outcomeUnknown,
    elapsedMs: Math.round(performance.now() - started), timeoutMs: timeout,
    stdoutSha256: digest(result.stdout), stderrSha256: digest(result.stderr),
  };
  write(path.join(output, `${label}.stdout.log`), result.stdout);
  write(path.join(output, `${label}.stderr.log`), result.stderr);
  write(path.join(output, `${label}.json`), receipt);
  steps.push(receipt);
  console.log(`[root-toolchain-compat] ${label}: exit=${result.code}`);
  if (result.reason || result.spawnFailed || result.outcomeUnknown || (!allowFailure && result.code !== 0)) {
    // These commands use public inputs and empty npm configs. Preserve bounded
    // diagnostics in existing job logs, without creating an artifact upload.
    for (const stream of ["stdout", "stderr"]) {
      if (result[stream].length) console.log(`[root-toolchain-compat] ${label} ${stream}:\n${result[stream].subarray(0, 16384)}`);
    }
    throw fixedFailure(result.reason || `STEP_FAILED_${label}`);
  }
  return result;
}

function assertPackages(prefix, versions) {
  const actual = {};
  for (const [name, version] of Object.entries(versions)) {
    actual[name] = readJson(path.join(prefix, "node_modules", name, "package.json")).version;
    assert.equal(actual[name], version);
  }
  return actual;
}

function bindReceipt(relative, schema) {
  const file = path.join(output, relative);
  const entry = fs.lstatSync(file);
  assert(entry.isFile() && !entry.isSymbolicLink() && entry.nlink === 1 && entry.size <= OUTPUT_LIMIT);
  assert.equal(fs.realpathSync(file), file);
  const bytes = fs.readFileSync(file);
  const report = JSON.parse(bytes);
  assert.equal(report.schema, schema);
  assert.equal(report.status, "PASS");
  return { path: relative, sha256: digest(bytes), bytes: bytes.length, report };
}

function cleanup() {
  if (!temporary) return { status: "NOT_CREATED" };
  assert(!processOutcomeUnknown, "unknown own process outcome must retain its baseline");
  assert(!active, "own comparison process must finish before baseline cleanup");
  const entry = fs.lstatSync(temporary);
  assert(entry.isDirectory() && !entry.isSymbolicLink());
  assert.equal(fs.realpathSync(temporary), temporary);
  assert(path.basename(temporary).startsWith("inferno-root-toolchain-"));
  assert.equal(fs.readFileSync(path.join(temporary, ".owner"), "utf8"), ownerToken);
  fs.rmSync(temporary, { recursive: true, force: false });
  assert(!fs.existsSync(temporary));
  return { status: "PASS", ownedTemporaryRemoved: true, foreignResourcesTouched: false };
}

async function main() {
  // Do not use the install/comparison runner on developer machines.
  assert(process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true");
  assert.equal(process.platform, "linux");
  assert.equal(Number(process.versions.node.split(".")[0]), 22);
  assert.equal(process.argv.length, 2);
  deadline = performance.now() + OVERALL_MS;
  const runnerTemp = fs.realpathSync(process.env.RUNNER_TEMP || os.tmpdir());
  const proposedOutput = path.join(runnerTemp, "root-toolchain-compat-evidence");
  fs.mkdirSync(proposedOutput, { mode: 0o700 }); // Refuse without writing to an existing directory.
  output = proposedOutput;
  const candidateFiles = ["package.json", "package-lock.json", "playwright.config.js", "scripts/test-root-toolchain-compat.cjs", "scripts/test-root-matcher-compat.cjs",
    "scripts/test-docs-server-compat.cjs", "scripts/check-markdownlint-baseline.cjs", "audit/markdownlint-baseline.json"];
  for (const file of candidateFiles) source.candidateFiles[file] = digest(fs.readFileSync(path.join(ROOT, file)));
  source.candidatePackages = assertPackages(ROOT, { mocha: "12.0.3", "markdownlint-cli": "0.49.1", glob: "14.0.2",
    minimatch: "11.0.1", "sirv-cli": "3.0.1" });
  temporary = fs.mkdtempSync(path.join(runnerTemp, "inferno-root-toolchain-"));
  ownerToken = randomUUID();
  write(path.join(temporary, ".owner"), ownerToken);
  write(path.join(temporary, "empty-user.npmrc"), "");
  write(path.join(temporary, "empty-global.npmrc"), "");
  const baselineRoot = path.join(temporary, "baseline");
  fs.mkdirSync(baselineRoot, { mode: 0o700 });
  const candidateHead = await run("candidate-head", "git", ["rev-parse", "HEAD"], 10_000);
  const candidateCommit = candidateHead.stdout.toString("utf8").trim();
  assert(/^[0-9a-f]{40}$/.test(candidateCommit));
  source.candidateCommit = candidateCommit;
  const npmVersion = await run("npm-version", "npm", ["--version"], 10_000);
  source.npm = npmVersion.stdout.toString("utf8").trim();
  assert(/^\d+\.\d+\.\d+$/.test(source.npm));
  const available = await run("baseline-object", "git", ["cat-file", "-e", `${BASELINE}^{commit}`], 10_000, true);
  if (available.code !== 0) {
    await run("baseline-fetch", "git", ["fetch", "--no-tags", "--depth=1", REPOSITORY, BASELINE], 30_000);
  }
  for (const [file, expected] of Object.entries(FROZEN)) {
    const value = await run(`baseline-${file.replaceAll(".", "-")}`, "git", ["show", `${BASELINE}:${file}`], 10_000);
    assert.equal(digest(value.stdout), expected);
    write(path.join(baselineRoot, file), value.stdout);
  }
  await run("baseline-install", "npm", ["ci", "--prefix", baselineRoot, "--ignore-scripts", "--no-audit",
    "--no-fund", "--include=dev", "--fetch-retries=0", "--fetch-timeout=20000"], 300_000);
  source.baselinePackages = assertPackages(baselineRoot, { mocha: "12.0.3", "markdownlint-cli": "0.49.1", glob: "13.0.6",
    minimatch: "10.2.6", serve: "14.2.6" });
  await run("matcher", process.execPath, [path.join(ROOT, "scripts/test-root-matcher-compat.cjs"),
    "--baseline-root", baselineRoot, "--candidate-root", ROOT, "--output", path.join(output, "matcher")], 180_000);
  const matcher = bindReceipt("matcher/matcher-compat.json", "root-matcher-compat/v1");
  await run("docs-server", process.execPath, [path.join(ROOT, "scripts/test-docs-server-compat.cjs"),
    "--baseline-root", baselineRoot, "--candidate-root", ROOT, "--docs-root", path.join(ROOT, "docs"),
    "--output", path.join(output, "docs-server")], 180_000);
  const docs = bindReceipt("docs-server/docs-server-compat.json", 1);
  return { status: "PASS",
    comparisons: { matcher, docs }, qualification: "TARGETED_COMPARISON_ONLY",
    remainingGates: ["existing full candidate contract/tooling", "owning full Markdown baseline", "unchanged three browser suites"] };
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => { interrupted = true; active?.stop("INTERRUPTED"); });
}

(async () => {
  let result;
  try { result = await main(); }
  catch (error) { result = { status: "FAIL", failureCode: error.failureCode || "QUALIFICATION_PRECONDITION_OR_CHECK_FAILED" }; }
  try { result.cleanup = cleanup(); }
  catch { result.status = "FAIL"; result.cleanup = { status: "FAIL", failureCode: "OWN_TEMP_CLEANUP_REFUSED" }; }
  if (interrupted) result.status = "FAIL";
  result.interrupted = interrupted;
  result.steps = steps;
  result.source = source;
  result.node = process.version;
  // Failure reports are also retained, even when a harness exits before binding.
  for (const [name, relative] of [["matcher", "matcher/matcher-compat.json"], ["docs", "docs-server/docs-server-compat.json"]]) {
    if (!output) break;
    if (result.comparisons?.[name]) continue;
    const file = path.join(output, relative);
    try {
      const entry = fs.lstatSync(file);
      if (entry.isFile() && !entry.isSymbolicLink() && entry.nlink === 1 && entry.size <= OUTPUT_LIMIT && fs.realpathSync(file) === file) {
        const bytes = fs.readFileSync(file);
        result.harnessReceipts ||= {};
        result.harnessReceipts[name] = { sha256: digest(bytes), report: JSON.parse(bytes) };
      }
    } catch {}
  }
  result.noMainOrReleaseAcceptance = true;
  let machine = JSON.stringify(result);
  if (Buffer.byteLength(machine) > 256 * 1024) {
    result.status = "FAIL";
    result.failureCode = "RECEIPT_LOG_LIMIT";
    machine = JSON.stringify({ status: "FAIL", failureCode: "RECEIPT_LOG_LIMIT", source, steps,
      cleanup: result.cleanup, completeReceiptSha256: digest(JSON.stringify(result)) });
  }
  try { if (output) write(path.join(output, "root-toolchain-compat.json"), result); }
  catch {
    result.status = "FAIL";
    machine = JSON.stringify({ status: "FAIL", failureCode: "RECEIPT_WRITE_FAILED", source, steps, cleanup: result.cleanup });
  }
  console.log(`[root-toolchain-compat-receipt] BEGIN bytes=${Buffer.byteLength(machine)} sha256=${digest(machine)}`);
  console.log(machine);
  console.log("[root-toolchain-compat-receipt] END");
  console.log(`[root-toolchain-compat] ${result.status}`);
  if (result.status !== "PASS") process.exitCode = 1;
})();
