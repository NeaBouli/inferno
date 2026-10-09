#!/usr/bin/env node
'use strict';

// Owner-B only. Source capture uses filesystem reads, never SQLite. All tool output is private.
// `spec` documents the certificate and offline bundle; `plan` never opens source or contacts Docker.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'apps/benefits-network/backend');
const TARGET = '20261006120000_owner_b_customer_session_privacy';
const BASE = 'cc4642a04932953f823f47577b281b2bbecc8264';
const GO = 'OWNER_GO_CAPTURE_AND_COPY_REHEARSAL';
const SIDECARS = ['-wal', '-shm', '-journal'];
const MAX_BYTES = 256 * 1024 * 1024;
const MAX_OUTPUT = 128 * 1024;
const TIMEOUT = 120000;
const HASH = /^[a-f0-9]{64}$/;
const CUID = /^c[a-z0-9]{24}$/;
const PASS_ID = /^[A-Za-z0-9_-]{32}$/;
const BARE = /(?<![0-9a-fA-FxX])([0-9a-fA-F]{40,})(?![0-9a-fA-F])/g;
const REWARDS = ['CONFIRMED', 'PENDING', 'READY', 'BLOCKED_CALLER', 'BLOCKED_GOVERNANCE', 'SETTLEMENT_PENDING'];
const CATEGORIES = new Set([
  'INVALID_COMMAND', 'INVALID_CERTIFICATE', 'OWNER_GO_REQUIRED', 'ROOT_LINUX_REQUIRED',
  'UNKNOWN_SOURCE_PROVENANCE', 'SOURCE_RUNNING', 'UNKNOWN_WRITERS', 'UNKNOWN_MOUNT',
  'UNKNOWN_TOOL_PROVENANCE', 'RUNTIME_NEEDS_VALIDATION', 'SOURCE_CHANGED', 'SIDECAR_PRESENT',
  'UNSAFE_PATH', 'COPY_MISMATCH', 'INVALID_SQLITE_HEADER', 'SOURCE_READ_FAILED',
  'ISOLATION_UNPROVEN', 'TOOL_FAILED', 'TOOL_OUTPUT_INVALID', 'TOOL_TIMEOUT', 'CLEANUP_REQUIRED',
  'INTEGRITY_FAILED', 'SCHEMA_MISMATCH', 'MIGRATION_BASELINE_UNKNOWN', 'OPEN_REWARDS',
  'INVALID_JSON', 'AUTH_SHAPE_INCOMPATIBLE', 'SCAN_FAILED', 'CONTINUITY_FAILED',
  'SNAPSHOT_CAPTURED', 'COPY_MIGRATED', 'SCAN_PASSED', 'REHEARSAL_PASSED', 'INTERRUPTED',
]);
const MODEL_KEYS = {
  Business: 'business', BenefitRule: 'rule', Product: 'product', CheckoutOperator: 'operator',
  Session: 'session', CustomerPass: 'pass', RewardEvent: 'reward', AuditLog: 'audit',
  SellerAuthorizationChallenge: 'challenge', SellerRewardLink: 'reward_link',
  AdminAuditLog: 'admin_audit', _prisma_migrations: 'migration',
  CustomerPassChallenge: 'legacy_pass_challenge', CustomerHistoryChallenge: 'legacy_history_challenge',
  CustomerHistoryAccess: 'legacy_history_access',
};
const METRICS = new Set([
  'bytes', 'invalid_json', 'reward_unknown', 'reward_null', 'session_open', 'pass_open',
  'noncuid_references', 'invalid_pass_ids', 'bare_other', 'unknown_locations',
  ...REWARDS.map((s) => `reward_${s.toLowerCase()}`),
  ...Object.values(MODEL_KEYS).flatMap((k) => [`rows_${k}`, `bare_${k}`, `noncuid_${k}`]),
]);
class Hold extends Error {
  constructor(category, counts = {}) { super(category); this.category = category; this.counts = counts; }
}
function need(condition, category) { if (!condition) throw new Hold(category); }
function safeCounts(counts) {
  const result = {};
  for (const [key, value] of Object.entries(counts)) {
    const leaf = key.replace(/^(before_|after_)/, '');
    need(METRICS.has(leaf) && Number.isSafeInteger(value) && value >= 0, 'TOOL_OUTPUT_INVALID');
    result[key] = value;
  }
  return result;
}
function summary(status, category, counts = {}) {
  need(['HOLD', 'PASS', 'NEEDS_VALIDATION'].includes(status) && CATEGORIES.has(category), 'TOOL_OUTPUT_INVALID');
  return { status, category, counts: safeCounts(counts) };
}
function emitSafeSummary(result) { process.stdout.write(`${JSON.stringify(result)}\n`); }
function runtimeSupported(version = process.versions.node) {
  return /^22\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version) && Number(version.split('.')[1]) >= 12;
}
function hashBuffer(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function privatePath(value) {
  need(typeof value === 'string' && path.isAbsolute(value) && !/[,\r\n\0]/.test(value), 'UNSAFE_PATH');
  need(path.normalize(value) === value && value !== '/', 'UNSAFE_PATH');
  return value;
}
function regular(stat, uid) {
  need(stat.isFile() && stat.nlink === 1n && stat.uid === BigInt(uid), 'UNSAFE_PATH');
  need((stat.mode & 0o077n) === 0n && stat.size > 0n && stat.size <= BigInt(MAX_BYTES), 'UNSAFE_PATH');
}
function identity(stat) {
  return Object.fromEntries(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].map((k) => [k, String(stat[k])]));
}
function sameIdentity(a, b) { return JSON.stringify(identity(a)) === JSON.stringify(identity(b)); }
const REAL_POLICY = { uid: 0, noAtime: true, anchored: true };
function directoryHandle(directory, policy = REAL_POLICY) {
  privatePath(directory);
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split('/')) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { bigint: true });
    need(stat.isDirectory() && !stat.isSymbolicLink(), 'UNSAFE_PATH');
    need(stat.uid === 0n || stat.uid === BigInt(policy.uid), 'UNSAFE_PATH');
    // A sticky system temp ancestor is acceptable; the actual private root is not shared.
    need((stat.mode & 0o022n) === 0n || (stat.mode & 0o1000n) !== 0n, 'UNSAFE_PATH');
  }
  const before = fs.lstatSync(directory, { bigint: true });
  need(before.uid === BigInt(policy.uid) && (before.mode & 0o077n) === 0n, 'UNSAFE_PATH');
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_DIRECTORY);
  if (!sameIdentity(before, fs.fstatSync(fd, { bigint: true }))) { fs.closeSync(fd); throw new Hold('SOURCE_CHANGED'); }
  return { fd, at: policy.anchored ? `/proc/self/fd/${fd}` : directory };
}
function absentSidecars(file) {
  for (const suffix of SIDECARS) {
    try { fs.lstatSync(file + suffix); throw new Hold('SIDECAR_PRESENT'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function openSource(file, policy) {
  const before = fs.lstatSync(file, { bigint: true });
  regular(before, policy.uid);
  need(!policy.noAtime || typeof fs.constants.O_NOATIME === 'number', 'SOURCE_READ_FAILED');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW |
    (policy.noAtime ? fs.constants.O_NOATIME : 0));
  const opened = fs.fstatSync(fd, { bigint: true });
  if (!sameIdentity(before, opened)) { fs.closeSync(fd); throw new Hold('SOURCE_CHANGED'); }
  return { fd, stat: opened };
}
function digestFd(fd, size, onChunk = () => {}) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  for (let offset = 0; offset < size;) {
    const n = fs.readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset);
    need(n > 0, 'COPY_MISMATCH');
    hash.update(buffer.subarray(0, n));
    onChunk(buffer.subarray(0, n), offset);
    offset += n;
  }
  return hash.digest('hex');
}
function fileHash(file, policy = REAL_POLICY) {
  const source = openSource(file, policy);
  try {
    const digest = digestFd(source.fd, Number(source.stat.size));
    need(sameIdentity(source.stat, fs.fstatSync(source.fd, { bigint: true })) &&
      sameIdentity(source.stat, fs.lstatSync(file, { bigint: true })), 'SOURCE_CHANGED');
    return digest;
  } finally { fs.closeSync(source.fd); }
}
function copyProtected(sourceFile, destFile, expectedHash, policy = REAL_POLICY) {
  need(HASH.test(expectedHash), 'INVALID_CERTIFICATE');
  absentSidecars(sourceFile);
  const source = openSource(sourceFile, policy);
  let dest;
  let created;
  let complete = false;
  try {
    const header = Buffer.alloc(16);
    need(fs.readSync(source.fd, header, 0, 16, 0) === 16 && header.toString('ascii') === 'SQLite format 3\0', 'INVALID_SQLITE_HEADER');
    dest = fs.openSync(destFile, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    created = fs.fstatSync(dest, { bigint: true });
    const digest = digestFd(source.fd, Number(source.stat.size), (bytes, offset) => {
      absentSidecars(sourceFile);
      let written = 0;
      while (written < bytes.length) {
        const n = fs.writeSync(dest, bytes, written, bytes.length - written, offset + written);
        need(n > 0, 'COPY_MISMATCH'); written += n;
      }
    });
    fs.fsyncSync(dest);
    if (policy.afterCopy) policy.afterCopy(sourceFile, destFile); // In-memory dummy fault injection only.
    need(digest === expectedHash && digestFd(dest, Number(source.stat.size)) === expectedHash, 'COPY_MISMATCH');
    const destination = fs.lstatSync(destFile, { bigint: true });
    regular(destination, policy.uid);
    need(destination.dev === created.dev && destination.ino === created.ino &&
      destination.size === source.stat.size, 'COPY_MISMATCH');
    need(sameIdentity(source.stat, fs.fstatSync(source.fd, { bigint: true })) &&
      sameIdentity(source.stat, fs.lstatSync(sourceFile, { bigint: true })), 'SOURCE_CHANGED');
    need(digestFd(source.fd, Number(source.stat.size)) === expectedHash, 'SOURCE_CHANGED');
    need(sameIdentity(source.stat, fs.fstatSync(source.fd, { bigint: true })) &&
      sameIdentity(source.stat, fs.lstatSync(sourceFile, { bigint: true })), 'SOURCE_CHANGED');
    absentSidecars(sourceFile);
    complete = true;
    return Number(source.stat.size);
  } finally {
    fs.closeSync(source.fd);
    if (dest !== undefined) fs.closeSync(dest);
    if (!complete && created) {
      const stat = fs.lstatSync(destFile, { bigint: true });
      need(stat.dev === created.dev && stat.ino === created.ino && stat.isFile() && stat.nlink === 1n, 'CLEANUP_REQUIRED');
      fs.unlinkSync(destFile);
    }
  }
}
function validateCertificate(cert, now = Date.now()) {
  need(cert && cert.version === 1 && cert.ownerGo === true, 'OWNER_GO_REQUIRED');
  const expiry = Date.parse(cert.expiresAt);
  need(Number.isFinite(expiry) && expiry > now && expiry <= now + 60 * 60 * 1000, 'INVALID_CERTIFICATE');
  const source = cert.source;
  need(source && ['certified-backup', 'stopped-source'].includes(source.kind) && HASH.test(source.sha256), 'UNKNOWN_SOURCE_PROVENANCE');
  privatePath(source.directory);
  need(source.identity && ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every((k) => /^\d+$/.test(source.identity[k])), 'INVALID_CERTIFICATE');
  const proof = source.proof;
  need(proof && proof.coherent === true && proof.offline === true && proof.exclusionHeld === true, 'UNKNOWN_SOURCE_PROVENANCE');
  need(proof.writersKnown === true && proof.allWritersExcluded === true, 'UNKNOWN_WRITERS');
  if (source.kind === 'certified-backup') {
    need(proof.ownerCertified === true && proof.restoreVerified === true, 'UNKNOWN_SOURCE_PROVENANCE');
  } else {
    need(proof.backendRunning === false, 'SOURCE_RUNNING');
    need(proof.mountVerified === true && proof.container === 'inferno-benefits-backend' &&
      proof.destination === '/data' && proof.sourceDirectory === source.directory, 'UNKNOWN_MOUNT');
  }
  const tool = cert.tools;
  need(tool && tool.ownerApproved === true && tool.sourceBase === BASE && HASH.test(tool.bundleSha256) &&
    typeof tool.image === 'string' && /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(tool.image), 'UNKNOWN_TOOL_PROVENANCE');
  need(tool.runtimeValidated === true && tool.isolationValidated === true && tool.offlineEnginesVerified === true &&
    runtimeSupported(tool.nodeVersion) && tool.prismaVersion === '5.22.0' &&
    HASH.test(tool.hostNodeSha256) && HASH.test(tool.hostDockerSha256), 'RUNTIME_NEEDS_VALIDATION');
  return cert;
}
function captureStoppedSnapshot(cert, sourceDirectory, outputDirectory, policy = REAL_POLICY) {
  validateCertificate(cert);
  const sourceDir = directoryHandle(sourceDirectory, policy);
  let out;
  try {
    out = directoryHandle(outputDirectory, policy);
    const file = path.join(sourceDir.at, 'benefits.db');
    const stat = fs.lstatSync(file, { bigint: true });
    regular(stat, policy.uid);
    need(Object.entries(identity(stat)).every(([k, v]) => cert.source.identity[k] === v), 'SOURCE_CHANGED');
    return copyProtected(file, path.join(out.at, 'snapshot.db'), cert.source.sha256, policy);
  } finally { fs.closeSync(sourceDir.fd); if (out) fs.closeSync(out.fd); }
}
function migrationNames() {
  const dir = path.join(BACKEND, 'prisma/migrations');
  const names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  need(names.length === 21 && names.at(-1) === TARGET, 'UNKNOWN_TOOL_PROVENANCE');
  return names;
}
function migrationSql(name) { return fs.readFileSync(path.join(BACKEND, 'prisma/migrations', name, 'migration.sql'), 'utf8'); }
function bundleSpec() {
  const names = migrationNames();
  const files = [
    'scripts/prepare-benefits-owner-b-rehearsal.sh', 'scripts/benefits-owner-b-rehearsal.cjs',
    'scripts/test-benefits-owner-b-rehearsal.cjs',
    ...['package.json', 'package-lock.json', 'prisma/schema.prisma', 'prisma/migrations/migration_lock.toml',
      'scripts/verify-owner-b-migration.cjs', 'scripts/verify-populated-migration-upgrade.cjs', 'src/routes/seller.ts']
      .map((p) => `apps/benefits-network/backend/${p}`),
    ...names.map((n) => `apps/benefits-network/backend/prisma/migrations/${n}/migration.sql`),
  ].sort();
  const manifest = files.map((p) => ({ path: p, sha256: hashBuffer(fs.readFileSync(path.join(ROOT, p))) }));
  return {
    status: 'NEEDS_VALIDATION', runtimeImage: 'UNAVAILABLE', sourceBase: BASE,
    bundleSha256: hashBuffer(Buffer.from(JSON.stringify(manifest))), manifest,
    offlineBundle: {
      root: '/bundle', node: 'stable >=22.12 <23', prisma: '5.22.0',
      required: ['preinstalled locked dependencies and platform engines', 'sqlite3 CLI for existing dummy fixtures',
        'immutable prebuilt image digest', 'benefits.rehearsal.bundle-sha256 image label',
        'Node binary at /usr/local/bin/node', 'no install/build/pull/production entrypoint at execution'],
    },
    certificate: {
      version: 1, ownerGo: 'true, separately approved actual capture/rehearsal', expiresAt: 'ISO timestamp, at most one hour',
      source: { kind: 'certified-backup (preferred) or stopped-source', directory: 'root-owned 0700 absolute directory; leaf benefits.db',
        sha256: 'certified SHA-256', identity: 'dev, ino, size, mtimeNs, ctimeNs decimal strings',
        proof: 'coherent/offline/exclusionHeld/writersKnown/allWritersExcluded=true; backup: ownerCertified/restoreVerified=true; direct: backendRunning=false, mountVerified=true, container=inferno-benefits-backend, destination=/data, sourceDirectory=directory' },
      tools: 'ownerApproved/runtimeValidated/isolationValidated/offlineEnginesVerified=true, sourceBase, bundleSha256, image@sha256, nodeVersion, prismaVersion=5.22.0, hostNodeSha256, hostDockerSha256',
    },
    usage: ['sh scripts/prepare-benefits-owner-b-rehearsal.sh spec',
      'sh scripts/prepare-benefits-owner-b-rehearsal.sh plan <private certificate file>',
      `execute <private certificate file> ${GO} (separate owner GO, root Linux operator only)`],
  };
}
function childEnv() {
  return { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/scratch', TMPDIR: '/scratch',
    XDG_CACHE_HOME: '/scratch/cache', DATABASE_URL: 'file:/scratch/rehearsal.db', PRISMA_HIDE_UPDATE_MESSAGE: '1' };
}
function buildDockerArgs(phase, image, sourceDirectory, outputDirectory, name) {
  need(['capture', 'migrate', 'scan'].includes(phase), 'INVALID_COMMAND');
  privatePath(sourceDirectory);
  if (phase !== 'scan') privatePath(outputDirectory);
  const input = phase === 'capture' ? '/source' : '/input';
  const args = ['run', '--rm', '-i', '--pull=never', `--name=${name}`, '--network=none', '--read-only',
    '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=0:0', '--no-healthcheck', '--log-driver=none',
    '--memory=512m', '--memory-swap=512m', '--cpus=1', '--pids-limit=64', '--ulimit=core=0:0',
    '--ulimit=nofile=64:64', '--ulimit=cpu=120:120', `--ulimit=fsize=${MAX_BYTES}:${MAX_BYTES}`,
    '--tmpfs=/scratch:rw,nosuid,nodev,noexec,size=512m,mode=0700',
    '--mount', `type=bind,src=${sourceDirectory},dst=${input},readonly,bind-propagation=rprivate`];
  if (phase !== 'scan') args.push('--mount', `type=bind,src=${outputDirectory},dst=/out,bind-propagation=rprivate`);
  args.push('--entrypoint=/usr/bin/env', image, '-i', ...Object.entries(childEnv()).map(([k, v]) => `${k}=${v}`),
    '/usr/local/bin/node', '--no-warnings', '/bundle/scripts/benefits-owner-b-rehearsal.cjs', `phase-${phase}`);
  return args;
}
function enforcePhase(phase, request) {
  need(process.platform === 'linux' && process.getuid() === 0 && runtimeSupported(), 'ROOT_LINUX_REQUIRED');
  need(Object.keys(process.env).every((k) => Object.hasOwn(childEnv(), k)) &&
    Object.entries(childEnv()).every(([k, v]) => process.env[k] === v), 'ISOLATION_UNPROVEN');
  need(request.bundleSha256 === bundleSpec().bundleSha256, 'UNKNOWN_TOOL_PROVENANCE');
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  need(/^CapEff:\s*0+$/m.test(status) && /^NoNewPrivs:\s*1$/m.test(status) && /^Seccomp:\s*2$/m.test(status), 'ISOLATION_UNPROVEN');
  const mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8').trim().split('\n').map((line) => line.split(' - ')[0].split(' '));
  const mount = (p) => mounts.find((m) => m[4] === p);
  const ro = (p) => mount(p)?.[5].split(',').includes('ro');
  const input = phase === 'capture' ? '/source' : '/input';
  need(ro('/') && ro(input) && mount('/scratch') && (phase === 'scan' ? !mount('/out') : mount('/out')), 'ISOLATION_UNPROVEN');
  for (const m of mounts) {
    const p = m[4];
    need(['/', input, '/scratch', ...(phase === 'scan' ? [] : ['/out']), '/etc/hosts', '/etc/hostname', '/etc/resolv.conf'].includes(p) ||
      /^\/(proc|dev|sys)(\/|$)/.test(p), 'ISOLATION_UNPROVEN');
  }
  need(fs.readFileSync('/proc/net/route', 'utf8').trim().split('\n').length === 1, 'ISOLATION_UNPROVEN');
  const memory = Number(fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim());
  const pids = Number(fs.readFileSync('/sys/fs/cgroup/pids.max', 'utf8').trim());
  const cpu = fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(' ').map(Number);
  need(memory > 0 && memory <= 512 * 1024 * 1024 && pids > 0 && pids <= 64 && cpu[0] > 0 && cpu[0] <= cpu[1], 'ISOLATION_UNPROVEN');
}
function sqlite() { need(runtimeSupported(), 'RUNTIME_NEEDS_VALIDATION'); return require('node:sqlite').DatabaseSync; }
function qi(name) { return `"${name.replace(/"/g, '""')}"`; }
function schemaObjects(db) {
  // GLOB's underscore is literal; sqliteX is not SQLite's reserved internal namespace.
  // Exact stored DDL deliberately refuses equivalent-but-unproven schema definitions.
  return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' AND name != '_prisma_migrations' ORDER BY type,name").all();
}
function expectedSchema(after = false) {
  const db = new (sqlite())(':memory:');
  try {
    for (const name of migrationNames().slice(0, after ? 21 : 20)) db.exec(migrationSql(name));
    return { objects: schemaObjects(db), tables: schemaObjects(db).filter((o) => o.type === 'table').map((o) => ({
      name: o.name, columns: db.prepare(`PRAGMA table_info(${qi(o.name)})`).all(),
      foreignKeys: db.prepare(`PRAGMA foreign_key_list(${qi(o.name)})`).all(),
    })) };
  } finally { db.close(); }
}
function verifySchema(db, expected) {
  need(JSON.stringify(schemaObjects(db)) === JSON.stringify(expected.objects), 'SCHEMA_MISMATCH');
  for (const table of expected.tables) {
    need(JSON.stringify(db.prepare(`PRAGMA table_info(${qi(table.name)})`).all()) === JSON.stringify(table.columns) &&
      JSON.stringify(db.prepare(`PRAGMA foreign_key_list(${qi(table.name)})`).all()) === JSON.stringify(table.foreignKeys), 'SCHEMA_MISMATCH');
  }
}
function integrity(db) {
  const check = db.prepare('PRAGMA integrity_check').all();
  need(check.length === 1 && Object.values(check[0])[0] === 'ok' &&
    db.prepare('PRAGMA foreign_key_check').all().length === 0, 'INTEGRITY_FAILED');
}
function count(db, sql, ...args) { const n = db.prepare(sql).get(...args).n; need(Number.isSafeInteger(n) && n >= 0 && n <= 250000, 'TOOL_FAILED'); return n; }
function jsonStrings(value, visit, depth = 0) {
  need(depth <= 32, 'INVALID_JSON');
  if (typeof value === 'string') visit(value);
  else if (Array.isArray(value)) value.forEach((v) => jsonStrings(v, visit, depth + 1));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { visit(k); jsonStrings(v, visit, depth + 1); }
}
function analyzeCopy(db, tables, scanner) {
  const counts = { invalid_json: 0, noncuid_references: 0, invalid_pass_ids: 0, bare_other: 0, unknown_locations: 0 };
  for (const { name, columns } of tables) {
    const key = MODEL_KEYS[name];
    need(Boolean(key), 'SCHEMA_MISMATCH');
    const rows = count(db, `SELECT COUNT(*) n FROM ${qi(name)}`);
    counts[`rows_${key}`] = rows; counts[`bare_${key}`] = 0; counts[`noncuid_${key}`] = 0;
    for (let offset = 0; offset < rows; offset += 128) {
      const batch = db.prepare(`SELECT * FROM ${qi(name)} LIMIT 128 OFFSET ?`).all(offset);
      for (const row of batch) for (const { name: column } of columns) {
        const value = row[column];
        if (value === null || value === undefined) continue;
        if (column === 'id' && ['Business', 'BenefitRule', 'Product', 'CheckoutOperator', 'Session'].includes(name) && !CUID.test(value)) counts[`noncuid_${key}`]++;
        if (column === 'id' && name === 'CustomerPass' && !PASS_ID.test(value)) counts.invalid_pass_ids++;
        if (['businessId', 'benefitRuleId', 'productId', 'sessionId', 'confirmedByOperatorId'].includes(column) && !CUID.test(value)) counts.noncuid_references++;
        if (typeof value !== 'string' && !Buffer.isBuffer(value)) continue;
        const visit = (s) => { for (const match of String(s).matchAll(BARE)) counts[`bare_${key}`] += scanner.countAddresses(match[1]); };
        if ((name === 'AuditLog' && column === 'payload') || (name === 'Business' && column === 'categoriesJson')) {
          try { jsonStrings(JSON.parse(String(value)), visit); } catch { counts.invalid_json++; }
        } else visit(String(value));
      }
    }
  }
  for (const state of REWARDS) counts[`reward_${state.toLowerCase()}`] = count(db, 'SELECT COUNT(*) n FROM RewardEvent WHERE status COLLATE BINARY = ?', state);
  counts.reward_null = count(db, 'SELECT COUNT(*) n FROM RewardEvent WHERE status IS NULL');
  counts.reward_unknown = count(db, `SELECT COUNT(*) n FROM RewardEvent WHERE status COLLATE BINARY NOT IN (${REWARDS.map(() => '?').join(',')})`, ...REWARDS);
  counts.session_open = count(db, "SELECT COUNT(*) n FROM Session WHERE status IN ('PENDING','APPROVED')");
  counts.pass_open = count(db, "SELECT COUNT(*) n FROM CustomerPass WHERE status IN ('OPEN','BOUND')");
  return safeCounts(counts);
}
function confirmedRewards(counts) {
  if (counts.rows_reward !== counts.reward_confirmed) throw new Hold('OPEN_REWARDS', counts);
}
function preflight(counts) {
  confirmedRewards(counts);
  if (counts.invalid_json) throw new Hold('INVALID_JSON', counts);
  if (counts.invalid_pass_ids || counts.noncuid_references || ['business', 'rule', 'product', 'operator', 'session'].some((k) => counts[`noncuid_${k}`]))
    throw new Hold('AUTH_SHAPE_INCOMPATIBLE', counts);
}
function verifyBaseline(db, after = false) {
  const rows = db.prepare('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations').all();
  const names = migrationNames().slice(0, after ? 21 : 20);
  need(rows.length === names.length && names.every((name) => rows.filter((r) => r.migration_name === name &&
    r.finished_at !== null && r.rolled_back_at === null && r.checksum === hashBuffer(Buffer.from(migrationSql(name)))).length === 1), 'MIGRATION_BASELINE_UNKNOWN');
}
function privateTool(bin, args, options = {}) {
  const result = spawnSync(bin, args, { env: childEnv(), encoding: 'utf8', timeout: TIMEOUT, maxBuffer: MAX_OUTPUT, ...options });
  need(!result.error && result.signal === null && result.status === 0, result.error?.code === 'ETIMEDOUT' ? 'TOOL_TIMEOUT' : 'TOOL_FAILED');
  return result.stdout;
}
function runExactMigration() {
  const prisma = path.join(BACKEND, 'node_modules/prisma/build/index.js');
  const version = JSON.parse(fs.readFileSync(path.join(BACKEND, 'node_modules/prisma/package.json'), 'utf8')).version;
  need(version === '5.22.0', 'UNKNOWN_TOOL_PROVENANCE');
  const schema = path.join('/scratch/prisma', 'schema.prisma');
  fs.cpSync(path.join(BACKEND, 'prisma'), '/scratch/prisma', { recursive: true, dereference: false, errorOnExist: true, force: false });
  privateTool(process.execPath, [prisma, 'migrate', 'deploy', '--schema', schema], { cwd: '/scratch' });
}
function verifyOfflineTools() {
  const prisma = path.join(BACKEND, 'node_modules/prisma/build/index.js');
  for (const pkg of ['prisma', '@prisma/client', '@prisma/engines']) {
    need(JSON.parse(fs.readFileSync(path.join(BACKEND, 'node_modules', pkg, 'package.json'), 'utf8')).version === '5.22.0', 'UNKNOWN_TOOL_PROVENANCE');
  }
  privateTool(process.execPath, [prisma, '--version'], { cwd: '/scratch' });
  privateTool('/usr/bin/sqlite3', ['-version']);
}
function runExistingScan(file) {
  const output = privateTool(process.execPath, ['--no-warnings', path.join(BACKEND, 'scripts/verify-owner-b-migration.cjs'), '--scan', file]);
  need(output.split('\n')[0] === 'Owner-B address scan: PASS', 'SCAN_FAILED');
}
function prefix(counts, label) { return Object.fromEntries(Object.entries(counts).map(([k, v]) => [`${label}_${k}`, v])); }
function verifyContinuity(before, after) {
  confirmedRewards(after);
  for (const key of ['business', 'rule', 'product', 'operator', 'session', 'pass', 'reward', 'audit', 'reward_link', 'admin_audit'])
    need(before[`rows_${key}`] === after[`rows_${key}`], 'CONTINUITY_FAILED');
  need(after.session_open === 0 && after.pass_open === 0 && after.rows_challenge === 0, 'CONTINUITY_FAILED');
}
function migrateCopy(request) {
  enforcePhase('migrate', request);
  const capturedHash = fileHash('/input/snapshot.db');
  need(capturedHash === request.sha256, 'COPY_MISMATCH');
  copyProtected('/input/snapshot.db', '/scratch/rehearsal.db', request.sha256);
  copyProtected('/input/snapshot.db', '/scratch/restore.db', request.sha256);
  const Database = sqlite();
  const restore = new Database('/scratch/restore.db');
  try { integrity(restore); } finally { restore.close(); }
  const scanner = require(path.join(BACKEND, 'scripts/verify-owner-b-migration.cjs'));
  const expected = expectedSchema();
  let db = new Database('/scratch/rehearsal.db');
  let before;
  try { integrity(db); verifySchema(db, expected); verifyBaseline(db); before = analyzeCopy(db, expected.tables, scanner); preflight(before); }
  finally { db.close(); }
  runExactMigration();
  db = new Database('/scratch/rehearsal.db');
  let after;
  try {
    const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    need(checkpoint.busy === 0, 'TOOL_FAILED');
    db.exec('VACUUM; PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON;');
    integrity(db);
    const final = expectedSchema(true);
    verifySchema(db, final); verifyBaseline(db, true);
    after = analyzeCopy(db, final.tables, scanner);
    verifyContinuity(before, after);
  } finally { db.close(); }
  absentSidecars('/scratch/rehearsal.db');
  need(fileHash('/input/snapshot.db') === capturedHash, 'SOURCE_CHANGED');
  copyProtected('/scratch/rehearsal.db', '/out/benefits.db', fileHash('/scratch/rehearsal.db'));
  return summary('PASS', 'COPY_MIGRATED', { ...prefix(before, 'before'), ...prefix(after, 'after') });
}
function scanCopy(request) {
  enforcePhase('scan', request);
  absentSidecars('/input/benefits.db');
  need(fileHash('/input/benefits.db') === request.sha256, 'COPY_MISMATCH');
  try { runExistingScan('/input/benefits.db'); } catch { throw new Hold('SCAN_FAILED'); }
  absentSidecars('/input/benefits.db');
  need(fileHash('/input/benefits.db') === request.sha256, 'SOURCE_CHANGED');
  return summary('PASS', 'SCAN_PASSED');
}
function readPrivateCertificate(file) {
  const parent = directoryHandle(path.dirname(privatePath(file)));
  let opened;
  try {
    opened = openSource(path.join(parent.at, path.basename(file)), REAL_POLICY);
    need(opened.stat.size <= 65536n, 'INVALID_CERTIFICATE');
    const bytes = fs.readFileSync(opened.fd);
    need(bytes.length <= 65536 && sameIdentity(opened.stat, fs.fstatSync(opened.fd, { bigint: true })), 'INVALID_CERTIFICATE');
    return JSON.parse(bytes.toString('utf8'));
  } finally { if (opened) fs.closeSync(opened.fd); fs.closeSync(parent.fd); }
}
function toolSummary(output) {
  let parsed;
  try { parsed = JSON.parse(output); } catch { throw new Hold('TOOL_OUTPUT_INVALID'); }
  need(parsed && Object.keys(parsed).sort().join(',') === 'category,counts,status', 'TOOL_OUTPUT_INVALID');
  return summary(parsed.status, parsed.category, parsed.counts);
}
function plan(cert) {
  validateCertificate(cert);
  need(cert.tools.bundleSha256 === bundleSpec().bundleSha256, 'UNKNOWN_TOOL_PROVENANCE');
  // Static prerequisites cannot establish that the image exists or enforce a sandbox.
  return summary('NEEDS_VALIDATION', 'RUNTIME_NEEDS_VALIDATION');
}
function hostDocker(bin, args) {
  const result = spawnSync(bin, args, { env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent' },
    encoding: 'utf8', timeout: 15000, maxBuffer: MAX_OUTPUT });
  need(!result.error && result.status === 0 && result.signal === null, 'TOOL_FAILED');
  return result.stdout;
}
function pathsOverlap(a, b) {
  for (const value of [a, b]) need(typeof value === 'string' && path.posix.isAbsolute(value) &&
    !/[\r\n\0]/.test(value) && path.posix.normalize(value) === value, 'UNKNOWN_WRITERS');
  const contains = (parent, child) => {
    const relative = path.posix.relative(parent, child);
    return relative === '' || (relative !== '..' && !relative.startsWith('../') && !path.posix.isAbsolute(relative));
  };
  return contains(a, b) || contains(b, a);
}
function verifyRuntime(bin, cert) {
  need(hashBuffer(fs.readFileSync(process.execPath)) === cert.tools.hostNodeSha256 &&
    hashBuffer(fs.readFileSync(bin)) === cert.tools.hostDockerSha256, 'UNKNOWN_TOOL_PROVENANCE');
  const info = JSON.parse(hostDocker(bin, ['info', '--format', '{"os":{{json .OSType}},"security":{{json .SecurityOptions}}}']));
  need(info.os === 'linux' && Array.isArray(info.security) && !info.security.some((s) => /rootless|userns/.test(s)), 'ISOLATION_UNPROVEN');
  const image = JSON.parse(hostDocker(bin, ['image', 'inspect', '--format',
    '{"digests":{{json .RepoDigests}},"bundle":{{json (index .Config.Labels "benefits.rehearsal.bundle-sha256")}}}', cert.tools.image]));
  need(image.digests?.includes(cert.tools.image) && image.bundle === cert.tools.bundleSha256, 'UNKNOWN_TOOL_PROVENANCE');
  if (cert.source.kind === 'stopped-source') {
    const main = JSON.parse(hostDocker(bin, ['inspect', '--format', '{"running":{{json .State.Running}},"mounts":{{json .Mounts}}}', 'inferno-benefits-backend']));
    need(main.running === false, 'SOURCE_RUNNING');
    need(main.mounts?.filter((m) => m.Destination === '/data' && m.Source === cert.source.directory).length === 1, 'UNKNOWN_MOUNT');
    const ids = hostDocker(bin, ['ps', '-q']).trim().split('\n').filter(Boolean);
    need(ids.length <= 256, 'UNKNOWN_WRITERS');
    for (const id of ids) {
      need(/^[a-f0-9]+$/.test(id), 'UNKNOWN_WRITERS');
      const mounts = JSON.parse(hostDocker(bin, ['inspect', '--format', '{{json .Mounts}}', id]));
      need(Array.isArray(mounts) && !mounts.some((m) => m.Source && pathsOverlap(m.Source, cert.source.directory)), 'UNKNOWN_WRITERS');
    }
  }
}
function containerClient(bin, args, input, state, acceptedCodes, options) {
  return new Promise((resolve, reject) => {
    const child = (options.spawn || spawn)(bin, args, {
      env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    state.child = child;
    state.clientReaped = false;
    let bytes = 0;
    let failure;
    let reapTimer;
    const chunks = [];
    const abort = (category) => {
      if (failure) return;
      failure = new Hold(category);
      try { child.kill('SIGKILL'); } catch { /* Reap/absence evidence, not kill's return value, decides cleanup. */ }
      reapTimer = setTimeout(() => reject(new Hold('CLEANUP_REQUIRED')), options.reapTimeout ?? 15000);
    };
    state.abortClient = () => abort('INTERRUPTED');
    const timer = setTimeout(() => abort('TOOL_TIMEOUT'), options.timeout ?? TIMEOUT);
    const collect = (chunk, stdout) => {
      if (failure) return;
      bytes += chunk.length;
      if (bytes > (options.maxOutput ?? MAX_OUTPUT)) abort('TOOL_OUTPUT_INVALID');
      else if (stdout) chunks.push(chunk);
    };
    child.stdout.on('data', (c) => collect(c, true)); child.stderr.on('data', (c) => collect(c, false));
    child.stdin.on('error', () => {});
    child.once('error', () => abort('TOOL_FAILED'));
    child.once('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(reapTimer);
      state.child = null; state.abortClient = null; state.clientReaped = true;
      if (failure) reject(failure);
      else if (signal || !acceptedCodes.includes(code)) reject(new Hold('TOOL_FAILED'));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    child.stdin.end(input);
  });
}
async function runContainer(bin, args, request, name, state, options = {}) {
  state.terminationConfirmed = false;
  let output;
  try {
    output = await containerClient(bin, args, JSON.stringify(request), state, [0, 78], options);
  } finally {
    try {
      need(state.clientReaped && state.child === null, 'CLEANUP_REQUIRED');
      const cleanupOptions = { ...options, timeout: options.cleanupTimeout ?? 15000 };
      const query = ['ps', '-aq', '--filter', `name=^/${name}$`];
      const existing = (await containerClient(bin, query, '', state, [0], cleanupOptions)).trim();
      if (existing !== '') {
        need(/^[a-f0-9]{12,64}$/.test(existing), 'CLEANUP_REQUIRED');
        // Remove only our unique tool container, never a service or an arbitrary returned ID.
        await containerClient(bin, ['rm', '-f', name], '', state, [0], cleanupOptions);
        need((await containerClient(bin, query, '', state, [0], cleanupOptions)).trim() === '', 'CLEANUP_REQUIRED');
      }
      state.terminationConfirmed = true;
    } catch { throw new Hold('CLEANUP_REQUIRED'); }
  }
  return toolSummary(output);
}
function cleanPrivateScratch(directory, inode) {
  const stat = fs.lstatSync(directory, { bigint: true });
  need(stat.ino === inode && stat.uid === 0n && stat.isDirectory() && (stat.mode & 0o077n) === 0n, 'CLEANUP_REQUIRED');
  for (const leaf of ['captured', 'migrated']) {
    const folder = path.join(directory, leaf);
    let st;
    try { st = fs.lstatSync(folder, { bigint: true }); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    need(st.isDirectory() && st.uid === 0n && (st.mode & 0o077n) === 0n, 'CLEANUP_REQUIRED');
    for (const entry of fs.readdirSync(folder)) {
      need(entry === (leaf === 'captured' ? 'snapshot.db' : 'benefits.db'), 'CLEANUP_REQUIRED');
      const file = path.join(folder, entry);
      const item = fs.lstatSync(file, { bigint: true });
      need(item.isFile() && item.nlink === 1n && item.uid === 0n && (item.mode & 0o077n) === 0n, 'CLEANUP_REQUIRED');
      fs.unlinkSync(file);
    }
    fs.rmdirSync(folder);
  }
  fs.rmdirSync(directory);
}
async function withPrivateCleanup(directory, inode, action, cleanup = cleanPrivateScratch) {
  const state = { child: null, clientReaped: true, terminationConfirmed: true, interrupted: false, abortClient: null };
  const interrupt = () => { state.interrupted = true; state.abortClient?.(); };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  let result;
  try {
    try { result = await action(state); }
    finally {
      need(state.terminationConfirmed && state.clientReaped && state.child === null, 'CLEANUP_REQUIRED');
      try { await cleanup(directory, inode); } catch { throw new Hold('CLEANUP_REQUIRED'); }
    }
    need(!state.interrupted, 'INTERRUPTED');
    return result;
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
  }
}
async function execute(cert, ownerGo) {
  need(ownerGo === GO, 'OWNER_GO_REQUIRED');
  need(process.platform === 'linux' && process.getuid() === 0 && runtimeSupported(), 'ROOT_LINUX_REQUIRED');
  validateCertificate(cert);
  need(cert.tools.bundleSha256 === bundleSpec().bundleSha256, 'UNKNOWN_TOOL_PROVENANCE');
  const docker = ['/usr/bin/docker', '/usr/local/bin/docker'].find((p) => fs.existsSync(p));
  need(Boolean(docker), 'RUNTIME_NEEDS_VALIDATION');
  verifyRuntime(docker, cert);
  const source = directoryHandle(cert.source.directory); fs.closeSync(source.fd);
  process.umask(0o077);
  const scratch = fs.mkdtempSync('/var/tmp/benefits-owner-b-');
  const inode = fs.lstatSync(scratch, { bigint: true }).ino;
  return withPrivateCleanup(scratch, inode, async (state) => {
    fs.mkdirSync(path.join(scratch, 'captured'), { mode: 0o700 });
    fs.mkdirSync(path.join(scratch, 'migrated'), { mode: 0o700 });
    const phases = [
      ['capture', cert.source.directory, path.join(scratch, 'captured')],
      ['migrate', path.join(scratch, 'captured'), path.join(scratch, 'migrated')],
      ['scan', path.join(scratch, 'migrated'), null],
    ];
    let counts = {};
    for (const [phase, input, output] of phases) {
      need(!state.interrupted, 'INTERRUPTED'); validateCertificate(cert);
      const name = `benefits-owner-b-${phase}-${crypto.randomUUID()}`;
      const sha256 = phase === 'scan' ? fileHash(path.join(input, 'benefits.db')) : cert.source.sha256;
      const request = phase === 'capture' ? { ...cert, bundleSha256: cert.tools.bundleSha256 } : { sha256, bundleSha256: cert.tools.bundleSha256 };
      const result = await runContainer(docker, buildDockerArgs(phase, cert.tools.image, input, output, name), request, name, state);
      if (result.status !== 'PASS') return result;
      counts = { ...counts, ...result.counts };
    }
    return summary('PASS', 'REHEARSAL_PASSED', counts);
  });
}
async function main(args) {
  const [command = 'spec', certificateFile, ownerGo] = args;
  if (command === 'spec' && args.length <= 1) { emitSafeSummary(bundleSpec()); return; }
  if (command === 'plan') {
    need(args.length === 2, 'INVALID_COMMAND');
    emitSafeSummary(plan(readPrivateCertificate(certificateFile))); process.exitCode = 78; return;
  }
  if (command === 'execute') {
    need(args.length === 3, 'INVALID_COMMAND');
    need(ownerGo === GO, 'OWNER_GO_REQUIRED');
    need(process.platform === 'linux' && process.getuid() === 0, 'ROOT_LINUX_REQUIRED');
    const result = await execute(readPrivateCertificate(certificateFile), ownerGo);
    emitSafeSummary(result); process.exitCode = result.status === 'PASS' ? 0 : 78; return;
  }
  need(['phase-capture', 'phase-migrate', 'phase-scan'].includes(command) && args.length === 1, 'INVALID_COMMAND');
  const buffer = Buffer.alloc(65537);
  let size = 0;
  while (size < buffer.length) {
    const n = fs.readSync(0, buffer, size, buffer.length - size, null);
    if (n === 0) break;
    size += n;
  }
  const input = buffer.subarray(0, size);
  need(input.length <= 65536, 'INVALID_CERTIFICATE');
  const request = JSON.parse(input.toString('utf8'));
  let result;
  if (command === 'phase-capture') {
    enforcePhase('capture', request);
    verifyOfflineTools();
    result = summary('PASS', 'SNAPSHOT_CAPTURED', { bytes: captureStoppedSnapshot(request, '/source', '/out') });
  } else if (command === 'phase-migrate') result = migrateCopy(request);
  else result = scanCopy(request);
  emitSafeSummary(result);
  if (result.status === 'HOLD') process.exitCode = 78;
}
module.exports = { Hold, REAL_POLICY, MAX_BYTES, TARGET, BASE, GO, identity, hashBuffer, fileHash, copyProtected,
  captureStoppedSnapshot, validateCertificate, bundleSpec, buildDockerArgs, childEnv, expectedSchema,
  analyzeCopy, preflight, verifySchema, verifyContinuity, integrity, summary, safeCounts, toolSummary, plan, runtimeSupported,
  cleanPrivateScratch, withPrivateCleanup, runContainer, pathsOverlap, execute, privateTool };
if (require.main === module) main(process.argv.slice(2)).catch((error) => {
  const category = error instanceof Hold && CATEGORIES.has(error.category) ? error.category : 'TOOL_FAILED';
  try { emitSafeSummary(summary('HOLD', category, error instanceof Hold ? error.counts : {})); }
  catch { emitSafeSummary(summary('HOLD', 'TOOL_OUTPUT_INVALID')); }
  process.exitCode = 78;
});
