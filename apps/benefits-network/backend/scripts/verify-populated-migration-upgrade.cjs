const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanDatabaseForAddresses, formatScan } = require('./verify-owner-b-migration.cjs');

const root = path.resolve(__dirname, '..');
const ownerBMigration = '20261006120000_owner_b_customer_session_privacy';
const migrationsDir = path.join(root, 'prisma', 'migrations');
const targetMigration = '20260726000100_add_admin_audit_log';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'benefits-populated-upgrade-'));
const dbPath = path.join(tempDir, 'upgrade.db');

function sqlite(sql) {
  return execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf8' }).trim();
}

try {
  const migrations = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const targetIndex = migrations.indexOf(targetMigration);
  if (targetIndex < 1) {
    throw new Error(`Expected migration ${targetMigration} after at least one existing migration`);
  }

  for (const migration of migrations.slice(0, targetIndex)) {
    sqlite(`.read ${path.join(migrationsDir, migration, 'migration.sql')}`);
  }

  sqlite(`
    INSERT INTO Business (
      id, name, discountPercent, requiredLockIFR, ttlSeconds, active, createdAt, ownerAddress
    ) VALUES (
      'migration-fixture', 'Existing Shop', 10, 1000, 300, 1, CURRENT_TIMESTAMP,
      '0x4f632748460E5277bF8435259cADce440AbAC254'
    );
    INSERT INTO BenefitRule (
      id, businessId, label, category, productName, discountPercent, requiredLockIFR,
      ttlSeconds, active, createdAt, updatedAt
    ) VALUES (
      'existing-rule', 'migration-fixture', 'Existing benefit', 'Coffee', 'Legacy espresso',
      10, 1000, 90, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
    INSERT INTO Product (
      id, businessId, name, category, active, createdAt, updatedAt
    ) VALUES (
      'upgrade-product', 'migration-fixture', 'Upgrade espresso', 'Coffee', 1,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
    UPDATE BenefitRule SET productId = 'upgrade-product' WHERE id = 'existing-rule';
    INSERT INTO Session (
      id, businessId, benefitRuleId, nonce, expiresAt, status, createdAt, updatedAt, attestAttempts
    ) VALUES (
      'existing-session', 'migration-fixture', 'existing-rule', 'existing-nonce',
      '2099-01-01T00:00:00.000Z', 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0
    );
    INSERT INTO AuditLog (id, sessionId, type, payload, ts) VALUES (
      'existing-audit', 'existing-session', 'CREATED', '{}', CURRENT_TIMESTAMP
    );
  `);

  sqlite(`.read ${path.join(migrationsDir, targetMigration, 'migration.sql')}`);

  const adminAuditTable = sqlite(`
    SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'table' AND name = 'AdminAuditLog';
  `);
  const adminAuditIndexes = sqlite(`
    SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'index' AND name IN (
      'AdminAuditLog_createdAt_idx',
      'AdminAuditLog_targetType_targetId_idx',
      'AdminAuditLog_action_createdAt_idx'
    );
  `);
  if (adminAuditTable !== '1' || adminAuditIndexes !== '3') {
    throw new Error(
      `Missing admin audit migration state: table=${adminAuditTable}, indexes=${adminAuditIndexes}`
    );
  }

  const preservedRows = sqlite(`
    SELECT
      (SELECT COUNT(*) FROM Business WHERE id = 'migration-fixture') || '|' ||
      (SELECT COUNT(*) FROM BenefitRule WHERE id = 'existing-rule') || '|' ||
      (SELECT COUNT(*) FROM Session WHERE id = 'existing-session') || '|' ||
      (SELECT COUNT(*) FROM AuditLog WHERE id = 'existing-audit');
  `);
  if (preservedRows !== '1|1|1|1') {
    throw new Error(`Existing rows were not preserved: ${preservedRows}`);
  }

  const tables = sqlite(`
    SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'table' AND name IN ('CheckoutOperator', 'Product', 'SellerRewardLink', 'RewardEvent');
  `);
  if (tables !== '4') throw new Error(`Expected CheckoutOperator, Product and reward tables, got ${tables}`);

  const productIdColumn = sqlite("SELECT COUNT(*) FROM pragma_table_info('BenefitRule') WHERE name='productId';");
  const snapshotColumns = sqlite(`
    SELECT COUNT(*) FROM pragma_table_info('Session')
    WHERE name IN (
      'benefitSnapshotVersion', 'benefitLabel', 'benefitCategory', 'benefitProductName',
      'benefitDiscountPercent', 'benefitRequiredLockIFR', 'benefitTtlSeconds',
      'benefitDailyRedemptionLimit', 'benefitMonthlyRedemptionLimit'
    );
  `);
  const ruleLimitColumns = sqlite(`
    SELECT COUNT(*) FROM pragma_table_info('BenefitRule')
    WHERE name IN ('dailyRedemptionLimit', 'monthlyRedemptionLimit');
  `);
  const existingRuleLimits = sqlite(`
    SELECT dailyRedemptionLimit || '|' || monthlyRedemptionLimit
    FROM BenefitRule WHERE id = 'existing-rule';
  `);
  if (productIdColumn !== '1' || snapshotColumns !== '9' || ruleLimitColumns !== '2' || existingRuleLimits !== '0|0') {
    throw new Error(
      `Missing catalog/cap snapshot state: productId=${productIdColumn}, snapshots=${snapshotColumns}, ` +
      `ruleLimits=${ruleLimitColumns}, existingLimits=${existingRuleLimits}`
    );
  }

  const businessProfileColumns = sqlite(`
    SELECT COUNT(*) FROM pragma_table_info('Business')
    WHERE name IN ('description', 'website', 'categoriesJson');
  `);
  const existingBusinessProfile = sqlite(`
    SELECT
      (description IS NULL) || '|' ||
      (website IS NULL) || '|' ||
      categoriesJson
    FROM Business WHERE id = 'migration-fixture';
  `);
  if (businessProfileColumns !== '3' || existingBusinessProfile !== '1|1|[]') {
    throw new Error(
      `Missing seller profile migration state: columns=${businessProfileColumns}, ` +
      `existingProfile=${existingBusinessProfile}`
    );
  }

  const customerHistoryTables = sqlite(`
    SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'table' AND name IN ('CustomerHistoryChallenge', 'CustomerHistoryAccess');
  `);
  const customerHistoryIndex = sqlite(`
    SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'index' AND name = 'Session_customerHistory_idx';
  `);
  if (customerHistoryTables !== '2' || customerHistoryIndex !== '1') {
    throw new Error(
      `Missing customer history auth state: tables=${customerHistoryTables}, index=${customerHistoryIndex}`
    );
  }

  const serviceAreaColumns = sqlite(`
    SELECT COUNT(*) FROM pragma_table_info('Business')
    WHERE name IN ('serviceArea', 'serviceAreaKey');
  `);
  const serviceAreaIndex = sqlite(`
    SELECT group_concat(name, '|') FROM pragma_index_info('Business_active_serviceAreaKey_idx')
    ORDER BY seqno;
  `);
  const existingServiceArea = sqlite(`
    SELECT
      (serviceArea IS NULL) || '|' ||
      (serviceAreaKey IS NULL)
    FROM Business WHERE id = 'migration-fixture';
  `);
  if (serviceAreaColumns !== '2' || serviceAreaIndex !== 'active|serviceAreaKey' || existingServiceArea !== '1|1') {
    throw new Error(
      `Missing service area migration state: columns=${serviceAreaColumns}, ` +
      `index=${serviceAreaIndex}, existing=${existingServiceArea}`
    );
  }

  const passTables = sqlite(`
    SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'table' AND name IN ('CustomerPass', 'CustomerPassChallenge');
  `);
  const passSessionColumn = sqlite("SELECT COUNT(*) FROM pragma_table_info('Session') WHERE name='customerPassId';");
  const passIndexes = sqlite(`
    SELECT COUNT(*) FROM sqlite_master
    WHERE type = 'index' AND name IN (
      'CustomerPass_status_expiresAt_idx',
      'CustomerPass_walletAddress_createdAt_idx',
      'Session_customerPassId_key'
    );
  `);
  if (passTables !== '2' || passSessionColumn !== '1' || passIndexes !== '3') {
    throw new Error(
      `Missing customer pass migration state: tables=${passTables}, ` +
      `sessionColumn=${passSessionColumn}, indexes=${passIndexes}`
    );
  }

  const businessLogoColumn = sqlite("SELECT COUNT(*) FROM pragma_table_info('Business') WHERE name='logoUrl';");
  const existingBusinessLogo = sqlite(`
    SELECT logoUrl IS NULL FROM Business WHERE id = 'migration-fixture';
  `);
  if (businessLogoColumn !== '1' || existingBusinessLogo !== '1') {
    throw new Error(
      `Missing seller logo migration state: column=${businessLogoColumn}, existing=${existingBusinessLogo}`
    );
  }

  const productPriceColumns = sqlite(`
    SELECT COUNT(*) FROM pragma_table_info('Product')
    WHERE name IN ('basePriceMinor', 'currency');
  `);
  const sessionPriceColumns = sqlite(`
    SELECT COUNT(*) FROM pragma_table_info('Session')
    WHERE name IN ('benefitBasePriceMinor', 'benefitCurrency');
  `);
  const existingPriceState = sqlite(`
    SELECT
      (basePriceMinor IS NULL) || '|' ||
      (currency IS NULL)
    FROM Product WHERE id = 'upgrade-product';
  `);
  if (productPriceColumns !== '2' || sessionPriceColumns !== '2' || existingPriceState !== '1|1') {
    throw new Error(
      `Missing product price migration state: productColumns=${productPriceColumns}, ` +
      `sessionColumns=${sessionPriceColumns}, existing=${existingPriceState}`
    );
  }

  const heldRuleColumn = sqlite("SELECT COUNT(*) FROM pragma_table_info('BenefitRule') WHERE name='minIFRHeld';");
  const heldSessionColumns = sqlite(`
    SELECT COUNT(*) FROM pragma_table_info('Session')
    WHERE name IN ('benefitMinIFRHeld', 'walletBalanceRaw');
  `);
  const existingHeldState = sqlite(`
    SELECT minIFRHeld FROM BenefitRule WHERE id = 'existing-rule';
  `);
  if (heldRuleColumn !== '1' || heldSessionColumns !== '2' || existingHeldState !== '0') {
    throw new Error(
      `Missing held-IFR migration state: ruleColumn=${heldRuleColumn}, ` +
      `sessionColumns=${heldSessionColumns}, existing=${existingHeldState}`
    );
  }

  const lockSourceRuleColumn = sqlite(
    "SELECT COUNT(*) FROM pragma_table_info('BenefitRule') WHERE name='lockSource';"
  );
  const lockSourceSessionColumns = sqlite(`
    SELECT COUNT(*) FROM pragma_table_info('Session')
    WHERE name IN ('benefitLockSource', 'verifiedLockSource', 'verificationBlock');
  `);
  const existingLockSourceState = sqlite(`
    SELECT
      lockSource || '|' ||
      (SELECT benefitLockSource IS NULL FROM Session WHERE id = 'existing-session') || '|' ||
      (SELECT verifiedLockSource IS NULL FROM Session WHERE id = 'existing-session') || '|' ||
      (SELECT verificationBlock IS NULL FROM Session WHERE id = 'existing-session')
    FROM BenefitRule WHERE id = 'existing-rule';
  `);
  if (
    lockSourceRuleColumn !== '1' ||
    lockSourceSessionColumns !== '3' ||
    existingLockSourceState !== 'ifrlock|1|1|1'
  ) {
    throw new Error(
      `Missing lock-source migration state: ruleColumn=${lockSourceRuleColumn}, ` +
      `sessionColumns=${lockSourceSessionColumns}, existing=${existingLockSourceState}`
    );
  }

  const businessSlugColumn = sqlite(
    "SELECT COUNT(*) FROM pragma_table_info('Business') WHERE name='slug';"
  );
  const businessSlugIndex = sqlite(`
    SELECT COUNT(*) FROM sqlite_master
    WHERE type='index' AND name='Business_slug_key';
  `);
  const existingBusinessSlug = sqlite(`
    SELECT slug IS NULL FROM Business WHERE id='migration-fixture';
  `);
  if (
    businessSlugColumn !== '1' ||
    businessSlugIndex !== '1' ||
    existingBusinessSlug !== '1'
  ) {
    throw new Error(
      `Missing stable seller slug migration state: column=${businessSlugColumn}, ` +
      `index=${businessSlugIndex}, existing=${existingBusinessSlug}`
    );
  }

  sqlite(`
    INSERT INTO SellerRewardLink (
      id, businessId, status, builderWallet, requestedAt, createdAt, updatedAt
    ) VALUES (
      'upgrade-reward-link', 'migration-fixture', 'APPLIED',
      '0x4f632748460E5277bF8435259cADce440AbAC254', CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
  `);
  const foreignKeyErrors = sqlite('PRAGMA foreign_key_check;');
  if (foreignKeyErrors) throw new Error(`Foreign-key errors after migration:\n${foreignKeyErrors}`);

  // ── Owner-B upgrade of the populated database with legacy customer data ──────────────
  // Applies every later migration up to (excluding) owner B, inserts the legacy row shapes that
  // historic writers produced, applies owner B, VACUUMs, and proves with the generic scan that no
  // non-allowlisted address remains anywhere while allowlisted seller identities stay.
  const SELLER = '0x4f632748460E5277bF8435259cADce440AbAC254';
  const OPERATOR = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';
  const REWARD = '0x976EA74026E726554dB657fA54763abd0C3a0aa9';
  const CUSTOMERS = {
    mixed: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
    upper: '0xABCDEF0123456789ABCDEF0123456789ABCDEF01',
    lower: '0x1234567890abcdef1234567890abcdef12345678',
    calldata: '0x00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee',
    reason: '0x0BADC0DE0badc0de0BADC0DE0badc0de0BADC0DE',
  };
  const ownerBIndex = migrations.indexOf(ownerBMigration);
  if (ownerBIndex <= targetIndex) throw new Error(`Expected ${ownerBMigration} after ${targetMigration}`);
  for (const migration of migrations.slice(targetIndex + 1, ownerBIndex)) {
    sqlite(`.read ${path.join(migrationsDir, migration, 'migration.sql')}`);
  }
  const bare = (address) => address.slice(2);
  const calldata = `0x70a08231000000000000000000000000${bare(CUSTOMERS.calldata).toLowerCase()}`;
  sqlite(`
    -- A bytes32 partner id and governance tx hash are not addresses and must not be flagged.
    UPDATE SellerRewardLink SET rewardWallet = '${REWARD}', partnerId = '0x${'7e3a'.repeat(16)}',
      governanceReference = '0x${'c0de'.repeat(16)}' WHERE id = 'upgrade-reward-link';
    INSERT INTO CheckoutOperator (id, businessId, walletAddress, label, active, createdAt, updatedAt)
    VALUES ('legacy-operator', 'migration-fixture', '${OPERATOR}', 'Till 1', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    INSERT INTO Session (id, businessId, nonce, expiresAt, status, reason, recoveredAddress, lockAmountRaw, walletBalanceRaw,
                         verificationBlock, createdAt, updatedAt, redeemedAt, attestAttempts)
    VALUES
      ('legacy-rejected', 'migration-fixture', 'legacy-n1', '2025-01-01T00:00:00.000Z', 'REJECTED',
       '7 IFR held < 1000 IFR required', '${CUSTOMERS.mixed}', '0', '7', 11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, 1),
      ('legacy-expired', 'migration-fixture', 'legacy-n2', '2025-01-01T00:00:00.000Z', 'EXPIRED',
       'Daily redemption limit reached for this wallet', NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, 0),
      ('legacy-redeemed', 'migration-fixture', 'legacy-n3', '2025-01-01T00:00:00.000Z', 'REDEEMED',
       'Insufficient wallet balance: 5 IFR for ${CUSTOMERS.reason}', '${CUSTOMERS.upper}', '2500.0', '5', 12,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1),
      ('legacy-approved', 'migration-fixture', 'legacy-n4', '2099-01-01T00:00:00.000Z', 'APPROVED',
       'Monthly limit for this wallet: 2 of 3 used', '${CUSTOMERS.lower}', '2500.0', '10', 13,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL, 1);
    INSERT INTO AuditLog (id, sessionId, type, payload, ts) VALUES
      ('legacy-fail-wallet', 'legacy-rejected', 'ATTEST_FAIL',
       '{"wallet":"${CUSTOMERS.mixed}","locked":"0","held":"7","verificationBlock":11,"required":1000,"reason":"7 IFR held < 1000 IFR required","attempts":1}', CURRENT_TIMESTAMP),
      ('legacy-fail-rpc', 'legacy-rejected', 'ATTEST_FAIL',
       '{"reason":"On-chain error: execution reverted (data=\\"${calldata}\\")","error":"eth_call failed for ${CUSTOMERS.calldata.toUpperCase().replace('0X', '0x')}"}', CURRENT_TIMESTAMP),
      ('legacy-ok', 'legacy-redeemed', 'ATTEST_OK',
       '{"wallet":"${CUSTOMERS.upper}","locked":"2500.0","held":"5","verificationBlock":12,"lockSource":"ifrlock"}', CURRENT_TIMESTAMP),
      ('legacy-ok-self', 'legacy-redeemed', 'ATTEST_OK',
       '{"wallet":"${SELLER.toLowerCase()}","selfRedemption":true}', CURRENT_TIMESTAMP),
      ('legacy-limit', 'legacy-expired', 'REDEEM_DENIED_LIMIT',
       '{"wallet":"${CUSTOMERS.lower}","used":3,"limit":3,"period":"monthly","actorRole":"OPERATOR","actorWallet":"${OPERATOR}"}', CURRENT_TIMESTAMP),
      ('legacy-redeemed-audit', 'legacy-redeemed', 'REDEEMED',
       '{"actorRole":"OWNER","actorWallet":"${SELLER}","operatorId":null}', CURRENT_TIMESTAMP),
      ('legacy-created-original', 'legacy-redeemed', 'SESSION_CREATED',
       '{"businessId":"migration-fixture","nonce":"legacy-n3"}', CURRENT_TIMESTAMP),
      ('legacy-pass-bound', 'legacy-redeemed', 'CUSTOMER_PASS_BOUND',
       '{"businessId":"migration-fixture","customerPassId":"p1","createdBy":{"walletAddress":"${SELLER}","role":"OWNER","operatorId":null}}', CURRENT_TIMESTAMP),
      ('legacy-created-object', 'legacy-expired', 'SESSION_CREATED',
       '{"businessId":"migration-fixture","createdBy":{"walletAddress":"${OPERATOR}","role":"OPERATOR","operatorId":"legacy-operator"}}', CURRENT_TIMESTAMP),
      ('legacy-expired-audit', 'legacy-expired', 'EXPIRED', '{"reason":"TTL expired before attestation"}', CURRENT_TIMESTAMP);
    INSERT INTO SellerAuthorizationChallenge (nonce, walletAddress, action, businessId, scope, expiresAt)
    VALUES ('${'d'.repeat(64)}', '${CUSTOMERS.mixed}', 'business:list', 'seller', 'read', '2099-01-01T00:00:00.000Z'),
           ('${'e'.repeat(64)}', '${SELLER}', 'rules:create', 'migration-fixture', 'migration-fixture', '2099-01-01T00:00:00.000Z');
  `);
  const preDump = sqlite('.dump').toLowerCase();
  for (const [name, address] of Object.entries(CUSTOMERS)) {
    if (!preDump.includes(bare(address).toLowerCase())) throw new Error(`Fixture must contain the ${name} customer address`);
  }

  sqlite(`.read ${path.join(migrationsDir, ownerBMigration, 'migration.sql')}`);
  sqlite('VACUUM;');

  const scan = scanDatabaseForAddresses(dbPath);
  if (!scan.ok) throw new Error(`Generic address scan failed after owner-B migration:\n${formatScan(scan)}`);
  const expectedAllowed = [
    'Business.ownerAddress',
    'CheckoutOperator.walletAddress',
    'SellerRewardLink.builderWallet',
    'SellerRewardLink.rewardWallet',
    'AuditLog.payload type=REDEEMED $.actorWallet',
    'AuditLog.payload type=REDEEM_DENIED_LIMIT $.actorWallet',
    'AuditLog.payload type=SESSION_CREATED $.createdBy.walletAddress',
    'AuditLog.payload type=CUSTOMER_PASS_BOUND $.createdBy.walletAddress',
  ];
  for (const location of expectedAllowed) {
    if (!scan.allowed[location]) throw new Error(`Allowlisted seller identity missing after migration: ${location}`);
  }

  const postDump = sqlite('.dump').toLowerCase();
  const fileBytes = fs.readFileSync(dbPath).toString('latin1').toLowerCase();
  for (const [name, address] of Object.entries(CUSTOMERS)) {
    if (postDump.includes(bare(address).toLowerCase())) throw new Error(`Customer address (${name}) remains in the dump`);
    if (fileBytes.includes(bare(address).toLowerCase())) throw new Error(`Customer address (${name}) remains in the file after VACUUM`);
  }
  for (const address of [SELLER, OPERATOR, REWARD]) {
    if (!postDump.includes(bare(address).toLowerCase())) throw new Error('Allowlisted seller identity was removed');
  }
  const neutral = 'Closed before the customer-privacy upgrade; details removed.';
  const reasons = sqlite(`
    SELECT group_concat(id || '=' || status || '=' || reason, '|') FROM (
      SELECT id, status, reason FROM Session WHERE id LIKE 'legacy-%' OR id = 'existing-session' ORDER BY id)
  `);
  const cutover = 'Checkout closed by the customer-privacy upgrade; start a new checkout.';
  const expectedReasons = [
    `existing-session=EXPIRED=${cutover}`,
    `legacy-approved=EXPIRED=${cutover}`,
    `legacy-expired=EXPIRED=${neutral}`,
    `legacy-redeemed=REDEEMED=${neutral}`,
    `legacy-rejected=REJECTED=${neutral}`,
  ].join('|');
  if (reasons !== expectedReasons) throw new Error(`Unexpected session reasons after migration: ${reasons}`);
  const failPayloads = sqlite("SELECT group_concat(payload, '|') FROM (SELECT payload FROM AuditLog WHERE type = 'ATTEST_FAIL' ORDER BY id)");
  if (failPayloads !== '{}|{"required":1000,"attempts":1}') throw new Error('ATTEST_FAIL payloads were not scrubbed to neutral keys');
  const limitPayload = JSON.parse(sqlite("SELECT payload FROM AuditLog WHERE id = 'legacy-limit'"));
  if ('wallet' in limitPayload || 'used' in limitPayload || limitPayload.actorWallet !== OPERATOR || limitPayload.limit !== 3) {
    throw new Error('REDEEM_DENIED_LIMIT must lose only the customer keys');
  }
  const selfPayload = JSON.parse(sqlite("SELECT payload FROM AuditLog WHERE id = 'legacy-ok-self'"));
  if ('wallet' in selfPayload || selfPayload.selfRedemption !== true) throw new Error('ATTEST_OK wallet equal to a seller must still be removed');
  const challenge = sqlite(`
    SELECT (SELECT COUNT(*) FROM SellerAuthorizationChallenge) || '|' ||
           (SELECT COUNT(*) FROM pragma_table_info('SellerAuthorizationChallenge') WHERE name = 'walletAddress') || '|' ||
           (SELECT group_concat(name, ',') FROM (SELECT name FROM pragma_index_list('SellerAuthorizationChallenge') WHERE origin = 'c' ORDER BY name))
  `);
  if (challenge !== '0|0|SellerAuthorizationChallenge_action_businessId_idx,SellerAuthorizationChallenge_expiresAt_idx') {
    throw new Error(`SellerAuthorizationChallenge must be nonce-only and emptied: ${challenge}`);
  }
  const ownerBForeignKeyErrors = sqlite('PRAGMA foreign_key_check;');
  if (ownerBForeignKeyErrors) throw new Error(`Foreign-key errors after owner-B migration:\n${ownerBForeignKeyErrors}`);

  // Mutation guard: an unscrubbed legacy ATTEST_FAIL wallet re-inserted after the migration must fail the scan.
  sqlite(`INSERT INTO AuditLog (id, sessionId, type, payload, ts) VALUES
    ('mutation', 'legacy-rejected', 'ATTEST_FAIL', '{"wallet":"${CUSTOMERS.mixed}"}', CURRENT_TIMESTAMP);`);
  const mutated = scanDatabaseForAddresses(dbPath);
  if (mutated.ok || mutated.failures['AuditLog.payload type=ATTEST_FAIL $.wallet'] !== 1) {
    throw new Error('Generic scan must flag an unscrubbed ATTEST_FAIL wallet');
  }

  console.log('Populated Benefits migration upgrade fixture passed (incl. owner-B legacy scrub and generic address scan)');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
