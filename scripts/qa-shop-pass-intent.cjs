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
  } finally {
    clearInterval(poll); clearTimeout(timer); fs.closeSync(fd);
  }
  const cleanup = await reap(child.pid, seen, namespaceExit);
  const result = { label, ...exit, bytes: fs.statSync(log).size, sha256: digest(log), cleanup };
  write(path.join(root, 'public', `${label}.json`), result);
  insist(!failure && exit.code === 0 && exit.signal === null, failure || 'COMMAND_FAILED');
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
  const rows = git(repo, ['ls-files', '--stage', '-z'], env).toString().split('\0').filter(Boolean);
  for (const row of rows) {
    const match = /^(100644|100755) ([a-f0-9]{40}) 0\t(.+)$/.exec(row);
    insist(match, 'UNSUPPORTED_GIT_ENTRY');
    const [, mode, blob, file] = match;
    if (!(file.startsWith(`${FRONTEND}/`) || FILES.some(item => item[0] === file) || LOCK_INPUTS.some(item => item[0] === file))) continue;
    insist(!path.basename(file).startsWith('.env') && !file.includes('node_modules/') && !file.includes('/.next/'), 'UNEXPECTED_SOURCE_INPUT');
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
  write(path.join(root, 'public', 'source.json'), { qaHead, base: BASE, baseTree: BASE_TREE, candidate: CANDIDATE, candidateTree: TARGET_TREE, patchSha256: PATCH_SHA256, files: FILES, inputs });
  return source;
}
function unchanged(source) {
  for (const item of json(path.join(root, 'inputs.json'))) {
    const file = path.join(source, item.path);
    insist(fs.lstatSync(file).isFile() && digest(file) === item.sha256, 'TRACKED_INPUT_DRIFT');
  }
}
function assertNamespace() {
  insist(process.platform === 'linux' && process.getuid() !== 0, 'RUNTIME_PRIVILEGE');
  const context = json(path.join(root, 'context.json'));
  insist(fs.readlinkSync('/proc/self/ns/net') !== context.hostNet && fs.readlinkSync('/proc/self/ns/pid') !== context.hostPid, 'NAMESPACE_NOT_ISOLATED');
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  insist(/^NoNewPrivs:\s+1$/m.test(status) && /^CapEff:\s+0+$/m.test(status), 'CAPABILITIES_NOT_DROPPED');
  const devices = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').filter(line => line.includes(':')).map(line => line.split(':')[0].trim());
  insist(devices.length === 1 && devices[0] === 'lo', 'NETWORK_INTERFACE_NOT_LOOPBACK_ONLY');
  insist(process.env.QA_SHOP_NONCE === context.nonce && process.getuid() === context.uid && process.getgid() === context.gid, 'WORKER_IDENTITY');
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
  assertNamespace(); selfPin();
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
const NAMESPACE_SCRIPT = 'set -eu; test "$$" -eq 1; /usr/sbin/ip link set dev lo up; exec /usr/bin/setpriv --reuid="$1" --regid="$2" --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs /usr/bin/env -i PATH="$3" HOME="$4/home" TMPDIR="$4/tmp" LANG=C.UTF-8 CI=1 NEXT_TELEMETRY_DISABLED=1 BENEFITS_PASS_UI_PORT=3210 NEXT_PUBLIC_API_URL= NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID= PLAYWRIGHT_BROWSERS_PATH="$4/browsers" QA_SHOP_ROOT="$4" QA_SHOP_NONCE="$5" QA_SHOP_HELPER_SHA256="$6" "$7" "$8" --namespace-worker';
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
    const utilities = ['/usr/bin/sudo', '/usr/bin/unshare', '/usr/bin/setpriv', '/usr/sbin/ip', '/bin/sh', '/bin/kill', '/usr/bin/env'];
    const tools = utilities.map(file => {
      const resolved = fs.realpathSync(file);
      const stat = fs.statSync(resolved);
      insist(stat.isFile() && stat.uid === 0 && !(stat.mode & 0o022), 'SYSTEM_TOOL_OWNERSHIP');
      return { file, sha256: digest(resolved) };
    });
    insist(digest(process.execPath) === nodeSha, 'NODE_EXECUTABLE_DRIFT');
    unchanged(source); selfPin();
    write(path.join(root, 'public', 'tools.json'), { node: process.version, nodeSha256: nodeSha, npm: npmVersion, tools, versions: versions.map(([, name, version]) => ({ name, version })), browserManifestSha256: digest(path.join(source, 'node_modules/playwright-core/browsers.json')) });
    const context = { uid: process.getuid(), gid: process.getgid(), hostNet: fs.readlinkSync('/proc/self/ns/net'), hostPid: fs.readlinkSync('/proc/self/ns/pid'), nonce: crypto.randomBytes(24).toString('hex'), endAt };
    write(path.join(root, 'context.json'), context);
    privileged = true;
    await command('namespace', '/usr/bin/sudo', ['-n', '/usr/bin/unshare', '--mount', '--net', '--pid', '--fork', '--mount-proc', '--kill-child=SIGKILL', '/bin/sh', '-c', NAMESPACE_SCRIPT, 'qa-shop-pass-intent', String(context.uid), String(context.gid), cleanEnv().PATH, root, context.nonce, process.env.QA_SHOP_HELPER_SHA256, process.execPath, __filename], 670_000, source, cleanEnv(), true);
    insist(json(path.join(root, 'public', 'runtime.json')).markerObservedOnce === true, 'RUNTIME_RECEIPT_MISSING');
    unchanged(source);
    complete = true;
  } catch (error) {
    failure = /^[A-Z0-9_]{1,80}$/.test(error.code || '') ? error.code : 'QUALIFICATION_FAILED';
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
  worker().catch(() => { process.exitCode = 1; });
} else main().catch(() => { console.error('[qa-shop-pass-intent] NOT_ACCEPTED; sanitized receipt only'); process.exitCode = 1; });
