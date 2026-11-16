'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const path = require('node:path').posix;

const CLI = '--inspect-umount-readonly-v2';
const NODE_VERSION = '22.22.2';
const LIMITS = Object.freeze({ totalMs: 45000, cleanupMs: 2000, commandMs: 5000,
  commandBytes: 16384, toolBytes: 16777216, osBytes: 16384, jsonBytes: 12288 });
const TOOLS = Object.freeze({ umount: '/usr/bin/umount', setpriv: '/usr/bin/setpriv',
  dpkg_query: '/usr/bin/dpkg-query', dpkg: '/usr/bin/dpkg' });
const FORMAT = '${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\t${Status}\n';
const COMMANDS = Object.freeze({
  owner_usr: Object.freeze(['dpkg_query', '-S', '/usr/bin/umount']),
  owner_bin: Object.freeze(['dpkg_query', '-S', '/bin/umount']),
  packages: Object.freeze(['dpkg_query', '-W', `-f=${FORMAT}`, 'mount', 'libmount1']),
  verify: Object.freeze(['dpkg', '--verify', 'mount', 'libmount1']),
  version: Object.freeze(['setpriv', '--no-new-privs', '--', TOOLS.umount, '--version']),
});
const FAILURES = Object.freeze(['CLI_REJECTED', 'RUNTIME_UNSUPPORTED', 'PLATFORM_UNSUPPORTED',
  'ROOT_REFUSED', 'TOOL_BLOCKED', 'OS_UNKNOWN', 'OS_UNSUPPORTED', 'PACKAGE_UNKNOWN',
  'OWNERSHIP_REJECTED', 'PACKAGE_MISMATCH', 'INTEGRITY_FAILED', 'NNP_VERSION_FAILED',
  'BANNER_UNKNOWN', 'VERSION_UNSUPPORTED', 'SNAPSHOT_CHANGED', 'COMMAND_TIMEOUT',
  'COMMAND_OUTPUT_LIMIT', 'TOTAL_TIMEOUT', 'JSON_OUTPUT_LIMIT', 'METADATA_ERROR', 'CLEANUP_UNKNOWN']);
const STAT_FIELDS = Object.freeze(['dev', 'ino', 'mode', 'nlink', 'uid', 'gid', 'rdev',
  'size', 'blksize', 'blocks', 'mtimeNs', 'ctimeNs', 'birthtimeNs']);
const CHILD_ENV = Object.freeze({ LC_ALL: 'C', LANG: 'C', PATH: '/usr/bin:/bin' });

class InspectionFailure extends Error {
  constructor(code) { super('Inspection refused'); this.code = code; }
}
function refuse(code) { throw new InspectionFailure(code); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function statRecord(stat) {
  return Object.fromEntries(STAT_FIELDS.map((key) => [key, stat[key].toString()]));
}
function emptyReport() {
  return { schema: 'inspect_umount_readonly_v2', binding_ok: false, failure: 'METADATA_ERROR',
    runtime: { required_node: NODE_VERSION, matched: false, ordinary_uid: false },
    os: { ID: null, VERSION_ID: null },
    image: { ImageOS: null, ImageVersion: null, independently_authenticated: false },
    umount: { canonical_path: null, sha256: null, util_linux_version: null, libmount_version: null },
    tools: Object.fromEntries(Object.keys(TOOLS).map((key) =>
      [key, { canonical_path: null, sha256: null }])),
    packages: { mount: emptyPackage(), libmount1: emptyPackage() },
    ownership_ok: false, verify: { pre: false, post: false }, dpkg_verify_ok: false,
    snapshots_match: false, children_reaped: false, trust_basis: 'UNKNOWN',
    vendor_proof: false, prune_executed: false };
}

// BEGIN PURE HELPERS V2
function emptyPackage() {
  return { binary_name: null, version: null, source_name: null, source_version: null };
}
function parseDebianVersion(value) {
  if (typeof value !== 'string' || value.length > 128 || /\s/.test(value)) return null;
  const match = /^(?:(\d+):)?([0-9][A-Za-z0-9.+~\-]*?)(?:-([A-Za-z0-9+.~]+))?$/.exec(value);
  if (!match || (!match[3] && match[2].includes('-'))) return null;
  return { epoch: match[1] || '0', upstream: match[2], revision: match[3] || null };
}
function parseOsRelease(text) {
  const fields = { ID: null, VERSION_ID: null };
  let valid = true;
  for (const line of text.split('\n')) {
    const match = /^(ID|VERSION_ID)=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    const pattern = match[1] === 'ID' ? /^[a-z][a-z0-9_-]{0,31}$/ : /^[0-9][A-Za-z0-9._-]{0,31}$/;
    if (fields[match[1]] !== null || !pattern.test(value)) { valid = false; continue; }
    fields[match[1]] = value;
  }
  return { fields, valid: valid && fields.ID !== null && fields.VERSION_ID !== null };
}
function parsePackages(text, architecture) {
  const packages = { mount: emptyPackage(), libmount1: emptyPackage() };
  const seen = new Set();
  let valid = true;
  let installed = true;
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : [];
  for (const line of lines) {
    const fields = line.split('\t');
    if (fields.length !== 5) { valid = false; continue; }
    const [binary, version, source, sourceVersion, status] = fields;
    const name = /^(mount|libmount1)(?::([a-z0-9-]{1,32}))?$/.exec(binary);
    if (!name || (name[2] && name[2] !== architecture) || seen.has(name[1]) ||
        !parseDebianVersion(version) || !parseDebianVersion(sourceVersion) ||
        !/^[a-z0-9][a-z0-9+.-]{0,63}$/.test(source)) { valid = false; continue; }
    seen.add(name[1]);
    packages[name[1]] = { binary_name: binary, version, source_name: source, source_version: sourceVersion };
    if (status !== 'install ok installed') installed = false;
  }
  return { packages, complete: valid && installed && seen.size === 2 && lines.length === 2 };
}
function parseOwnership(result, queryPath, architecture, alias) {
  if (result.code === 1 && result.stdout === '') return { absent: true, valid: true };
  if (result.code !== 0 || result.stderr !== '' || !alias) return { absent: false, valid: false };
  const match = /^(mount(?::([a-z0-9-]{1,32}))?): (\/usr\/bin\/umount|\/bin\/umount)\n(?![\s\S])/.exec(result.stdout);
  return { absent: false, valid: Boolean(match && match[3] === queryPath &&
    (!match[2] || match[2] === architecture)) };
}
function parseBanner(text) {
  const match = /^umount from util-linux ([0-9][A-Za-z0-9.+~\-]{0,63}) \(libmount ([0-9][A-Za-z0-9.+~\-]{0,63})(?:: [a-z0-9][a-z0-9 ,+_.-]{0,255})?\)\n?(?![\s\S])/.exec(text);
  return match ? { util_linux_version: match[1], libmount_version: match[2] } : null;
}
function packageConsistency(packages) {
  const { mount, libmount1 } = packages;
  return mount.source_name === 'util-linux' && libmount1.source_name === 'util-linux' &&
    mount.version === libmount1.version && mount.source_version === libmount1.source_version;
}
function supported(packages, banner) {
  return Object.values(packages).every((item) => [item.version, item.source_version]
    .every((value) => parseDebianVersion(value)?.upstream === '2.39.3')) &&
    banner?.util_linux_version === '2.39.3' && banner?.libmount_version === '2.39.3';
}

function parseImageMetadata(ImageOS, ImageVersion) {
  const os = typeof ImageOS === 'string' && ImageOS.length <= 24 && !/\s/.test(ImageOS) &&
    /^ubuntu[2-9][0-9](?:-arm64)?$/.test(ImageOS) ? ImageOS : null;
  const version = typeof ImageVersion === 'string' && ImageVersion.length <= 19 &&
    !/\s/.test(ImageVersion) &&
    /^20[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])\.(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,2})$/.test(ImageVersion)
    ? ImageVersion : null;
  return { ImageOS: os, ImageVersion: version, independently_authenticated: false };
}
function deadlineExpired(stopped, now, deadline) { return stopped || now >= deadline; }
function boundedOutputSize(current, incoming, cap) {
  if (![current, incoming, cap].every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
  return current <= cap && incoming <= cap - current ? current + incoming : null;
}
function cleanupConfirmed(state) {
  return state.tracking_lost === false &&
    [state.started, state.closed, state.pending].every((n) => Number.isSafeInteger(n) && n >= 0) &&
    state.started === state.closed && state.pending === 0;
}
function cleanupWaitMs(now, inspectionDeadline, cleanupMs) {
  if (typeof now !== 'bigint' || typeof inspectionDeadline !== 'bigint' ||
      !Number.isSafeInteger(cleanupMs) || cleanupMs < 0) return 0;
  const remaining = inspectionDeadline + BigInt(cleanupMs) * 1000000n - now;
  return remaining > 0n ? Math.min(cleanupMs, Number(remaining / 1000000n)) : 0;
}
function cleanupDecision(bindingOk, failure, trustBasis, confirmed) {
  return { children_reaped: confirmed === true, binding_ok: confirmed === true && bindingOk === true,
    failure: confirmed === true ? failure : 'CLEANUP_UNKNOWN',
    trust_basis: confirmed === true ? trustBasis : 'UNKNOWN' };
}
// END PURE HELPERS V2
function decode(buffer) { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }

function context() {
  const deadline = process.hrtime.bigint() + BigInt(LIMITS.totalMs) * 1000000n;
  return { deadline, stopped: false, children: new Set(), started: 0, closed: 0,
    trackingLost: false, expected: null,
    check() {
      if (deadlineExpired(this.stopped, process.hrtime.bigint(), this.deadline)) refuse('TOTAL_TIMEOUT');
    } };
}
async function parents(ctx, filename) {
  const result = {};
  for (let directory = path.dirname(filename); ; directory = path.dirname(directory)) {
    ctx.check();
    const link = await fs.lstat(directory, { bigint: true });
    const stat = await fs.stat(directory, { bigint: true });
    if (link.uid !== 0n || link.gid !== 0n || stat.uid !== 0n || stat.gid !== 0n ||
        !stat.isDirectory() || (stat.mode & 0o022n) !== 0n) refuse('TOOL_BLOCKED');
    result[directory] = { link: statRecord(link), target: statRecord(stat),
      canonical_path: await fs.realpath(directory) };
    if (directory === '/') break;
  }
  ctx.check();
  return result;
}
async function readTrusted(ctx, filename, allowed, cap, executable, retainBody = false) {
  ctx.check();
  const canonical = await fs.realpath(filename);
  if (!allowed.includes(canonical)) refuse(executable ? 'TOOL_BLOCKED' : 'OS_UNKNOWN');
  const parentStats = { original: await parents(ctx, filename), canonical: await parents(ctx, canonical) };
  ctx.check();
  const handle = await fs.open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.uid !== 0n || before.gid !== 0n ||
        (before.mode & 0o022n) !== 0n || before.size > BigInt(cap) ||
        (executable && ((before.mode & 0o111n) === 0n || before.size === 0n)) ||
        (executable && filename !== TOOLS.umount && (before.mode & 0o6000n) !== 0n)) {
      refuse(executable ? 'TOOL_BLOCKED' : 'OS_UNKNOWN');
    }
    const hash = createHash('sha256');
    const chunks = [];
    const buffer = Buffer.alloc(Math.min(65536, cap + 1));
    let count = 0;
    while (true) {
      ctx.check();
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, cap + 1 - count), count);
      ctx.check();
      if (bytesRead === 0) break;
      count += bytesRead;
      if (count > cap) refuse(executable ? 'TOOL_BLOCKED' : 'OS_UNKNOWN');
      hash.update(buffer.subarray(0, bytesRead));
      if (retainBody) chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const after = await handle.stat({ bigint: true });
    const named = await fs.stat(canonical, { bigint: true });
    if (BigInt(count) !== before.size || !same(statRecord(before), statRecord(after)) ||
        !same(statRecord(before), statRecord(named)) || await fs.realpath(filename) !== canonical) {
      refuse('SNAPSHOT_CHANGED');
    }
    ctx.check();
    return { snapshot: { canonical_path: canonical, sha256: hash.digest('hex'),
      stat: statRecord(before), parents: parentStats }, body: retainBody ? decode(Buffer.concat(chunks)) : null };
  } finally { await handle.close(); }
}
async function toolSnapshot(ctx, key) {
  const filename = TOOLS[key];
  return (await readTrusted(ctx, filename, [filename, filename.replace('/usr/bin/', '/bin/')],
    LIMITS.toolBytes, true)).snapshot;
}
async function aliasSnapshot(ctx, filename, umount) {
  ctx.check();
  try {
    const canonical = await fs.realpath(filename);
    const stat = await fs.stat(filename, { bigint: true });
    if (canonical !== umount.canonical_path || !same(statRecord(stat), umount.stat)) refuse('TOOL_BLOCKED');
    return { canonical_path: canonical, stat: statRecord(stat), parents: await parents(ctx, filename) };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}
async function snapshot(ctx, report, publish) {
  const tools = {};
  for (const key of Object.keys(TOOLS)) {
    tools[key] = await toolSnapshot(ctx, key);
    if (publish) report.tools[key] = { canonical_path: tools[key].canonical_path, sha256: tools[key].sha256 };
    if (publish && key === 'umount') Object.assign(report.umount, report.tools.umount);
  }
  const os = await readTrusted(ctx, '/etc/os-release', ['/etc/os-release', '/usr/lib/os-release'],
    LIMITS.osBytes, false, true);
  const parsed = parseOsRelease(os.body);
  if (publish) report.os = parsed.fields;
  if (!parsed.valid) refuse('OS_UNKNOWN');
  const aliases = { usr: await aliasSnapshot(ctx, '/usr/bin/umount', tools.umount),
    bin: await aliasSnapshot(ctx, '/bin/umount', tools.umount) };
  return { tools, os: { snapshot: os.snapshot, fields: parsed.fields }, aliases };
}


function childState(ctx) {
  return { started: ctx.started, closed: ctx.closed, pending: ctx.children.size,
    tracking_lost: ctx.trackingLost };
}
function stopChildren(ctx) {
  for (const record of ctx.children) {
    try { record.child.kill('SIGKILL'); }
    catch { /* Only a subsequent close event can confirm termination. */ }
  }
}
function trackChild(ctx, child) {
  let resolveClosed;
  const record = { child, closed: new Promise((resolve) => { resolveClosed = resolve; }) };
  ctx.started += 1;
  ctx.children.add(record);
  try {
    child.once('close', () => {
      ctx.closed += 1;
      ctx.children.delete(record);
      resolveClosed();
    });
  } catch {
    ctx.trackingLost = true;
    stopChildren(ctx);
    refuse('TOOL_BLOCKED');
  }
}
async function quiesceChildren(ctx) {
  ctx.stopped = true;
  if (cleanupConfirmed(childState(ctx))) return true;
  stopChildren(ctx);
  const waitMs = cleanupWaitMs(process.hrtime.bigint(), ctx.deadline, LIMITS.cleanupMs);
  if (waitMs === 0) return false;
  let timer;
  try {
    await Promise.race([
      Promise.all(Array.from(ctx.children, (record) => record.closed)),
      new Promise((resolve) => { timer = setTimeout(resolve, waitMs); }),
    ]);
  } finally { clearTimeout(timer); }
  return cleanupConfirmed(childState(ctx));
}

async function runFixed(ctx, command) {
  const spec = COMMANDS[command];
  if (!spec) refuse('TOOL_BLOCKED');
  const keys = command === 'version' ? ['setpriv', 'umount'] : [spec[0]];
  for (const key of keys) {
    if (!same(await toolSnapshot(ctx, key), ctx.expected.tools[key])) refuse('SNAPSHOT_CHANGED');
  }
  ctx.check();
  return new Promise((resolve, reject) => {
    let child;
    let failure = null;
    let total = 0;
    const stdout = [];
    const stderr = [];
    try {
      child = spawn(TOOLS[spec[0]], spec.slice(1), { cwd: '/', env: { ...CHILD_ENV },
        shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { reject(new InspectionFailure('TOOL_BLOCKED')); return; }
    trackChild(ctx, child);
    const timer = setTimeout(() => { failure ||= 'COMMAND_TIMEOUT'; child.kill('SIGKILL'); },
      Math.min(LIMITS.commandMs, Math.max(1, Number((ctx.deadline - process.hrtime.bigint()) / 1000000n))));
    function collect(chunks, data) {
      if (failure) return;
      const next = boundedOutputSize(total, data.length, LIMITS.commandBytes);
      if (next === null) { failure = 'COMMAND_OUTPUT_LIMIT'; child.kill('SIGKILL'); return; }
      total = next;
      chunks.push(data);
    }
    child.stdout.on('data', (data) => collect(stdout, data));
    child.stderr.on('data', (data) => collect(stderr, data));
    child.stdout.on('error', () => { failure ||= 'METADATA_ERROR'; child.kill('SIGKILL'); });
    child.stderr.on('error', () => { failure ||= 'METADATA_ERROR'; child.kill('SIGKILL'); });
    child.on('error', () => { failure ||= 'TOOL_BLOCKED'; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      try {
        ctx.check();
        if (failure) refuse(failure);
        if (signal !== null || !Number.isInteger(code)) refuse('TOOL_BLOCKED');
        resolve({ code, stdout: decode(Buffer.concat(stdout)), stderr: decode(Buffer.concat(stderr)) });
      } catch (error) { reject(error); }
    });
  });
}
async function packageRound(ctx, report, initial, architecture, phase) {
  const usr = parseOwnership(await runFixed(ctx, 'owner_usr'), '/usr/bin/umount', architecture, initial.aliases.usr);
  const bin = parseOwnership(await runFixed(ctx, 'owner_bin'), '/bin/umount', architecture, initial.aliases.bin);
  const query = await runFixed(ctx, 'packages');
  const parsed = parsePackages(query.stdout, architecture);
  if (phase === 'pre') report.packages = parsed.packages;
  const verification = await runFixed(ctx, 'verify');
  const verify = verification.code === 0 && verification.stdout === '' && verification.stderr === '';
  report.verify[phase] = verify;
  return { packages: parsed.packages,
    complete: query.code === 0 && query.stderr === '' && parsed.complete,
    ownership: usr.valid && bin.valid && !(usr.absent && bin.absent), aliases: { usr, bin }, verify };
}
async function inspect(ctx, report) {
  const initial = await snapshot(ctx, report, true);
  if (report.os.ID !== 'ubuntu') refuse('OS_UNSUPPORTED');
  ctx.expected = initial;
  const architecture = process.arch === 'x64' ? 'amd64' : process.arch === 'arm64' ? 'arm64' : null;
  if (!architecture) refuse('PLATFORM_UNSUPPORTED');
  const pre = await packageRound(ctx, report, initial, architecture, 'pre');
  let banner = null;
  let versionFailure = null;
  if (pre.complete && pre.ownership && pre.verify && packageConsistency(pre.packages)) {
    const version = await runFixed(ctx, 'version');
    if (version.code !== 0 || version.stderr !== '') versionFailure = 'NNP_VERSION_FAILED';
    else {
      banner = parseBanner(version.stdout);
      if (!banner) versionFailure = 'BANNER_UNKNOWN';
      else Object.assign(report.umount, banner);
    }
  }
  const post = await packageRound(ctx, report, initial, architecture, 'post');
  const final = await snapshot(ctx, report, false);
  report.ownership_ok = pre.ownership && post.ownership;
  report.dpkg_verify_ok = pre.verify && post.verify;
  report.snapshots_match = same(initial, final) && same(pre, post);
  ctx.check();
  if (!pre.complete || !post.complete) refuse('PACKAGE_UNKNOWN');
  if (!report.ownership_ok) refuse('OWNERSHIP_REJECTED');
  if (!report.dpkg_verify_ok) refuse('INTEGRITY_FAILED');
  if (!report.snapshots_match) refuse('SNAPSHOT_CHANGED');
  if (versionFailure) refuse(versionFailure);
  if (!packageConsistency(pre.packages)) refuse('PACKAGE_MISMATCH');
  if (!supported(pre.packages, banner)) refuse('VERSION_UNSUPPORTED');
  report.binding_ok = true;
  report.failure = null;
  report.trust_basis = 'STOCK_OS_PACKAGE_LINKED';
}
function emit(report) {
  if (report.children_reaped !== true) {
    Object.assign(report, cleanupDecision(false, report.failure, 'UNKNOWN', false));
  }
  let line = `${JSON.stringify(report)}\n`;
  if (Buffer.byteLength(line) > LIMITS.jsonBytes) {
    const reaped = report.children_reaped === true;
    report = emptyReport();
    report.children_reaped = reaped;
    report.failure = reaped ? 'JSON_OUTPUT_LIMIT' : 'CLEANUP_UNKNOWN';
    line = `${JSON.stringify(report)}\n`;
  }
  const exitCode = report.binding_ok ? 0 : 1;
  process.stdout.on('error', () => process.exit(1));
  try { process.stdout.write(line, () => process.exit(exitCode)); }
  catch { process.exit(1); }
}
async function main() {
  const report = emptyReport();
  const ctx = context();
  let timer;
  try {
    if (process.argv.length !== 3 || process.argv[2] !== CLI) refuse('CLI_REJECTED');
    if (process.versions.node !== NODE_VERSION) refuse('RUNTIME_UNSUPPORTED');
    report.runtime.matched = true;
    if (process.platform !== 'linux') refuse('PLATFORM_UNSUPPORTED');
    if (typeof process.getuid !== 'function' || typeof process.geteuid !== 'function' ||
        process.getuid() === 0 || process.geteuid() === 0) refuse('ROOT_REFUSED');
    report.runtime.ordinary_uid = true;
    report.image = parseImageMetadata(process.env.ImageOS, process.env.ImageVersion);
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        ctx.stopped = true;
        stopChildren(ctx);
        reject(new InspectionFailure('TOTAL_TIMEOUT'));
      }, Math.max(1, Number((ctx.deadline - process.hrtime.bigint()) / 1000000n)));
    });
    await Promise.race([inspect(ctx, report), timeout]);
  } catch (error) {
    report.binding_ok = false;
    report.trust_basis = 'UNKNOWN';
    report.failure = error instanceof InspectionFailure && FAILURES.includes(error.code)
      ? error.code : 'METADATA_ERROR';
  } finally {
    clearTimeout(timer);
    ctx.stopped = true;
    let reaped = false;
    try { reaped = await quiesceChildren(ctx); }
    catch { reaped = false; }
    Object.assign(report, cleanupDecision(report.binding_ok, report.failure, report.trust_basis, reaped));
  }
  emit(report);
}

module.exports = Object.freeze({ CLI, NODE_VERSION, LIMITS, TOOLS, COMMANDS, FAILURES,
  emptyReport, parseDebianVersion, parseOsRelease, parsePackages, parseOwnership,
  parseBanner, packageConsistency, supported, parseImageMetadata, deadlineExpired,
  boundedOutputSize, cleanupConfirmed, cleanupWaitMs, cleanupDecision });
if (require.main === module) void main();
