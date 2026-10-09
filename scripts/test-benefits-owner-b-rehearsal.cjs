#!/usr/bin/env node
'use strict';

// Dummy-only tests. Run in an OS-enforced no-network sandbox, with only --scratch writable.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const prep = require('./benefits-owner-b-rehearsal.cjs');
const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'apps/benefits-network/backend');
const scanner = require(path.join(BACKEND, 'scripts/verify-owner-b-migration.cjs'));
const SENTINEL = 'DUMMY_SECRET_SENTINEL_NEVER_EXPORT';
const policy = { uid: process.getuid(), noAtime: false, anchored: false };
let sequence = 0;
let passed = 0;
const scratch = process.argv[2];
assert.ok(scratch && path.isAbsolute(scratch) && scratch.startsWith(`${ROOT}/.fleet/`));
assert.equal(fs.lstatSync(scratch).mode & 0o777, 0o700);
process.umask(0o077);

function dir(label) { return fs.mkdtempSync(path.join(scratch, `${label}-`)); }
function bytesHash(file) { return prep.hashBuffer(fs.readFileSync(file)); }
function coldFixture() {
  const source = dir('source');
  const file = path.join(source, 'benefits.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE Dummy (value TEXT);');
  db.prepare('INSERT INTO Dummy VALUES (?)').run(SENTINEL);
  db.close(); fs.chmodSync(file, 0o600);
  return { source, file };
}
function certificate(source, file) {
  return {
    version: 1, ownerGo: true, expiresAt: new Date(Date.now() + 300000).toISOString(),
    source: { kind: 'certified-backup', directory: source, sha256: bytesHash(file),
      identity: prep.identity(fs.lstatSync(file, { bigint: true })),
      proof: { coherent: true, offline: true, exclusionHeld: true, writersKnown: true, allWritersExcluded: true,
        ownerCertified: true, restoreVerified: true } },
    tools: { ownerApproved: true, sourceBase: prep.BASE, bundleSha256: 'a'.repeat(64),
      image: `local/rehearsal@sha256:${'b'.repeat(64)}`, runtimeValidated: true, isolationValidated: true,
      offlineEnginesVerified: true, nodeVersion: '22.22.2', prismaVersion: '5.22.0',
      hostNodeSha256: 'c'.repeat(64), hostDockerSha256: 'd'.repeat(64) },
  };
}
function hold(fn, category) {
  let caught;
  try { fn(); } catch (error) { caught = error; }
  assert.ok(caught instanceof prep.Hold);
  if (caught.category !== category) throw caught;
}
function test(label, fn) {
  try { fn(); passed++; }
  catch (error) {
    const category = error instanceof prep.Hold ? prep.summary('HOLD', error.category).category : 'ASSERTION_FAILED';
    process.stdout.write(`${JSON.stringify({ status: 'FAIL', test: label, category })}\n`);
    process.exitCode = 1; throw new Error('FIXTURE_FAILED');
  }
}
try {
  test('cold_capture_and_source_unchanged', () => {
    const { source, file } = coldFixture(); const output = dir('output'); const cert = certificate(source, file);
    const before = fs.lstatSync(file, { bigint: true });
    const bytes = prep.captureStoppedSnapshot(cert, source, output, policy);
    assert.equal(bytes, Number(before.size)); assert.equal(bytesHash(path.join(output, 'snapshot.db')), cert.source.sha256);
    assert.equal(bytesHash(file), cert.source.sha256); assert.deepEqual(prep.identity(fs.lstatSync(file, { bigint: true })), prep.identity(before));
    assert.equal(fs.lstatSync(path.join(output, 'snapshot.db')).mode & 0o777, 0o600);
    assert.equal(fs.readdirSync(source).join(','), 'benefits.db');
  });
  for (const sidecar of ['-wal', '-shm', '-journal']) test(`refuse_${sidecar.slice(1)}`, () => {
    const { source, file } = coldFixture(); const cert = certificate(source, file); const output = dir('output');
    fs.writeFileSync(file + sidecar, '', { mode: 0o600 }); const before = bytesHash(file);
    hold(() => prep.captureStoppedSnapshot(cert, source, output, policy), 'SIDECAR_PRESENT');
    assert.equal(bytesHash(file), before); assert.equal(fs.existsSync(file + sidecar), true); assert.equal(fs.readdirSync(output).length, 0);
  });
  test('active_wal_refused_without_source_writes', () => {
    const { source, file } = coldFixture(); const db = new DatabaseSync(file);
    try {
      db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');
      db.prepare('INSERT INTO Dummy VALUES (?)').run(SENTINEL);
      const cert = certificate(source, file); const before = bytesHash(file); const wal = bytesHash(file + '-wal');
      hold(() => prep.captureStoppedSnapshot(cert, source, dir('output'), policy), 'SIDECAR_PRESENT');
      assert.equal(bytesHash(file), before); assert.equal(bytesHash(file + '-wal'), wal);
    } finally { db.close(); }
  });
  test('late_sidecar_cleans_failed_copy', () => {
    const { source, file } = coldFixture(); const cert = certificate(source, file); const output = dir('output');
    hold(() => prep.captureStoppedSnapshot(cert, source, output, { ...policy,
      afterCopy: () => fs.writeFileSync(file + '-journal', '', { mode: 0o600 }) }), 'SIDECAR_PRESENT');
    assert.equal(fs.readdirSync(output).length, 0); assert.equal(bytesHash(file), cert.source.sha256);
  });
  test('copy_hash_mismatch_cleanup', () => {
    const { source, file } = coldFixture(); const cert = certificate(source, file); const output = dir('output');
    cert.source.sha256 = '0'.repeat(64);
    hold(() => prep.captureStoppedSnapshot(cert, source, output, policy), 'COPY_MISMATCH');
    assert.equal(fs.readdirSync(output).length, 0);
  });
  test('replaced_source_identity', () => {
    const { source, file } = coldFixture(); const cert = certificate(source, file);
    cert.source.identity.ino = '0';
    hold(() => prep.captureStoppedSnapshot(cert, source, dir('output'), policy), 'SOURCE_CHANGED');
  });
  test('source_change_during_copy', () => {
    const { source, file } = coldFixture(); const cert = certificate(source, file); const output = dir('output');
    hold(() => prep.captureStoppedSnapshot(cert, source, output, { ...policy,
      afterCopy: () => fs.appendFileSync(file, 'dummy') }), 'SOURCE_CHANGED');
    assert.equal(fs.readdirSync(output).length, 0);
  });
  test('symlink_and_hardlink_refusal', () => {
    const { source, file } = coldFixture(); const cert = certificate(source, file); const output = dir('output');
    fs.linkSync(file, path.join(source, 'extra'));
    hold(() => prep.captureStoppedSnapshot(cert, source, output, policy), 'UNSAFE_PATH');
    fs.unlinkSync(path.join(source, 'extra'));
    const link = path.join(scratch, `symlink-${sequence++}`); fs.symlinkSync(source, link);
    hold(() => prep.captureStoppedSnapshot(cert, link, output, policy), 'UNSAFE_PATH');
  });
  test('unsafe_backend_writer_mount_and_tools_hold', () => {
    const { source, file } = coldFixture();
    const cert = certificate(source, file); cert.source.kind = 'stopped-source';
    cert.source.proof.backendRunning = true;
    hold(() => prep.validateCertificate(cert), 'SOURCE_RUNNING');
    cert.source.proof.backendRunning = false;
    hold(() => prep.validateCertificate(cert), 'UNKNOWN_MOUNT');
    cert.source.proof.writersKnown = false;
    hold(() => prep.validateCertificate(cert), 'UNKNOWN_WRITERS');
    cert.source.proof.writersKnown = true; cert.source.kind = 'certified-backup';
    cert.tools.ownerApproved = false; hold(() => prep.validateCertificate(cert), 'UNKNOWN_TOOL_PROVENANCE');
    cert.tools.ownerApproved = true; cert.tools.runtimeValidated = false;
    hold(() => prep.validateCertificate(cert), 'RUNTIME_NEEDS_VALIDATION');
  });
  test('count_only_sqlite_and_refusal', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE Business(id TEXT,categoriesJson TEXT); CREATE TABLE Session(id TEXT,businessId TEXT,status TEXT,reason TEXT); CREATE TABLE CustomerPass(id TEXT,status TEXT); CREATE TABLE RewardEvent(id TEXT,status TEXT); CREATE TABLE AuditLog(id TEXT,sessionId TEXT,payload TEXT);');
      db.prepare('INSERT INTO Business VALUES (?,?)').run(SENTINEL, '[]');
      db.prepare('INSERT INTO Session VALUES (?,?,?,?)').run(SENTINEL, SENTINEL, 'PENDING', 'bare ' + '1'.repeat(40));
      db.prepare('INSERT INTO CustomerPass VALUES (?,?)').run('P'.repeat(32), 'BOUND');
      db.prepare('INSERT INTO RewardEvent VALUES (?,?)').run(SENTINEL, SENTINEL);
      db.prepare('INSERT INTO AuditLog VALUES (?,?,?)').run(SENTINEL, SENTINEL, JSON.stringify({ [SENTINEL]: '2'.repeat(40) }));
      const tables = ['Business', 'Session', 'CustomerPass', 'RewardEvent', 'AuditLog'].map((name) => ({ name, columns: db.prepare(`PRAGMA table_info("${name}")`).all() }));
      let counts = prep.analyzeCopy(db, tables, scanner);
      assert.equal(counts.reward_unknown, 1); assert.equal(counts.noncuid_business, 1);
      assert.equal(counts.bare_session, 1); assert.equal(counts.bare_audit, 1);
      assert.equal(JSON.stringify(counts).includes(SENTINEL), false);
      hold(() => prep.preflight(counts), 'OPEN_REWARDS');
      db.exec('UPDATE RewardEvent SET status=NULL'); counts = prep.analyzeCopy(db, tables, scanner);
      assert.equal(counts.reward_null, 1); hold(() => prep.preflight(counts), 'OPEN_REWARDS');
      db.exec("UPDATE RewardEvent SET status='CONFIRMED'"); counts = prep.analyzeCopy(db, tables, scanner);
      hold(() => prep.preflight(counts), 'AUTH_SHAPE_INCOMPATIBLE');
      db.exec("UPDATE AuditLog SET payload='invalid'"); counts = prep.analyzeCopy(db, tables, scanner);
      hold(() => prep.preflight(counts), 'INVALID_JSON');
    } finally { db.close(); }
  });
  test('schema_from_unchanged_real_migrations', () => {
    const before = prep.expectedSchema(); const after = prep.expectedSchema(true);
    assert.ok(before.tables.some((t) => t.name === 'CustomerHistoryAccess'));
    assert.ok(!after.tables.some((t) => t.name === 'CustomerHistoryAccess'));
    assert.ok(!after.tables.find((t) => t.name === 'Session').columns.some((c) => c.name === 'recoveredAddress'));
  });
  test('real_sql_refusal_and_late_failure_rollback', () => {
    const migrations = path.join(BACKEND, 'prisma/migrations');
    const names = fs.readdirSync(migrations, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    const target = fs.readFileSync(path.join(migrations, prep.TARGET, 'migration.sql'), 'utf8');
    const make = () => {
      const db = new DatabaseSync(':memory:');
      for (const name of names.slice(0, -1)) db.exec(fs.readFileSync(path.join(migrations, name, 'migration.sql'), 'utf8'));
      db.exec(`INSERT INTO Business(id,name,discountPercent,requiredLockIFR,ttlSeconds,createdAt) VALUES('shop','Dummy',10,1,60,'2025-01-01');
        INSERT INTO Session(id,businessId,nonce,expiresAt,status,createdAt,updatedAt) VALUES('session','shop','nonce','2025-01-01','APPROVED','2025-01-01','2025-01-01');`);
      db.prepare('INSERT INTO AuditLog(id,sessionId,type,payload,ts) VALUES(?,?,?,?,?)').run('audit','session','ATTEST_FAIL',JSON.stringify({ wallet: SENTINEL, held: 1 }),'2025-01-01');
      return db;
    };
    const state = (db) => JSON.stringify({ sessions: db.prepare('SELECT * FROM Session').all(), audit: db.prepare('SELECT * FROM AuditLog').all() });
    for (const status of ['PENDING','READY','BLOCKED_CALLER','BLOCKED_GOVERNANCE','SETTLEMENT_PENDING',SENTINEL]) {
      const db = make();
      try {
        db.prepare('INSERT INTO RewardEvent(id,businessId,sessionId,partnerId,customerWallet,lockAmountRaw,chainId,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)')
          .run('event','shop','session','partner',SENTINEL,'1',1,status,'2025-01-01','2025-01-01');
        const before = state(db); assert.throws(() => db.exec(target)); assert.equal(state(db), before);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM RewardEvent').get().n, 1);
      } finally { db.close(); }
    }
    const late = make();
    try {
      late.exec('CREATE TABLE new_RewardEvent(blocker TEXT)'); const before = state(late);
      assert.throws(() => late.exec(target)); late.exec('ROLLBACK'); assert.equal(state(late), before);
    } finally { late.close(); }
    const invalid = make();
    try {
      invalid.exec("UPDATE AuditLog SET payload='invalid'"); const before = state(invalid);
      assert.throws(() => invalid.exec(target)); invalid.exec('ROLLBACK'); assert.equal(state(invalid), before);
    } finally { invalid.close(); }
  });
  test('private_subprocess_stderr_and_timeout', () => {
    hold(() => prep.privateTool('/bin/sh', ['-c', `printf '%s\\n' '${SENTINEL}' >&2; exit 1`]), 'TOOL_FAILED');
    hold(() => prep.privateTool('/bin/sleep', ['1'], { timeout: 50 }), 'TOOL_TIMEOUT');
  });
  test('copy_tool_has_no_production_mount_env_socket', () => {
    const image = `local/rehearsal@sha256:${'a'.repeat(64)}`;
    const capture = prep.buildDockerArgs('capture', image, '/protected/source', '/protected/captured', 'dummy-capture');
    for (const phase of ['migrate', 'scan']) {
      const args = prep.buildDockerArgs(phase, image, '/protected/captured', '/protected/migrated', `dummy-${phase}`);
      const text = args.join(' ');
      for (const flag of ['--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pull=never', '--log-driver=none', '--pids-limit=64']) assert.ok(args.includes(flag));
      assert.equal(text.includes('/protected/source'), false); assert.equal(text.includes('/source'), false);
      assert.equal(text.includes('docker.sock'), false); assert.equal(text.includes('--env-file'), false);
      assert.equal(text.includes(SENTINEL), false); assert.equal(text.includes('--privileged'), false);
      assert.ok(text.includes('dst=/input,readonly')); assert.ok(text.includes('--entrypoint=/usr/bin/env'));
      if (phase === 'scan') assert.equal(text.includes('dst=/out'), false);
    }
    assert.ok(capture.join(' ').includes('dst=/source,readonly'));
    assert.deepEqual(Object.keys(prep.childEnv()).sort(), ['DATABASE_URL', 'HOME', 'PATH', 'PRISMA_HIDE_UPDATE_MESSAGE', 'TMPDIR', 'XDG_CACHE_HOME']);
    hold(() => prep.buildDockerArgs('capture', image, '/unsafe,src=/home', '/out', 'dummy'), 'UNSAFE_PATH');
  });
  test('exported_output_rejects_data_derived_labels', () => {
    hold(() => prep.toolSummary(JSON.stringify({ status: 'HOLD', category: SENTINEL, counts: {} })), 'TOOL_OUTPUT_INVALID');
    hold(() => prep.summary('HOLD', 'SCAN_FAILED', { [SENTINEL]: 1 }), 'TOOL_OUTPUT_INVALID');
    hold(() => prep.toolSummary(`${SENTINEL}\n{"status":"PASS"}`), 'TOOL_OUTPUT_INVALID');
    assert.equal(JSON.stringify(prep.summary('HOLD', 'SCAN_FAILED')).includes(SENTINEL), false);
    assert.equal(prep.runtimeSupported('22.11.0'), false); assert.equal(prep.runtimeSupported('23.0.0'), false);
    const spec = prep.bundleSpec(); assert.equal(spec.runtimeImage, 'UNAVAILABLE');
    const { source, file } = coldFixture(); const cert = certificate(source, file); cert.tools.bundleSha256 = spec.bundleSha256;
    assert.equal(prep.plan(cert).status, 'NEEDS_VALIDATION');
  });
  test('launcher_environment_and_hold_exit_codes', () => {
    const script = path.join(ROOT, 'scripts/prepare-benefits-owner-b-rehearsal.sh');
    const env = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: scratch, TMPDIR: scratch,
      ADMIN_SECRET: SENTINEL, NODE_OPTIONS: `--require ${SENTINEL}` };
    const spec = spawnSync('/bin/sh', [script, 'spec'], { env, encoding: 'utf8', timeout: 10000, maxBuffer: 128 * 1024 });
    assert.equal(spec.status, 0); assert.equal(JSON.parse(spec.stdout).runtimeImage, 'UNAVAILABLE');
    assert.equal((spec.stdout + spec.stderr).includes(SENTINEL), false);
    const refusal = spawnSync('/bin/sh', [script, 'execute', SENTINEL, 'NOT_OWNER_GO'], { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(refusal.status, 78); assert.equal(JSON.parse(refusal.stdout).category, 'OWNER_GO_REQUIRED');
    assert.equal((refusal.stdout + refusal.stderr).includes(SENTINEL), false);
  });
  process.stdout.write(`${JSON.stringify({ status: 'PASS', dummyTests: passed, dockerExecuted: false,
    prismaIntegration: fs.existsSync(path.join(BACKEND, 'node_modules/.bin/prisma')) ? 'NEEDS_VALIDATION' : 'SKIPPED_OFFLINE_TOOL_UNAVAILABLE' })}\n`);
} catch {
  process.exitCode = 1;
} finally {
  // Every path here was generated by this dummy harness, never a certified source or operator input.
  for (const entry of fs.readdirSync(scratch)) fs.rmSync(path.join(scratch, entry), { recursive: true, force: true });
}
