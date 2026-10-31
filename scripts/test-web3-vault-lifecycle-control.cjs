#!/usr/bin/env node
"use strict";

// CI-only real Node control of the comparator lifecycle, never browser evidence.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const PREFIX = "IFR_VAULT_LIFECYCLE_CONTROL ";
const CAP = 2 * 1024 * 1024;
const DEADLINE_MS = 28000;
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function check(value, code) { if (!value) throw Object.assign(new Error(code), { safeCode: code }); }
function nonceValid(value) { return typeof value === "string" && /^[a-f0-9]{32}$/.test(value); }
function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
function parseStat(text, pid) {
  const end = text.lastIndexOf(")");
  const fields = text.slice(end + 2).trim().split(/\s+/);
  check(end > 0 && /^\d+$/.test(fields[19]) && /^[A-Z]$/.test(fields[0]), "PROC_STAT_SHAPE");
  return { pid, startTicks: fields[19], pgid: Number(fields[2]), sid: Number(fields[3]), state: fields[0] };
}
function readPid(pid) {
  check(Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid, "FIXTURE_PID");
  try { return parseStat(fs.readFileSync(`/proc/${pid}/stat`, "utf8"), pid); }
  catch (error) { if (error.code === "ENOENT" || error.code === "ESRCH") return null; throw error; }
}
function sameIdentity(saved, live) {
  return Boolean(live && saved.pid === live.pid && saved.startTicks === live.startTicks
    && saved.pgid === live.pgid && saved.sid === live.sid && saved.pgid === saved.pid && saved.sid === saved.pid);
}
function privateWrite(root, name, bytes) {
  const file = path.join(root, name); check(inside(root, file), "OWN_WRITE_PATH");
  fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 }); fs.chmodSync(file, 0o600);
  return file;
}
function identityFile(root, role) { return path.join(root, `${role}-identity.json`); }
function writeIdentity(root, role, token) {
  const identity = parseStat(fs.readFileSync(`/proc/${process.pid}/stat`, "utf8"), process.pid);
  check(identity.pgid === identity.pid && identity.sid === identity.pid, "FIXTURE_OWN_GROUP");
  privateWrite(root, `${role}-identity.json`, JSON.stringify({ token, role, ...identity }) + "\n");
  return identity;
}
function loadIdentity(root, role, token) {
  const file = identityFile(root, role); check(inside(root, file), "IDENTITY_PATH");
  const stat = fs.lstatSync(file);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.uid === process.getuid()
    && (stat.mode & 0o777) === 0o600 && stat.size <= 1024, "IDENTITY_FILE");
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  check(value.token === token && value.role === role && nonceValid(token)
    && Number.isSafeInteger(value.pid) && value.pid > 1 && value.pid !== process.pid
    && /^\d+$/.test(value.startTicks) && value.pgid === value.pid && value.sid === value.pid, "IDENTITY_BINDING");
  if (role === "holder") {
    const ipcFile = path.join(root, "holder-ipc-confirmed.json");
    const ipcStat = fs.lstatSync(ipcFile);
    check(ipcStat.isFile() && !ipcStat.isSymbolicLink() && ipcStat.nlink === 1
      && ipcStat.uid === process.getuid() && (ipcStat.mode & 0o777) === 0o600
      && ipcStat.size <= 1024, "HOLDER_IPC_FILE");
    const ipc = JSON.parse(fs.readFileSync(ipcFile, "utf8"));
    check(ipc.token === token && ipc.pid === value.pid && ipc.startTicks === value.startTicks,
      "HOLDER_IPC_PROOF");
  }
  return value;
}
function fixture(role, token, root) {
  check(process.platform === "linux" && process.env.CI === "true" && nonceValid(token)
    && path.isAbsolute(root) && fs.realpathSync(root) === root, "FIXTURE_ADMISSION");
  const stat = fs.lstatSync(root);
  check(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid()
    && (stat.mode & 0o777) === 0o700 && ["ordinary", "stubborn", "holder"].includes(role), "FIXTURE_ROOT");
  const identity = writeIdentity(root, role === "holder" ? "holder" : "leader", token);
  if (role === "ordinary") {
    process.stdout.write("LIFECYCLE_CONTROL_FIXTURE_EXIT1\n");
    process.stderr.write("LIFECYCLE_CONTROL_EXPECTED_FAILURE\n");
    process.exitCode = 1; return;
  }
  process.on("SIGTERM", () => {});
  if (role === "holder") {
    check(typeof process.send === "function", "HOLDER_IPC_REQUIRED");
    process.send({ token, role, identity });
    process.on("disconnect", () => {});
  } else {
    // A separate owned group intentionally retains the supervised child's pipes.
    const child = spawn(process.execPath, [__filename, "--fixture", "holder", token, root],
      { detached: true, stdio: ["ignore", process.stdout, process.stderr, "ipc"] });
    child.once("error", () => { process.exitCode = 2; });
    child.once("message", (message) => {
      check(message?.token === token && message.role === "holder"
        && message.identity?.pid === child.pid, "HOLDER_IPC_BINDING");
      check(sameIdentity(message.identity, readPid(child.pid)), "HOLDER_IPC_IDENTITY");
      privateWrite(root, "holder-ipc-confirmed.json", JSON.stringify({ token,
        pid: child.pid, startTicks: message.identity.startTicks }) + "\n");
      process.stdout.write("LIFECYCLE_CONTROL_OWN_PIPEHOLDER_READY\n");
    });
  }
  setInterval(() => {}, 1000);
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function cleanFixtures(records) {
  const identities = [];
  for (const record of records) for (const role of record.holder ? ["leader", "holder"] : ["leader"]) {
    identities.push(loadIdentity(record.root, role, record.token));
  }
  function signal(signalName) {
    for (const saved of identities) {
      const live = readPid(saved.pid);
      if (!live) continue;
      check(sameIdentity(saved, live), "FIXTURE_IDENTITY_DRIFT");
      if (live.state === "Z") continue;
      // Re-read the exact identity immediately before signalling its own group.
      check(sameIdentity(saved, readPid(saved.pid)), "FIXTURE_SIGNAL_IDENTITY");
      try { process.kill(-saved.pgid, signalName); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  }
  signal("SIGTERM"); await pause(100); signal("SIGKILL");
  const until = performance.now() + 2500;
  for (;;) {
    const present = identities.filter((saved) => {
      const live = readPid(saved.pid); if (!live) return false;
      check(sameIdentity(saved, live), "FIXTURE_CLEANUP_IDENTITY_DRIFT"); return true;
    });
    if (present.length === 0) return { status: "PASS", identitiesChecked: identities.length, allExactIdentitiesAbsent: true };
    check(performance.now() < until, "FIXTURE_ABSENCE_NOT_PROVED"); await pause(25);
  }
}
function verifyStreams(meta, root, complete) {
  let retained = 0;
  for (const name of ["stdout", "stderr"]) {
    const stream = meta.rawStreams?.[name];
    check(stream && inside(root, stream.path) && stream.mode === 0o600, "PRIVATE_STREAM_PATH_MODE");
    const stat = fs.lstatSync(stream.path);
    check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.uid === process.getuid()
      && (stat.mode & 0o777) === 0o600 && stat.size === stream.retainedBytes && stat.size <= CAP, "PRIVATE_STREAM_FILE");
    const bytes = fs.readFileSync(stream.path); retained += bytes.length;
    check(sha(bytes) === stream.sha256 && stream.observedBytes >= bytes.length && stream.localRunnerOnly === true
      && stream.complete === complete && stream.prefixOnly === !complete && stream.truncated === !complete
      && stream.producerTotalBytesKnown === complete, "PRIVATE_STREAM_RECEIPT");
  }
  check(retained <= CAP && meta.rawOutputPublished === false && meta.artifactsRetained === true, "PRIVATE_STREAM_CAP");
  return { status: "PASS", retainedBytes: retained, streams: 2, mode: "0600", complete, rawPublished: false, localRunnerOnly: true };
}
function checkRows(rows, count, uncertain) {
  check(rows.length === 4 && count === (uncertain ? 1 : 4), "SELECTION_INVOKE_COUNT");
  if (uncertain) {
    check(rows[0].process.outcomeUncertain === true && rows.slice(1).every((row) =>
      row.status === "SKIPPED_NOT_RUN" && row.reason === "UNCERTAIN_PREVIOUS_OWNED_PROCESS"
      && row.process.started === false), "UNCERTAIN_MUST_SKIP");
  } else check(rows.every((row) => row.status === "FAIL" && row.process.exitCode === 1
    && row.process.outcomeUncertain === false), "ORDINARY_FAILURE_MUST_CONTINUE");
}
function pureControls() {
  const assert = require("node:assert/strict");
  const saved = { pid: 123, startTicks: "42", pgid: 123, sid: 123 };
  assert(sameIdentity(saved, { ...saved, state: "S" }));
  assert(!sameIdentity(saved, { ...saved, startTicks: "43" }));
  assert(!sameIdentity(saved, { ...saved, pgid: 456 }));
  assert(inside("/owned", "/owned/case/fixture.cjs") && !inside("/owned", "/other/file"));
  assert(nonceValid("ab".repeat(16)) && !nonceValid("arbitrary"));
  const normal = Array.from({ length: 4 }, () => ({ status: "FAIL", process: { exitCode: 1, outcomeUncertain: false } }));
  assert.doesNotThrow(() => checkRows(normal, 4, false));
  assert.throws(() => checkRows(normal, 1, false));
  const unknown = [{ status: "FAIL", process: { outcomeUncertain: true } }, ...Array.from({ length: 3 }, () =>
    ({ status: "SKIPPED_NOT_RUN", reason: "UNCERTAIN_PREVIOUS_OWNED_PROCESS", process: { started: false } }))];
  assert.doesNotThrow(() => checkRows(unknown, 1, true));
  assert.throws(() => checkRows(unknown, 2, true));
  process.stdout.write(PREFIX + JSON.stringify({ scope: "PURE_CONTROLS_ONLY", status: "PASS", controls: 9, childStarted: false, browserStarted: false }) + "\n");
}
async function main() {
  if (process.argv.length === 3 && process.argv[2] === "--self-test") return pureControls();
  check(process.platform === "linux" && process.env.CI === "true"
    && Number(process.versions.node.split(".")[0]) === 22, "LINUX_NODE22_CI_ONLY");
  check(process.argv.length === 4 && process.argv[2] === "--output" && path.isAbsolute(process.argv[3]), "EXPLICIT_FRESH_OUTPUT_REQUIRED");
  const output = path.resolve(process.argv[3]); check(!fs.existsSync(output), "OUTPUT_ALREADY_EXISTS");
  fs.mkdirSync(output, { mode: 0o700 }); check(fs.realpathSync(output) === output, "OUTPUT_REAL_ROOT");
  const source = fs.readFileSync(__filename); check(source.length <= 16 * 1024, "FIXTURE_SOURCE_SIZE");
  const comparator = path.join(__dirname, "test-web3-vault-isolation.cjs");
  const comparatorSha256 = sha(fs.readFileSync(comparator));
  const { execute, collectSelections } = require(comparator);
  check(typeof execute === "function" && typeof collectSelections === "function", "SHARED_COMPARATOR_SEAM");
  const records = [], cases = []; const started = performance.now(); let finishing = false;
  const publish = (status, failureCode, cleanup) => {
    const receipt = { schema: "vault-lifecycle-control/v1", scope: "LIFECYCLE_CONTROL_ONLY", status,
      failureCode, sourceSha256: sha(source), comparatorSha256, elapsedMs: performance.now() - started,
      deadlineMs: DEADLINE_MS, cases, cleanup, rawStreamsPublished: false, artifactsDeleted: false,
      runnerLocalRetentionOnly: true, browserStarted: false, realWalletOrProviderAcceptance: false, historicalCauseResolved: false };
    privateWrite(output, "lifecycle-control-result.json", JSON.stringify(receipt, null, 2) + "\n");
    process.stdout.write(PREFIX + JSON.stringify(receipt) + "\n");
  };
  const emergency = async (code) => {
    if (finishing) return; finishing = true;
    let cleanup; try { cleanup = await cleanFixtures(records); } catch { cleanup = { status: "FAIL", allExactIdentitiesAbsent: false }; }
    try { publish("FAIL", code, cleanup); }
    catch { process.stdout.write(PREFIX + '{"scope":"LIFECYCLE_CONTROL_ONLY","status":"FAIL","failureCode":"RECEIPT_WRITE_FAILED"}\n'); }
    process.exit(1);
  };
  const timer = setTimeout(() => { void emergency("OUTER_DEADLINE"); }, 24000);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void emergency("INTERRUPTED"); });
  try {
    for (const mode of ["ordinary", "stubborn"]) {
      const root = path.join(output, mode); fs.mkdirSync(root, { mode: 0o700 });
      const fixtureFile = privateWrite(root, "fixture.cjs", source);
      check(sha(fs.readFileSync(fixtureFile)) === sha(source), "EXACT_FIXTURE_COPY");
      let calls = 0; const streamProof = [];
      const rows = await collectSelections(async (run) => {
        calls++; check(/^[A-D]-[a-z-]+$/.test(run.id), "FIXED_RUN_ID");
        const identityRoot = path.join(root, "identity-" + run.id); fs.mkdirSync(identityRoot, { mode: 0o700 });
        const token = crypto.randomBytes(16).toString("hex"); records.push({ root: identityRoot, token, holder: mode === "stubborn" });
        const result = await execute({ ...run, budget: 1500 }, root, performance.now(),
          { nodeFixture: fixtureFile, nodeArguments: ["--fixture", mode, token, identityRoot] });
        check(result.meta.executionKind === "OWN_NODE_LIFECYCLE_CONTROL", "FIXTURE_EXECUTION_KIND");
        if (mode === "stubborn") check(result.meta.timedOut && result.meta.outcomeUncertain
          && result.meta.localHandlesDetached && !result.meta.childCloseObserved, "REAL_SHUTDOWN_FALLBACK_REQUIRED");
        else check(!result.meta.timedOut && result.meta.childCloseObserved && !result.meta.localHandlesDetached, "REAL_NORMAL_CLOSE_REQUIRED");
        streamProof.push(verifyStreams(result.meta, root, mode === "ordinary"));
        return { id: run.id, status: "FAIL", process: result.meta };
      });
      checkRows(rows, calls, mode === "stubborn");
      cases.push({ case: mode, status: "PASS", childInvocations: calls, deliberateFailureRows: rows.filter((row) => row.status === "FAIL").length,
        skippedRows: rows.filter((row) => row.status === "SKIPPED_NOT_RUN").length,
        uncertain: mode === "stubborn", streamProof, naturalChildCloseClaimed: mode === "ordinary" });
    }
    const cleanup = await cleanFixtures(records); check(performance.now() - started < DEADLINE_MS, "TOTAL_DEADLINE");
    if (!finishing) { finishing = true; clearTimeout(timer); publish("PASS", null, cleanup); }
  } catch (error) {
    clearTimeout(timer); if (finishing) throw error;
    await emergency(error.safeCode || "CONTROL_FAILURE");
  }
}
if (require.main === module) {
  const action = process.argv[2] === "--fixture"
    ? () => { check(process.argv.length === 6, "FIXTURE_ARGUMENTS"); return fixture(process.argv[3], process.argv[4], process.argv[5]); }
    : main;
  Promise.resolve().then(action).catch((error) => {
    process.stdout.write(PREFIX + JSON.stringify({ schema: "vault-lifecycle-control/v1", scope: "LIFECYCLE_CONTROL_ONLY", status: "FAIL",
      failureCode: error.safeCode || "CONTROL_FAILURE", browserStarted: false }) + "\n"); process.exitCode = 1;
  });
}
