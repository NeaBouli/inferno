/**
 * Contract test for the Model B price-evidence tool output (T-290) against the REAL
 * settlement schema and validator. The fixture is produced byte-identically by
 * scripts/model-b-price-evidence.mjs generateEvidence (enforced by
 * scripts/test-model-b-price-evidence.mjs), so this suite proves that actual tool output
 * parses against priceEvidenceSchema and validates under a reviewed pilot policy.
 */
import fs from 'node:fs';
import path from 'node:path';

// config.ts validates process.env and exits at import time; mock it like modelBSettlement.test.ts.
jest.mock('../src/config', () => ({
  config: {
    CHAIN_ID: 1,
    SELLER_AUTH_DOMAIN: 'shop.example.test',
    RPC_URL: 'https://mock-rpc.example.com',
    IFR_TOKEN_ADDRESS: '0x77e99917Eca8539c62F509ED1193ac36580A6e7B',
    IFRLOCK_ADDRESS: '0x0000000000000000000000000000000000000001',
    PARTNER_VAULT_ADDRESS: '0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D',
    BUILDER_REGISTRY_ADDRESS: '0x0000000000000000000000000000000000000003',
    REWARD_CALLER_ADDRESS: undefined,
    MODEL_B_SETTLEMENT_ENABLED: 'true',
    MODEL_B_PILOT_POLICY_JSON: undefined,
    ADMIN_SECRET: 'test-secret-12345',
    DATABASE_URL: 'file:./test.db',
    MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET: 5,
    MAX_TOTAL_SELLER_BUSINESSES_PER_WALLET: 25,
    PORT: 0,
  },
}));

import { parseModelBPolicy, type ModelBPolicy } from '../src/services/modelBPolicy';
import {
  canonicalDigest,
  parseSettlementPeriod,
  priceEvidenceSchema,
  validatePriceEvidence,
} from '../src/services/modelBSettlement';

const IFR_TOKEN = '0x77e99917Eca8539c62F509ED1193ac36580A6e7B';
const PAIR = '0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0';
// Keep in sync with REVIEWED_SOURCE_ID in scripts/model-b-price-evidence.mjs.
const REVIEWED_SOURCE_ID = 'uniswap-v2-twap:chainlink-eth-usd:eur-usd';

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'modelBPriceEvidence.sample.json'), 'utf8')
) as Record<string, unknown>;
const period = parseSettlementPeriod('2026-09');

function policy(reviewedPriceSourceIds: string[] = [REVIEWED_SOURCE_ID]): ModelBPolicy {
  const parsed = parseModelBPolicy({
    CHAIN_ID: 1,
    MODEL_B_SETTLEMENT_ENABLED: 'true',
    MODEL_B_PILOT_POLICY_JSON: JSON.stringify({
      policyVersion: 'lane4-model-b-evidence-test-1',
      globalPilotBudgetBaseUnits: '1000000000000000',
      twapPair: PAIR,
      reviewedPriceSourceIds,
      pilots: [
        {
          partnerId: `0x${'cd'.repeat(32)}`,
          businessId: 'evidence-test-business',
          eurMinorPerRedemption: '200',
          partnerBudgetBaseUnits: '500000000000000',
          startsAt: '2026-07-01T00:00:00Z',
          governanceReference: 'test-governance-reference',
        },
      ],
    }),
  });
  if (!parsed.enabled) throw new Error(`policy must parse: ${parsed.reason}`);
  return parsed.policy;
}

function cloneFixture(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
}

describe('Model B price-evidence tool output (T-290 fixture)', () => {
  it('parses against the real priceEvidenceSchema', () => {
    const parsed = priceEvidenceSchema.safeParse(fixture);
    expect(parsed.success).toBe(true);
  });

  it('validates as VALID under a reviewed pilot policy', () => {
    const result = validatePriceEvidence(fixture, { policy: policy(), ifrTokenAddress: IFR_TOKEN, period });
    expect(result.status).toBe('VALID');
    if (result.status !== 'VALID') return;
    expect(result.windowSeconds).toBe(604_800);
    expect(result.cumulativeDelta).toBe(
      BigInt((fixture.end as { price0Cumulative: string }).price0Cumulative) -
        BigInt((fixture.start as { price0Cumulative: string }).price0Cumulative)
    );
    expect(result.digest).toBe(canonicalDigest(result.evidence));
    expect(result.settlementBlock).toEqual({
      number: (fixture.end as { blockNumber: number }).blockNumber,
      hash: (fixture.end as { blockHash: string }).blockHash,
      timestamp: (fixture.end as { timestamp: number }).timestamp,
    });
  });

  it('accepts the reviewed source id through the real policy parser', () => {
    expect(policy().reviewedPriceSourceIds).toContain(REVIEWED_SOURCE_ID);
  });

  it('rejects an unreviewed source id', () => {
    const result = validatePriceEvidence(cloneFixture(), { policy: policy([]), ifrTokenAddress: IFR_TOKEN, period });
    expect(result.status).toBe('INVALID');
  });

  it('rejects schema violations (strict object, malformed fields)', () => {
    expect(validatePriceEvidence({ ...cloneFixture(), extra: 1 }, { policy: policy(), ifrTokenAddress: IFR_TOKEN, period }).status).toBe('INVALID');
    const badRate = cloneFixture();
    (badRate.ethEur as Record<string, unknown>).rate = '0';
    const result = validatePriceEvidence(badRate, { policy: policy(), ifrTokenAddress: IFR_TOKEN, period });
    expect(result.status).toBe('INVALID');
    expect(result.status === 'INVALID' && result.reason).toMatch(/positive/);
  });

  it('rejects policy binding violations (pair, token0, window, period, skew)', () => {
    const cases: [string, (e: Record<string, unknown>) => void, RegExp][] = [
      ['pair', (e) => { e.pair = `0x${'11'.repeat(20)}`; }, /pair/],
      ['token0', (e) => { e.token0 = `0x${'11'.repeat(20)}`; }, /token0/],
      ['block order', (e) => { (e.start as Record<string, unknown>).blockNumber = (e.end as Record<string, unknown>).blockNumber; }, /end block/],
      ['window', (e) => { (e.start as Record<string, unknown>).timestamp = (e.end as { timestamp: number }).timestamp - 604_799; }, /7-day/],
      ['period lag', (e) => {
        // Shift both ends so the 7-day window stays intact and the lag bound is the failing check.
        (e.start as Record<string, unknown>).timestamp = (e.start as { timestamp: number }).timestamp + 72 * 3600 + 1;
        (e.end as Record<string, unknown>).timestamp = (e.end as { timestamp: number }).timestamp + 72 * 3600 + 1;
      }, /72 hours/],
      ['delta', (e) => { (e.end as Record<string, unknown>).price0Cumulative = (e.start as Record<string, unknown>).price0Cumulative; }, /did not advance/],
      ['skew', (e) => { (e.ethEur as Record<string, unknown>).publishedAt = '2026-10-02T01:00:00.000Z'; }, /not bound/],
    ];
    for (const [label, mutate, reason] of cases) {
      const tampered = cloneFixture();
      mutate(tampered);
      const result = validatePriceEvidence(tampered, { policy: policy(), ifrTokenAddress: IFR_TOKEN, period });
      expect({ label, status: result.status }).toEqual({ label, status: 'INVALID' });
      expect({ label, reason: result.status === 'INVALID' ? result.reason : '' }).toEqual({
        label,
        reason: expect.stringMatching(reason),
      });
    }
  });
});
