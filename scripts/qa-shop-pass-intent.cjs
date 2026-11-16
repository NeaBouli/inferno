#!/usr/bin/env node
'use strict';

// Last-slot CONTROL_ONLY source; actual Parent admission/review is required.
// The final helper004 test is bound below; 7a is not an executable alternative.
const RUNTIME_ADMITTED = true;
const CONTROL_ONLY = true;
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

const BASE = 'd516a8960a3551dd6d397e9ad92a3d69eb246449';
const BASE_TREE = 'c7e92c6c42d43f6ba5e10d6b4035a70a37550088';
const CANDIDATE = '5cb9a1dea8cf16dc7eee67c1ba82a5c745a7b3a9';
const TARGET_TREE = 'd9a084b687b340a6ca2f746519920712a73aaed5';
const PATCH_SHA256 = '552304e60d7b54fb45d4f06bc9e439d262b2d5b3d83a8e311b6d75aff9514616';
const QA_PATHS = ['.github/workflows/qa-shop-pass-intent.yml', 'scripts/qa-shop-pass-intent.cjs', 'tests/fixtures/qa-shop-pass-intent-20261114.patch'];
const FRONTEND = 'apps/benefits-network/frontend';
const OMIT_ENV_TEMPLATES = [`${FRONTEND}/.env.example`, `${FRONTEND}/.env.local.example`];
const PASS = 'scripts/test-benefits-customer-pass-ui.js';
const FILES = [
  ['apps/benefits-network/frontend/src/components/CustomerCheckoutPass.tsx', 'dc7f9117a0d2c790dd24e243e01cfb35f913f10c', '4606c38561d5d7d35b56342f94c38060348c0fc5'],
  [PASS, '776bc25813d2c19365096568be97c39d050ae419', '006f2de2851f80327a28ef2e607d07de99cb51eb'],
  ['docs/architecture/MAP.md', '3cc436e9a88630b4ca6d7b560e772239bf84e04a', '5af9b19bdb0777892473a289d2064d7354e7125d'],
];
const LOCK_INPUTS = [
  ['package.json', '0b53f753554a98b0578892023ab8c7820d79c018'],
  ['package-lock.json', '964f54b3e7fa2b1bb7680d5c33704c61905dfe04'],
  [`${FRONTEND}/package.json`, 'e2807e9b8b8f3be47ab691f39f917ba64c28a34d'],
  [`${FRONTEND}/package-lock.json`, 'be312af9aa1c7617f5b6475c4f4044a23c686c6a'],
];
const MARKER = '[benefits-customer-pass-ui] PASS - create -> bind -> exact-offer proof redeems once';
const LOG_CAP = 16 * 1024 * 1024;
const DIAGNOSTIC_ERRORS = new Set(`
  UNKNOWN_FAILURE DIAGNOSTIC_WRITE_FAILED FORMAT_HOLD BOOTSTRAP_FAILED NAMESPACE_EXIT_FAILURE CHILD_SIGNALLED ERR_UNKNOWN_SIGNAL
  RO_VERIFY_META RO_VERIFY_HASH RO_VERIFY_IDS
  RO_TARGET_ROOT RO_TARGET_PROC RO_TARGET_SYS RO_TARGET_DEV RO_TARGET_WORKSPACE RO_TARGET_OTHER RO_TARGET_UNKNOWN
  RO_PROC_ROOT RO_PROC_ACPI RO_PROC_BUS RO_PROC_FS RO_PROC_INTERRUPTS RO_PROC_IRQ
  RO_PROC_KCORE RO_PROC_KEYS RO_PROC_SCSI RO_PROC_SYS RO_PROC_SYSRQ_TRIGGER RO_PROC_TIMER_LIST
  ENOENT EACCES EPERM ENOSPC EEXIST EIO ENOMEM EROFS EISDIR ENOTDIR ESRCH EPIPE EINVAL ETIMEDOUT EADDRINUSE
  NO_ARBITRARY_ARGUMENTS HOST_TOOLCHAIN HOSTED_CI_ONLY PARENT_AND_INDEPENDENT_REVIEW_REQUIRED
  HELPER_DIGEST GIT_DATA_OPERATION_FAILED LOCK_SCHEMA LOCK_LINK NON_OFFICIAL_LOCK_RECORD
  QA_BRANCH_NOT_BASELINE_ONLY BASE_BLOB_MISMATCH PATCH_DIGEST CANDIDATE_TREE_MISMATCH FINAL_BLOB_MISMATCH
  UNSUPPORTED_GIT_ENTRY ENV_TEMPLATE_MODE UNEXPECTED_SOURCE_INPUT ENV_TEMPLATE_PATH_SET SOURCE_PATH
  TRACKED_INPUT_DRIFT NPM_TOOLCHAIN INSTALLED_VERSION_MISMATCH SYSTEM_TOOL_OWNERSHIP NODE_EXECUTABLE_DRIFT
  RUNTIME_RECEIPT_MISSING CONTROL_RECEIPT_MISSING FINAL_CLEANUP_UNCERTAIN NOT_ACCEPTED RUNTIME_PRIVILEGE NAMESPACE_NOT_ISOLATED
  MOUNT_IPC_NAMESPACE_NOT_ISOLATED CAPABILITIES_NOT_DROPPED NETWORK_INTERFACE_NOT_LOOPBACK_ONLY
  PRIVATE_PROC_MOUNT PRIVATE_PROC_PID
  WORKER_IDENTITY MOUNT_ID_UNAVAILABLE SCRATCH_MOUNTS_NOT_DISTINCT MOUNT_COUNT MOUNTINFO_SHAPE
  MOUNT_PROPAGATION SCRATCH_MOUNT_FLAGS PRIVATE_SHM_FLAGS HOST_MOUNT_WRITABLE PRIVATE_TMP_BIND
  NAMESPACE_PORT_ALREADY_USED OUTER_DEADLINE SPAWN_FAILED UNOWNED_PROCESS_GROUP PROCESS_COUNT_CAP
  PRIVILEGED_SIGNAL_FAILED OWNED_PROCESS_REAP_UNCERTAIN CHILD_DEADLINE OUTPUT_CAP
  PROCESS_OBSERVATION_FAILED SIGNAL_FAILED COMMAND_FAILED PASS_FIXTURE_MARKER LISTENER_NOT_REAPED
  PRELOAD_TARGET UNEXPECTED_BROWSER_OPTIONS CONTEXT_POLICY UNSANDBOXED_BROWSER
`.trim().split(/\s+/));
const FAILURE_NAMES = ['bootstrap-failure.json', 'worker-failure.json', 'preload-failure.json'];
const owned = new Map();
let usedBytes = 0;
let stopped = false;
let endAt = Date.now() + 18 * 60_000;
let root;
let privileged = false;

function insist(condition, code) { if (!condition) throw Object.assign(new Error(code), { code }); }
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function json(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); }
function diagnosticCode(error) { const code = error?.code; return DIAGNOSTIC_ERRORS.has(code) ? code : 'UNKNOWN_FAILURE'; }
function diagnosticExit(code) { return Number.isInteger(code) && code >= 1 && code <= 255 ? code : 1; }
function writeFailure(name, stage, error, exitCode, targetSha256) {
  insist(FAILURE_NAMES.includes(name), 'DIAGNOSTIC_WRITE_FAILED');
  const directory = path.join(root, 'public');
  insist(process.getuid() !== 0 && fs.statSync(directory).uid === process.getuid(), 'DIAGNOSTIC_WRITE_FAILED');
  const stages = new Set(['BOOTSTRAP_PRIVATE', 'RO_SCAN', 'RO_SORT', 'RO_REMOUNT', 'RO_VERIFY', 'TMP_SHM', 'UID_DROP', 'WORKER', 'PRELOAD', 'DIAGNOSTIC']);
  const code = diagnosticCode(error);
  const receipt = stages.has(stage) && (stage === 'RO_VERIFY' || !['RO_VERIFY_META', 'RO_VERIFY_HASH', 'RO_VERIFY_IDS'].includes(code))
    ? { stage, errorCode: code, exitCode: diagnosticExit(exitCode) }
    : { stage: 'DIAGNOSTIC', errorCode: 'FORMAT_HOLD', exitCode: 1 };
  if (targetSha256 !== undefined) {
    if (name === 'bootstrap-failure.json' && receipt.stage === 'RO_REMOUNT' && receipt.errorCode === 'RO_TARGET_PROC' && typeof targetSha256 === 'string' && targetSha256.length === 64 && /^[a-f0-9]{64}$/.test(targetSha256)) receipt.targetSha256 = targetSha256;
    else Object.assign(receipt, { stage: 'DIAGNOSTIC', errorCode: 'FORMAT_HOLD', exitCode: 1 });
  }
  const fd = fs.openSync(path.join(directory, name), 'wx', 0o600);
  try {
    const stat = fs.fstatSync(fd);
    insist(stat.uid === process.getuid() && (stat.mode & 0o777) === 0o600, 'DIAGNOSTIC_WRITE_FAILED');
    fs.writeFileSync(fd, `${JSON.stringify(receipt)}\n`);
  } finally { fs.closeSync(fd); }
}
function failureNames() {
  return FAILURE_NAMES.filter(name => {
    try { fs.lstatSync(path.join(root, 'public', name)); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  });
}
function readOwnedFailure(name) {
  let fd;
  try {
    fd = fs.openSync(path.join(root, 'public', name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600 || stat.size > 512) return null;
    const bytes = Buffer.alloc(513);
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (count > 512) return null;
    const value = JSON.parse(bytes.subarray(0, count).toString('utf8'));
    if (!value || JSON.stringify(Object.keys(value).sort()) !== '["errorCode","exitCode","stage"]') return null;
    const expected = name === 'worker-failure.json' ? 'WORKER' : name === 'preload-failure.json' ? 'PRELOAD' : null;
    if (!expected || (value.stage !== expected && !(value.stage === 'DIAGNOSTIC' && value.errorCode === 'FORMAT_HOLD'))) return null;
    return DIAGNOSTIC_ERRORS.has(value.errorCode) && !['RO_VERIFY_META', 'RO_VERIFY_HASH', 'RO_VERIFY_IDS'].includes(value.errorCode) && diagnosticExit(value.exitCode) === value.exitCode ? value : null;
  } catch { return null; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function quarantineFailures(names) {
  if (!names.length) return;
  const directory = fs.mkdtempSync(path.join(root, 'raw', 'diagnostic-hold-'));
  for (const name of names) fs.renameSync(path.join(root, 'public', name), path.join(directory, name));
}
function namespaceDiagnostic(stdout, exit) {
  const names = failureNames();
  const failed = exit.code !== 0 || exit.signal !== null;
  if (stdout === '' && names.length === 0 && !failed) return null;
  if (stdout === '' && names.length === 1 && failed) {
    const value = readOwnedFailure(names[0]);
    if (value) return { ...value, retained: true };
  }
  const match = /^QA_SHOP_DIAGNOSTIC\|(BOOTSTRAP_PRIVATE|RO_SCAN|RO_SORT|RO_REMOUNT|RO_VERIFY|TMP_SHM|UID_DROP)\|(BOOTSTRAP_FAILED|RO_VERIFY_META|RO_VERIFY_HASH|RO_VERIFY_IDS|RO_TARGET_ROOT|RO_TARGET_PROC|RO_TARGET_SYS|RO_TARGET_DEV|RO_TARGET_WORKSPACE|RO_TARGET_OTHER|RO_TARGET_UNKNOWN|RO_PROC_ROOT|RO_PROC_ACPI|RO_PROC_BUS|RO_PROC_FS|RO_PROC_INTERRUPTS|RO_PROC_IRQ|RO_PROC_KCORE|RO_PROC_KEYS|RO_PROC_SCSI|RO_PROC_SYS|RO_PROC_SYSRQ_TRIGGER|RO_PROC_TIMER_LIST)\|([1-9][0-9]{0,2})(?:\|([a-f0-9]{64}))?\n$/.exec(stdout);
  const validCode = match && (['RO_VERIFY_META', 'RO_VERIFY_HASH', 'RO_VERIFY_IDS'].includes(match[2]) ? match[1] === 'RO_VERIFY' : (match[1] === 'RO_REMOUNT' ? match[2] !== 'BOOTSTRAP_FAILED' : match[2] === 'BOOTSTRAP_FAILED'));
  const validTarget = !match?.[4] || (match[1] === 'RO_REMOUNT' && match[2] === 'RO_TARGET_PROC');
  if (names.length === 0 && match?.[0] === stdout && validCode && validTarget && failed && exit.signal === null && Number(match[3]) <= 255 && exit.code === Number(match[3])) {
    return { stage: match[1], errorCode: match[2], exitCode: Number(match[3]), ...(match[4] ? { targetSha256: match[4] } : {}) };
  }
  quarantineFailures(names);
  return { stage: 'DIAGNOSTIC', errorCode: 'FORMAT_HOLD', exitCode: 1 };
}
function digest(file) { return sha(fs.readFileSync(file)); }
function mkdir(directory) { fs.mkdirSync(directory, { mode: 0o700 }); }
function cleanEnv() {
  return {
    PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: path.join(root, 'home'), TMPDIR: path.join(root, 'tmp'), LANG: 'C.UTF-8',
    CI: '1', NEXT_TELEMETRY_DISABLED: '1', BENEFITS_PASS_UI_PORT: '3210',
    NEXT_PUBLIC_API_URL: '', NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: '',
    PLAYWRIGHT_BROWSERS_PATH: path.join(root, 'browsers'),
    NPM_CONFIG_USERCONFIG: path.join(root, 'user.npmrc'),
    NPM_CONFIG_GLOBALCONFIG: path.join(root, 'global.npmrc'),
    NPM_CONFIG_CACHE: path.join(root, 'cache'), NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_LAZY_FETCH: '1',
    GIT_OPTIONAL_LOCKS: '0',
  };
}
function proc(id) {
  try {
    const text = fs.readFileSync(`/proc/${id}/stat`, 'utf8');
    const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
    return { state: fields[0], group: Number(fields[2]), start: fields[19] };
  } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return null; throw error; }
}
function descendants(id, rows = new Map()) {
  const item = proc(id);
  if (!item) return rows;
  rows.set(id, item);
  insist(rows.size <= 256, 'PROCESS_COUNT_CAP');
  let children;
  try { children = fs.readFileSync(`/proc/${id}/task/${id}/children`, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return rows; throw error; }
  for (const child of children.trim().split(/\s+/).filter(Boolean)) descendants(Number(child), rows);
  return rows;
}
function signalGroup(id, signal) {
  insist(owned.has(id) && id > 1, 'UNOWNED_PROCESS_GROUP');
  if (privileged) {
    const result = spawnSync('/usr/bin/sudo', ['-n', '/bin/kill', `-${signal}`, '--', String(-id)], {
      env: cleanEnv(), timeout: 3000, stdio: 'ignore',
    });
    if (result.status !== 0) {
      try { process.kill(-id, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
      insist(false, 'PRIVILEGED_SIGNAL_FAILED');
    }
  } else {
    const nodeSignal = signal === 'TERM' ? 'SIGTERM' : signal === 'KILL' ? 'SIGKILL' : null;
    insist(nodeSignal !== null, 'ERR_UNKNOWN_SIGNAL');
    try { process.kill(-id, nodeSignal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}
async function reap(id, seen, namespaceExit = false) {
  signalGroup(id, 'TERM');
  await new Promise(resolve => setTimeout(resolve, 500));
  signalGroup(id, 'KILL');
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const remaining = [...seen].filter(([pid, old]) => {
      const now = proc(pid);
      return now && now.start === old.start && (namespaceExit || now.state !== 'Z');
    });
    if (!remaining.length) { owned.delete(id); return { observedPids: seen.size, absent: true, zombiesDeferredToNamespaceExit: !namespaceExit }; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  insist(false, 'OWNED_PROCESS_REAP_UNCERTAIN');
}
async function command(label, binary, args, milliseconds, cwd, env = cleanEnv(), namespaceExit = false) {
  insist(!stopped && Date.now() < endAt, 'OUTER_DEADLINE');
  const log = path.join(root, 'raw', `${label}.log`);
  const fd = fs.openSync(log, 'wx', 0o600);
  let child;
  const seen = new Map();
  let failure;
  let output = '';
  let diagnosticStdout = '';
  let exit = { code: null, signal: null };
  let cleanup;
  const cleanupErrors = [];
  let poll;
  let timer;
  let killing = false;
  const stop = code => {
    failure ||= code;
    if (!killing) {
      killing = true;
      try { signalGroup(child.pid, 'KILL'); }
      catch (error) { cleanupErrors.push({ stage: 'SIGNAL', errorCode: diagnosticCode(error) }); }
    }
  };
  const capture = (chunk, stdout) => {
    usedBytes += chunk.length;
    if (usedBytes > LOG_CAP) { stop('OUTPUT_CAP'); return; }
    try { fs.writeSync(fd, chunk); }
    catch { stop('DIAGNOSTIC_WRITE_FAILED'); return; }
    output += chunk.toString('utf8');
    if (namespaceExit && stdout && diagnosticStdout.length <= 256) diagnosticStdout += chunk.toString('utf8');
  };
  try {
    child = spawn(binary, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (Number.isInteger(child.pid)) {
      owned.set(child.pid, true);
      poll = setInterval(() => {
        try { for (const [pid, item] of descendants(child.pid)) seen.set(pid, item); }
        catch { stop('PROCESS_OBSERVATION_FAILED'); }
      }, 50);
      timer = setTimeout(() => stop('CHILD_DEADLINE'), Math.min(milliseconds, endAt - Date.now()));
    } else failure = 'SPAWN_FAILED';
    child.stdout?.on('data', chunk => capture(chunk, true));
    child.stderr?.on('data', chunk => capture(chunk, false));
    exit = await new Promise((resolve, reject) => {
      child.once('error', error => { failure ||= diagnosticCode(error); });
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
  } catch (error) {
    failure ||= diagnosticCode(error);
  } finally {
    clearInterval(poll); clearTimeout(timer);
    if (child && owned.has(child.pid)) {
      try { cleanup = await reap(child.pid, seen, namespaceExit); }
      catch (error) { cleanupErrors.push({ stage: 'REAP', errorCode: diagnosticCode(error) }); }
    }
    try { fs.closeSync(fd); } catch { cleanupErrors.push({ stage: 'LOG_CLOSE', errorCode: 'DIAGNOSTIC_WRITE_FAILED' }); }
  }
  const primaryError = failure || (exit.code !== 0 || exit.signal !== null ? 'COMMAND_FAILED' : null);
  // No diagnostic I/O or exception can bypass the owned-process reap above.
  if (namespaceExit) {
    const receipt = namespaceDiagnostic(diagnosticStdout, exit);
    if (receipt) {
      failure ||= receipt.errorCode;
      if (receipt.errorCode === 'FORMAT_HOLD') failure = 'FORMAT_HOLD';
      if (!receipt.retained) writeFailure('bootstrap-failure.json', receipt.stage, { code: receipt.errorCode }, receipt.exitCode, receipt.targetSha256);
    }
  }
  const result = { label, ...exit, bytes: fs.statSync(log).size, sha256: digest(log), primaryError, cleanup: cleanup || null, cleanupErrors };
  write(path.join(root, 'public', `${label}.json`), result);
  if (failure || primaryError || cleanupErrors.length) {
    const code = failure || primaryError || cleanupErrors[0].errorCode;
    throw Object.assign(new Error(code), { code, exitCode: diagnosticExit(exit.code), primaryError, cleanupErrors });
  }
  return { ...result, output };
}
function git(repo, args, env, input) {
  const result = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false', '-C', repo, ...args], {
    env, input, timeout: 30_000, maxBuffer: 8 * 1024 * 1024, encoding: null,
  });
  insist(result.status === 0 && !result.error, 'GIT_DATA_OPERATION_FAILED');
  return result.stdout;
}
function officialLock(file) {
  const lock = json(file);
  insist(lock.lockfileVersion === 3, 'LOCK_SCHEMA');
  for (const item of Object.values(lock.packages)) {
    insist(!item.link, 'LOCK_LINK');
    if (!item.resolved) continue;
    const url = new URL(item.resolved);
    insist(url.protocol === 'https:' && url.hostname === 'registry.npmjs.org' && !url.username && !url.password && /^sha512-/.test(item.integrity || ''), 'NON_OFFICIAL_LOCK_RECORD');
  }
}
function stage(repo) {
  const env = cleanEnv();
  const qaHead = git(repo, ['rev-parse', 'HEAD'], env).toString().trim();
  const objects = git(repo, ['rev-parse', '--git-path', 'objects'], env).toString().trim();
  env.GIT_ALTERNATE_OBJECT_DIRECTORIES = path.resolve(repo, objects);
  env.GIT_OBJECT_DIRECTORY = path.join(root, 'objects');
  env.GIT_INDEX_FILE = path.join(root, 'index');
  mkdir(env.GIT_OBJECT_DIRECTORY);
  git(repo, ['read-tree', 'HEAD'], env);
  git(repo, ['update-index', '--force-remove', '--', ...QA_PATHS], env);
  insist(git(repo, ['write-tree'], env).toString().trim() === BASE_TREE, 'QA_BRANCH_NOT_BASELINE_ONLY');
  for (const [file, blob] of [...FILES.map(row => row.slice(0, 2)), ...LOCK_INPUTS]) {
    insist(git(repo, ['ls-files', '--stage', '--', file], env).toString().startsWith(`100644 ${blob} 0\t`), 'BASE_BLOB_MISMATCH');
  }
  const patchFile = path.join(repo, QA_PATHS[2]);
  insist(fs.lstatSync(patchFile).isFile() && digest(patchFile) === PATCH_SHA256, 'PATCH_DIGEST');
  git(repo, ['apply', '--cached', '--check', '--whitespace=error-all', patchFile], env);
  git(repo, ['apply', '--cached', '--whitespace=error-all', patchFile], env);
  insist(git(repo, ['write-tree'], env).toString().trim() === TARGET_TREE, 'CANDIDATE_TREE_MISMATCH');
  for (const [file, , blob] of FILES) insist(git(repo, ['ls-files', '--stage', '--', file], env).toString().startsWith(`100644 ${blob} 0\t`), 'FINAL_BLOB_MISMATCH');
  const source = path.join(root, 'source'); mkdir(source);
  const inputs = [];
  const omittedEnvironmentTemplates = [];
  const rows = git(repo, ['ls-files', '--stage', '-z'], env).toString().split('\0').filter(Boolean);
  const selected = [];
  for (const row of rows) {
    const match = /^(100644|100755) ([a-f0-9]{40}) 0\t(.+)$/.exec(row);
    insist(match, 'UNSUPPORTED_GIT_ENTRY');
    const [, mode, blob, file] = match;
    if (!(file.startsWith(`${FRONTEND}/`) || FILES.some(item => item[0] === file) || LOCK_INPUTS.some(item => item[0] === file))) continue;
    if (OMIT_ENV_TEMPLATES.includes(file)) {
      insist(mode === '100644', 'ENV_TEMPLATE_MODE');
      omittedEnvironmentTemplates.push({ path: file, blob });
      continue;
    }
    insist(!file.split('/').some(part => part.startsWith('.env')) && !file.includes('node_modules/') && !file.includes('/.next/'), 'UNEXPECTED_SOURCE_INPUT');
    selected.push({ mode, blob, file });
  }
  insist(omittedEnvironmentTemplates.length === 2 && OMIT_ENV_TEMPLATES.every(file => omittedEnvironmentTemplates.some(item => item.path === file)), 'ENV_TEMPLATE_PATH_SET');
  // Only names and index blob IDs above are inspected for the two templates.
  for (const { mode, blob, file } of selected) {
    const destination = path.resolve(source, file);
    insist(destination.startsWith(`${source}/`) && !file.split('/').includes('..'), 'SOURCE_PATH');
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    const data = git(repo, ['cat-file', 'blob', blob], env);
    fs.writeFileSync(destination, data, { flag: 'wx', mode: mode === '100755' ? 0o700 : 0o600 });
    inputs.push({ path: file, blob, sha256: sha(data), bytes: data.length });
  }
  officialLock(path.join(source, 'package-lock.json'));
  officialLock(path.join(source, FRONTEND, 'package-lock.json'));
  write(path.join(root, 'inputs.json'), inputs);
  write(path.join(root, 'public', 'source.json'), { qaHead, base: BASE, baseTree: BASE_TREE, candidate: CANDIDATE, candidateTree: TARGET_TREE, patchSha256: PATCH_SHA256, files: FILES, omittedEnvironmentTemplates, inputs });
  return source;
}
function unchanged(source) {
  for (const item of json(path.join(root, 'inputs.json'))) {
    const file = path.join(source, item.path);
    insist(fs.lstatSync(file).isFile() && digest(file) === item.sha256, 'TRACKED_INPUT_DRIFT');
  }
}
function mountId(directory) {
  const fd = fs.openSync(directory, 'r');
  try {
    const match = /^mnt_id:\s+(\d+)$/m.exec(fs.readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8'));
    insist(match, 'MOUNT_ID_UNAVAILABLE');
    return match[1];
  } finally { fs.closeSync(fd); }
}
function assertWriteBoundary() {
  const allowed = new Map([[mountId(root), root], [mountId('/tmp'), '/tmp'], [mountId('/dev/shm'), '/dev/shm']]);
  insist(allowed.size === 3, 'SCRATCH_MOUNTS_NOT_DISTINCT');
  const procId = mountId('/proc');
  insist(/^[1-9][0-9]{0,19}$/.test(procId) && !allowed.has(procId), 'PRIVATE_PROC_MOUNT');
  const text = fs.readFileSync('/proc/self/mountinfo', 'utf8');
  const rows = text.trim().split('\n');
  insist(rows.length > 3 && rows.length <= 4096, 'MOUNT_COUNT');
  let writable = 0;
  let procMounts = 0;
  for (const line of rows) {
    const fields = line.split(' ');
    const separator = fields.indexOf('-');
    insist(separator >= 6 && fields[4].startsWith('/') && !fields[4].includes('\\'), 'MOUNTINFO_SHAPE');
    insist(!fields.slice(6, separator).some(field => /^(shared|master|propagate_from):/.test(field)), 'MOUNT_PROPAGATION');
    const options = new Set(fields[5].split(','));
    if (fields[0] === procId) {
      insist(fields[4] === '/proc' && fields[3] === '/' && separator + 4 === fields.length && fields[separator + 1] === 'proc'
        && options.has('ro') && !options.has('rw') && options.has('nosuid') && options.has('nodev') && options.has('noexec'), 'PRIVATE_PROC_MOUNT');
      procMounts += 1;
    }
    if (allowed.has(fields[0])) {
      insist(fields[4] === allowed.get(fields[0]) && options.has('rw') && !options.has('ro') && options.has('nosuid') && options.has('nodev'), 'SCRATCH_MOUNT_FLAGS');
      if (fields[4] === '/dev/shm') insist(fields[separator + 1] === 'tmpfs' && options.has('noexec'), 'PRIVATE_SHM_FLAGS');
      writable += 1;
    } else insist(options.has('ro') && !options.has('rw'), 'HOST_MOUNT_WRITABLE');
  }
  insist(procMounts === 1, 'PRIVATE_PROC_MOUNT');
  const tmp = fs.statSync('/tmp');
  const backing = fs.statSync(path.join(root, 'tmp'));
  insist(writable === 3 && tmp.dev === backing.dev && tmp.ino === backing.ino, 'PRIVATE_TMP_BIND');
  return { policy: 'T_AND_PRIVATE_TMP_SHM_ONLY', mountCount: rows.length, writableMountCount: writable, mountInfoSha256: sha(text), rootSetupVerifiedBeforeUidDrop: true, workerRevalidated: true };
}
function assertNamespace() {
  insist(process.platform === 'linux' && process.getuid() !== 0, 'RUNTIME_PRIVILEGE');
  const context = json(path.join(root, 'context.json'));
  insist(fs.readlinkSync('/proc/self/ns/net') !== context.hostNet && fs.readlinkSync('/proc/self/ns/pid') !== context.hostPid, 'NAMESPACE_NOT_ISOLATED');
  insist(fs.readlinkSync('/proc/self/ns/mnt') !== context.hostMount && fs.readlinkSync('/proc/self/ns/ipc') !== context.hostIpc, 'MOUNT_IPC_NAMESPACE_NOT_ISOLATED');
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  const namespacePids = status.split('\n').filter(line => line.startsWith('NSpid:'));
  const namespacePid = namespacePids?.length === 1 && /^NSpid:[ \t]+([1-9][0-9]*)[ \t]*$/.exec(namespacePids[0]);
  insist(namespacePid && namespacePid[0] === namespacePids[0] && namespacePid[1] === String(process.pid), 'PRIVATE_PROC_PID');
  insist(/^NoNewPrivs:\s+1$/m.test(status) && /^CapEff:\s+0+$/m.test(status), 'CAPABILITIES_NOT_DROPPED');
  const devices = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').filter(line => line.includes(':')).map(line => line.split(':')[0].trim());
  insist(devices.length === 1 && devices[0] === 'lo', 'NETWORK_INTERFACE_NOT_LOOPBACK_ONLY');
  insist(process.env.QA_SHOP_NONCE === context.nonce && process.getuid() === context.uid && process.getgid() === context.gid, 'WORKER_IDENTITY');
  return assertWriteBoundary();
}
function listenPorts() {
  return ['tcp', 'tcp6'].flatMap(name => fs.readFileSync(`/proc/net/${name}`, 'utf8').trim().split('\n').slice(1)
    .map(line => line.trim().split(/\s+/)).filter(fields => fields[3] === '0A').map(fields => parseInt(fields[1].split(':')[1], 16)));
}
function selfPin() {
  insist(/^[a-f0-9]{64}$/.test(process.env.QA_SHOP_HELPER_SHA256 || '') && digest(__filename) === process.env.QA_SHOP_HELPER_SHA256, 'HELPER_DIGEST');
}
function installBrowserPolicy() {
  root = process.env.QA_SHOP_ROOT;
  assertNamespace(); selfPin();
  const source = path.join(root, 'source');
  insist(process.argv.length === 2 && process.argv[1] === path.join(source, PASS), 'PRELOAD_TARGET');
  const requireStage = createRequire(path.join(source, 'package.json'));
  const { chromium } = requireStage('playwright');
  const original = chromium.launch.bind(chromium);
  chromium.launch = async options => {
    insist(options?.headless === true && !options.executablePath && !options.args?.length, 'UNEXPECTED_BROWSER_OPTIONS');
    const browser = await original({ ...options, chromiumSandbox: true, args: ['--disable-background-networking'], env: cleanEnv() });
    // The existing suite otherwise receives Playwright's no-sandbox default.
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async config => {
      insist(config?.serviceWorkers === 'block' && !config.ignoreHTTPSErrors, 'CONTEXT_POLICY');
      const context = await newContext(config);
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        return url.origin === 'http://127.0.0.1:3210' ? route.continue() : route.abort('blockedbyclient');
      });
      return context;
    };
    for (const entry of fs.readdirSync('/proc').filter(value => /^\d+$/.test(value))) {
      try {
        const args = fs.readFileSync(`/proc/${entry}/cmdline`).toString().split('\0');
        insist(!args.some(arg => arg === '--no-sandbox' || arg === '--disable-setuid-sandbox'), 'UNSANDBOXED_BROWSER');
      } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error; }
    }
    const executable = chromium.executablePath();
    write(path.join(root, 'public', 'browser.json'), { version: browser.version(), executableSha256: digest(executable), chromiumSandbox: true, unmatchedHttpDenied: true });
    return browser;
  };
}
async function worker() {
  root = process.env.QA_SHOP_ROOT;
  const writeBoundary = assertNamespace(); selfPin();
  write(path.join(root, 'public', 'write-boundary.json'), writeBoundary);
  const context = json(path.join(root, 'context.json'));
  endAt = context.endAt;
  const source = path.join(root, 'source');
  insist(listenPorts().length === 0, 'NAMESPACE_PORT_ALREADY_USED');
  unchanged(source);
  if (CONTROL_ONLY) {
    write(path.join(root, 'public', 'control-only.json'), { mode: 'CONTROL_ONLY', candidate: CANDIDATE, candidateTree: TARGET_TREE, sourceChecksPassed: true, namespaceChecksPassed: true, port3210Closed: true, acquisition: 'NOT_RUN', passSuite: 'NOT_RUN', typecheck: 'NOT_RUN', browser: 'NOT_RUN', kernelReap: 'AWAIT_OUTER_NAMESPACE_EXIT' });
    return;
  }
  const env = { ...cleanEnv(), QA_SHOP_ROOT: root, QA_SHOP_NONCE: context.nonce, QA_SHOP_HELPER_SHA256: process.env.QA_SHOP_HELPER_SHA256 };
  const pass = await command('pass', process.execPath, ['--require', __filename, path.join(source, PASS)], 480_000, source, env);
  insist(pass.output.split(MARKER).length === 2, 'PASS_FIXTURE_MARKER');
  const tsc = path.join(source, FRONTEND, 'node_modules/typescript/lib/tsc.js');
  await command('typecheck', process.execPath, [tsc, '--noEmit'], 180_000, path.join(source, FRONTEND), env);
  unchanged(source);
  insist(listenPorts().length === 0, 'LISTENER_NOT_REAPED');
  write(path.join(root, 'public', 'runtime.json'), { candidate: CANDIDATE, candidateTree: TARGET_TREE, testBlob: FILES[1][2], marker: MARKER, markerObservedOnce: true, typecheckExit: 0, passExit: 0, port3210Closed: true, network: fs.readlinkSync('/proc/self/ns/net'), pidNamespace: fs.readlinkSync('/proc/self/ns/pid'), uid: process.getuid(), noNewPrivileges: true, productionBuild: 'NOT_RUN', backendReplay: 'NOT_PROVEN', physicalWallet: 'NOT_RUN', kernelReap: 'AWAIT_OUTER_NAMESPACE_EXIT' });
}
// All remounts use per-mount bind flags inside the private namespace, never a
// superblock/global-host remount. Unsupported mount topology is a hard refusal.
const NAMESPACE_SCRIPT = String.raw`
set -eu
umask 077
diagnostic_stage=BOOTSTRAP_PRIVATE
diagnostic_code=BOOTSTRAP_FAILED
bootstrap_exit() {
  diagnostic_exit=$1
  trap - 0
  if [ "$diagnostic_exit" -ne 0 ]; then
    case "$diagnostic_stage" in BOOTSTRAP_PRIVATE|RO_SCAN|RO_SORT|RO_REMOUNT|RO_VERIFY|TMP_SHM|UID_DROP) ;; *) diagnostic_stage=BOOTSTRAP_UNKNOWN ;; esac
    case "$diagnostic_stage:$diagnostic_code" in
      RO_VERIFY:RO_VERIFY_META|RO_VERIFY:RO_VERIFY_HASH|RO_VERIFY:RO_VERIFY_IDS) ;;
      *:RO_VERIFY_META|*:RO_VERIFY_HASH|*:RO_VERIFY_IDS) diagnostic_stage=DIAGNOSTIC; diagnostic_code=FORMAT_HOLD ;;
      RO_REMOUNT:RO_TARGET_ROOT|RO_REMOUNT:RO_TARGET_PROC|RO_REMOUNT:RO_TARGET_SYS|RO_REMOUNT:RO_TARGET_DEV|RO_REMOUNT:RO_TARGET_WORKSPACE|RO_REMOUNT:RO_TARGET_OTHER|RO_REMOUNT:RO_TARGET_UNKNOWN) ;;
      RO_REMOUNT:RO_PROC_ROOT|RO_REMOUNT:RO_PROC_ACPI|RO_REMOUNT:RO_PROC_BUS|RO_REMOUNT:RO_PROC_FS|RO_REMOUNT:RO_PROC_INTERRUPTS|RO_REMOUNT:RO_PROC_IRQ|RO_REMOUNT:RO_PROC_KCORE|RO_REMOUNT:RO_PROC_KEYS|RO_REMOUNT:RO_PROC_SCSI|RO_REMOUNT:RO_PROC_SYS|RO_REMOUNT:RO_PROC_SYSRQ_TRIGGER|RO_REMOUNT:RO_PROC_TIMER_LIST) ;;
      RO_REMOUNT:*) diagnostic_code=RO_TARGET_UNKNOWN ;;
      *) diagnostic_code=BOOTSTRAP_FAILED ;;
    esac
    case "$diagnostic_exit" in ''|*[!0-9]*) diagnostic_exit=1 ;; esac
    if [ "$diagnostic_exit" -lt 1 ] || [ "$diagnostic_exit" -gt 255 ]; then diagnostic_exit=1; fi
    if [ "$diagnostic_stage:$diagnostic_code" = RO_REMOUNT:RO_TARGET_PROC ]; then
      diagnostic_sha256=FORMAT_HOLD
      # Encode raw bytes before awk; no dependence on its embedded-NUL behavior.
      if diagnostic_validated=$({
        if {
          if printf '%s' "$target" | /usr/bin/sha256sum 2>/dev/null; then
            printf '0\n'
          else
            printf '1\n'
          fi
        } | /usr/bin/od -An -v -tx1 2>/dev/null; then
          printf 'QA_OD_OK\n'
        else
          printf 'QA_OD_FAIL\n'
        fi
      } | /usr/bin/awk '
          BEGIN {
            alphabet["x30"]="0"; alphabet["x31"]="1"; alphabet["x32"]="2"; alphabet["x33"]="3"
            alphabet["x34"]="4"; alphabet["x35"]="5"; alphabet["x36"]="6"; alphabet["x37"]="7"
            alphabet["x38"]="8"; alphabet["x39"]="9"; alphabet["x61"]="a"; alphabet["x62"]="b"
            alphabet["x63"]="c"; alphabet["x64"]="d"; alphabet["x65"]="e"; alphabet["x66"]="f"
            suffix[65]="20"; suffix[66]="20"; suffix[67]="2d"; suffix[68]="0a"; suffix[69]="30"; suffix[70]="0a"
          }
          $0 == "" && NR == 6 && n == 70 && !complete && !separator { separator=1; next }
          $0 == "QA_OD_OK" {
            if (NR != 6 + separator || n != 70 || complete) { bad=1; exit 1 }
            complete=1; next
          }
          {
            if (complete || NR > 5 || $0 ~ /[^0-9a-f ]/ || NF != (NR < 5 ? 16 : 6)) { bad=1; exit 1 }
            for (i=1; i<=NF; i++) {
              n++; token=$i
              if (token !~ /^[0-9a-f][0-9a-f]$/) { bad=1; exit 1 }
              if (n <= 64) {
                key="x" token
                if (!(key in alphabet)) { bad=1; exit 1 }
                hash=hash alphabet[key]
              } else if (("x" token) != ("x" suffix[n])) { bad=1; exit 1 }
            }
          }
          END { if (bad || NR != 6 + separator || !complete || n != 70 || length(hash) != 64) exit 1; print hash }
      ' 2>/dev/null); then
        diagnostic_sha256=$diagnostic_validated
      fi
      printf 'QA_SHOP_DIAGNOSTIC|%s|%s|%s|%s\n' "$diagnostic_stage" "$diagnostic_code" "$diagnostic_exit" "$diagnostic_sha256"
    else
      printf 'QA_SHOP_DIAGNOSTIC|%s|%s|%s\n' "$diagnostic_stage" "$diagnostic_code" "$diagnostic_exit"
    fi
  fi
  exit "$diagnostic_exit"
}
trap 'bootstrap_exit "$?"' 0
test "$#" -eq 12
test "$$" -eq 1
uid=$1; gid=$2; runtime_path=$3; scratch=$4
nonce=$5; helper_sha=$6; node=$7; helper=$8
shift 8
test "$(/usr/bin/readlink /proc/self/ns/mnt)" != "$1"
test "$(/usr/bin/readlink /proc/self/ns/net)" != "$2"
test "$(/usr/bin/readlink /proc/self/ns/pid)" != "$3"
test "$(/usr/bin/readlink /proc/self/ns/ipc)" != "$4"
test "$(/usr/bin/readlink -e "$scratch")" = "$scratch"
test "$(/usr/bin/readlink -e "$scratch/tmp")" = "$scratch/tmp"
/usr/bin/mount --make-rprivate /
/usr/bin/mount --bind "$scratch" "$scratch"
exec 9< "$scratch"
work_id=$(/usr/bin/awk '$1 == "mnt_id:" { print $2; found=1 } END { if (!found) exit 1 }' /proc/self/fdinfo/9)
exec 9<&-
test -n "$work_id"
diagnostic_stage=RO_SCAN
# Retain exact decimal IDs, including covered mounts, before changing the proc view.
test ! -e "$scratch/original-mount-ids"
test ! -L "$scratch/original-mount-ids"
(
  set -C
  /usr/bin/awk '
    NR > 4096 || NF < 10 || $1 !~ /^[1-9][0-9]*$/ || length($1) > 20 || seen["x" $1]++ { bad=1; exit 1 }
    { print $1 }
    END { if (bad || NR < 4) exit 1 }
  ' /proc/self/mountinfo > "$scratch/original-mount-ids"
)
test "$(/usr/bin/stat -c '%u:%a:%h:%F' "$scratch/original-mount-ids")" = '0:600:1:regular file'
original_ids_bytes=$(/usr/bin/stat -c '%s' "$scratch/original-mount-ids")
test "$original_ids_bytes" -ge 1; test "$original_ids_bytes" -le 86016
/usr/bin/awk -v work="$work_id" '
  NR > 4096 || NF < 10 || $5 !~ /^\// || $5 ~ /\\/ { exit 1 }
  { for (i=7; i<=NF && $i!="-"; i++) if ($i ~ /^(shared|master|propagate_from):/) exit 1 }
  $1 == work && ("," $6 ",") ~ /,noexec,/ { exit 1 }
  $1 != work && ("," $6 ",") ~ /,rw,/ { print length($5), $5 }
' /proc/self/mountinfo > "$scratch/read-only-mounts.unsorted"
diagnostic_stage=RO_SORT
/usr/bin/sort -rn "$scratch/read-only-mounts.unsorted" > "$scratch/read-only-mounts"
diagnostic_stage=RO_REMOUNT
diagnostic_code=RO_TARGET_UNKNOWN
while IFS=' ' read -r length target; do
  case "$target" in
    /) diagnostic_code=RO_TARGET_ROOT ;;
    /proc) diagnostic_code=RO_PROC_ROOT ;;
    /proc/acpi) diagnostic_code=RO_PROC_ACPI ;;
    /proc/bus) diagnostic_code=RO_PROC_BUS ;;
    /proc/fs) diagnostic_code=RO_PROC_FS ;;
    /proc/interrupts) diagnostic_code=RO_PROC_INTERRUPTS ;;
    /proc/irq) diagnostic_code=RO_PROC_IRQ ;;
    /proc/kcore) diagnostic_code=RO_PROC_KCORE ;;
    /proc/keys) diagnostic_code=RO_PROC_KEYS ;;
    /proc/scsi) diagnostic_code=RO_PROC_SCSI ;;
    /proc/sys) diagnostic_code=RO_PROC_SYS ;;
    /proc/sysrq-trigger) diagnostic_code=RO_PROC_SYSRQ_TRIGGER ;;
    /proc/timer_list) diagnostic_code=RO_PROC_TIMER_LIST ;;
    /proc|/proc/*) diagnostic_code=RO_TARGET_PROC ;;
    /sys|/sys/*) diagnostic_code=RO_TARGET_SYS ;;
    /dev|/dev/*) diagnostic_code=RO_TARGET_DEV ;;
    /home|/home/*|/workspace|/workspace/*) diagnostic_code=RO_TARGET_WORKSPACE ;;
    *) diagnostic_code=RO_TARGET_OTHER ;;
  esac
  /usr/bin/mount -o remount,bind,ro "$target"
done < "$scratch/read-only-mounts"
diagnostic_code=RO_TARGET_ROOT
/usr/bin/mount -o remount,bind,ro=recursive / /
diagnostic_stage=BOOTSTRAP_PRIVATE
diagnostic_code=BOOTSTRAP_FAILED
/usr/bin/mount -o remount,bind,rw "$scratch" "$scratch"
/usr/bin/mount -t proc -o ro,nosuid,nodev,noexec proc /proc
diagnostic_stage=RO_VERIFY
diagnostic_code=RO_VERIFY_META
test "$(/usr/bin/stat -c '%u:%a:%h:%F' "$scratch/original-mount-ids")" = '0:600:1:regular file'
original_ids_bytes=$(/usr/bin/stat -c '%s' "$scratch/original-mount-ids")
test "$original_ids_bytes" -ge 1; test "$original_ids_bytes" -le 86016
diagnostic_code=RO_VERIFY_HASH
original_ids_sha=$(/usr/bin/sha256sum < "$scratch/original-mount-ids")
canonical_ids_sha=$(
  { if /usr/bin/awk '{ print }' "$scratch/original-mount-ids"; then :; else printf '!QA_CANONICAL_AWK_FAILED!\n'; fi; } |
    /usr/bin/sha256sum
)
test "$original_ids_sha" = "$canonical_ids_sha"
diagnostic_code=RO_VERIFY_IDS
/usr/bin/awk -v work="$work_id" '
  # Statuses11..17 are guard diagnostics, not kernel errno.
  FILENAME == ARGV[1] {
    if (FNR > 4096 || $0 !~ /^[1-9][0-9]*$/ || length($0) > 20 || original["x" $0]++) { bad=11; exit bad }
    original_count++; next
  }
  {
    current_count++
    if (current_count > 4096 || NF < 10 || $1 !~ /^[1-9][0-9]*$/ || length($1) > 20 || current["x" $1]++ || $5 !~ /^\// || $5 ~ /\\/) { bad=12; exit bad }
    for (i=7; i<=NF && $i!="-"; i++) if ($i ~ /^(shared|master|propagate_from):/) { bad=13; exit bad }
    if (i < 7 || i + 3 != NF || $i != "-") { bad=12; exit bad }
    if ((("x" $1) != ("x" work) && ("," $6 ",") ~ /,rw,/) || (("x" $1) == ("x" work) && ("," $6 ",") ~ /,ro,/)) { bad=14; exit bad }
  }
  ("x" $1) != ("x" work) && ("," $6 ",") !~ /,ro,/ { bad=14; exit bad }
  ("x" $1) == ("x" work) && ("," $6 ",") !~ /,rw,/ { bad=15; exit bad }
  END {
    if (bad) exit bad
    if (original_count < 4 || current_count < 4 || !original["x" work]) exit 16
    for (id in original) if (!(id in current)) exit 17
  }
' "$scratch/original-mount-ids" /proc/self/mountinfo
diagnostic_stage=TMP_SHM
diagnostic_code=BOOTSTRAP_FAILED
/usr/bin/mount -o remount,bind,rw,nosuid,nodev "$scratch"
/usr/bin/mount --bind "$scratch/tmp" /tmp
/usr/bin/mount -o remount,bind,rw,nosuid,nodev /tmp
/usr/bin/mount -t tmpfs -o rw,nosuid,nodev,noexec,size=256m,mode=1777 qa-shop-pass-shm /dev/shm
exec 8< /tmp
tmp_id=$(/usr/bin/awk '$1 == "mnt_id:" { print $2; found=1 } END { if (!found) exit 1 }' /proc/self/fdinfo/8)
exec 8<&-
exec 7< /dev/shm
shm_id=$(/usr/bin/awk '$1 == "mnt_id:" { print $2; found=1 } END { if (!found) exit 1 }' /proc/self/fdinfo/7)
exec 7<&-
test -n "$tmp_id"; test -n "$shm_id"
test "$work_id" != "$tmp_id"; test "$work_id" != "$shm_id"; test "$tmp_id" != "$shm_id"
test "$(/usr/bin/stat -Lc '%d:%i' "$scratch/tmp")" = "$(/usr/bin/stat -Lc '%d:%i' /tmp)"
/usr/bin/awk -v work="$work_id" -v tmp="$tmp_id" -v shm="$shm_id" -v scratch="$scratch" '
  NR > 4096 || NF < 10 || $5 !~ /^\// || $5 ~ /\\/ { exit 1 }
  { for (i=7; i<=NF && $i!="-"; i++) if ($i ~ /^(shared|master|propagate_from):/) exit 1 }
  $1 == work || $1 == tmp || $1 == shm {
    if (($1 == work && $5 != scratch) || ($1 == tmp && $5 != "/tmp") || ($1 == shm && $5 != "/dev/shm")) exit 1
    if (("," $6 ",") !~ /,rw,/ || ("," $6 ",") !~ /,nosuid,/ || ("," $6 ",") !~ /,nodev,/) exit 1
    if ($1 == shm && (("," $6 ",") !~ /,noexec,/ || $(i+1) != "tmpfs")) exit 1
    writable++; next
  }
  ("," $6 ",") !~ /,ro,/ { exit 1 }
  END { if (writable != 3) exit 1 }
' /proc/self/mountinfo
diagnostic_stage=BOOTSTRAP_PRIVATE
/usr/sbin/ip link set dev lo up
diagnostic_stage=UID_DROP
exec /usr/bin/setpriv --reuid="$uid" --regid="$gid" --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs /usr/bin/env -i PATH="$runtime_path" HOME="$scratch/home" TMPDIR="$scratch/tmp" LANG=C.UTF-8 CI=1 NEXT_TELEMETRY_DISABLED=1 BENEFITS_PASS_UI_PORT=3210 NEXT_PUBLIC_API_URL= NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID= PLAYWRIGHT_BROWSERS_PATH="$scratch/browsers" QA_SHOP_ROOT="$scratch" QA_SHOP_NONCE="$nonce" QA_SHOP_HELPER_SHA256="$helper_sha" "$node" "$helper" --namespace-worker
`;
async function main() {
  insist(process.argv.length === 2, 'NO_ARBITRARY_ARGUMENTS');
  insist(process.platform === 'linux' && process.arch === 'x64' && process.version === 'v22.22.2' && process.getuid() !== 0, 'HOST_TOOLCHAIN');
  insist(process.env.GITHUB_ACTIONS === 'true' && /^\d+$/.test(process.env.GITHUB_RUN_ID || '') && /^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT || ''), 'HOSTED_CI_ONLY');
  const temporary = fs.realpathSync(process.env.RUNNER_TEMP);
  root = path.join(temporary, `qa-shop-pass-intent-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`);
  mkdir(root);
  for (const name of ['public', 'raw', 'home', 'tmp', 'cache', 'browsers']) mkdir(path.join(root, name));
  let failure;
  let primaryError = null;
  const cleanupErrors = [];
  let complete = false;
  try {
    selfPin();
    insist(RUNTIME_ADMITTED, 'PARENT_AND_INDEPENDENT_REVIEW_REQUIRED');
    for (const file of ['user.npmrc', 'global.npmrc']) fs.writeFileSync(path.join(root, file), '', { flag: 'wx', mode: 0o600 });
    const repo = path.resolve(__dirname, '..');
    const source = stage(repo);
    const nodeSha = digest(process.execPath);
    let acquisition = null;
    if (!CONTROL_ONLY) {
      const npm = fs.realpathSync(path.join(path.dirname(process.execPath), '..', 'lib/node_modules/npm/bin/npm-cli.js'));
      const version = await command('npm-version', process.execPath, [npm, '--version'], 10_000, source);
      const npmVersion = version.output.trim();
      insist(/^10\.\d+\.\d+$/.test(npmVersion), 'NPM_TOOLCHAIN');
      for (const [label, cwd] of [['root-ci', source], ['frontend-ci', path.join(source, FRONTEND)]]) {
        await command(label, process.execPath, [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--fetch-retries=0', '--fetch-timeout=10000', '--registry=https://registry.npmjs.org'], 120_000, cwd);
      }
      const versions = [[source, 'playwright', '1.64.1'], [source, 'axe-core', '4.14.0'], [path.join(source, FRONTEND), 'next', '15.5.28'], [path.join(source, FRONTEND), 'typescript', '5.9.3']];
      for (const [cwd, name, expected] of versions) insist(json(path.join(cwd, 'node_modules', name, 'package.json')).version === expected, 'INSTALLED_VERSION_MISMATCH');
      await command('chromium-install', process.execPath, [path.join(source, 'node_modules/playwright/cli.js'), 'install', '--with-deps', 'chromium'], 180_000, source);
      acquisition = { npm: npmVersion, versions: versions.map(([, name, version]) => ({ name, version })), browserManifestSha256: digest(path.join(source, 'node_modules/playwright-core/browsers.json')) };
    }
    const utilities = ['/usr/bin/sudo', '/usr/bin/unshare', '/usr/bin/setpriv', '/usr/sbin/ip', '/bin/sh', '/bin/kill', '/usr/bin/env', '/usr/bin/mount', '/usr/bin/awk', '/usr/bin/sort', '/usr/bin/stat', '/usr/bin/readlink', '/usr/bin/sha256sum', '/usr/bin/od'];
    const tools = utilities.map(file => {
      const resolved = fs.realpathSync(file);
      const stat = fs.statSync(resolved);
      insist(stat.isFile() && stat.uid === 0 && !(stat.mode & 0o022), 'SYSTEM_TOOL_OWNERSHIP');
      return { file, sha256: digest(resolved) };
    });
    insist(digest(process.execPath) === nodeSha, 'NODE_EXECUTABLE_DRIFT');
    unchanged(source); selfPin();
    write(path.join(root, 'public', 'tools.json'), { mode: CONTROL_ONLY ? 'CONTROL_ONLY' : 'APP_AND_TYPECHECK', node: process.version, nodeSha256: nodeSha, tools, acquisition });
    const context = { uid: process.getuid(), gid: process.getgid(), hostNet: fs.readlinkSync('/proc/self/ns/net'), hostPid: fs.readlinkSync('/proc/self/ns/pid'), hostMount: fs.readlinkSync('/proc/self/ns/mnt'), hostIpc: fs.readlinkSync('/proc/self/ns/ipc'), nonce: crypto.randomBytes(24).toString('hex'), endAt };
    write(path.join(root, 'context.json'), context);
    privileged = true;
    await command('namespace', '/usr/bin/sudo', ['-n', '/usr/bin/unshare', '--mount', '--net', '--ipc', '--pid', '--fork', '--kill-child=SIGKILL', '/bin/sh', '-c', NAMESPACE_SCRIPT, 'qa-shop-pass-intent', String(context.uid), String(context.gid), cleanEnv().PATH, root, context.nonce, process.env.QA_SHOP_HELPER_SHA256, process.execPath, __filename, context.hostMount, context.hostNet, context.hostPid, context.hostIpc], 670_000, source, cleanEnv(), true);
    if (CONTROL_ONLY) {
      const control = json(path.join(root, 'public', 'control-only.json'));
      insist(control.mode === 'CONTROL_ONLY' && control.candidate === CANDIDATE && control.candidateTree === TARGET_TREE && control.sourceChecksPassed === true && control.namespaceChecksPassed === true, 'CONTROL_RECEIPT_MISSING');
    } else insist(json(path.join(root, 'public', 'runtime.json')).markerObservedOnce === true, 'RUNTIME_RECEIPT_MISSING');
    unchanged(source);
    complete = true;
  } catch (error) {
    failure = diagnosticCode(error);
    primaryError = error.primaryError === null ? null : diagnosticCode({ code: error.primaryError || error.code });
    for (const item of Array.isArray(error.cleanupErrors) ? error.cleanupErrors : []) {
      cleanupErrors.push({
        stage: ['SIGNAL', 'REAP', 'LOG_CLOSE'].includes(item?.stage) ? item.stage : 'UNKNOWN',
        errorCode: diagnosticCode({ code: item?.errorCode }),
      });
    }
  } finally {
    const cleanup = [];
    for (const id of owned.keys()) {
      try { cleanup.push(await reap(id, descendants(id), true)); }
      catch (error) {
        cleanupErrors.push({ stage: 'FINAL_REAP', errorCode: diagnosticCode(error) });
        failure ||= 'FINAL_CLEANUP_UNCERTAIN';
      }
    }
    write(path.join(root, 'public', 'result.json'), { schema: 'qa-shop-pass-intent-v1', state: complete && !failure && cleanupErrors.length === 0 ? (CONTROL_ONLY ? 'CONTROL_ONLY_PASS' : 'FOCUSED_PASS_ONLY') : 'NOT_ACCEPTED', mode: CONTROL_ONLY ? 'CONTROL_ONLY' : 'APP_AND_TYPECHECK', runtimeAdmitted: RUNTIME_ADMITTED, candidate: CANDIDATE, candidateTree: TARGET_TREE, patchSha256: PATCH_SHA256, failure: failure || null, primaryError, outputBytes: usedBytes, cleanup, cleanupErrors, noW02Entry: true, noBackend: true, noProductionBuild: true, sourceReviewStillRequired: true });
  }
  insist(complete && !failure && cleanupErrors.length === 0, failure || 'NOT_ACCEPTED');
}
for (const name of ['SIGTERM', 'SIGINT']) process.on(name, () => {
  stopped = true;
  for (const id of owned.keys()) { try { signalGroup(id, 'KILL'); } catch { /* Final receipt refuses uncertain cleanup. */ } }
});
if (require.main !== module) {
  try { installBrowserPolicy(); }
  catch (error) {
    try { writeFailure('preload-failure.json', 'PRELOAD', error, 1); } catch { /* Missing receipt is FORMAT_HOLD at the supervisor. */ }
    process.exit(1);
  }
}
else if (process.argv.length === 3 && process.argv[2] === '--namespace-worker') {
  worker().catch(error => {
    try {
      const names = failureNames();
      if (!(names.length === 1 && names[0] === 'preload-failure.json' && readOwnedFailure(names[0]))) {
        quarantineFailures(names);
        writeFailure('worker-failure.json', names.length ? 'DIAGNOSTIC' : 'WORKER', { code: names.length ? 'FORMAT_HOLD' : diagnosticCode(error) }, error?.exitCode);
      }
    } catch { /* Missing or invalid receipt becomes FORMAT_HOLD at the supervisor. */ }
    process.exitCode = 1;
  });
} else main().catch(() => { console.error('[qa-shop-pass-intent] NOT_ACCEPTED; sanitized receipt only'); process.exitCode = 1; });
