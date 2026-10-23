#!/usr/bin/env node
// Offline proposal preparation only. The local ledger reserves drafts; it never claims payment.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { z } = require('zod');
const { ethers } = require('ethers');
const { args, required, uint, checksum, canonicalDigest, parseSettlementPeriod,
  computeMilestoneId, buildTemplate, validateRecordMilestoneTemplate } = require('./model-b-common.cjs');

const id = z.string().regex(/^0x[0-9a-f]{64}$/);
const address = z.string().regex(/^0x[0-9a-f]{40}$/).refine((s) => s !== ethers.ZeroAddress);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const integer = z.string().refine((s) => { try { uint(s); return true; } catch { return false; } });
const partnerSchema = z.object({
  partnerId: id, backendRedemptions: count, sellerConfirmedRedemptions: count.nullable(), eligibleCount: count,
  excludedCount: count, reconciliationStatus: z.enum(['RECONCILED', 'MISMATCH', 'INCOMPLETE']),
  discrepancies: z.array(z.object({ code: z.string(), count }).strict()), blockers: z.array(z.string()),
  reconciliationDigest: id,
}).strict();
const exportSchema = z.object({
  kind: z.literal('ifr-model-b-period-aggregates'), schemaVersion: z.literal(1), policyVersion: z.string().min(1).max(64),
  chainId: count.refine((n) => n > 0), partnerVault: address, period: z.string(), eurMinorPerRedemption: z.literal('50'),
  partners: z.array(partnerSchema).length(1), reconciliationChecksum: id,
}).strict();
const snapshotSchema = z.object({
  chainId: count, partnerVault: address, governance: address, partnerId: id,
  blockNumber: count.refine((n) => n > 0), blockHash: id, milestoneId: id,
  active: z.boolean(), milestonesFinal: z.boolean(), paused: z.boolean(), milestoneDone: z.boolean(),
  recordedMilestoneIds: z.array(id),
  maxAllocationBaseUnits: integer, unlockedTotalBaseUnits: integer, rewardAccruedBaseUnits: integer,
}).strict();
const reservationSchema = z.object({
  partnerId: id, period: z.string(), milestoneId: id, reconciliationChecksum: id,
  status: z.literal('DRAFT_RESERVED'), ifrBaseUnits: integer, eurMinorCharged: integer,
}).strict();
const ledgerSchema = z.object({
  schemaVersion: z.literal(1), chainId: count, partnerVault: address, pilotPartnerId: id,
  periods: z.record(z.string(), reservationSchema),
}).strict();

function priceUnits(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,30})(\.[0-9]{1,18})?$/.test(value)) {
    throw new Error('Price must be a positive decimal EUR per IFR, with at most 18 decimals');
  }
  const units = ethers.parseUnits(value, 18);
  if (units <= 0n) throw new Error('Price must be positive');
  return units;
}

function prepareProposal(rawExport, rawSnapshot, rawLedger, price, now = new Date()) {
  const report = exportSchema.parse(rawExport);
  if (checksum(report) !== report.reconciliationChecksum) throw new Error('Reconciliation checksum mismatch');
  const snapshot = snapshotSchema.parse(rawSnapshot);
  const period = parseSettlementPeriod(report.period);
  if (period.end > now) throw new Error('Period is still open');
  const [partner] = report.partners;
  if (partner.reconciliationStatus !== 'RECONCILED' || partner.blockers.length || partner.discrepancies.length ||
      partner.backendRedemptions !== partner.sellerConfirmedRedemptions ||
      partner.eligibleCount > partner.backendRedemptions || partner.eligibleCount === 0) {
    throw new Error('Redemptions are not eligible and reconciled');
  }
  const milestoneId = computeMilestoneId(report.chainId, report.partnerVault, partner.partnerId, period);
  if (snapshot.chainId !== report.chainId || snapshot.partnerVault !== report.partnerVault ||
      snapshot.partnerId !== partner.partnerId || snapshot.milestoneId !== milestoneId) throw new Error('Snapshot binding mismatch');
  if (!snapshot.active || snapshot.milestonesFinal || snapshot.paused || snapshot.milestoneDone ||
      uint(snapshot.rewardAccruedBaseUnits) !== 0n) throw new Error('Vault snapshot blocks Model B settlement');
  const ledger = rawLedger === null ? {
    schemaVersion: 1, chainId: report.chainId, partnerVault: report.partnerVault,
    pilotPartnerId: partner.partnerId, periods: {},
  } : ledgerSchema.parse(rawLedger);
  if (ledger.chainId !== report.chainId || ledger.partnerVault !== report.partnerVault ||
      ledger.pilotPartnerId !== partner.partnerId) throw new Error('Ledger binding mismatch');
  let reservedIfr = 0n;
  let reservedEur = 0n;
  let recordedIfr = 0n;
  const recorded = new Set(snapshot.recordedMilestoneIds);
  if (recorded.size !== snapshot.recordedMilestoneIds.length) throw new Error('Repeated recorded milestone');
  for (const [key, entry] of Object.entries(ledger.periods)) {
    if (key !== `${partner.partnerId}:${entry.period}` || entry.partnerId !== partner.partnerId ||
        computeMilestoneId(report.chainId, report.partnerVault, entry.partnerId, parseSettlementPeriod(entry.period)) !== entry.milestoneId ||
        uint(entry.ifrBaseUnits) === 0n || uint(entry.eurMinorCharged) === 0n) throw new Error('Invalid ledger reservation');
    reservedIfr += uint(entry.ifrBaseUnits);
    reservedEur += uint(entry.eurMinorCharged);
    if (recorded.delete(entry.milestoneId)) recordedIfr += uint(entry.ifrBaseUnits);
  }
  if (recorded.size) throw new Error('Recorded milestone is missing from the operator ledger');
  const key = `${partner.partnerId}:${report.period}`;
  if (Object.hasOwn(ledger.periods, key)) throw new Error('Partner period is already reserved or settled; refusing a second template');
  const allocation = uint(snapshot.maxAllocationBaseUnits);
  const unlocked = uint(snapshot.unlockedTotalBaseUnits);
  if (unlocked !== recordedIfr) throw new Error('Vault usage is not reconciled with the operator ledger');
  const used = unlocked + reservedIfr - recordedIfr;
  const remainingIfr = allocation > used ? allocation - used : 0n;
  const remainingEur = 25000n > reservedEur ? 25000n - reservedEur : 0n;
  const rate = priceUnits(price);
  const amountFor = (n) => n * 50n * 10n ** 9n * 10n ** 18n / (100n * rate);
  // Pay only whole eligible redemptions. Uncovered counts in a final capped period are explicit.
  let low = 0n;
  let high = BigInt(partner.eligibleCount) < remainingEur / 50n ? BigInt(partner.eligibleCount) : remainingEur / 50n;
  while (low < high) {
    const mid = (low + high + 1n) / 2n;
    if (amountFor(mid) <= remainingIfr) low = mid; else high = mid - 1n;
  }
  const unlockAmount = amountFor(low);
  if (low === 0n || unlockAmount === 0n) throw new Error('Budget exhausted or amount rounds to zero');
  const template = buildTemplate({
    chainId: report.chainId, governance: snapshot.governance, partnerVault: report.partnerVault,
    partnerId: partner.partnerId, milestoneId, unlockAmount, batchDigest: report.reconciliationChecksum,
    evidenceDigest: canonicalDigest({ operatorPriceEurPerIfr: price, blockHash: snapshot.blockHash }),
    policyVersion: report.policyVersion, period: report.period,
  });
  validateRecordMilestoneTemplate(template, {
    chainId: report.chainId, governance: snapshot.governance, partnerVault: report.partnerVault,
    partnerId: partner.partnerId, milestoneId, unlockAmount, remainingAllocation: remainingIfr,
  });
  const entry = {
    partnerId: partner.partnerId, period: report.period, milestoneId, reconciliationChecksum: report.reconciliationChecksum,
    status: 'DRAFT_RESERVED', ifrBaseUnits: unlockAmount.toString(), eurMinorCharged: (low * 50n).toString(),
  };
  return {
    ledger: { ...ledger, periods: { ...ledger.periods, [key]: entry } },
    output: {
      ...template, operatorPriceEurPerIfr: price, priceIndependentlyVerified: false,
      snapshotBlock: { number: snapshot.blockNumber, hash: snapshot.blockHash },
      eligibleCount: String(partner.eligibleCount), settleableCount: low.toString(),
      uncoveredCount: (BigInt(partner.eligibleCount) - low).toString(), eurMinorCharged: entry.eurMinorCharged,
      budgetEurMinor: '25000', capped: low < BigInt(partner.eligibleCount),
      reviewRequired: 'Verify seller reconciliation, price provenance (7-day TWAP and ETH/EUR), current allocation and milestoneDone before Governance submission. No transaction was sent.',
    },
  };
}

function reserveProposal({ report, snapshot, stateFile, price, now }) {
  // One local ledger is mandatory for all pilot periods. Lock + atomic rename prevent concurrent drafts.
  const lock = `${stateFile}.lock`;
  const fd = fs.openSync(lock, 'wx', 0o600);
  const temporary = `${stateFile}.${crypto.randomUUID()}.tmp`;
  try {
    if (fs.existsSync(stateFile) && !fs.lstatSync(stateFile).isFile()) throw new Error('Ledger must be a regular file');
    const previous = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
    const result = prepareProposal(report, snapshot, previous, price, now);
    const draft = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(draft, `${JSON.stringify(result.ledger, null, 2)}\n`);
      fs.fsyncSync(draft);
    } finally { fs.closeSync(draft); }
    fs.renameSync(temporary, stateFile);
    return result.output;
  } finally {
    fs.rmSync(temporary, { force: true });
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

function main(argv) {
  const options = args(argv, ['export', 'vault-state', 'state', 'price-eur-per-ifr']);
  const report = JSON.parse(fs.readFileSync(required(options.export, '--export JSON file'), 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(required(options['vault-state'], '--vault-state JSON file'), 'utf8'));
  const output = reserveProposal({ report, snapshot, stateFile: required(options.state, '--state ledger.json'),
    price: required(options['price-eur-per-ifr'], '--price-eur-per-ifr decimal') });
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch {
    console.error('Model B proposal refused; verify inputs, reconciliation, budget and the period ledger locally');
    process.exitCode = 1;
  }
}
module.exports = { prepareProposal, reserveProposal, main };
