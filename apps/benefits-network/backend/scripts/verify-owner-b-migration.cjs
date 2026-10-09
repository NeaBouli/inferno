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
const prismaBin = path.join(root, 'node_modules', '.bin', 'prisma');
let tempDir = null;

// ── Generic post-migration address scan ──────────────────────────────────────
// Rule (PR238-ARCH-MAP "Generic post-migration address scan"): an EVM address
// (0x + 40 hex, case-insensitive) may appear only at an explicitly allowlisted
// (table, column) or (AuditLog type, JSON key path). Allowlisting is by location,
// never by address value: a customer address may equal a seller address.
// Fail closed on any other hit, on unreadable/invalid JSON and on any table or
// column the scanner does not know. Output is counts per location, never values.
// Address token: 0x + exactly 40 hex digits, case-insensitive, not continued by another hex digit
// (a bytes32 such as RewardEvent.partnerId or a tx hash is not an address). An address embedded in
// longer hex (ABI-encoded calldata, left-padded bytes32) is caught by the padded-word pattern.
const ADDRESS_PATTERN = /0x[0-9a-f]{40}(?![0-9a-f])/gi;
const PADDED_ADDRESS_PATTERN = /0{24}[0-9a-f]{40}/gi;

// Every table/column the post-migration schema may contain. Anything else fails.
const KNOWN_COLUMNS = {
  _prisma_migrations: ['id', 'checksum', 'finished_at', 'migration_name', 'logs', 'rolled_back_at', 'started_at', 'applied_steps_count'],
  AdminAuditLog: ['id', 'action', 'method', 'routeTemplate', 'targetType', 'targetId', 'actorDigest', 'clientDigest', 'statusCode', 'createdAt'],
  AuditLog: ['id', 'sessionId', 'type', 'payload', 'ts'],
  BenefitRule: ['id', 'businessId', 'label', 'category', 'productName', 'discountPercent', 'requiredLockIFR', 'ttlSeconds', 'active',
    'createdAt', 'updatedAt', 'productId', 'dailyRedemptionLimit', 'monthlyRedemptionLimit', 'minIFRHeld', 'lockSource'],
  Business: ['id', 'name', 'discountPercent', 'requiredLockIFR', 'ttlSeconds', 'tierLabel', 'active', 'createdAt', 'ownerAddress',
    'description', 'website', 'categoriesJson', 'serviceArea', 'serviceAreaKey', 'logoUrl', 'slug'],
  CheckoutOperator: ['id', 'businessId', 'walletAddress', 'label', 'active', 'expiresAt', 'createdAt', 'updatedAt'],
  CustomerPass: ['id', 'controlHash', 'status', 'expiresAt', 'boundAt', 'cancelledAt', 'createdAt', 'updatedAt'],
  Product: ['id', 'businessId', 'name', 'category', 'description', 'active', 'createdAt', 'updatedAt', 'basePriceMinor', 'currency'],
  RewardEvent: ['id', 'businessId', 'sessionId', 'partnerId', 'chainId', 'status', 'reason', 'txHash', 'createdAt', 'updatedAt'],
  SellerAuthorizationChallenge: ['nonce', 'action', 'businessId', 'scope', 'expiresAt', 'consumedAt', 'createdAt'],
  SellerRewardLink: ['id', 'businessId', 'status', 'partnerId', 'builderWallet', 'requestedAt', 'verifiedAt', 'lastCheckedAt',
    'verificationBlock', 'governanceReference', 'reason', 'createdAt', 'updatedAt', 'rewardWallet', 'rewardWalletConfirmedAt'],
  Session: ['id', 'businessId', 'benefitRuleId', 'benefitSnapshotVersion', 'benefitLabel', 'benefitCategory', 'benefitProductName',
    'benefitBasePriceMinor', 'benefitCurrency', 'benefitDiscountPercent', 'benefitRequiredLockIFR', 'benefitMinIFRHeld',
    'benefitLockSource', 'benefitTtlSeconds', 'benefitDailyRedemptionLimit', 'benefitMonthlyRedemptionLimit', 'nonce', 'expiresAt',
    'status', 'verifiedLockSource', 'selfRedemption', 'proofVersion', 'confirmedByWallet', 'confirmedByRole', 'confirmedByOperatorId',
    'reason', 'createdAt', 'updatedAt', 'redeemedAt', 'attestAttempts', 'customerPassId'],
};

// Columns holding JSON: walked recursively (string values and keys), never matched as raw text.
const JSON_COLUMNS = { AuditLog: ['payload'], Business: ['categoriesJson'] };

// FINAL allowlist (map, Update 2026-10-09). Seller identities written only after seller authorization.
const ALLOWED_COLUMNS = new Set([
  'Business.ownerAddress',
  'CheckoutOperator.walletAddress',
  'SellerRewardLink.builderWallet',
  'SellerRewardLink.rewardWallet',
  'Session.confirmedByWallet',
]);
// (AuditLog type -> JSON key paths). A path covers the value at that key, including a nested object
// written there (current writer: createdBy = { walletAddress, role, operatorId } of the seller creator).
const ALLOWED_AUDIT_PATHS = {
  REDEEMED: ['$.actorWallet'],
  REDEEM_DENIED_LIMIT: ['$.actorWallet'],
  SESSION_CREATED: ['$.walletAddress', '$.createdBy'],
};

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function redact(text) {
  return String(text).replace(/0x[0-9a-f]{40,}/gi, '0x<redacted>').replace(PADDED_ADDRESS_PATTERN, '<redacted>');
}

function countAddresses(text) {
  const value = String(text);
  return (value.match(ADDRESS_PATTERN) || []).length + (value.match(PADDED_ADDRESS_PATTERN) || []).length;
}

function sqliteJson(db, sql) {
  const out = execFileSync('sqlite3', ['-json', db, sql], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 }).trim();
  return out ? JSON.parse(out) : [];
}

function childPath(base, key) {
  if (typeof key === 'number') return `${base}[${key}]`;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`;
}

function pathAllowed(jsonPath, allowed) {
  return allowed.some((entry) => jsonPath === entry || jsonPath.startsWith(`${entry}.`) || jsonPath.startsWith(`${entry}[`));
}

/** Walks a parsed JSON value; calls onHit(path, count) for every address in a string value or key. */
function walkJson(value, jsonPath, onHit) {
  if (typeof value === 'string') {
    const count = countAddresses(value);
    if (count) onHit(jsonPath, count);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => walkJson(item, childPath(jsonPath, index), onHit));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const keyPath = childPath(jsonPath, key);
      const keyCount = countAddresses(key);
      if (keyCount) onHit(`${keyPath} (key)`, keyCount);
      walkJson(item, keyPath, onHit);
    }
  }
}

/**
 * Scans a SQLite database file. Returns { ok, failures: { location: count }, allowed: { location: count },
 * errors: [string] }. Locations and errors never contain an address value.
 */
function scanDatabaseForAddresses(db) {
  const failures = {};
  const allowed = {};
  const errors = [];
  const add = (bucket, location, count) => { bucket[location] = (bucket[location] || 0) + count; };

  const objects = sqliteJson(db, "SELECT type, name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name");
  for (const { type, name } of objects) {
    if (type !== 'table' || !Object.prototype.hasOwnProperty.call(KNOWN_COLUMNS, name)) {
      errors.push(`unknown ${type} ${redact(name)}`);
      continue;
    }
    const columns = sqliteJson(db, `SELECT name FROM pragma_table_info('${name.replace(/'/g, "''")}')`).map((row) => row.name);
    const known = new Set(KNOWN_COLUMNS[name]);
    const unknownColumns = columns.filter((column) => !known.has(column));
    if (unknownColumns.length) {
      unknownColumns.forEach((column) => errors.push(`unknown column ${name}.${redact(column)}`));
      continue;
    }
    const jsonColumns = new Set(JSON_COLUMNS[name] || []);
    const selected = columns.map((column) =>
      `CASE WHEN typeof(${quoteIdent(column)}) IN ('text', 'blob') THEN CAST(${quoteIdent(column)} AS TEXT) END AS ${quoteIdent(column)}`);
    const rows = sqliteJson(db, `SELECT ${selected.join(', ')} FROM ${quoteIdent(name)}`);
    for (const row of rows) {
      for (const column of columns) {
        const value = row[column];
        if (value === null || value === undefined) continue;
        const location = `${name}.${column}`;
        if (jsonColumns.has(column)) {
          let parsed;
          try {
            parsed = JSON.parse(value);
          } catch {
            add(failures, `${location} (invalid JSON)`, 1);
            continue;
          }
          const auditType = name === 'AuditLog' ? String(row.type ?? '') : null;
          const allowedPaths = auditType !== null ? (ALLOWED_AUDIT_PATHS[auditType] || []) : [];
          walkJson(parsed, '$', (jsonPath, count) => {
            const label = auditType !== null
              ? `${location} type=${redact(auditType)} ${redact(jsonPath)}`
              : `${location} ${redact(jsonPath)}`;
            add(pathAllowed(jsonPath, allowedPaths) ? allowed : failures, label, count);
          });
          continue;
        }
        const count = countAddresses(value);
        if (count) add(ALLOWED_COLUMNS.has(location) ? allowed : failures, location, count);
      }
    }
  }
  return { ok: errors.length === 0 && Object.keys(failures).length === 0, failures, allowed, errors };
}

function formatScan(result) {
  const lines = [];
  for (const error of result.errors) lines.push(`  ERROR ${error}`);
  for (const [location, count] of Object.entries(result.failures).sort()) lines.push(`  HIT   ${location}: ${count}`);
  for (const [location, count] of Object.entries(result.allowed).sort()) lines.push(`  ok    ${location}: ${count} (allowlisted)`);
  return lines.join('\n');
}

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
function buildPreMigrationDb(name, { obligationStatus = null, failureStage = false } = {}) {
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
      ('a4', 's-old', 'REDEEM_DENIED_LIMIT', '{"period":"daily","wallet":"${CUSTOMER}","used":3,"actorWallet":"${SELLER}"}', '${old}'),
      ('a5', 's-old', 'ATTEST_FAIL', '{"wallet":"${CUSTOMER.toLowerCase()}","locked":"1","held":"7","verificationBlock":9,"reason":"7 IFR held < 1000 IFR required","required":1000}', '${old}'),
      ('a6', 's-old', 'ATTEST_FAIL', '{"error":"On-chain error: call revert data=0x70a08231000000000000000000000000${CUSTOMER_BARE}"}', '${old}');
    UPDATE Session SET reason = '7 IFR held < 1000 IFR required for this wallet' WHERE id = 's-old';
    INSERT INTO SellerAuthorizationChallenge (nonce, walletAddress, action, businessId, scope, expiresAt, createdAt)
    VALUES ('${'c'.repeat(64)}', '${CUSTOMER}', 'business:list', 'seller', 'read', '2099-01-01T00:00:00.000Z', '${old}');
    INSERT INTO RewardEvent (id, businessId, sessionId, partnerId, customerWallet, lockAmountRaw, chainId, status, createdAt, updatedAt)
    VALUES ('r-closed', 'shop', 's-redeemed', '0x${'ab'.repeat(32)}', '${CUSTOMER}', '2500000000000000000000', 11155111, 'CONFIRMED', '${old}', '${old}');
    INSERT INTO CustomerPassChallenge (nonce, walletAddress, issuedAt, expiresAt, createdAt)
    VALUES ('c1', '${CUSTOMER}', '${old}', '${old}', '${old}');
    INSERT INTO CustomerHistoryChallenge (nonce, walletAddress, issuedAt, expiresAt, createdAt)
    VALUES ('h1', '${CUSTOMER}', '${old}', '${old}', '${old}');
    INSERT INTO CustomerHistoryAccess (tokenHash, walletAddress, expiresAt, createdAt)
    VALUES ('t1', '${CUSTOMER}', '2099-01-01T00:00:00.000Z', '${old}');
  `);
  if (obligationStatus) {
    // A non-terminal or unknown obligation from long before any 72h settlement lag: still refused.
    sqlite(db, `
      INSERT INTO RewardEvent (id, businessId, sessionId, partnerId, customerWallet, lockAmountRaw, chainId, status, createdAt, updatedAt)
      VALUES ('r-open', 'shop', 's-old', '0x${'ab'.repeat(32)}', '0x${'11'.repeat(20)}', '1', 11155111, '${obligationStatus}', '${old}', '${old}');
    `);
  }
  if (failureStage) {
    // Forces a failure late in the migration (table redefinition) after the guard, invalidation and
    // audit scrub statements have run: the whole migration must roll back.
    sqlite(db, 'CREATE TABLE "new_RewardEvent" ("blocker" TEXT);');
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

function runFixture() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'benefits-owner-b-'));
  try {
  // ── 1. Refusal: fail closed on anything but the explicit terminal allowlist (CONFIRMED) ──
  for (const status of ['SETTLEMENT_PENDING', 'PENDING', 'READY', 'BLOCKED_CALLER', 'BLOCKED_GOVERNANCE', 'UNEXPECTED_FUTURE_STATUS']) {
    const { db: refusedDb, workDir: refusedDir } = buildPreMigrationDb(`refused-${status.toLowerCase()}`, { obligationStatus: status });
    const before = dataDump(refusedDb);
    const refused = applyTarget(refusedDir);
    assert(refused.status !== 0, `Migration must refuse while a ${status} reward event exists`);
    assert(/non_terminal_reward_events_must_be_resolved_first/.test(refused.stdout + refused.stderr), `Unexpected refusal output: ${refused.stdout}${refused.stderr}`);
    assert(dataDump(refusedDb) === before, `Refused migration (${status}) must not change the database`);
    assert(sqlite(refusedDb, "SELECT status FROM RewardEvent WHERE id = 'r-open'") === status, 'Obligation must be kept');
  }

  // ── 1b. Atomic failure stage: a late failure leaves the database unchanged ──
  {
    const { db: failedDb, workDir: failedDir } = buildPreMigrationDb('failure-stage', { failureStage: true });
    const before = dataDump(failedDb);
    const failed = applyTarget(failedDir);
    assert(failed.status !== 0, 'Migration must fail when the table redefinition fails');
    assert(dataDump(failedDb) === before, 'A failure late in the migration must roll back every earlier statement');
  }

  // ── 2. Continuity ─────────────────────────────────────────────────────────
  const { db, workDir } = buildPreMigrationDb('migrated');
  const applied = applyTarget(workDir);
  assert(applied.status === 0, `Migration failed: ${applied.stdout}${applied.stderr}`);

  const counts = sqlite(db, `
    SELECT (SELECT COUNT(*) FROM Session) || '|' || (SELECT COUNT(*) FROM AuditLog) || '|' ||
           (SELECT COUNT(*) FROM RewardEvent) || '|' || (SELECT COUNT(*) FROM CustomerPass);
  `);
  assert(counts === '4|6|1|2', `Rows were not preserved: ${counts}`);
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

  const failPayload = JSON.parse(sqlite(db, "SELECT payload FROM AuditLog WHERE id = 'a5'"));
  assert(JSON.stringify(failPayload) === '{"required":1000}',
    `ATTEST_FAIL payload not scrubbed: keys=${Object.keys(failPayload).join(',')}`);
  assert(sqlite(db, "SELECT payload FROM AuditLog WHERE id = 'a6'") === '{}', 'ATTEST_FAIL error text must be removed');
  assert(!('used' in limitPayload), 'Per-customer counter must be removed');
  assert(sqlite(db, "SELECT reason FROM Session WHERE id = 's-old'") === 'Closed before the customer-privacy upgrade; details removed.',
    'Closed session reason must be neutralised');
  assert(sqlite(db, 'SELECT COUNT(*) FROM SellerAuthorizationChallenge') === '0', 'Existing seller challenges must be deleted');
  assert(sqlite(db, "SELECT COUNT(*) FROM pragma_table_info('SellerAuthorizationChallenge') WHERE name = 'walletAddress'") === '0',
    'SellerAuthorizationChallenge must not have a wallet column');

  const scan = scanDatabaseForAddresses(db);
  assert(scan.ok, `Generic address scan failed after migration:\n${formatScan(scan)}`);
  assert(scan.allowed['Business.ownerAddress'] === 1, 'Allowlisted seller owner address must be kept and not flagged');
  selfTestScanner(db);

  console.log('Owner-B migration verified: refusal (non-terminal and unknown statuses) and a late failure leave the DB unchanged; continuity keeps sessions, closed events and audit rows without customer data; generic address scan clean.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/** Negative cases on copies of the migrated DB: every one must make the scan fail closed. */
function selfTestScanner(migratedDb) {
  const cases = [
    ['unscrubbed ATTEST_FAIL wallet', `INSERT INTO AuditLog (id, sessionId, type, payload, ts) VALUES ('neg', 's-old', 'ATTEST_FAIL', '{"wallet":"${CUSTOMER}"}', '2025-01-01');`],
    // Open map item: the current pass-bind writer (sessionService createSessionSnapshot) stores the seller
    // creator at CUSTOMER_PASS_BOUND $.createdBy, which the FINAL allowlist does not list, so such rows fail
    // closed until the allowlist is extended by a reviewed map change.
    ['CUSTOMER_PASS_BOUND seller createdBy (not allowlisted)', `INSERT INTO AuditLog (id, sessionId, type, payload, ts) VALUES ('neg', 's-old', 'CUSTOMER_PASS_BOUND', '{"createdBy":{"walletAddress":"${SELLER}","role":"OWNER"}}', '2025-01-01');`],
    ['allowlisted key under another type', `INSERT INTO AuditLog (id, sessionId, type, payload, ts) VALUES ('neg', 's-old', 'ATTEST_OK', '{"actorWallet":"${SELLER}"}', '2025-01-01');`],
    ['escaped address in JSON', `INSERT INTO AuditLog (id, sessionId, type, payload, ts) VALUES ('neg', 's-old', 'EXPIRED', '{"reason":"\\u0030x${CUSTOMER_BARE.toUpperCase()}"}', '2025-01-01');`],
    ['address as JSON key', `INSERT INTO AuditLog (id, sessionId, type, payload, ts) VALUES ('neg', 's-old', 'EXPIRED', '{"${CUSTOMER}":1}', '2025-01-01');`],
    ['invalid JSON payload', `INSERT INTO AuditLog (id, sessionId, type, payload, ts) VALUES ('neg', 's-old', 'EXPIRED', 'not json', '2025-01-01');`],
    ['address in Session.reason', `UPDATE Session SET reason = 'denied for ${CUSTOMER}' WHERE id = 's-old';`],
    ['address in challenge scope', `INSERT INTO SellerAuthorizationChallenge (nonce, action, businessId, scope, expiresAt) VALUES ('n', 'x', 'y', '${CUSTOMER.toLowerCase()}', '2099-01-01');`],
    ['padded address in RewardEvent.reason', `UPDATE RewardEvent SET reason = 'call 0x70a08231000000000000000000000000${CUSTOMER_BARE}' WHERE id = 'r-closed';`],
    ['unknown table', 'CREATE TABLE "Shadow" ("note" TEXT);'],
    ['unknown column', 'ALTER TABLE "Session" ADD COLUMN "recoveredAddress" TEXT;'],
  ];
  for (const [name, sql] of cases) {
    const copy = path.join(tempDir, `neg-${cases.findIndex((entry) => entry[0] === name)}.db`);
    fs.copyFileSync(migratedDb, copy);
    sqlite(copy, sql);
    const result = scanDatabaseForAddresses(copy);
    assert(!result.ok, `Scanner must fail closed on: ${name}`);
    assert(!formatScan(result).toLowerCase().includes(CUSTOMER_BARE), `Scanner output must not disclose the address (${name})`);
  }
}

module.exports = { scanDatabaseForAddresses, formatScan, ALLOWED_COLUMNS, ALLOWED_AUDIT_PATHS };

if (require.main === module) {
  const scanIndex = process.argv.indexOf('--scan');
  if (scanIndex !== -1) {
    // Read-only scan of a given SQLite file (rehearsal copy). Prints counts per location only.
    const db = process.argv[scanIndex + 1];
    if (!db || !fs.existsSync(db)) {
      console.error('Usage: node scripts/verify-owner-b-migration.cjs --scan <sqlite-file>');
      process.exit(2);
    }
    const result = scanDatabaseForAddresses(db);
    console.log(`Owner-B address scan: ${result.ok ? 'PASS' : 'FAIL'}\n${formatScan(result)}`);
    process.exit(result.ok ? 0 : 1);
  }
  runFixture();
}
