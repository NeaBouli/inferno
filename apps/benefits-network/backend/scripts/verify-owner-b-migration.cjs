/**
 * T-231b / owner decision B: dummy-data verification of the customer-privacy migration.
 *
 * 1. Refusal: any open reward obligation (even one far older than periodEnd + 72h) makes the
 *    migration fail before it changes anything; the database stays byte-for-byte equal in content.
 * 2. Continuity: without open obligations the migration keeps every session, closed reward event and
 *    audit row, expires in-flight checkouts/passes, drops customer tables/columns, scrubs customer
 *    values from audit payloads and leaves no customer address in the dump or (after VACUUM) the file.
 * Uses only throwaway SQLite files in the OS temp dir. Never touches a real database.
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const migrationsDir = path.join(root, 'prisma', 'migrations');
const target = '20261006120000_owner_b_customer_session_privacy';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'benefits-owner-b-'));
const prismaBin = path.join(root, 'node_modules', '.bin', 'prisma');

const CUSTOMER = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const CUSTOMER_BARE = CUSTOMER.slice(2).toLowerCase();
const SELLER = '0x4f632748460E5277bF8435259cADce440AbAC254';

function sqlite(db, sql) {
  return execFileSync('sqlite3', [db, sql], { encoding: 'utf8' }).trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Builds the pre-migration database with the real runner (`prisma migrate deploy`) from a private
 * copy of the migrations that stops right before the owner-B migration.
 */
function buildPreMigrationDb(name, { openObligation }) {
  const workDir = path.join(tempDir, name);
  const workMigrations = path.join(workDir, 'migrations');
  fs.mkdirSync(workMigrations, { recursive: true });
  fs.copyFileSync(path.join(root, 'prisma', 'schema.prisma'), path.join(workDir, 'schema.prisma'));
  fs.copyFileSync(path.join(migrationsDir, 'migration_lock.toml'), path.join(workMigrations, 'migration_lock.toml'));
  const migrations = fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const index = migrations.indexOf(target);
  assert(index > 0, `Migration ${target} not found`);
  for (const migration of migrations.slice(0, index)) {
    fs.cpSync(path.join(migrationsDir, migration), path.join(workMigrations, migration), { recursive: true });
  }
  const db = path.join(workDir, 'dev.db');
  const deployed = migrateDeploy(workDir);
  assert(deployed.status === 0, `Pre-migration deploy failed: ${deployed.stderr}`);
  const old = '2025-01-01T00:00:00.000Z';
  sqlite(db, `
    INSERT INTO Business (id, name, discountPercent, requiredLockIFR, ttlSeconds, active, createdAt, ownerAddress)
    VALUES ('shop', 'Dummy Shop', 10, 1000, 300, 1, '${old}', '${SELLER}');
    INSERT INTO SellerRewardLink (id, businessId, status, partnerId, requestedAt, createdAt, updatedAt)
    VALUES ('link', 'shop', 'VERIFIED', '0x${'ab'.repeat(32)}', '${old}', '${old}', '${old}');
    INSERT INTO CustomerPass (id, walletAddress, controlHash, status, expiresAt, createdAt, updatedAt)
    VALUES ('pass-bound', '${CUSTOMER}', 'hash-bound', 'BOUND', '2099-01-01T00:00:00.000Z', '${old}', '${old}'),
           ('pass-done', '${CUSTOMER}', 'hash-done', 'BOUND', '${old}', '${old}', '${old}');
    INSERT INTO Session (id, businessId, nonce, expiresAt, status, recoveredAddress, lockAmountRaw, walletBalanceRaw,
                         verifiedLockSource, verificationBlock, createdAt, updatedAt, redeemedAt, attestAttempts, customerPassId)
    VALUES ('s-redeemed', 'shop', 'n1', '${old}', 'REDEEMED', '${CUSTOMER}', '2500.0', '10', 'ifrlock', 123, '${old}', '${old}', '${old}', 1, 'pass-done'),
           ('s-approved', 'shop', 'n2', '2099-01-01T00:00:00.000Z', 'APPROVED', '${CUSTOMER}', '2500.0', '10', 'ifrlock', 124, '${old}', '${old}', NULL, 1, NULL),
           ('s-pending', 'shop', 'n3', '2099-01-01T00:00:00.000Z', 'PENDING', NULL, NULL, NULL, NULL, NULL, '${old}', '${old}', NULL, 0, 'pass-bound'),
           ('s-old', 'shop', 'n4', '${old}', 'REDEEMED', '${CUSTOMER}', '2500.0', '10', 'ifrlock', 99, '${old}', '${old}', '${old}', 1, NULL);
    INSERT INTO AuditLog (id, sessionId, type, payload, ts) VALUES
      ('a1', 's-redeemed', 'ATTEST_OK', '{"wallet":"${CUSTOMER}","locked":"2500.0","held":"10","verificationBlock":123,"lockSource":"ifrlock"}', '${old}'),
      ('a2', 's-redeemed', 'SESSION_CREATED', '{"businessId":"shop","createdBy":{"walletAddress":"${SELLER}","role":"OWNER","operatorId":null}}', '${old}'),
      ('a3', 's-redeemed', 'REDEEMED', '{"actorWallet":"${SELLER}","actorRole":"OWNER","operatorId":null}', '${old}'),
      ('a4', 's-old', 'REDEEM_DENIED_LIMIT', '{"period":"daily","wallet":"${CUSTOMER}","actorWallet":"${SELLER}"}', '${old}');
    INSERT INTO RewardEvent (id, businessId, sessionId, partnerId, customerWallet, lockAmountRaw, chainId, status, createdAt, updatedAt)
    VALUES ('r-closed', 'shop', 's-redeemed', '0x${'ab'.repeat(32)}', '${CUSTOMER}', '2500000000000000000000', 11155111, 'CONFIRMED', '${old}', '${old}');
    INSERT INTO CustomerPassChallenge (nonce, walletAddress, issuedAt, expiresAt, createdAt)
    VALUES ('c1', '${CUSTOMER}', '${old}', '${old}', '${old}');
    INSERT INTO CustomerHistoryChallenge (nonce, walletAddress, issuedAt, expiresAt, createdAt)
    VALUES ('h1', '${CUSTOMER}', '${old}', '${old}', '${old}');
    INSERT INTO CustomerHistoryAccess (tokenHash, walletAddress, expiresAt, createdAt)
    VALUES ('t1', '${CUSTOMER}', '2099-01-01T00:00:00.000Z', '${old}');
  `);
  if (openObligation) {
    // An unsettled obligation from long before any 72h settlement lag: still refused.
    sqlite(db, `
      INSERT INTO RewardEvent (id, businessId, sessionId, partnerId, customerWallet, lockAmountRaw, chainId, status, createdAt, updatedAt)
      VALUES ('r-open', 'shop', 's-old', '0x${'ab'.repeat(32)}', '0x${'11'.repeat(20)}', '1', 11155111, 'SETTLEMENT_PENDING', '${old}', '${old}');
    `);
  }
  return { db, workDir };
}

function migrateDeploy(workDir) {
  return spawnSync(prismaBin, ['migrate', 'deploy', '--schema', path.join(workDir, 'schema.prisma')], {
    cwd: workDir,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: `file:${path.join(workDir, 'dev.db')}`, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
}

/** Adds the owner-B migration to the private copy and runs the real runner again. */
function applyTarget(workDir) {
  fs.cpSync(path.join(migrationsDir, target), path.join(workDir, 'migrations', target), { recursive: true });
  return migrateDeploy(workDir);
}

function dataDump(db) {
  // Everything except Prisma's own bookkeeping table, which records the failed attempt.
  return sqlite(db, '.dump').split('\n').filter((line) => !line.includes('_prisma_migrations')).join('\n');
}

try {
  // ── 1. Refusal ────────────────────────────────────────────────────────────
  const { db: refusedDb, workDir: refusedDir } = buildPreMigrationDb('refused', { openObligation: true });
  const before = dataDump(refusedDb);
  const refused = applyTarget(refusedDir);
  assert(refused.status !== 0, 'Migration must refuse while an open reward obligation exists');
  assert(/open_reward_events_must_be_resolved_first/.test(refused.stdout + refused.stderr), `Unexpected refusal output: ${refused.stdout}${refused.stderr}`);
  const after = dataDump(refusedDb);
  assert(after === before, 'Refused migration must not change the database');
  assert(sqlite(refusedDb, "SELECT status FROM RewardEvent WHERE id = 'r-open'") === 'SETTLEMENT_PENDING', 'Open obligation must be kept');

  // ── 2. Continuity ─────────────────────────────────────────────────────────
  const { db, workDir } = buildPreMigrationDb('migrated', { openObligation: false });
  const applied = applyTarget(workDir);
  assert(applied.status === 0, `Migration failed: ${applied.stdout}${applied.stderr}`);

  const counts = sqlite(db, `
    SELECT (SELECT COUNT(*) FROM Session) || '|' || (SELECT COUNT(*) FROM AuditLog) || '|' ||
           (SELECT COUNT(*) FROM RewardEvent) || '|' || (SELECT COUNT(*) FROM CustomerPass);
  `);
  assert(counts === '4|4|1|2', `Rows were not preserved: ${counts}`);
  const statuses = sqlite(db, "SELECT group_concat(id || '=' || status, ',') FROM (SELECT id, status FROM Session ORDER BY id)");
  assert(statuses === 's-approved=EXPIRED,s-old=REDEEMED,s-pending=EXPIRED,s-redeemed=REDEEMED', `Unexpected session statuses: ${statuses}`);
  assert(sqlite(db, "SELECT redeemedAt FROM Session WHERE id = 's-redeemed'") !== '', 'redeemedAt must survive');
  assert(sqlite(db, "SELECT status FROM RewardEvent WHERE id = 'r-closed'") === 'CONFIRMED', 'Closed reward event must survive');
  const passes = sqlite(db, "SELECT group_concat(status, ',') FROM (SELECT status FROM CustomerPass ORDER BY id)");
  assert(passes === 'EXPIRED,EXPIRED', `In-flight passes must expire: ${passes}`);
  const droppedTables = sqlite(db, `
    SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'
      AND name IN ('CustomerPassChallenge', 'CustomerHistoryChallenge', 'CustomerHistoryAccess');
  `);
  assert(droppedTables === '0', 'Customer tables must be dropped (history tokens invalid)');
  const customerColumns = sqlite(db, `
    SELECT COUNT(*) FROM (
      SELECT name FROM pragma_table_info('Session') UNION ALL
      SELECT name FROM pragma_table_info('RewardEvent') UNION ALL
      SELECT name FROM pragma_table_info('CustomerPass')
    ) WHERE name IN ('recoveredAddress', 'lockAmountRaw', 'walletBalanceRaw', 'verificationBlock', 'customerWallet', 'walletAddress');
  `);
  assert(customerColumns === '0', 'Customer columns must be dropped');
  const attestPayload = JSON.parse(sqlite(db, "SELECT payload FROM AuditLog WHERE id = 'a1'"));
  assert(!('wallet' in attestPayload) && !('locked' in attestPayload) && !('held' in attestPayload) && !('verificationBlock' in attestPayload),
    `ATTEST_OK payload not scrubbed: ${JSON.stringify(attestPayload)}`);
  assert(attestPayload.lockSource === 'ifrlock', 'Non-customer audit fields must survive');
  const sellerPayload = JSON.parse(sqlite(db, "SELECT payload FROM AuditLog WHERE id = 'a2'"));
  assert(sellerPayload.createdBy.walletAddress === SELLER, 'Seller identity must stay');
  const limitPayload = JSON.parse(sqlite(db, "SELECT payload FROM AuditLog WHERE id = 'a4'"));
  assert(!('wallet' in limitPayload) && limitPayload.actorWallet === SELLER, 'REDEEM_DENIED_LIMIT must lose only the customer wallet');
  assert(sqlite(db, 'PRAGMA foreign_key_check') === '', 'Foreign-key errors after migration');

  const dump = sqlite(db, '.dump').toLowerCase();
  assert(!dump.includes(CUSTOMER_BARE), 'Customer address still present in the migrated database dump');
  sqlite(db, 'VACUUM');
  const bytes = fs.readFileSync(db).toString('latin1').toLowerCase();
  assert(!bytes.includes(CUSTOMER_BARE), 'Customer address still present in the database file after VACUUM');

  console.log('Owner-B migration verified: refusal leaves the DB unchanged; continuity keeps sessions, closed events and audit rows without customer data.');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
