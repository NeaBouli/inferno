#!/usr/bin/env node
"use strict";

// Diagnostic comparison only: passing runs do not close the historical cause.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const ROOT = path.resolve(__dirname, "..");
const PREFIX = "IFR_VAULT_DIAGNOSTIC ";
const ENV_KEY = "INFERNO_VAULT_DIAGNOSTIC";
const PRINCIPAL = "CommitmentVault time-only writes preserve IFR base units; retired LendingVault refuses new offers and keeps full withdraw (T-273)";
const ACCOUNT = "Web3 wallet manager shows connector details, tracks account changes and disconnects";
const TITLES = [
  "Lending Wiki status banner keeps the full contract address inside a narrow viewport",
  "closing a pending tablet WalletConnect dialog cancels it and a retry still connects",
  "cancelling while WalletConnect init is pending drops the late provider and a retry pairs fresh",
  PRINCIPAL,
];
const FILES = ["lending-retired.spec.js", "web3-write.spec.js", "web3-write.spec.js", "web3-write.spec.js"];
const METHODS = new Set(["eth_requestAccounts", "eth_accounts", "eth_chainId", "net_version", "wallet_switchEthereumChain", "wallet_watchAsset", "eth_getBalance", "eth_blockNumber", "eth_getCode", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_getTransactionCount", "eth_estimateGas", "eth_call", "eth_sendTransaction", "eth_getTransactionReceipt", "eth_getTransactionByHash", "other"]);
const CATEGORIES = new Set(["rpc", "fee-exempt", "allowance", "balance", "approve", "commitment-lock-v2", "access-lock", "access-unlock", "commitment-lock", "commitment-unlock-v1", "commitment-unlock-v2", "lending-create", "lending-increase", "lending-withdraw", "lending-borrow", "transaction", "lock-submit", "reading", "allowance-check", "approval-request", "approval-wait", "lock-request", "lock-wait", "lock-confirmed", "other-phase", "pageerror", "limit"]);
const LANES = ["wallet", "read-rpc", "ui", "write-route"];
const MAX_OUTPUT = 2 * 1024 * 1024;
const TOTAL_MS = 360000;
const RUNS = [
  { id: "A-principal-alone", titles: [PRINCIPAL], files: ["web3-write.spec.js"], budget: 60000 },
  { id: "B-historical-context", titles: TITLES, files: FILES, budget: 150000 },
  { id: "C-accounts-changed-control", titles: [ACCOUNT], files: ["web3-write.spec.js"], budget: 60000 },
  { id: "D-observed-principal", titles: [PRINCIPAL], files: ["web3-write.spec.js"], budget: 60000, observed: true },
];
const owners = new Set();
let interrupted = false;
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
function requireThat(value, code) { if (!value) throw Object.assign(new Error(code), { safeCode: code }); }
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function grep(titles) { return "(?:" + titles.map(escapeRegex).join("|") + ")$"; }
function outputWithinLimit(bytes) { return Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= MAX_OUTPUT; }
function fileName(value) { return typeof value === "string" ? value.replace(/\\/g, "/").split("/").pop() : ""; }
function limitedError(error) {
  const raw = typeof error?.message === "string" ? error.message : "";
  const clean = raw.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  const lines = [];
  for (const line of clean.split(/\r?\n/)) {
    const text = line.trim();
    if (/^Test timeout of (?:30000|15000)ms exceeded\.?$/.test(text)) lines.push(text);
    else if (/^(?:Expected|Received):\s*\d{1,4}$/.test(text)) lines.push(text);
    else if (/^expect\(received\)\.toBe\(expected\)(?: \/\/ Object\.is equality)?$/.test(text)) lines.push(text);
    else if (/^Timeout (?:15000|30000)ms exceeded while waiting on the predicate$/.test(text)) lines.push(text);
    if (lines.length === 6) break;
  }
  return { category: /timeout|timed out/i.test(clean) ? "TIMEOUT" : /Expected:|expect\(/.test(clean) ? "ASSERTION" : "OTHER",
    safeOriginalLines: lines, messageSha256: hash(raw), rawMessageRetained: false };
}
function traceEvents(results, observed) {
  const events = [];
  let invalid = 0, prefixed = 0;
  const allowed = new Set(["schema", "lane", "clock", "id", "edge", "method", "category", "atMs", "status", "code"]);
  for (const result of results) {
    const text = (result.stdout || []).filter((chunk) => typeof chunk.text === "string").map((chunk) => chunk.text).join("");
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith(PREFIX)) continue;
      prefixed++;
      if (!observed || line.length > 2048 || prefixed > 193) { invalid++; continue; }
      try {
        const event = JSON.parse(line.slice(PREFIX.length));
        const keys = Object.keys(event);
        const baseKeys = ["schema", "lane", "clock", "id", "edge", "method", "category", "atMs", "status"];
        requireThat(keys.every((key) => allowed.has(key)) && baseKeys.every((key) => Object.hasOwn(event, key)), "TRACE_KEYS");
        requireThat(event.schema === "vault-observer/v1" && LANES.includes(event.lane) && ["browser", "node"].includes(event.clock), "TRACE_ENUM");
        requireThat(Number.isSafeInteger(event.id) && event.id >= 0 && Number.isFinite(event.atMs) && event.atMs >= 0, "TRACE_NUMBERS");
        requireThat(event.method === null || METHODS.has(event.method), "TRACE_METHOD");
        requireThat(CATEGORIES.has(event.category), "TRACE_CATEGORY");
        requireThat((event.edge === "start" && event.status === "started") || (event.edge === "end" && ["fulfilled", "rejected"].includes(event.status)) || (event.edge === "phase" && event.status === "observed") || (event.edge === "limit" && event.status === "truncated"), "TRACE_EDGE_STATUS");
        requireThat(!Object.hasOwn(event, "code") || (typeof event.code === "number" && Number.isFinite(event.code)), "TRACE_CODE");
        events.push(event);
      } catch { invalid++; }
    }
  }
  const truncated = events.some((event) => event.edge === "limit" || event.status === "truncated");
  const laneCoverage = Object.fromEntries(LANES.map((lane) => [lane, events.some((event) => event.lane === lane)]));
  const pending = new Map();
  for (const event of events) {
    const key = event.clock + ":" + event.lane + ":" + event.id;
    if (event.edge === "start") pending.set(key, event);
    if (event.edge === "end") pending.delete(key);
  }
  return { valid: invalid === 0 && !truncated && (observed ? events.length > 0 && Object.values(laneCoverage).every(Boolean) : prefixed === 0),
    prefixed, invalid, truncated, laneCoverage, events, pending: [...pending.values()],
    clockContract: "Local browser/node clocks; no cross-domain ordering. route fulfilled is fixture route.fulfill completion only." };
}
function flatten(suites, rows = []) {
  for (const suite of suites || []) {
    for (const spec of suite.specs || []) rows.push({ ...spec, file: spec.file || suite.file });
    flatten(suite.suites, rows);
  }
  return rows;
}
function analyze(run, processResult) {
  const out = { id: run.id, observed: Boolean(run.observed), expectedTitles: run.titles, expectedCount: run.titles.length, process: processResult.meta, status: "FAIL", failures: [] };
  try {
    requireThat(!processResult.meta.timedOut && !processResult.meta.outputLimited && !processResult.meta.spawnFailed && !processResult.meta.outcomeUncertain, "PROCESS_INCOMPLETE");
    requireThat(processResult.meta.docsIdentity?.valid === true, "CANONICAL_DOCS_IDENTITY_MISSING");
    const json = JSON.parse(processResult.stdout);
    const specs = flatten(json.suites);
    requireThat(specs.length === run.titles.length && specs.length > 0, "SELECTION_COUNT");
    requireThat(specs.every((spec, i) => spec.title === run.titles[i] && fileName(spec.file) === run.files[i]), "SELECTION_TITLE_FILE_ORDER");
    requireThat(json.config?.workers === 1 && Array.isArray(json.config.projects) && json.config.projects.length === 1 && json.config.projects.every((project) => project.retries === 0 && project.timeout === 30000), "CANONICAL_EXECUTION_LIMITS");
    const allResults = [];
    out.tests = specs.map((spec) => {
      requireThat(Array.isArray(spec.tests) && spec.tests.length === 1, "PROJECT_OR_REPEAT_COUNT");
      const test = spec.tests[0];
      requireThat(test.expectedStatus === "passed" && test.results?.length === 1, "RESULT_OR_RETRY_COUNT");
      const result = test.results[0]; allResults.push(result);
      requireThat(result.retry === 0 && typeof result.status === "string", "RESULT_SHAPE");
      const errors = [...(result.errors || []), ...(result.error ? [result.error] : [])];
      return { title: spec.title, file: fileName(spec.file), line: spec.line, status: result.status, retry: result.retry,
        durationMs: result.duration, startTime: result.startTime, errors: errors.slice(0, 4).map(limitedError) };
    });
    const starts = out.tests.map((test) => Date.parse(test.startTime));
    requireThat(starts.every(Number.isFinite) && starts.every((start, i) => i === 0 || start >= starts[i - 1]), "NATIVE_EXECUTION_ORDER");
    out.trace = traceEvents(allResults, Boolean(run.observed));
    out.principalStatus = out.tests.find((test) => test.title === PRINCIPAL)?.status || null;
    requireThat(out.trace.valid, "TRACE_INVALID_OR_UNINSTRUMENTED_LEAK");
    requireThat(processResult.meta.exitCode === 0 && out.tests.every((test) => test.status === "passed"), "REQUIRED_TEST_FAILURE");
    requireThat((json.errors || []).length === 0 && json.stats?.unexpected === 0 && json.stats?.flaky === 0 && json.stats?.skipped === 0, "REPORT_ERRORS_OR_SKIPS");
    out.status = "PASS";
  } catch (error) { out.failures.push(error.safeCode || "REPORT_INVALID_OR_MISSING"); }
  return out;
}
function aggregate(rows) {
  const a = rows.find((row) => row.id === RUNS[0].id), b = rows.find((row) => row.id === RUNS[1].id);
  let comparison = "UNKNOWN_INCOMPLETE_COMPARISON";
  if (a?.status === "PASS" && b?.status === "PASS") comparison = "HISTORICAL_CAUSE_UNKNOWN_BOTH_PASS";
  else if (a?.principalStatus && b?.principalStatus && a.principalStatus !== b.principalStatus) comparison = "DIFFERENT_SELECTION_OUTCOMES_IMMEDIATE_CAUSE_UNKNOWN";
  else if (a?.principalStatus && b?.principalStatus) comparison = "FAILED_IN_BOTH_SELECTIONS_IMMEDIATE_CAUSE_REQUIRES_OBSERVATION";
  return { status: rows.length === 4 && rows.every((row, i) => row.id === RUNS[i].id && row.status === "PASS") ? "PASS" : "FAIL",
    comparison, issue382Closed: false, historicalCauseResolved: false, runs: rows };
}
function timeRemaining(start, now, cap) { return Math.max(0, Math.min(cap, TOTAL_MS - (now - start))); }
function signalOwn(owner, signal) {
  if (!owners.has(owner) || owner.closed || !owner.child.pid || owner.child.exitCode !== null || owner.child.signalCode !== null) return;
  try { process.kill(-owner.child.pid, signal); } catch (error) { if (error.code !== "ESRCH") owner.signalFailed = true; }
}
async function stopOwn(owner) {
  if (owner.closed) return;
  signalOwn(owner, "SIGTERM");
  await Promise.race([owner.done, new Promise((resolve) => setTimeout(resolve, 500))]);
  if (!owner.closed) signalOwn(owner, "SIGKILL");
  await Promise.race([owner.done, new Promise((resolve) => setTimeout(resolve, 2000))]);
}
async function execute(run, output, started) {
  const directory = path.join(output, run.id); fs.mkdirSync(directory, { mode: 0o700 });
  const budget = timeRemaining(started, performance.now(), run.budget);
  const meta = { exitCode: null, timedOut: false, outputLimited: false, spawnFailed: false, outcomeUncertain: false, budgetMs: budget, outputDirectory: directory };
  if (interrupted || budget < 1000) return { stdout: "", meta: { ...meta, timedOut: true, outcomeUncertain: false } };
  const files = [...new Set(run.files)].map((file) => "tests/browser/" + file);
  const env = { ...process.env }; delete env[ENV_KEY]; if (run.observed) env[ENV_KEY] = "1";
  const cli = path.join(ROOT, "node_modules/@playwright/test/cli.js");
  let owner;
  try {
    const child = spawn(process.execPath, [cli, "test", ...files, "--config", path.join(ROOT, "playwright.config.js"), "--workers=1", "--retries=0", "--reporter=json", "--grep", grep(run.titles), "--output", directory], { cwd: ROOT, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    owner = { child, closed: false, stdout: "", stderr: "", bytes: 0 }; owners.add(owner);
    owner.done = new Promise((resolve) => {
      child.once("error", () => { meta.spawnFailed = true; resolve(); });
      child.once("close", (code, signal) => { owner.closed = true; meta.exitCode = code; meta.signal = signal; resolve(); });
    });
    for (const stream of ["stdout", "stderr"]) {
      child[stream].setEncoding("utf8"); child[stream].on("data", (chunk) => {
        owner.bytes += Buffer.byteLength(chunk);
        if (!outputWithinLimit(owner.bytes)) { meta.outputLimited = true; signalOwn(owner, "SIGTERM"); }
        else owner[stream] += chunk;
      });
    }
    let timer;
    await Promise.race([owner.done, new Promise((resolve) => { timer = setTimeout(() => { meta.timedOut = true; resolve(); }, budget); })]); clearTimeout(timer);
    if (!owner.closed) await stopOwn(owner);
    meta.outcomeUncertain = !owner.closed || meta.timedOut || meta.outputLimited || meta.signalFailed || Boolean(meta.signal);
    meta.stdoutBytes = Buffer.byteLength(owner.stdout); meta.stderrBytes = Buffer.byteLength(owner.stderr);
    meta.stdoutSha256 = hash(owner.stdout); meta.stderrSha256 = hash(owner.stderr);
    meta.rawOutputPublished = false; meta.artifactsRetained = true;
    const identity = path.join(directory, "docs-server-identity.json");
    try {
      const stat = fs.lstatSync(identity);
      requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 128 * 1024, "DOCS_IDENTITY_FILE");
      const bytes = fs.readFileSync(identity), value = JSON.parse(bytes);
      meta.docsIdentity = { valid: value.schema === 1 && value.status === "PASS" && value.origin === "http://localhost:8787" && Array.isArray(value.rows) && value.rows.length > 0, sha256: hash(bytes), rowCount: value.rows?.length || 0 };
    } catch { meta.docsIdentity = { valid: false }; }
    return { stdout: owner.stdout, meta };
  } catch { if (owner) await stopOwn(owner); return { stdout: "", meta: { ...meta, spawnFailed: true, outcomeUncertain: Boolean(owner && !owner.closed) } }; }
}
function fakeReport(run, statuses = run.titles.map(() => "passed")) {
  return { config: { workers: 1, projects: [{ retries: 0, timeout: 30000 }] }, suites: [{ specs: run.titles.map((title, i) => ({ title, file: run.files[i], line: 1,
    tests: [{ expectedStatus: "passed", results: [{ retry: 0, status: statuses[i], duration: 1, startTime: new Date(1000 + i).toISOString(), errors: [], stdout: [] }] }] })) }], stats: { unexpected: 0, flaky: 0, skipped: 0 }, errors: [] };
}
function selfTest() {
  let count = 0;
  const check = (value) => { count++; requireThat(value, "SELF_TEST_CONTROL_" + count); };
  const meta = { exitCode: 0, timedOut: false, outputLimited: false, spawnFailed: false, outcomeUncertain: false, docsIdentity: { valid: true } };
  const analyzeFake = (run, report, extra = {}) => analyze(run, { meta: { ...meta, ...extra }, stdout: JSON.stringify(report) });
  for (const title of TITLES) check(new RegExp(grep(TITLES)).test("file " + title));
  check(!new RegExp(grep(TITLES)).test(PRINCIPAL + " extra"));
  check(analyzeFake(RUNS[0], fakeReport(RUNS[0])).status === "PASS");
  check(analyzeFake(RUNS[1], fakeReport(RUNS[1])).status === "PASS");
  const empty = fakeReport(RUNS[0]); empty.suites[0].specs = []; check(analyzeFake(RUNS[0], empty).status === "FAIL");
  const wrongOrder = fakeReport(RUNS[1]); wrongOrder.suites[0].specs.reverse(); check(analyzeFake(RUNS[1], wrongOrder).status === "FAIL");
  const retry = fakeReport(RUNS[0]); retry.suites[0].specs[0].tests[0].results.push(retry.suites[0].specs[0].tests[0].results[0]); check(analyzeFake(RUNS[0], retry).status === "FAIL");
  check(analyze(RUNS[0], { meta, stdout: "broken" }).status === "FAIL");
  check(analyzeFake(RUNS[0], fakeReport(RUNS[0]), { exitCode: 1 }).status === "FAIL");
  check(analyzeFake(RUNS[0], fakeReport(RUNS[0]), { outputLimited: true }).status === "FAIL");
  check(analyzeFake(RUNS[0], fakeReport(RUNS[0]), { timedOut: true, outcomeUncertain: true }).status === "FAIL");
  check(outputWithinLimit(MAX_OUTPUT) && !outputWithinLimit(MAX_OUTPUT + 1));
  check(!outputWithinLimit(NaN) && !outputWithinLimit(-1));
  const partial = fakeReport(RUNS[0]); partial.suites[0].specs[0].title = "prefix " + PRINCIPAL; check(analyzeFake(RUNS[0], partial).status === "FAIL");
  check(analyzeFake(RUNS[0], fakeReport(RUNS[0]), { docsIdentity: { valid: false } }).status === "FAIL");
  check(timeRemaining(0, TOTAL_MS + 1, 60000) === 0);
  check(timeRemaining(0, 0, 60000) === 60000);
  const error = limitedError({ message: "Test timeout of 30000ms exceeded.\nExpected: 2\nReceived: 1\nPRIVATE_SENTINEL 0x1111222233334444555566667777888899990000 https://private.invalid" });
  check(error.safeOriginalLines.length === 3 && !JSON.stringify(error).includes("PRIVATE_SENTINEL") && !JSON.stringify(error).includes("0x1111"));
  const event = (lane) => ({ schema: "vault-observer/v1", lane, clock: lane === "wallet" || lane === "ui" ? "browser" : "node", id: 1, edge: "phase", method: null, category: "reading", atMs: 1, status: "observed" });
  const good = [{ stdout: LANES.map((lane) => ({ text: PREFIX + JSON.stringify(event(lane)) + "\n" })) }];
  check(traceEvents(good, true).valid);
  const joined = good[0].stdout.map((chunk) => chunk.text).join(""); check(traceEvents([{ stdout: [{ text: joined.slice(0, 17) }, { text: joined.slice(17) }] }], true).valid);
  check(!traceEvents(good, false).valid);
  const forged = event("wallet"); forged.result = "PRIVATE_SENTINEL";
  check(!traceEvents([{ stdout: [{ text: PREFIX + JSON.stringify(forged) }] }], true).valid);
  const limit = { ...event("ui"), edge: "limit", status: "truncated", category: "limit" };
  check(!traceEvents([{ stdout: [{ text: PREFIX + JSON.stringify(limit) }] }], true).valid);
  check(!traceEvents([{ stdout: Array(194).fill({ text: PREFIX + JSON.stringify(event("wallet")) + "\n" }) }], true).valid);
  const rows = RUNS.map((run) => ({ id: run.id, status: "PASS", principalStatus: run.titles.includes(PRINCIPAL) ? "passed" : null }));
  check(aggregate(rows).status === "PASS" && aggregate(rows).comparison === "HISTORICAL_CAUSE_UNKNOWN_BOTH_PASS");
  rows[2].status = "FAIL"; check(aggregate(rows).status === "FAIL");
  rows[0].principalStatus = "failed"; rows[0].status = "FAIL"; check(aggregate(rows).comparison === "DIFFERENT_SELECTION_OUTCOMES_IMMEDIATE_CAUSE_UNKNOWN");
  process.stdout.write(JSON.stringify({ schema: "vault-isolation-self-test/v1", status: "PASS", controls: count, playwrightStarted: false, childStarted: false }) + "\n");
}
async function main() {
  if (process.argv.length === 3 && process.argv[2] === "--self-test") return selfTest();
  requireThat(process.argv.length === 4 && process.argv[2] === "--output" && path.isAbsolute(process.argv[3]), "EXPLICIT_OUTPUT_REQUIRED");
  const output = path.resolve(process.argv[3]);
  if (!fs.existsSync(output)) fs.mkdirSync(output, { mode: 0o700 });
  requireThat(fs.lstatSync(output).isDirectory() && !fs.lstatSync(output).isSymbolicLink() && fs.readdirSync(output).length === 0, "FRESH_OUTPUT_REQUIRED");
  requireThat(Number(process.versions.node.split(".")[0]) === 22, "NODE22_REQUIRED");
  const readPackage = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", name, "package.json"), "utf8"));
  requireThat(readPackage("@playwright/test").version === "1.64.1" && readPackage("ethers").version === "6.17.0", "LOCKED_RUNTIME_REQUIRED");
  const started = performance.now(), rows = [];
  for (const run of RUNS) rows.push(analyze(run, await execute(run, output, started)));
  const result = { schema: "vault-isolation/v1", ...aggregate(rows), source: { node: process.version,
    comparatorSha256: hash(fs.readFileSync(__filename)), specSha256: hash(fs.readFileSync(path.join(ROOT, "tests/browser/web3-write.spec.js"))),
    canonicalConfigSha256: hash(fs.readFileSync(path.join(ROOT, "playwright.config.js"))), docsWeb3Sha256: hash(fs.readFileSync(path.join(ROOT, "docs/web3/index.html"))), walletCoreSha256: hash(fs.readFileSync(path.join(ROOT, "docs/web3-wallet-core.js"))), timeoutsChanged: false },
    artifactsDeleted: false, realWalletOrProviderAcceptance: false, outcomeUncertain: rows.some((row) => row.process.outcomeUncertain) };
  fs.writeFileSync(path.join(output, "isolation-result.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  process.stdout.write("IFR_VAULT_ISOLATION " + JSON.stringify(result) + "\n");
  process.exitCode = result.status === "PASS" ? 0 : 1;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { interrupted = true; for (const owner of owners) signalOwn(owner, "SIGTERM"); });
main().catch((error) => { process.stdout.write("IFR_VAULT_ISOLATION " + JSON.stringify({ schema: "vault-isolation/v1", status: "FAIL", failureCode: error.safeCode || "CONTROL_FAILURE", issue382Closed: false, artifactsDeleted: false }) + "\n"); process.exitCode = 1; });
