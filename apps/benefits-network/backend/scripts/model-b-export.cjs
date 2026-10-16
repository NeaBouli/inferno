#!/usr/bin/env node
// Read-only database export. Only partner aggregates and reconciliation commitments leave here.
const fs = require('node:fs');
const { args, required, checksum, buildSettlementExport, parseSettlementPeriod } = require('./model-b-common.cjs');
const { loadSettlementRecords } = require('../src/services/modelBSettlementData');

async function aggregateExport({ db, policy, period: label, chainId, partnerVault, ifrToken, sellerCounts, now = new Date() }) {
  const period = parseSettlementPeriod(label);
  if (policy.pilots.length !== 1 || policy.pilots[0].eurMinorPerRedemption !== '50') {
    throw new Error('Owner policy requires one pilot and EUR 0.50 per redemption');
  }
  const partners = [];
  for (const pilot of policy.pilots) {
    const records = await loadSettlementRecords(db, pilot, period);
    if (!records) throw new Error('Pilot business not found');
    const report = buildSettlementExport({
      policy, pilot, period, now, expectedChainId: chainId, partnerVaultAddress: partnerVault,
      ifrTokenAddress: ifrToken, records, sellerConfirmedRedemptions: sellerCounts[pilot.partnerId], chain: null,
    });
    partners.push({
      partnerId: pilot.partnerId,
      backendRedemptions: report.reconciliation.backendRedemptions,
      sellerConfirmedRedemptions: report.reconciliation.sellerConfirmedRedemptions,
      eligibleCount: report.totals.eligibleCount,
      excludedCount: report.events.excluded.length,
      reconciliationStatus: report.reconciliation.status,
      discrepancies: report.reconciliation.discrepancies,
      blockers: report.blockers.filter((code) => !['PRICE_EVIDENCE_MISSING', 'CHAIN_STATE_UNAVAILABLE', 'NO_ELIGIBLE_EVENTS', 'OPERATOR_LEDGER_REQUIRED'].includes(code)),
      // Commitment to the private reconciliation; no event/session IDs or customer keys are exported.
      reconciliationDigest: report.batchDigest,
    });
  }
  partners.sort((a, b) => a.partnerId.localeCompare(b.partnerId));
  const content = {
    kind: 'ifr-model-b-period-aggregates', schemaVersion: 1, policyVersion: policy.policyVersion,
    chainId, partnerVault: partnerVault.toLowerCase(), period: label, eurMinorPerRedemption: '50', partners,
  };
  return { ...content, reconciliationChecksum: checksum(content) };
}

async function main(argv) {
  const options = args(argv, ['period', 'seller-counts']);
  const label = required(options.period, '--period YYYY-MM');
  const counts = JSON.parse(fs.readFileSync(required(options['seller-counts'], '--seller-counts JSON file'), 'utf8'));
  if (!counts || Array.isArray(counts) || typeof counts !== 'object' ||
      Object.values(counts).some((n) => !Number.isSafeInteger(n) || n < 0)) throw new Error('Invalid seller counts');
  const { config } = require('../src/config');
  const { getModelBPolicy } = require('../src/services/modelBPolicy');
  const state = getModelBPolicy();
  if (!state.enabled) throw new Error(state.reason);
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  try {
    const result = await db.$transaction((tx) => aggregateExport({
      db: tx, policy: state.policy, period: label, chainId: config.CHAIN_ID,
      partnerVault: required(config.PARTNER_VAULT_ADDRESS, 'PARTNER_VAULT_ADDRESS'),
      ifrToken: config.IFR_TOKEN_ADDRESS, sellerCounts: counts,
    }));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally { await db.$disconnect(); }
}

if (require.main === module) main(process.argv.slice(2)).catch(() => {
  // Database/configuration exceptions may contain private values. Keep CLI failure output fixed.
  console.error('Model B export failed; check configuration, closed period and seller-count input locally');
  process.exitCode = 1;
});
module.exports = { aggregateExport, main };
