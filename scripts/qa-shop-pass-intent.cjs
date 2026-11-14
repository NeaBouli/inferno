#!/usr/bin/env node
'use strict';

// Source preparation only. Parent and independent review must enable this gate.
// The final helper004 test is bound below; 7a is not an executable alternative.
const RUNTIME_ADMITTED = false;
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
  UNKNOWN_FAILURE DIAGNOSTIC_WRITE_FAILED NAMESPACE_EXIT_FAILURE CHILD_SIGNALLED
  ENOENT EACCES EPERM ENOSPC EEXIST EIO ENOMEM EROFS EISDIR ENOTDIR ESRCH EPIPE EINVAL ETIMEDOUT EADDRINUSE
  NO_ARBITRARY_ARGUMENTS HOST_TOOLCHAIN HOSTED_CI_ONLY PARENT_AND_INDEPENDENT_REVIEW_REQUIRED
  HELPER_DIGEST GIT_DATA_OPERATION_FAILED LOCK_SCHEMA LOCK_LINK NON_OFFICIAL_LOCK_RECORD
  QA_BRANCH_NOT_BASELINE_ONLY BASE_BLOB_MISMATCH PATCH_DIGEST CANDIDATE_TREE_MISMATCH FINAL_BLOB_MISMATCH
  UNSUPPORTED_GIT_ENTRY ENV_TEMPLATE_MODE UNEXPECTED_SOURCE_INPUT ENV_TEMPLATE_PATH_SET SOURCE_PATH
  TRACKED_INPUT_DRIFT NPM_TOOLCHAIN INSTALLED_VERSION_MISMATCH SYSTEM_TOOL_OWNERSHIP NODE_EXECUTABLE_DRIFT
  RUNTIME_RECEIPT_MISSING FINAL_CLEANUP_UNCERTAIN NOT_ACCEPTED RUNTIME_PRIVILEGE NAMESPACE_NOT_ISOLATED
  MOUNT_IPC_NAMESPACE_NOT_ISOLATED CAPABILITIES_NOT_DROPPED NETWORK_INTERFACE_NOT_LOOPBACK_ONLY
  WORKER_IDENTITY MOUNT_ID_UNAVAILABLE SCRATCH_MOUNTS_NOT_DISTINCT MOUNT_COUNT MOUNTINFO_SHAPE
  MOUNT_PROPAGATION SCRATCH_MOUNT_FLAGS PRIVATE_SHM_FLAGS HOST_MOUNT_WRITABLE PRIVATE_TMP_BIND
  NAMESPACE_PORT_ALREADY_USED OUTER_DEADLINE SPAWN_FAILED UNOWNED_PROCESS_GROUP PROCESS_COUNT_CAP
  PRIVILEGED_SIGNAL_FAILED OWNED_PROCESS_REAP_UNCERTAIN CHILD_DEADLINE OUTPUT_CAP
  PROCESS_OBSERVATION_FAILED SIGNAL_FAILED COMMAND_FAILED PASS_FIXTURE_MARKER LISTENER_NOT_REAPED
`.trim().split(/\s+/));
const BOOTSTRAP_MARKERS = new Map([
  ['QA_SHOP_STAGE_BOOTSTRAP_PRIVATE', 'BOOTSTRAP_PRIVATE'],
  ['QA_SHOP_STAGE_RO_MOUNT', 'RO_MOUNT'],
  ['QA_SHOP_STAGE_TMP_SHM', 'TMP_SHM'],
  ['QA_SHOP_STAGE_UID_DROP', 'UID_DROP'],
]);
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
function diagnosticCode(error) { return DIAGNOSTIC_ERRORS.has(error?.code) ? error.code : 'UNKNOWN_FAILURE'; }
function diagnosticExit(code) { return Number.isInteger(code) && code >= 1 && code <= 255 ? code : 1; }
function writeFailure(name, stage, error, exitCode) {
  insist(name === 'bootstrap-failure.json' || name === 'worker-failure.json', 'DIAGNOSTIC_WRITE_FAILED');
  const stages = new Set(['BOOTSTRAP_UNKNOWN', 'BOOTSTRAP_PRIVATE', 'RO_MOUNT', 'TMP_SHM', 'UID_DROP', 'WORKER']);
  write(path.join(root, 'public', name), { stage: stages.has(stage) ? stage : 'BOOTSTRAP_UNKNOWN', errorCode: diagnosticCode(error), exitCode: diagnosticExit(exitCode) });
}
function bootstrapStage(output) {
  let stage = 'BOOTSTRAP_UNKNOWN';
  for (const line of output.split('\n')) if (BOOTSTRAP_MARKERS.has(line)) stage = BOOTSTRAP_MARKERS.get(line);
  return stage;
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
    try { process.kill(-id, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
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
  const child = spawn(binary, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  insist(Number.isInteger(child.pid), 'SPAWN_FAILED');
  owned.set(child.pid, true);
  const seen = new Map();
  let failure;
  let output = '';
  let killing = false;
  const stop = code => {
    failure ||= code;
    if (!killing) { killing = true; try { signalGroup(child.pid, 'KILL'); } catch { failure = 'SIGNAL_FAILED'; } }
  };
  const poll = setInterval(() => {
    try { for (const [pid, item] of descendants(child.pid)) seen.set(pid, item); }
    catch { stop('PROCESS_OBSERVATION_FAILED'); }
  }, 50);
  const timer = setTimeout(() => stop('CHILD_DEADLINE'), Math.min(milliseconds, endAt - Date.now()));
  const capture = chunk => {
    usedBytes += chunk.length;
    if (usedBytes > LOG_CAP) { stop('OUTPUT_CAP'); return; }
    fs.writeSync(fd, chunk);
    output += chunk.toString('utf8');
  };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  let exit;
  try {
    exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
  } catch (error) {
    if (namespaceExit) writeFailure('bootstrap-failure.json', bootstrapStage(output), error, 1);
    throw error;
  } finally {
    clearInterval(poll); clearTimeout(timer); fs.closeSync(fd);
  }
  if (namespaceExit && (failure || exit.code !== 0 || exit.signal !== null)) {
    writeFailure('bootstrap-failure.json', bootstrapStage(output), { code: failure || (exit.signal ? 'CHILD_SIGNALLED' : 'NAMESPACE_EXIT_FAILURE') }, exit.code);
  }
  const cleanup = await reap(child.pid, seen, namespaceExit);
  const result = { label, ...exit, bytes: fs.statSync(log).size, sha256: digest(log), cleanup };
  write(path.join(root, 'public', `${label}.json`), result);
  if (failure || exit.code !== 0 || exit.signal !== null) {
    const code = failure || 'COMMAND_FAILED';
    throw Object.assign(new Error(code), { code, exitCode: diagnosticExit(exit.code) });
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
  const text = fs.readFileSync('/proc/self/mountinfo', 'utf8');
  const rows = text.trim().split('\n');
  insist(rows.length > 3 && rows.length <= 4096, 'MOUNT_COUNT');
  let writable = 0;
  for (const line of rows) {
    const fields = line.split(' ');
    const separator = fields.indexOf('-');
    insist(separator >= 6 && fields[4].startsWith('/') && !fields[4].includes('\\'), 'MOUNTINFO_SHAPE');
    insist(!fields.slice(6, separator).some(field => /^(shared|master|propagate_from):/.test(field)), 'MOUNT_PROPAGATION');
    const options = new Set(fields[5].split(','));
    if (allowed.has(fields[0])) {
      insist(fields[4] === allowed.get(fields[0]) && options.has('rw') && !options.has('ro') && options.has('nosuid') && options.has('nodev'), 'SCRATCH_MOUNT_FLAGS');
      if (fields[4] === '/dev/shm') insist(fields[separator + 1] === 'tmpfs' && options.has('noexec'), 'PRIVATE_SHM_FLAGS');
      writable += 1;
    } else insist(options.has('ro') && !options.has('rw'), 'HOST_MOUNT_WRITABLE');
  }
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
printf '%s\n' 'QA_SHOP_STAGE_BOOTSTRAP_PRIVATE'
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
printf '%s\n' 'QA_SHOP_STAGE_RO_MOUNT'
/usr/bin/awk -v work="$work_id" '
  NR > 4096 || NF < 10 || $5 !~ /^\// || $5 ~ /\\/ { exit 1 }
  { for (i=7; i<=NF && $i!="-"; i++) if ($i ~ /^(shared|master|propagate_from):/) exit 1 }
  $1 == work && ("," $6 ",") ~ /,noexec,/ { exit 1 }
  $1 != work && ("," $6 ",") ~ /,rw,/ { print length($5), $5 }
' /proc/self/mountinfo > "$scratch/read-only-mounts.unsorted"
/usr/bin/sort -rn "$scratch/read-only-mounts.unsorted" > "$scratch/read-only-mounts"
while IFS=' ' read -r length target; do
  /usr/bin/mount -o remount,bind,ro "$target"
done < "$scratch/read-only-mounts"
/usr/bin/awk -v work="$work_id" '
  $1 != work && ("," $6 ",") !~ /,ro,/ { exit 1 }
  $1 == work && ("," $6 ",") !~ /,rw,/ { exit 1 }
' /proc/self/mountinfo
printf '%s\n' 'QA_SHOP_STAGE_TMP_SHM'
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
printf '%s\n' 'QA_SHOP_STAGE_BOOTSTRAP_PRIVATE'
/usr/sbin/ip link set dev lo up
printf '%s\n' 'QA_SHOP_STAGE_UID_DROP'
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
  let complete = false;
  try {
    selfPin();
    insist(RUNTIME_ADMITTED, 'PARENT_AND_INDEPENDENT_REVIEW_REQUIRED');
    for (const file of ['user.npmrc', 'global.npmrc']) fs.writeFileSync(path.join(root, file), '', { flag: 'wx', mode: 0o600 });
    const repo = path.resolve(__dirname, '..');
    const source = stage(repo);
    const nodeSha = digest(process.execPath);
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
    const utilities = ['/usr/bin/sudo', '/usr/bin/unshare', '/usr/bin/setpriv', '/usr/sbin/ip', '/bin/sh', '/bin/kill', '/usr/bin/env', '/usr/bin/mount', '/usr/bin/awk', '/usr/bin/sort', '/usr/bin/stat', '/usr/bin/readlink'];
    const tools = utilities.map(file => {
      const resolved = fs.realpathSync(file);
      const stat = fs.statSync(resolved);
      insist(stat.isFile() && stat.uid === 0 && !(stat.mode & 0o022), 'SYSTEM_TOOL_OWNERSHIP');
      return { file, sha256: digest(resolved) };
    });
    insist(digest(process.execPath) === nodeSha, 'NODE_EXECUTABLE_DRIFT');
    unchanged(source); selfPin();
    write(path.join(root, 'public', 'tools.json'), { node: process.version, nodeSha256: nodeSha, npm: npmVersion, tools, versions: versions.map(([, name, version]) => ({ name, version })), browserManifestSha256: digest(path.join(source, 'node_modules/playwright-core/browsers.json')) });
    const context = { uid: process.getuid(), gid: process.getgid(), hostNet: fs.readlinkSync('/proc/self/ns/net'), hostPid: fs.readlinkSync('/proc/self/ns/pid'), hostMount: fs.readlinkSync('/proc/self/ns/mnt'), hostIpc: fs.readlinkSync('/proc/self/ns/ipc'), nonce: crypto.randomBytes(24).toString('hex'), endAt };
    write(path.join(root, 'context.json'), context);
    privileged = true;
    await command('namespace', '/usr/bin/sudo', ['-n', '/usr/bin/unshare', '--mount', '--net', '--ipc', '--pid', '--fork', '--mount-proc', '--kill-child=SIGKILL', '/bin/sh', '-c', NAMESPACE_SCRIPT, 'qa-shop-pass-intent', String(context.uid), String(context.gid), cleanEnv().PATH, root, context.nonce, process.env.QA_SHOP_HELPER_SHA256, process.execPath, __filename, context.hostMount, context.hostNet, context.hostPid, context.hostIpc], 670_000, source, cleanEnv(), true);
    insist(json(path.join(root, 'public', 'runtime.json')).markerObservedOnce === true, 'RUNTIME_RECEIPT_MISSING');
    unchanged(source);
    complete = true;
  } catch (error) {
    failure = diagnosticCode(error);
  } finally {
    const cleanup = [];
    for (const id of owned.keys()) {
      try { cleanup.push(await reap(id, descendants(id), true)); }
      catch { failure = 'FINAL_CLEANUP_UNCERTAIN'; }
    }
    write(path.join(root, 'public', 'result.json'), { schema: 'qa-shop-pass-intent-v1', state: complete && !failure ? 'FOCUSED_PASS_ONLY' : 'NOT_ACCEPTED', runtimeAdmitted: RUNTIME_ADMITTED, candidate: CANDIDATE, candidateTree: TARGET_TREE, patchSha256: PATCH_SHA256, failure: failure || null, outputBytes: usedBytes, cleanup, noW02Entry: true, noBackend: true, noProductionBuild: true, sourceReviewStillRequired: true });
  }
  insist(complete && !failure, failure || 'NOT_ACCEPTED');
}
for (const name of ['SIGTERM', 'SIGINT']) process.on(name, () => {
  stopped = true;
  for (const id of owned.keys()) { try { signalGroup(id, 'KILL'); } catch { /* Final receipt refuses uncertain cleanup. */ } }
});
if (require.main !== module) installBrowserPolicy();
else if (process.argv.length === 3 && process.argv[2] === '--namespace-worker') {
  worker().catch(error => {
    try { writeFailure('worker-failure.json', 'WORKER', error, error?.exitCode); }
    catch { process.stderr.write('{"stage":"WORKER","errorCode":"DIAGNOSTIC_WRITE_FAILED","exitCode":1}\n'); }
    process.exitCode = 1;
  });
} else main().catch(() => { console.error('[qa-shop-pass-intent] NOT_ACCEPTED; sanitized receipt only'); process.exitCode = 1; });
