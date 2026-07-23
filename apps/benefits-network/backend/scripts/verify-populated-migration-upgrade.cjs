const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const migrationsDir = path.join(root, 'prisma', 'migrations');
const targetMigration = '20260723222000_add_min_ifr_held';
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

  console.log('Populated Benefits migration upgrade fixture passed');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
