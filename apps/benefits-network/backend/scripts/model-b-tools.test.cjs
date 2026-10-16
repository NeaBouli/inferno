const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const { ethers } = require('ethers');
const { checksum, computeMilestoneId, parseSettlementPeriod } = require('./model-b-common.cjs');
const { aggregateExport } = require('./model-b-export.cjs');
const { prepareProposal, reserveProposal } = require('./model-b-proposal.cjs');

const partnerId = `0x${'ab'.repeat(32)}`;
const vault = `0x${'11'.repeat(20)}`;
const seller = `0x${'33'.repeat(20)}`;
const governance = `0x${'22'.repeat(20)}`;
const now = new Date('2026-10-17T12:00:00Z');
const clone = (value) => JSON.parse(JSON.stringify(value));

function report(period = '2026-08', eligibleCount = 4) {
  const value = {
    kind: 'ifr-model-b-period-aggregates', schemaVersion: 1, policyVersion: 'owner-2026-10-17',
    chainId: 11155111, partnerVault: vault, period, eurMinorPerRedemption: '50',
    partners: [{ partnerId, backendRedemptions: eligibleCount, sellerConfirmedRedemptions: eligibleCount,
      eligibleCount, excludedCount: 0, reconciliationStatus: 'RECONCILED', discrepancies: [], blockers: [],
      reconciliationDigest: `0x${'aa'.repeat(32)}` }],
  };
  return { ...value, reconciliationChecksum: checksum(value) };
}
function snapshot(period = '2026-08', overrides = {}) {
  return {
    chainId: 11155111, partnerVault: vault, governance, partnerId,
    blockNumber: 100, blockHash: `0x${'cc'.repeat(32)}`,
    milestoneId: computeMilestoneId(11155111, vault, partnerId, parseSettlementPeriod(period)),
    active: true, milestonesFinal: false, paused: false, milestoneDone: false,
    recordedMilestoneIds: [],
    maxAllocationBaseUnits: '10000000000000000000000', unlockedTotalBaseUnits: '0', rewardAccruedBaseUnits: '0',
    ...overrides,
  };
}

test('export CLI reads an actual migrated SQLite DB without changing it and feeds the proposal CLI', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-b-cli-'));
  const dbFile = path.join(dir, 'fixture.db');
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } } });
  try {
    const migrations = path.join(__dirname, '../prisma/migrations');
    for (const migration of fs.readdirSync(migrations).sort()) {
      const sql = path.join(migrations, migration, 'migration.sql');
      if (!fs.existsSync(sql)) continue;
      const applied = spawnSync('sqlite3', [dbFile], { input: fs.readFileSync(sql), encoding: 'utf8' });
      assert.equal(applied.status, 0, applied.stderr);
    }
    await db.business.create({ data: { id: 'shop', name: 'Synthetic pilot', ownerAddress: seller, discountPercent: 10, requiredLockIFR: 1000 } });
    await db.sellerRewardLink.create({ data: { businessId: 'shop', status: 'VERIFIED', partnerId } });
    await db.session.create({ data: { id: 'private-session', businessId: 'shop', nonce: 'fixture',
      status: 'REDEEMED', redeemedAt: new Date('2026-08-20Z'), expiresAt: new Date('2026-08-20Z'),
      proofVersion: 2, benefitSnapshotVersion: 5, selfRedemption: false } });
    await db.auditLog.create({ data: { sessionId: 'private-session', type: 'REDEEMED',
      payload: JSON.stringify({ actorRole: 'OWNER', actorWallet: seller }) } });
    await db.rewardEvent.create({ data: { businessId: 'shop', sessionId: 'private-session', partnerId,
      chainId: 11155111, status: 'SETTLEMENT_PENDING', rewardPeriod: '2026-08', rewardDedupKey: `${'q'.repeat(22)}.${'r'.repeat(43)}` } });
    await db.$disconnect();
    const hash = () => crypto.createHash('sha256').update(fs.readFileSync(dbFile)).digest('hex');
    const before = hash();
    const countsFile = path.join(dir, 'counts.json');
    fs.writeFileSync(countsFile, JSON.stringify({ [partnerId]: 1 }));
    const env = { ...process.env, DATABASE_URL: `file:${dbFile}`, CHAIN_ID: '11155111',
      RPC_URL: 'https://rpc.example.test', IFR_TOKEN_ADDRESS: `0x${'55'.repeat(20)}`,
      IFRLOCK_ADDRESS: `0x${'66'.repeat(20)}`, COMMITMENT_VAULT_ADDRESS: `0x${'77'.repeat(20)}`,
      PARTNER_VAULT_ADDRESS: vault, ADMIN_SECRET: 'synthetic-test-secret-0123456789abcdef0123456789',
      REWARD_CALLER_ADDRESS: '', MODEL_B_SETTLEMENT_ENABLED: 'true',
      MODEL_B_PILOT_POLICY_JSON: JSON.stringify({ policyVersion: 'owner-2026-10-17',
        globalPilotBudgetBaseUnits: '10000000000000', twapPair: seller, pilots: [{ partnerId, businessId: 'shop',
          startsAt: '2026-08-01T00:00:00Z', eurMinorPerRedemption: '50', partnerBudgetBaseUnits: '10000000000000', governanceReference: 'synthetic' }] }) };
    const exported = spawnSync(process.execPath, [path.join(__dirname, 'model-b-export.cjs'), '--period', '2026-08', '--seller-counts', countsFile], { env, encoding: 'utf8' });
    assert.equal(exported.status, 0, exported.stderr);
    assert.equal(hash(), before);
    const data = JSON.parse(exported.stdout);
    assert.equal(data.partners[0].eligibleCount, 1);
    assert.deepEqual(data.partners[0].blockers, []);
    assert.ok(!exported.stdout.includes(seller));
    assert.ok(!exported.stdout.includes('private-session'));
    const exportFile = path.join(dir, 'export.json'); const snapshotFile = path.join(dir, 'snapshot.json');
    fs.writeFileSync(exportFile, exported.stdout); fs.writeFileSync(snapshotFile, JSON.stringify(snapshot()));
    const proposed = spawnSync(process.execPath, [path.join(__dirname, 'model-b-proposal.cjs'), '--export', exportFile,
      '--vault-state', snapshotFile, '--state', path.join(dir, 'ledger.json'), '--price-eur-per-ifr', '0.003'], { encoding: 'utf8' });
    assert.equal(proposed.status, 0, proposed.stderr);
    assert.equal(JSON.parse(proposed.stdout).meta.unlockAmount, '166666666666');
  } finally { await db.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('aggregate export is deterministic, reconciles seller totals and contains no private identifiers', async () => {
  const sessionId = 'private-session';
  const eventId = 'private-event';
  const session = { id: sessionId, businessId: 'shop', status: 'REDEEMED', redeemedAt: new Date('2026-08-20Z'), selfRedemption: false };
  const db = {
    business: { findUnique: async () => ({ active: true, ownerAddress: seller, checkoutOperators: [],
      rewardLink: { status: 'VERIFIED', partnerId, rewardWallet: null, builderWallet: seller } }) },
    session: { findMany: async () => [session] },
    rewardEvent: { findMany: async (query) => query.where.createdAt ? [] :
      [{ id: eventId, businessId: 'shop', partnerId, status: 'SETTLEMENT_PENDING', session }] },
    auditLog: { findMany: async () => [{ sessionId, payload: JSON.stringify({ actorWallet: seller, actorRole: 'OWNER' }) }] },
  };
  const input = { db, policy: { policyVersion: 'owner-2026-10-17', globalPilotBudgetBaseUnits: '1000000000000',
    reviewedPriceSourceIds: [], pilots: [{ partnerId, businessId: 'shop', startsAt: '2026-08-01Z',
      eurMinorPerRedemption: '50', partnerBudgetBaseUnits: '1000000000000' }] },
  period: '2026-08', chainId: 11155111, partnerVault: vault, ifrToken: seller,
  sellerCounts: { [partnerId]: 1 }, now };
  const first = await aggregateExport(input);
  assert.deepEqual(await aggregateExport(input), first);
  assert.equal(first.reconciliationChecksum, checksum(first));
  assert.equal(first.partners[0].backendRedemptions, 1);
  assert.equal(first.partners[0].reconciliationStatus, 'RECONCILED');
  for (const privateValue of [sessionId, eventId, seller]) assert.ok(!JSON.stringify(first).includes(privateValue));
  const mismatch = await aggregateExport({ ...input, sellerCounts: { [partnerId]: 2 } });
  assert.equal(mismatch.partners[0].reconciliationStatus, 'MISMATCH');
  assert.notEqual(mismatch.reconciliationChecksum, first.reconciliationChecksum);
  await assert.rejects(aggregateExport({ ...input, policy: { ...input.policy, pilots: [] } }));
});

test('proposal encodes actual recordMilestone and Governance.propose with exact 9-decimal arithmetic', () => {
  const { output } = prepareProposal(report(), snapshot(), null, '0.003', now);
  assert.equal(output.meta.unlockAmount, '666666666666'); // floor(EUR 2 / .003 * 1e9)
  assert.equal(output.eurMinorCharged, '200');
  assert.equal(output.unsigned, true);
  assert.equal(output.submitted, false);
  const gov = new ethers.Interface(['function propose(address target, bytes data)']);
  const abi = new ethers.Interface(['function recordMilestone(bytes32,bytes32,uint256)']);
  const [target, calldata] = gov.decodeFunctionData('propose', output.transactions[0].data);
  assert.equal(target.toLowerCase(), vault);
  assert.equal(calldata, output.inner.data);
  const [partner, milestone, amount] = abi.decodeFunctionData('recordMilestone', calldata);
  assert.equal(partner, partnerId);
  assert.equal(milestone, snapshot().milestoneId);
  assert.equal(amount, 666666666666n);
  const precise = prepareProposal(report(), snapshot('2026-08', { maxAllocationBaseUnits: '1000000000000000000000000000000' }), null, '0.000000000000000003', now);
  assert.equal(precise.output.meta.unlockAmount, '666666666666666666666666666');
});

test('EUR 250 lifetime cap, allocation cap and reservations across periods cannot be bypassed by price changes', () => {
  const first = prepareProposal(report('2026-08', 499), snapshot(), null, '0.01', now);
  const second = prepareProposal(report('2026-09', 4), snapshot('2026-09'), first.ledger, '0.02', now);
  assert.equal(second.output.settleableCount, '1');
  assert.equal(second.output.uncoveredCount, '3');
  assert.equal(second.output.capped, true);
  assert.equal(second.output.eurMinorCharged, '50');
  assert.throws(() => prepareProposal(report('2026-07'), snapshot('2026-07'), second.ledger, '0.01', now), /Budget exhausted/);
  const limited = prepareProposal(report(), snapshot('2026-08', { maxAllocationBaseUnits: '399999999999' }), null, '0.003', now);
  assert.equal(limited.output.settleableCount, '2');
  assert.equal(limited.output.meta.unlockAmount, '333333333333');
  const drafted = prepareProposal(report('2026-08', 2), snapshot('2026-08', { maxAllocationBaseUnits: '1000000000000' }), null, '0.003', now);
  const recorded = prepareProposal(report('2026-09', 4), snapshot('2026-09', { maxAllocationBaseUnits: '1000000000000',
    unlockedTotalBaseUnits: drafted.output.meta.unlockAmount, recordedMilestoneIds: [drafted.output.meta.milestoneId] }), drafted.ledger, '0.003', now);
  assert.equal(recorded.output.settleableCount, '4'); // confirmed reservations are not deducted twice
  const huge = prepareProposal(report(), snapshot(), null, '0.0000000003', now);
  assert.equal(huge.output.meta.unlockAmount, '6666666666666666666');
});

test('rejects duplicates, changed checksums, incomplete reconciliation, malformed prices and unbound/on-chain-used snapshots', () => {
  const first = prepareProposal(report(), snapshot(), null, '0.01', now);
  assert.throws(() => prepareProposal(report(), snapshot(), first.ledger, '0.01', now), /already reserved/);
  for (const price of ['', '0', '-1', 'NaN', '1e-3', '0.1234567890123456789']) {
    assert.throws(() => prepareProposal(report(), snapshot(), null, price, now));
  }
  const corrupt = report(); corrupt.partners[0].eligibleCount += 1;
  assert.throws(() => prepareProposal(corrupt, snapshot(), null, '0.01', now), /checksum/);
  for (const change of [{ reconciliationStatus: 'INCOMPLETE' }, { blockers: ['CUSTOMER_DEDUP_UNAVAILABLE_OWNER_B'] },
    { sellerConfirmedRedemptions: 999 }, { discrepancies: [{ code: 'MISSING', count: 1 }] }]) {
    const invalid = report(); Object.assign(invalid.partners[0], change); invalid.reconciliationChecksum = checksum(invalid);
    assert.throws(() => prepareProposal(invalid, snapshot(), null, '0.01', now));
  }
  for (const change of [{ milestoneDone: true }, { active: false }, { milestonesFinal: true }, { paused: true },
    { rewardAccruedBaseUnits: '1' }, { chainId: 1 }, { milestoneId: `0x${'dd'.repeat(32)}` },
    { unlockedTotalBaseUnits: '1' },
    { recordedMilestoneIds: [`0x${'ff'.repeat(32)}`] },
    { maxAllocationBaseUnits: '0' }]) {
    assert.throws(() => prepareProposal(report(), snapshot('2026-08', change), null, '0.01', now));
  }
  assert.throws(() => prepareProposal(report('2026-10'), snapshot('2026-10'), null, '0.01', now), /still open/);
});

test('ledger writes atomically, survives a new process, locks concurrent access and stays unchanged on failure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-b-tools-'));
  try {
    const stateFile = path.join(dir, 'ledger.json');
    const options = { report: report(), snapshot: snapshot(), stateFile, price: '0.01', now };
    const output = reserveProposal(options);
    assert.equal(output.submitted, false);
    assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);
    const before = fs.readFileSync(stateFile, 'utf8');
    assert.throws(() => reserveProposal(options));
    assert.equal(fs.readFileSync(stateFile, 'utf8'), before);
    fs.writeFileSync(`${stateFile}.lock`, '');
    assert.throws(() => reserveProposal(options), /EEXIST/);
    fs.unlinkSync(`${stateFile}.lock`);
    const exportFile = path.join(dir, 'export.json');
    const snapshotFile = path.join(dir, 'snapshot.json');
    fs.writeFileSync(exportFile, JSON.stringify(report())); fs.writeFileSync(snapshotFile, JSON.stringify(snapshot()));
    const result = spawnSync(process.execPath, [path.join(__dirname, 'model-b-proposal.cjs'), '--export', exportFile,
      '--vault-state', snapshotFile, '--state', stateFile, '--price-eur-per-ifr', '0.01'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /proposal refused/);
    assert.equal(fs.readFileSync(stateFile, 'utf8'), before);
    fs.writeFileSync(stateFile, '{}');
    assert.throws(() => reserveProposal(options));
    assert.equal(fs.readFileSync(stateFile, 'utf8'), '{}');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
