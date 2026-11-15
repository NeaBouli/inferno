'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const SOURCE = { head: '8bec16dbcd44edf4ed9d7c9feb4c0d889e23fdae', tree: '5bbbf3e1d78122323d7a1360262b3c16d091d29b', docsTree: '6fd5fa86cf867e05d2fbebd31b288d6ae92809a9', manifestSHA256: '141c85d9aa65525b20bdeef4819b6cb07a910c24d58d44cd833a2c151a4625bd', count: 324, bytes: 24374988, htmlSHA256: '3a552de1fbcacb8c25f809151647d8c2ed836fac142d43ee9e294f9e0778f103' };
const FONT_SHA = '8bff039ebb639dfbc1902204faab9eea67eb20c2f2c8c2524f588a7ee08f400d';
// Application source preparation only; keep this sole activation literal OFF.
const CONTROL_ONLY = true;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36';
const ROOT = path.resolve(__dirname, '..');
const T = path.resolve(process.argv[3] || '/');
const OUT = path.join(T, 'out');
const MODE = process.argv[2];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const check = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }); };
const PHASE_CODES = Object.freeze({
  ENTRY: 'MODE', ADMISSION: 'APPLICATION_MODE_REQUIRED', HOST: 'HOSTED_NODE_ONLY', ROOT: 'ONE_USE_HOSTED_ROOT', OUTPUT: 'NONREGULAR_INPUT', SETUP: 'SETUP_FAILED', OUTPUT_OWNER: 'OUTPUT_OWNER_BINDING',
  NAMESPACE_PID: 'PRIVATE_PID_NAMESPACE_REQUIRED', NAMESPACE_NET: 'NAMESPACE_NOT_NEW', NAMESPACE_MNT: 'NAMESPACE_NOT_NEW', NAMESPACE_PID_NEW: 'NAMESPACE_NOT_NEW', NETWORK: 'NON_LOOPBACK_INTERFACE', BOOTSTRAP: 'BOOTSTRAP_IDENTITY',
  LOOPBACK: 'LOOPBACK_FAILED', MOUNT_PRIVATE: 'MOUNT_PRIVATE_FAILED', MOUNT_BIND: 'MOUNT_BIND_FAILED', MOUNT_INVENTORY: 'MOUNT_INVENTORY_FAILED', MOUNT_HOST_RO: 'MOUNT_PATH', MOUNT_INPUT_RO: 'MOUNT_INPUT_RO_FAILED', MOUNT_VERIFY: 'WRITABLE_HOST_MOUNT', MOUNT_INPUT_VERIFY: 'IMMUTABLE_INPUT_MOUNT', ISOLATION_RECORD: 'ISOLATION_RECORD_FAILED',
  CHILD: 'CHILD_SPAWN', RESOURCE: 'RESOURCE_CAP', CHILD_WAIT: 'CHILD_EXIT', STOP: 'LOG_CAP', CLEANUP_SIGNAL: 'CLEANUP_SIGNAL_FAILED', CLEANUP_PROFILE: 'CLEANUP_PROFILE_FAILED', CLEANUP_RECORD: 'CLEANUP_RECORD_FAILED',
  RUNTIME_UID: 'UNPRIVILEGED_RUNTIME', RUNTIME_CAPS: 'PRIVILEGE_DROP', RUNTIME_NETWORK: 'RUNTIME_NETWORK_NAMESPACE', RUNTIME_TOOLS: 'RUNTIME_TOOL_IDENTITY', RUNTIME_SOURCE: 'RUNTIME_SOURCE_BINDING', RUNTIME_FONTS: 'RUNTIME_FONT_IDENTITY', CONTROL: 'CONTROL_ONLY_NO_APP_BROWSER'
});
const DIAGNOSTIC_CODES = new Set(['ENTER', 'OPERATION_FAILED', 'FAILURE_RECORD_FAILED', 'DIAGNOSTIC_PROTOCOL', 'OUTPUT_OWNER_BINDING', 'OUTPUT_FILE_BINDING', 'RUNTIME_DEADLINE', 'OUTER_TERM', 'OUTER_INT', ...Object.values(PHASE_CODES)]);
let phase = 'ENTRY', outputOwner;
const diagnostic = (next, code = 'ENTER') => {
  check(Object.hasOwn(PHASE_CODES, next) && DIAGNOSTIC_CODES.has(code), 'DIAGNOSTIC_PROTOCOL');
  process.stdout.write(JSON.stringify({ phase: next, code }) + '\n');
};
const mark = next => { diagnostic(next); phase = next; };
function save(name, value) {
  check(/^[A-Za-z][A-Za-z0-9-]*\.json$/.test(name), 'OUTPUT_FILE_BINDING');
  const owner = outputOwner || (process.getuid() !== 0 ? { uid: process.getuid(), gid: process.getgid() } : null);
  check(owner && owner.uid >= 1000 && owner.gid >= 1000, 'OUTPUT_OWNER_BINDING');
  const before = regular(OUT, true);
  const dir = fs.openSync(OUT, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(dir);
    check(stat.dev === before.dev && stat.ino === before.ino && stat.uid === owner.uid && stat.gid === owner.gid && (stat.mode & 0o7777) === 0o700, 'OUTPUT_OWNER_BINDING');
    const fd = fs.openSync('/proc/self/fd/' + dir + '/' + name, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try {
      const file = fs.fstatSync(fd);
      check(file.isFile() && file.nlink === 1 && (file.mode & 0o7777) === 0o600, 'OUTPUT_FILE_BINDING');
      if (process.getuid() === 0) fs.fchownSync(fd, owner.uid, owner.gid);
      const owned = fs.fstatSync(fd);
      check(owned.uid === owner.uid && owned.gid === owner.gid && (owned.mode & 0o7777) === 0o600, 'OUTPUT_OWNER_BINDING');
      fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    } finally { fs.closeSync(fd); }
  } finally { fs.closeSync(dir); }
}
function readPrepared() {
  const file = path.join(T, 'prepared.json'), before = regular(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd), prepared = JSON.parse(fs.readFileSync(fd, 'utf8'));
    check(stat.isFile() && stat.nlink === 1 && stat.dev === before.dev && stat.ino === before.ino && (stat.mode & 0o7777) === 0o600, 'OUTPUT_OWNER_BINDING');
    check([prepared.uid, prepared.gid].every(n => Number.isSafeInteger(n) && n >= 1000 && n < 4294967295) && stat.uid === prepared.uid && stat.gid === prepared.gid, 'OUTPUT_OWNER_BINDING');
    for (const dir of [T, OUT]) { const s = regular(dir, true); check(s.uid === prepared.uid && s.gid === prepared.gid && (s.mode & 0o7777) === 0o700, 'OUTPUT_OWNER_BINDING'); }
    check(prepared.node === process.execPath && prepared.runnerSHA256 === sha(fs.readFileSync(__filename)), 'BOOTSTRAP_IDENTITY');
    outputOwner = { uid: prepared.uid, gid: prepared.gid };
    return prepared;
  } finally { fs.closeSync(fd); }
}
const clean = { PATH: '/usr/bin:/bin', HOME: path.join(T, 'home'), TMPDIR: path.join(T, 'tmp'), PLAYWRIGHT_BROWSERS_PATH: path.join(T, 'browsers'), LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC' };
const coreRun = (file, args) => execFileSync(file, args, { cwd: ROOT, env: clean, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, maxBuffer: 20 * 1024 * 1024 });
function assertLoopbackLinks(links, code) {
  const link = Array.isArray(links) && links.length === 1 ? links[0] : null;
  check(link && !Array.isArray(link) && Number.isSafeInteger(link.ifindex) && link.ifindex > 0 &&
    link.ifname === 'lo' && link.link_type === 'loopback' &&
    Array.isArray(link.flags) && link.flags.includes('LOOPBACK'), code);
}
function mountControlTrace(rows, refused) {
  check(process.platform === 'linux' && process.arch === 'x64' && Array.isArray(rows) && rows.length > 0 && rows.length <= 4096, 'MOUNT_TRACE_FORMAT');
  const mountId = value => {
    check(typeof value === 'number' || typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value), 'MOUNT_TRACE_FORMAT');
    const id = Number(value);
    check(Number.isSafeInteger(id) && id >= 0, 'MOUNT_TRACE_FORMAT');
    return id;
  };
  const refs = new Map(), groups = new Map();
  for (const row of rows) {
    const id = mountId(row.id);
    check(id > 0 && !refs.has(id) && typeof row.target === 'string' && path.isAbsolute(row.target) && !row.target.includes('\0'), 'MOUNT_TRACE_FORMAT');
    refs.set(id, refs.size + 1);
    if (!groups.has(row.target)) groups.set(row.target, groups.size + 1);
  }
  const targetClass = target => target === '/' ? 'ROOT' : target === T || target.startsWith(T + '/') ? 'SCRATCH' :
    target === '/proc' || target.startsWith('/proc/') ? 'PROC' : target === '/sys' || target.startsWith('/sys/') ? 'SYS' :
    target === '/dev' || target.startsWith('/dev/') ? 'DEV' : target === ROOT || target.startsWith(ROOT + '/') ? 'WORKSPACE' : 'OTHER';
  const record = row => {
    check(typeof row['vfs-options'] === 'string' && typeof row['fs-options'] === 'string', 'MOUNT_TRACE_FORMAT');
    return { mountRef: refs.get(mountId(row.id)), parentRef: refs.get(mountId(row.parent)) || null,
      groupRef: groups.get(row.target), targetClass: targetClass(row.target),
      vfsReadOnly: row['vfs-options'].split(',').includes('ro'), superblockReadOnly: row['fs-options'].split(',').includes('ro') };
  };
  // Linux UAPI O_PATH: metadata handles cannot open mounted devices for I/O.
  const O_PATH = 0o10000000, O_CLOEXEC = 0o2000000;
  const descriptor = fd => {
    const input = fs.openSync('/proc/self/fdinfo/' + fd, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let info;
    try {
      const bytes = Buffer.alloc(65537); let total = 0, count;
      do {
        count = fs.readSync(input, bytes, total, bytes.length - total, null);
        total += count;
      } while (count > 0 && total < bytes.length);
      check(total <= 65536, 'MOUNT_TRACE_FORMAT');
      info = bytes.subarray(0, total).toString('utf8');
    } finally { fs.closeSync(input); }
    const ids = [...info.matchAll(/^mnt_id:\s+([0-9]+)$/gm)], flags = [...info.matchAll(/^flags:\s+([0-7]+)$/gm)];
    check(ids.length === 1 && flags.length === 1, 'MOUNT_TRACE_FORMAT');
    const id = mountId(ids[0][1]), mode = Number.parseInt(flags[0][1], 8);
    check(Number.isSafeInteger(mode) && mode >= 0, 'MOUNT_TRACE_FORMAT');
    return { mountRef: refs.get(id) || null, accessMode: ['READ', 'WRITE', 'READ_WRITE', 'INVALID'][mode & 3], pathOnly: (mode & O_PATH) !== 0 };
  };
  const handle = (name, magicLink = false) => {
    const fd = fs.openSync(name, O_PATH | O_CLOEXEC | (magicLink ? fs.constants.O_DIRECTORY : fs.constants.O_NOFOLLOW));
    try {
      const stat = fs.fstatSync(fd);
      check(!stat.isSymbolicLink() && (!magicLink || stat.isDirectory()), 'MOUNT_TRACE_FORMAT');
      const value = descriptor(fd);
      check(value.mountRef !== null, 'MOUNT_TRACE_FORMAT');
      return value;
    } finally { fs.closeSync(fd); }
  };
  const names = fs.readdirSync('/proc/self/fd');
  check(names.length <= 128 && names.every(name => /^(0|[1-9][0-9]*)$/.test(name)), 'MOUNT_TRACE_FORMAT');
  const inherited = []; let vanished = 0;
  for (const name of names) {
    const fd = Number(name);
    try {
      const stat = fs.fstatSync(fd), kind = stat.isDirectory() ? 'DIRECTORY' : stat.isFile() ? 'FILE' : stat.isFIFO() ? 'PIPE' :
        stat.isSocket() ? 'SOCKET' : stat.isCharacterDevice() ? 'CHARACTER' : stat.isBlockDevice() ? 'BLOCK' : 'OTHER';
      inherited.push({ fd, kind, ...descriptor(fd) });
    } catch (error) {
      if (error.code === 'EBADF' || error.code === 'ENOENT') { vanished++; continue; }
      throw error;
    }
  }
  check(rows.includes(refused), 'MOUNT_TRACE_FORMAT');
  return { status: vanished === 0 ? 'DIAGNOSTIC_ONLY' : 'TRACE_INCOMPLETE', metadataComplete: vanished === 0,
    applicationRuntime: 'NOT_RUN', rawIdsOrPathsIncluded: false,
    records: rows.map(record), refused: record(refused), visibleAtRefusedTarget: handle(refused.target),
    processRoot: handle('/proc/self/root', true), processCwd: handle('/proc/self/cwd', true), inheritedDescriptors: inherited, vanishedDescriptors: vanished };
}
const git = (...args) => execFileSync('/usr/bin/git', ['-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never', ...args], { cwd: ROOT, env: { ...clean, GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0' }, timeout: 10000, maxBuffer: 20 * 1024 * 1024 });
function regular(file, directory = false) {
  const stat = fs.lstatSync(file);
  check(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile()), 'NONREGULAR_INPUT');
  check(fs.realpathSync(file) === file, 'SYMLINK_PARENT');
  return stat;
}
function fonts() {
  const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/web3-audience-fonts-20261114.json'), 'utf8'));
  check(Array.isArray(rows) && rows.length === 28 && sha(JSON.stringify(rows)) === FONT_SHA, 'FONT_MANIFEST_BINDING');
  check(rows.reduce((n, r) => n + r.bytes, 0) === 509510 && new Set(rows.map(r => r.url)).size === 28, 'FONT_TOTAL');
  rows.forEach((r, i) => {
    check(Object.keys(r).join(',') === 'url,bytes,type,sha256', 'FONT_KEYS');
    const u = new URL(r.url);
    check(u.href === r.url && !u.username && !u.password && !u.hash && /^[0-9a-f]{64}$/.test(r.sha256), 'FONT_URL');
    check(i === 0 ? u.origin === 'https://fonts.googleapis.com' && u.pathname === '/css2' && r.type === 'text/css' && r.bytes <= 131072 : u.origin === 'https://fonts.gstatic.com' && !u.search && /^\/s\/[A-Za-z0-9/_-]+\.woff2$/.test(u.pathname) && r.type === 'font/woff2' && r.bytes <= 524288, 'FONT_SCOPE');
  });
  return rows;
}
function fetchFont(row, deadline) {
  return new Promise((resolve, reject) => {
    const chunks = []; let count = 0;
    const ms = Math.min(15000, deadline - performance.now());
    if (ms <= 0) { reject(Object.assign(new Error('FONT_DEADLINE'), { code: 'FONT_DEADLINE' })); return; }
    const req = https.get(row.url, { agent: false, headers: { 'User-Agent': UA, 'Accept-Encoding': 'identity' } }, res => {
      if (res.statusCode !== 200 || String(res.headers['content-type']).split(';')[0] !== row.type) { res.destroy(); req.destroy(new Error('FONT_STATUS_OR_TYPE')); return; }
      res.on('data', bytes => { count += bytes.length; if (count > row.bytes) req.destroy(new Error('FONT_SIZE')); else chunks.push(bytes); });
      res.on('error', reject);
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks);
          check(body.length === row.bytes && sha(body) === row.sha256, 'FONT_BODY_IDENTITY');
          if (row.type === 'font/woff2') check(body.toString('ascii', 0, 4) === 'wOF2' && body.readUInt32BE(8) === body.length, 'WOFF2_HEADER');
          resolve(body);
        } catch (error) { reject(error); }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('FONT_DEADLINE')), ms);
    req.once('error', reject); req.once('close', () => clearTimeout(timer));
  });
}

async function setup() {
  check(process.getuid() !== 0, 'SETUP_MUST_BE_UNPRIVILEGED');
  check(git('rev-parse', SOURCE.head + '^{tree}').toString().trim() === SOURCE.tree && git('rev-parse', SOURCE.head + ':docs').toString().trim() === SOURCE.docsTree, 'GIT_SOURCE');
  const entries = git('ls-tree', '-rz', '--full-tree', SOURCE.head, '--', 'docs').toString().split('\0').filter(Boolean);
  check(entries.length === SOURCE.count, 'DOCS_COUNT');
  const rows = [];
  for (const entry of entries) {
    const m = /^(100644) blob ([a-f0-9]{40})\t(docs\/[^\n\r\\]+)$/.exec(entry);
    check(m && !m[3].split('/').some(p => ['', '.', '..'].includes(p)), 'DOCS_REGULAR_PATH');
    const body = git('cat-file', 'blob', m[2]);
    check(body.length <= 20 * 1024 * 1024, 'BLOB_CAP');
    rows.push({ name: m[3], blob: m[2], bytes: body.length, sha256: sha(body) });
    check(rows.reduce((n, r) => n + r.bytes, 0) <= SOURCE.bytes, 'DOCS_BYTE_CAP');
    const file = path.join(T, 'input', m[3]);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, body, { flag: 'wx', mode: 0o600 });
  }
  rows.sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
  check(sha(JSON.stringify(rows)) === SOURCE.manifestSHA256 && rows.reduce((n, r) => n + r.bytes, 0) === SOURCE.bytes, 'DOCS_MANIFEST');
  const bank = fonts(), until = performance.now() + 90000;
  for (const row of bank) fs.writeFileSync(path.join(T, 'fonts', row.sha256), await fetchFont(row, until), { flag: 'wx', mode: 0o600 });
  const packageInfo = JSON.parse(fs.readFileSync(require.resolve('playwright/package.json'), 'utf8'));
  check(packageInfo.version === '1.64.1', 'PLAYWRIGHT_VERSION');
  const browser = require('playwright').chromium.executablePath();
  regular(browser);
  const prepared = { source: SOURCE, docs: rows, node: process.execPath, nodeSHA256: sha(fs.readFileSync(process.execPath)), browser, browserSHA256: sha(fs.readFileSync(browser)), uid: process.getuid(), gid: process.getgid(), namespaces: Object.fromEntries(['net', 'mnt', 'pid'].map(n => [n, fs.readlinkSync('/proc/self/ns/' + n)])), runnerSHA256: sha(fs.readFileSync(__filename)) };
  fs.writeFileSync(path.join(T, 'prepared.json'), JSON.stringify(prepared), { flag: 'wx', mode: 0o600 });
  save('FONTS.json', { source: SOURCE.head, records: bank, totalBytes: 509510, status: 'HASH_VERIFIED_DATA_ONLY' });
  save('SETUP.json', { source: SOURCE, node: process.version, playwright: packageInfo.version, nodeSHA256: prepared.nodeSHA256, browserSHA256: prepared.browserSHA256, fonts: bank.length, bytes: 509510, status: 'PREPARED_NOT_RENDERED' });
}

async function namespace() {
  mark('OUTPUT_OWNER');
  const prepared = readPrepared();
  mark('NAMESPACE_PID');
  check(process.getuid() === 0 && process.pid === 1, 'PRIVATE_PID_NAMESPACE_REQUIRED');
  for (const [n, stage] of [['net', 'NAMESPACE_NET'], ['mnt', 'NAMESPACE_MNT'], ['pid', 'NAMESPACE_PID_NEW']]) { mark(stage); check(fs.readlinkSync('/proc/self/ns/' + n) !== prepared.namespaces[n], 'NAMESPACE_NOT_NEW'); }
  mark('NETWORK');
  const links = JSON.parse(coreRun('/usr/sbin/ip', ['-j', 'link', 'show']).toString('utf8'));
  assertLoopbackLinks(links, 'NON_LOOPBACK_INTERFACE');
  const sysfsLinks = fs.readdirSync('/sys/class/net');
  save('NETWORK-CONTROL.json', { source: 'PROCESS_NAMESPACE_RTNETLINK', loopbackOnly: true,
    interfaceCount: links.length, inheritedSysfsCount: sysfsLinks.length,
    sysfsOnlyLoopback: sysfsLinks.length === 1 && sysfsLinks[0] === 'lo', applicationRuntime: 'NOT_RUN' });
  mark('BOOTSTRAP');
  check(prepared.uid >= 1000 && prepared.gid >= 1000 && prepared.node === process.execPath && prepared.runnerSHA256 === sha(fs.readFileSync(__filename)), 'BOOTSTRAP_IDENTITY');
  mark('LOOPBACK');
  coreRun('/usr/sbin/ip', ['link', 'set', 'dev', 'lo', 'up']);
  mark('MOUNT_PRIVATE');
  coreRun('/usr/bin/mount', ['--make-rprivate', '/']);
  for (const [source, target] of [[T, T], [path.join(T, 'tmp'), '/tmp'], [path.join(T, 'tmp'), '/var/tmp'], [path.join(T, 'shm'), '/dev/shm']]) { mark('MOUNT_BIND'); coreRun('/usr/bin/mount', ['--bind', source, target]); }
  mark('MOUNT_INVENTORY');
  const mounts = JSON.parse(coreRun('/usr/bin/findmnt', ['--json', '--list', '--output', 'TARGET']).toString()).filesystems.map(m => m.target);
  const readonly = target => { coreRun('/usr/bin/mount', ['--bind', target, target]); coreRun('/usr/bin/mount', ['-o', 'remount,bind,ro', target]); };
  for (const target of [...new Set(mounts)].sort((a, b) => b.length - a.length)) {
    mark('MOUNT_HOST_RO');
    check(path.isAbsolute(target), 'MOUNT_PATH');
    if (target === T || target.startsWith(T + '/') || target === '/proc' || target.startsWith('/proc/') || ['/tmp', '/var/tmp', '/dev/shm'].includes(target)) continue;
    coreRun('/usr/bin/mount', ['-o', 'remount,bind,ro', target]);
    readonly(target);
  }
  for (const target of [path.join(T, 'input'), path.join(T, 'fonts'), '/proc/sys']) { mark('MOUNT_INPUT_RO'); readonly(target); }
  mark('MOUNT_VERIFY');
  const verified = JSON.parse(coreRun('/usr/bin/findmnt', ['--json', '--list', '--output', 'ID,PARENT,TARGET,OPTIONS,VFS-OPTIONS,FS-OPTIONS']).toString()).filesystems;
  for (const m of verified) {
    if (m.target === T || m.target.startsWith(T + '/') || m.target === '/proc' || m.target.startsWith('/proc/') || ['/tmp', '/var/tmp', '/dev/shm'].includes(m.target)) continue;
    if (!m.options.split(',').includes('ro')) {
      let trace;
      try { trace = mountControlTrace(verified, m); }
      catch { trace = { status: 'TRACE_INCOMPLETE', code: 'MOUNT_IDENTITY_UNAVAILABLE', applicationRuntime: 'NOT_RUN' }; }
      save('MOUNT-CONTROL.json', trace);
    }
    check(m.options.split(',').includes('ro'), 'WRITABLE_HOST_MOUNT');
  }
  for (const dir of ['input', 'fonts']) { mark('MOUNT_INPUT_VERIFY'); check(verified.some(m => m.target === path.join(T, dir) && m.options.split(',').includes('ro')), 'IMMUTABLE_INPUT_MOUNT'); }
  mark('ISOLATION_RECORD');
  save('ISOLATION.json', { status: 'BOUND_BEFORE_PRODUCT_RUNTIME', privateNet: true, interfaces: ['lo'], privatePID: true, readonlyMounts: verified.length, immutableSourceAndFonts: true, uid: prepared.uid, filesystemWriteRoots: ['private-attempt', 'private-tmp', 'private-shm', 'private-process-proc'], namespaceExitKillsDescendants: true });
  mark('CHILD');
  const child = spawn('/usr/bin/setpriv', ['--reuid=' + prepared.uid, '--regid=' + prepared.gid, '--clear-groups', '--bounding-set=-all', '--inh-caps=-all', '--ambient-caps=-all', '--no-new-privs', '/usr/bin/env', '-i', ...Object.entries(clean).map(([k, v]) => k + '=' + v), process.execPath, '--no-addons', __filename, 'runtime', T], { cwd: ROOT, env: clean, stdio: ['ignore', 'pipe', 'pipe'] });
  let cap = 0, failure = null, maxRSS = 0;
  const processes = () => fs.readdirSync('/proc').filter(n => /^\d+$/.test(n) && n !== '1').flatMap(pid => {
    try { const status = fs.readFileSync('/proc/' + pid + '/status', 'utf8'); return [{ pid: Number(pid), state: /^State:\s+(\w)/m.exec(status)?.[1], rss: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] || 0) * 1024 }]; } catch { return []; }
  });
  const signalAll = signal => { for (const p of processes()) try { process.kill(p.pid, signal); } catch (e) { if (e.code !== 'ESRCH') throw e; } };
  let killTimer;
  const stop = reason => {
    failure ||= reason;
    if (killTimer !== undefined) return;
    killTimer = setTimeout(() => signalAll('SIGKILL'), 2000);
    diagnostic('STOP', DIAGNOSTIC_CODES.has(reason) ? reason : 'OPERATION_FAILED');
    signalAll('SIGTERM');
  };
  for (const stream of [child.stdout, child.stderr]) stream.on('data', b => { cap += b.length; if (cap > 2 * 1024 * 1024) stop('LOG_CAP'); });
  let pending = '';
  child.stdout.on('data', b => {
    pending += b.toString('utf8');
    if (pending.length > 4096) { pending = ''; stop('DIAGNOSTIC_PROTOCOL'); return; }
    const lines = pending.split('\n'); pending = lines.pop();
    for (const line of lines) {
      try { const row = JSON.parse(line); check(Object.keys(row).join(',') === 'phase,code', 'DIAGNOSTIC_PROTOCOL'); diagnostic(row.phase, row.code); }
      catch { stop('DIAGNOSTIC_PROTOCOL'); return; }
    }
  });
  mark('RESOURCE');
  const timer = setTimeout(() => stop('RUNTIME_DEADLINE'), 180000);
  const monitor = setInterval(() => { const p = processes(); const rss = p.reduce((n, x) => n + x.rss, 0); maxRSS = Math.max(maxRSS, rss); if (rss > 2 * 1024 ** 3 || p.length > 128) stop('RESOURCE_CAP'); }, 500);
  process.once('SIGTERM', () => stop('OUTER_TERM'));
  process.once('SIGINT', () => stop('OUTER_INT'));
  mark('CHILD_WAIT');
  const code = await new Promise(resolve => { child.once('error', () => stop('CHILD_SPAWN')); child.once('close', (c, s) => resolve(s ? 2 : c)); });
  clearTimeout(timer); clearTimeout(killTimer); clearInterval(monitor);
  mark('CLEANUP_SIGNAL');
  signalAll('SIGTERM'); await new Promise(r => setTimeout(r, 2000)); signalAll('SIGKILL');
  const remaining = processes();
  mark('CLEANUP_PROFILE');
  for (const dir of ['tmp', 'home', 'shm']) for (const name of fs.readdirSync(path.join(T, dir))) fs.rmSync(path.join(T, dir, name), { recursive: true, force: true });
  mark('CLEANUP_RECORD');
  save('CLEANUP.json', { childCloseObserved: true, childExit: code, failure, maxRSS, capturedBytes: cap, remainingBeforePIDNamespaceExit: remaining.map(p => ({ pid: p.pid, state: p.state })), liveRemaining: remaining.filter(p => p.state !== 'Z').length, profileContentsRemoved: true, pidNamespaceExitIsFinalReapBoundary: true });
  process.exit(code === 0 && !failure && remaining.every(p => p.state === 'Z') ? 0 : 2);
}

const AUDIENCES = [
  { key: 'users', title: 'Lock once. Use across the ecosystem.', copy: 'IFRLock', actions: ['Access lock', 'Commitment lock', 'Withdraw offer', 'Loans (borrowing closed)', 'Buy IFR', 'Use IFR Benefits', 'Track pool'], hrefs: ['https://app.uniswap.org/swap?outputCurrency=0x77e99917Eca8539c62F509ED1193ac36580A6e7B', 'https://shop.ifrunit.tech/', 'https://www.geckoterminal.com/eth/pools/0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0'], items: ['Use the access terminal for wallet, IFR balance, lock state, and token import.', 'Buy IFR on Uniswap or track the live pool without leaving the user flow.', 'Use IFRLock for simple access or CommitmentVault for time tranches; LendingVault V1 new business is retired, while available-offer withdrawal and existing-loan repayment/top-up remain.'] },
  { key: 'builders', title: 'Add IFR-gated access to real products.', copy: 'Builders should use the Wiki', actions: ['Integration guide', 'Business onboarding', 'Ecosystem'], hrefs: ['/wiki/integration.html', '/wiki/business-onboarding.html', '/wiki/ecosystem.html'], items: ['Use verified Mainnet contracts as the source of truth.', 'Design product tiers around lock status and wallet proof.', 'Route builders to integration docs and business onboarding before implementation.'] },
  { key: 'developers', title: 'Verify the surface before integrating.', copy: 'Developers should leave the user execution flow', actions: ['Smart contracts', 'Integration guide', 'Wallet guide'], hrefs: ['/wiki/contracts.html', '/wiki/integration.html', '/wiki/wallet-guide.html'], items: ['Check Etherscan-verified contracts.', 'Read the integration guide and wallet/contract guide.', 'Keep dynamic API usage explicit for web3.ifrunit.tech before shipping integrations.'] },
  { key: 'community', title: 'A cleaner front door for the protocol.', copy: 'Community members can use Web3', actions: ['Governance', 'Signer expansion', 'Transparency'], hrefs: ['/wiki/governance.html', '/wiki/community-signer-expansion.html', '/wiki/transparency.html'], items: ['Understand what IFR does in one screen.', 'Find governance, signer expansion, and transparency references.', 'Share the dedicated Web3 URL for users and the Wiki for deeper context.'] },
];

async function runtime() {
  mark('RUNTIME_UID');
  check(process.getuid() !== 0 && process.getuid() >= 1000, 'UNPRIVILEGED_RUNTIME');
  mark('RUNTIME_CAPS');
  const capabilities = fs.readFileSync('/proc/self/status', 'utf8');
  check(/^CapEff:\s+0+$/m.test(capabilities) && /^NoNewPrivs:\s+1$/m.test(capabilities), 'PRIVILEGE_DROP');
  mark('RUNTIME_NETWORK');
  assertLoopbackLinks(JSON.parse(coreRun('/usr/sbin/ip', ['-j', 'link', 'show']).toString('utf8')), 'RUNTIME_NETWORK_NAMESPACE');
  mark('OUTPUT_OWNER');
  const prepared = readPrepared();
  mark('RUNTIME_TOOLS');
  check(prepared.nodeSHA256 === sha(fs.readFileSync(process.execPath)) && prepared.browserSHA256 === sha(fs.readFileSync(prepared.browser)), 'RUNTIME_TOOL_IDENTITY');
  mark('RUNTIME_SOURCE');
  check(prepared.source.head === SOURCE.head && sha(JSON.stringify(prepared.docs)) === SOURCE.manifestSHA256, 'RUNTIME_SOURCE_BINDING');
  mark('RUNTIME_FONTS');
  const bank = fonts(), bodies = new Map(bank.map(r => { const bytes = fs.readFileSync(path.join(T, 'fonts', r.sha256)); check(bytes.length === r.bytes && sha(bytes) === r.sha256, 'RUNTIME_FONT_IDENTITY'); return [r.url, { ...r, body: bytes }]; }));
  if (CONTROL_ONLY) {
    mark('CONTROL');
    save('CONTROL-ONLY.json', { status: 'CONTROL_ONLY_NO_APP_BROWSER', source: SOURCE, applicationRuntime: 'NOT_RUN', browser: 'NOT_RUN', visualAccepted: false });
    diagnostic('CONTROL', 'CONTROL_ONLY_NO_APP_BROWSER');
    return;
  }
  const allowed = new Map(prepared.docs.map(r => [r.name.slice(5), r]));
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
  let server, browser, context, port, failed = null, outputBytes = 0;
  const observations = [], focusObservations = [], resources = [], blocked = [], pageErrors = [], effects = [];
  try {
    server = http.createServer((req, res) => {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
      let name;
      try { name = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).slice(1); if (name.endsWith('/')) name += 'index.html'; } catch { res.writeHead(400).end(); return; }
      const row = allowed.get(name);
      if (!row) { res.writeHead(404).end(); return; }
      const file = path.join(T, 'input/docs', name); regular(file);
      const bytes = fs.readFileSync(file); check(bytes.length === row.bytes && sha(bytes) === row.sha256, 'SERVED_BYTES');
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; worker-src 'none'" });
      resources.push({ method: req.method, path: '/' + name, status: 200, sha256: row.sha256 });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    port = server.address().port; const origin = 'http://127.0.0.1:' + port;
    const { chromium } = require('playwright');
    browser = await chromium.launch({ executablePath: prepared.browser, headless: true, chromiumSandbox: true, timeout: 30000 });
    const browserCDP = await browser.newBrowserCDPSession();
    const command = await browserCDP.send('Browser.getBrowserCommandLine');
    check(!command.arguments.includes('--no-sandbox'), 'CHROMIUM_SANDBOX_DISABLED');
    for (const [width, height] of [[375, 812], [390, 844], [820, 1180], [1180, 820], [1440, 1000]]) {
      context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block', acceptDownloads: false, storageState: { cookies: [], origins: [] } });
      context.setDefaultTimeout(5000); context.setDefaultNavigationTimeout(15000);
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); await cdp.send('Network.setBypassServiceWorker', { bypass: true });
      context.on('page', p => { if (p !== page) { effects.push('POPUP'); p.close().catch(() => {}); } });
      page.on('worker', w => { effects.push('WORKER'); w.evaluate(() => self.close()).catch(() => {}); });
      page.on('pageerror', () => pageErrors.push('PAGE_ERROR'));
      await context.routeWebSocket('**/*', route => { effects.push('WEBSOCKET'); route.close(); });
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), font = bodies.get(url.href);
        if (request.method() === 'GET' && font) { await route.fulfill({ status: 200, contentType: font.type, body: font.body }); return; }
        if (url.origin === origin && ['GET', 'HEAD'].includes(request.method())) { await route.continue(); return; }
        blocked.push({ method: request.method(), origin: url.origin, path: url.pathname }); await route.abort('blockedbyclient');
      });
      await page.goto(origin + '/web3/', { waitUntil: 'domcontentloaded' });
      assert.deepEqual(await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio, typeof window.ethereum, localStorage.length, sessionStorage.length]), [width, height, 1, 'undefined', 0, 0]);
      const tabs = page.locator('[role="tablist"][aria-label="Audience selector"] [role="tab"]'), panel = page.locator('#audience-panel');
      check(await tabs.count() === 4 && await page.locator('[role="tabpanel"]').count() === 1, 'AUDIENCE_STRUCTURE');
      const region = page.locator('#use-cases > .shell');
      const observeScope = () => region.evaluate(root => {
        const box = e => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
        const topbar = box(document.querySelector('.topbar')), heading = box(root.querySelector('.section-head')), tablist = box(root.querySelector('.audience-tabs')), panel = box(root.querySelector('#audience-panel'));
        const texts = [...root.querySelectorAll('button,a,h2,h3,p,li')], canvas = new OffscreenCanvas(1, 1), ctx = canvas.getContext('2d');
        const color = value => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); const c = [...ctx.getImageData(0, 0, 1, 1).data]; c[3] /= 255; return c; };
        const over = (a, b) => { const alpha = a[3] + b[3] * (1 - a[3]); return [...a.slice(0, 3).map((v, i) => alpha ? (v * a[3] + b[i] * b[3] * (1 - a[3])) / alpha : 0), alpha]; };
        const background = e => {
          let value = [0, 0, 0, 0];
          for (let n = e; n; n = n.parentElement) {
            const s = getComputedStyle(n);
            if (s.backgroundImage !== 'none' || Number(s.opacity) !== 1) throw new Error('UNSUPPORTED_CONTRAST_COMPOSITE');
            value = over(value, color(s.backgroundColor));
            if (value[3] === 1) return value;
          }
          throw new Error('UNKNOWN_CANVAS_BACKGROUND');
        };
        const luminance = c => c.slice(0, 3).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
        const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
        const normalContrast = [], lines = [], occluded = [];
        for (const e of texts) {
          const s = getComputedStyle(e), b = box(e), bg = background(e), fg = over(color(s.color), bg), range = document.createRange();
          range.selectNodeContents(e);
          const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
          const minimum = parseFloat(s.fontSize) >= 24 || parseFloat(s.fontSize) >= 18.667 && Number(s.fontWeight) >= 700 ? 3 : 4.5;
          normalContrast.push({ tag: e.tagName, text: e.textContent.trim().slice(0, 100), foreground: fg, background: bg, ratio: contrast(fg, bg), minimum });
          for (const r of rects) {
            lines.push({ fits: r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1, belowNav: r.top >= topbar.bottom, left: r.left, right: r.right, top: r.top, bottom: r.bottom });
            if (r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth) {
              const y = (Math.max(0, r.top) + Math.min(innerHeight, r.bottom)) / 2;
              for (const x of [Math.max(0, r.left) + 0.5, (Math.max(0, r.left) + Math.min(innerWidth, r.right)) / 2, Math.min(innerWidth, r.right) - 0.5]) {
                const hit = document.elementFromPoint(x, y);
                if (!hit || hit !== e && !e.contains(hit)) occluded.push({ tag: e.tagName, x, y });
              }
            }
          }
        }
        const active = document.activeElement;
        let focus = null;
        if (root.contains(active)) {
          const s = getComputedStyle(active), bg = background(active), adjacent = parseFloat(s.outlineOffset) < 0 ? bg : background(active.parentElement), ink = color(s.outlineColor);
          focus = { id: active.id, tag: active.tagName, focusVisible: active.matches(':focus-visible'), outlineStyle: s.outlineStyle, outlineWidth: parseFloat(s.outlineWidth), outlineOffset: parseFloat(s.outlineOffset), outlineAlpha: ink[3], ringContrast: contrast(over(ink, adjacent), adjacent), textContrast: contrast(over(color(s.color), bg), bg) };
        }
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1, panelBelowTabs: panel.top >= tablist.bottom, navAboveTabs: tablist.top >= topbar.bottom, headingBeforeTabs: heading.bottom <= tablist.top + 1, scopeBelowNav: box(root).top >= topbar.bottom, textFits: lines.length > 0 && lines.every(r => r.fits), allTextBelowNav: lines.every(r => r.belowNav), occluded, targets: [...root.querySelectorAll('button,a')].map(box), normalContrast, focus, topbar, heading, tablist, panel, scope: box(root), scrollY, viewport: { width: innerWidth, height: innerHeight }, lineCount: lines.length };
      });
      const geometryPass = layout => !layout.overflow && layout.panelBelowTabs && layout.navAboveTabs && layout.headingBeforeTabs && layout.scopeBelowNav && layout.textFits && layout.allTextBelowNav && layout.occluded.length === 0;
      const assertContrast = layout => check(layout.normalContrast.every(c => c.ratio >= c.minimum), 'NORMAL_OR_FOCUSED_TEXT_CONTRAST');
      const assertKeyboardFocus = async (observed = null) => {
        const layout = observed || await observeScope(), f = layout.focus;
        assertContrast(layout);
        check(f && f.focusVisible && f.outlineWidth >= 1 && !['none', 'hidden'].includes(f.outlineStyle) && f.outlineAlpha > 0 && f.ringContrast >= 3 && f.textContrast >= 4.5, 'VISIBLE_KEYBOARD_FOCUS');
        focusObservations.push({ viewport: { width, height }, ...f, nativeOutlineEvidence: true });
      };
      const assertAudience = async (index, focused = true, initial = false) => {
        const data = AUDIENCES[index];
        const state = await page.evaluate(() => ({ selected: [...document.querySelectorAll('[role="tab"]')].map(t => [t.id, t.getAttribute('aria-selected'), t.tabIndex, t.getAttribute('aria-controls')]), label: document.querySelector('#audience-panel').getAttribute('aria-labelledby'), title: document.querySelector('[data-audience-title]').textContent.trim(), copy: document.querySelector('[data-audience-copy]').textContent, items: [...document.querySelectorAll('[data-audience-list] li')].map(n => n.textContent.trim()), actions: [...document.querySelector('[data-audience-actions]').children].map(n => n.textContent.trim()), hrefs: [...document.querySelectorAll('[data-audience-actions] a')].map(n => n.getAttribute('href')), focus: document.activeElement.id }));
        assert.deepEqual(state.selected, AUDIENCES.map((a, i) => ['audience-tab-' + a.key, String(i === index), i === index ? 0 : -1, 'audience-panel']));
        check(state.label === 'audience-tab-' + data.key && state.title === data.title && state.copy.includes(data.copy), 'AUDIENCE_TEXT_BINDING');
        const initialItems = ['Check wallet, IFR balance, and lock state.', 'Buy IFR on the live Uniswap V2 pool.', AUDIENCES[0].items[2]];
        assert.deepEqual(state.items, initial ? initialItems : data.items); assert.deepEqual(state.actions, data.actions); assert.deepEqual(state.hrefs, data.hrefs);
        if (focused) check(state.focus === 'audience-tab-' + data.key, 'AUDIENCE_FOCUS');
      };
      await assertAudience(0, false, true);
      for (let i = 0; i < 4; i++) {
        await tabs.nth(i).click(); await assertAudience(i);
        await page.keyboard.press('ArrowRight'); await assertAudience((i + 1) % 4);
        await page.keyboard.press('ArrowLeft'); await assertAudience(i); await assertKeyboardFocus();
        await page.evaluate(async () => { await document.fonts.ready; });
        await region.evaluate(root => {
          const nav = document.querySelector('.topbar').getBoundingClientRect();
          window.scrollBy({ top: root.getBoundingClientRect().top - nav.bottom - 12, behavior: 'instant' });
        });
        const layout = await observeScope();
        check(geometryPass(layout), 'AUDIENCE_LAYOUT'); assertContrast(layout);
        check(layout.targets.every(b => b.width >= 44 && b.height >= 44), 'TARGET_44');
        await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
        const doc = await cdp.send('DOM.getDocument'); const renderedFonts = [];
        for (const selector of ['#audience-tab-' + AUDIENCES[i].key, '[data-audience-title]', '[data-audience-copy]']) {
          const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
          const { fonts: used } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
          check(used.some(f => f.isCustomFont && f.glyphCount > 0), 'CUSTOM_FONT_REQUIRED');
          renderedFonts.push({ selector, fonts: used.map(f => ({ familyName: f.familyName, isCustomFont: f.isCustomFont, glyphCount: f.glyphCount })) });
        }
        const bounds = await region.boundingBox();
        const png = await region.screenshot({ type: 'png', animations: 'disabled' });
        const afterCapture = await observeScope();
        check(png.length < 4 * 1024 * 1024 && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'PNG_HEADER_OR_CAP');
        const pixel = await page.evaluate(async bytes => { const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' })); const canvas = new OffscreenCanvas(bitmap.width, bitmap.height); const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data, colors = new Set(); for (let j = 0; j < data.length; j += Math.max(4, Math.floor(data.length / 20000 / 4) * 4)) colors.add([data[j], data[j + 1], data[j + 2], data[j + 3]].join(',')); return { width: bitmap.width, height: bitmap.height, colors: colors.size }; }, [...png]);
        check(Math.abs(pixel.width - bounds.width) <= 2 && Math.abs(pixel.height - bounds.height) <= 2 && png.readUInt32BE(16) === pixel.width && png.readUInt32BE(20) === pixel.height && pixel.colors > 16, 'PNG_DIMENSIONS_OR_BLANK');
        outputBytes += png.length; check(outputBytes <= 64 * 1024 * 1024, 'ARTIFACT_CAP');
        const name = `audience-${width}x${height}-${AUDIENCES[i].key}.png`;
        fs.writeFileSync(path.join(OUT, name), png, { flag: 'wx', mode: 0o600 });
        observations.push({ viewport: { width, height }, audience: AUDIENCES[i].key, layout, afterCapture, captureGeometryPassed: geometryPass(afterCapture), renderedFonts, screenshot: { name, bytes: png.length, sha256: sha(png), ...pixel, captureScope: 'complete-audience-shell-not-entire-viewport' } });
        check(geometryPass(afterCapture), 'POST_CAPTURE_HEADING_TAB_PANEL_OCCLUSION'); assertContrast(afterCapture);
        check(afterCapture.targets.every(b => b.width >= 44 && b.height >= 44), 'POST_CAPTURE_TARGET_44');
        check(afterCapture.viewport.width === width && afterCapture.viewport.height === height, 'POST_CAPTURE_VIEWPORT');
        await assertKeyboardFocus(afterCapture);
      }
      await tabs.nth(0).focus();
      for (const [key, index] of [['ArrowLeft', 3], ['ArrowRight', 0], ['End', 3], ['Home', 0], ['ArrowRight', 1], ['ArrowRight', 2]]) { await page.keyboard.press(key); await assertAudience(index); await assertKeyboardFocus(); }
      await page.keyboard.press('End'); await page.keyboard.press('Tab');
      check(await panel.locator('[data-audience-actions] a').first().evaluate(e => e === document.activeElement), 'TAB_EXIT');
      await assertKeyboardFocus();
      await page.keyboard.press('Shift+Tab'); await assertAudience(3); await assertKeyboardFocus();
      await tabs.nth(0).focus(); await tabs.nth(1).evaluate(t => t.click()); await assertAudience(1, false);
      check(await tabs.nth(0).evaluate(t => t === document.activeElement), 'NO_FORCED_POINTER_FOCUS');
      await tabs.nth(2).focus(); await page.keyboard.press('Enter'); await assertAudience(2); await assertKeyboardFocus();
      await tabs.nth(0).focus(); await page.keyboard.press('Space'); await assertAudience(0); await assertKeyboardFocus();
      check(await page.evaluate(() => typeof window.ethereum === 'undefined' && !window.IFRWallet.isConnected()), 'NO_WALLET');
      check(await page.locator('[data-wallet-chooser][aria-hidden="false"], [data-wallet-dialog][aria-hidden="false"], .protocol-dialog[aria-hidden="false"]').count() === 0, 'NO_DIALOG');
      check(pageErrors.length === 0 && effects.length === 0, 'PAGE_ERROR_OR_EFFECT');
      await context.close(); context = null;
    }
  } catch (error) { failed = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'ASSERTION_OR_BROWSER_FAILURE'; }
  finally {
    if (context) await context.close().catch(() => { failed ||= 'CONTEXT_CLOSE'; });
    if (browser) await browser.close().catch(() => { failed ||= 'BROWSER_CLOSE'; });
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    save('RESULT.json', { source: SOURCE, status: failed ? 'HOLD' : 'ASSERTIONS_COMPLETE_VISUAL_REVIEW_PENDING', reason: failed, screenshots: observations, focusObservations, resources, blocked, pageErrors, effects, port, listenerClosed: server ? !server.listening : true, visualAccepted: false, totalPNGBytes: outputBytes, effectEvidenceLayers: { observer: 'fresh empty context; no injected provider; no action-destination activation; no wallet/dialog; owned-origin-only transport', owningRegression: 'tests/browser/web3-write.spec.js audience cases at frozen C8bec assert zero account/signature/transaction/network-switch/watchAsset methods', owningRegressionRunHere: false, clipboardAndFormInstrumentationClaimed: false } });
  }
  check(!failed && observations.length === 20, failed || 'IMAGE_COUNT');
}

process.umask(0o077);
(async () => {
  mark('ENTRY'); check(['setup', 'namespace', 'runtime'].includes(MODE), 'MODE');
  mark('ADMISSION'); check(!CONTROL_ONLY, 'APPLICATION_MODE_REQUIRED');
  mark('HOST'); check(process.platform === 'linux' && process.version === 'v22.22.2' && process.argv.length === 4, 'HOSTED_NODE_ONLY');
  mark('ROOT'); check(/^\/home\/runner\/work\/_temp\/web3-audience-\d+-1$/.test(T), 'ONE_USE_HOSTED_ROOT');
  mark('OUTPUT'); regular(T, true); regular(OUT, true);
  if (MODE === 'setup') mark('SETUP');
  await ({ setup, namespace, runtime }[MODE])();
})().catch(error => {
  const code = DIAGNOSTIC_CODES.has(error?.code) ? error.code : 'OPERATION_FAILED';
  diagnostic(phase, code);
  try { if (['setup', 'namespace', 'runtime'].includes(MODE)) save('FAILURE-' + MODE + '.json', { status: 'HOLD', phase, code }); }
  catch { diagnostic(phase, 'FAILURE_RECORD_FAILED'); }
  process.exitCode = 2;
});
