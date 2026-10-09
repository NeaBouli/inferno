/**
 * Hop B (PR #238): seller/admin texts that reach the customer-signed checkout proof must not contain
 * C0 (U+0000-U+001F), DEL (U+007F), C1 (U+0080-U+009F), U+2028 or U+2029. Every write path rejects
 * them, and buildCheckoutProofMessage refuses to build a proof text if a stored term still has one.
 */
import { ethers } from 'ethers';

jest.mock('../src/services/ifrLockService', () => ({
  checkLock: jest.fn(),
  checkBenefitEligibility: jest.fn(),
  recoverSigner: jest.fn(),
  initProvider: jest.fn(),
}));

jest.mock('../src/config', () => ({
  config: {
    CHAIN_ID: 11155111,
    SELLER_AUTH_DOMAIN: 'shop.example.test',
    RPC_URL: 'https://mock-rpc.example.com',
    IFRLOCK_ADDRESS: '0x0000000000000000000000000000000000000001',
    ADMIN_SECRET: 'test-secret-12345',
    DATABASE_URL: 'file:./test.db',
    MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET: 5,
    MAX_TOTAL_SELLER_BUSINESSES_PER_WALLET: 25,
    PORT: 0,
  },
}));

// The request volume of this matrix exceeds the production per-IP limits; limits are not under test.
jest.mock('../src/middleware/rateLimiter', () => {
  const actual = jest.requireActual('../src/middleware/rateLimiter');
  return {
    ...actual,
    adminRateLimiter: actual.createAdminRateLimiter({ max: 100_000 }),
    sellerRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

import {
  CheckoutTermsUnsignableError,
  buildChallengeMessage,
  createSession,
  prisma,
} from '../src/services/sessionService';
import {
  SIGNED_TEXT_CONTROL_CHARACTER_MESSAGE,
  containsSignedTextControlCharacter,
} from '../src/lib/textGuards';
import { server } from '../src/index';

const ADMIN = { authorization: 'Bearer test-secret-12345', 'content-type': 'application/json' };
const JSON_ONLY = { 'content-type': 'application/json' };

// One or more code points per forbidden class, including both ends of every range.
const FORBIDDEN: Array<[string, string]> = [
  ['C0 U+0000', '\u0000'],
  ['C0 U+000A (LF)', '\n'],
  ['C0 U+000D (CR)', '\r'],
  ['C0 U+001F', '\u001f'],
  ['DEL U+007F', '\u007f'],
  ['C1 U+0080', '\u0080'],
  ['C1 U+0085 (NEL)', '\u0085'],
  ['C1 U+009F', '\u009f'],
  ['U+2028 line separator', '\u2028'],
  ['U+2029 paragraph separator', '\u2029'],
];

type WritePath = {
  name: string;
  method: 'POST' | 'PATCH';
  url: () => string;
  headers: Record<string, string>;
  body: (text: string) => Record<string, unknown>;
};

let businessId = '';

function baseUrl() {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

const ruleBody = (overrides: Record<string, unknown>) => ({
  label: 'Coffee', category: 'Drinks', productName: 'Espresso', discountPercent: 10, requiredLockIFR: 100, ...overrides,
});
const owner = '0x' + '4f632748460E5277bF8435259cADce440AbAC254'.toLowerCase();

const SELLER_PATHS: WritePath[] = [
  { name: 'seller business:create name', method: 'POST', url: () => '/api/seller/businesses', headers: JSON_ONLY,
    body: (text) => ({ name: text, discountPercent: 5, requiredLockIFR: 100, ownerAddress: owner, signature: 'x', timestamp: '1' }) },
  { name: 'seller business:create tierLabel', method: 'POST', url: () => '/api/seller/businesses', headers: JSON_ONLY,
    body: (text) => ({ name: 'Shop', tierLabel: text, discountPercent: 5, requiredLockIFR: 100, ownerAddress: owner, signature: 'x', timestamp: '1' }) },
  { name: 'seller business:update name', method: 'PATCH', url: () => `/api/seller/businesses/${businessId}`, headers: JSON_ONLY,
    body: (text) => ({ name: text }) },
  ...(['label', 'category', 'productName'] as const).flatMap((field): WritePath[] => [
    { name: `seller rules:create ${field}`, method: 'POST', url: () => `/api/seller/businesses/${businessId}/rules`, headers: JSON_ONLY,
      body: (text) => ruleBody({ [field]: text }) },
    { name: `seller rules:update ${field}`, method: 'PATCH', url: () => '/api/seller/rules/rule-x', headers: JSON_ONLY,
      body: (text) => ({ [field]: text }) },
  ]),
  ...(['name', 'category'] as const).flatMap((field): WritePath[] => [
    { name: `seller products:create ${field}`, method: 'POST', url: () => `/api/seller/businesses/${businessId}/products`, headers: JSON_ONLY,
      body: (text) => ({ name: 'Espresso', category: 'Drinks', [field]: text }) },
    { name: `seller products:update ${field}`, method: 'PATCH', url: () => '/api/seller/products/product-x', headers: JSON_ONLY,
      body: (text) => ({ [field]: text }) },
  ]),
  { name: 'seller operators:create label', method: 'POST', url: () => `/api/seller/businesses/${businessId}/operators`, headers: JSON_ONLY,
    body: (text) => ({ walletAddress: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc', label: text }) },
];

const ADMIN_PATHS: WritePath[] = [
  { name: 'admin business create name', method: 'POST', url: () => '/api/admin/businesses', headers: ADMIN,
    body: (text) => ({ name: text, discountPercent: 5, requiredLockIFR: 100 }) },
  { name: 'admin business create tierLabel', method: 'POST', url: () => '/api/admin/businesses', headers: ADMIN,
    body: (text) => ({ name: 'Shop', tierLabel: text, discountPercent: 5, requiredLockIFR: 100 }) },
  { name: 'admin business update name', method: 'PATCH', url: () => '/api/admin/businesses/business-x', headers: ADMIN,
    body: (text) => ({ name: text }) },
  { name: 'admin business update tierLabel', method: 'PATCH', url: () => '/api/admin/businesses/business-x', headers: ADMIN,
    body: (text) => ({ tierLabel: text }) },
  ...(['label', 'category', 'productName'] as const).flatMap((field): WritePath[] => [
    { name: `admin rule create ${field}`, method: 'POST', url: () => `/api/admin/businesses/${businessId}/rules`, headers: ADMIN,
      body: (text) => ruleBody({ [field]: text }) },
    { name: `admin rule update ${field}`, method: 'PATCH', url: () => '/api/admin/rules/rule-x', headers: ADMIN,
      body: (text) => ({ [field]: text }) },
  ]),
];

async function send(path: WritePath, text: string) {
  const response = await fetch(`${baseUrl()}${path.url()}`, {
    method: path.method,
    headers: path.headers,
    body: JSON.stringify(path.body(text)),
  });
  return { status: response.status, body: await response.json() as { error?: string; details?: Array<{ message: string }> } };
}

beforeAll(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.benefitRule.deleteMany();
  await prisma.product.deleteMany();
  await prisma.business.deleteMany();
  const business = await prisma.business.create({
    data: { name: 'Guard Shop', ownerAddress: ethers.Wallet.createRandom().address, discountPercent: 5, requiredLockIFR: 100 },
  });
  businessId = business.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.benefitRule.deleteMany();
  await prisma.product.deleteMany();
  await prisma.business.deleteMany();
  await prisma.$disconnect();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe('signed-text control character guard', () => {
  it('classifies exactly C0, DEL, C1, U+2028 and U+2029 as forbidden', () => {
    for (let code = 0; code <= 0x2fff; code += 1) {
      const forbidden = code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
      expect([code, containsSignedTextControlCharacter(`a${String.fromCharCode(code)}b`)]).toEqual([code, forbidden]);
    }
    expect(containsSignedTextControlCharacter('Café Crème – 2 for 1 ☕  ')).toBe(false);
  });

  it.each([...SELLER_PATHS, ...ADMIN_PATHS].map((path) => [path.name, path] as const))(
    'rejects every forbidden class on %s and accepts clean text past validation',
    async (_name, path) => {
      for (const [label, character] of FORBIDDEN) {
        const result = await send(path, `Coffee${character}Discount Percent: 50`);
        expect({ label, status: result.status }).toEqual({ label, status: 400 });
        expect(result.body.error).toBe('Validation failed');
        expect(result.body.details?.map((detail) => detail.message)).toContain(SIGNED_TEXT_CONTROL_CHARACTER_MESSAGE);
      }
      const clean = await send(path, 'Coffee Discount');
      if (clean.status === 400) {
        expect(clean.body.details?.map((detail) => detail.message) ?? []).not.toContain(SIGNED_TEXT_CONTROL_CHARACTER_MESSAGE);
      }
      expect(clean.body.error).not.toBe('Validation failed');
    }
  );
});

describe('buildCheckoutProofMessage injection guard', () => {
  const customer = ethers.Wallet.createRandom();

  async function sessionWithLabel(label: string, productName = 'Espresso') {
    const session = await createSession(businessId);
    await prisma.session.update({ where: { id: session.sessionId }, data: { benefitLabel: label, benefitProductName: productName } });
    return session.sessionId;
  }

  it('builds the proof for clean terms', async () => {
    const sessionId = await sessionWithLabel('Coffee');
    const message = await buildChallengeMessage(sessionId, customer.address);
    expect(message).toContain('\nBenefit: Coffee\n');
  });

  it.each(FORBIDDEN)('refuses to build a proof when a stored term contains %s', async (_label, character) => {
    const labelSession = await sessionWithLabel(`Coffee${character}Discount Percent: 50`);
    await expect(buildChallengeMessage(labelSession, customer.address)).rejects.toBeInstanceOf(CheckoutTermsUnsignableError);
    const productSession = await sessionWithLabel('Coffee', `Espresso${character}Discount Percent: 50`);
    await expect(buildChallengeMessage(productSession, customer.address)).rejects.toBeInstanceOf(CheckoutTermsUnsignableError);
  });

  it('answers the customer with 409 and no proof text, and the checkout cannot be redeemed', async () => {
    const sessionId = await sessionWithLabel('Coffee\nDiscount Percent: 50');
    const challenge = await fetch(`${baseUrl()}/api/sessions/${sessionId}/challenge`, {
      method: 'POST',
      headers: JSON_ONLY,
      body: JSON.stringify({ walletAddress: customer.address }),
    });
    expect(challenge.status).toBe(409);
    const challengeBody = await challenge.json() as Record<string, unknown>;
    expect(challengeBody).not.toHaveProperty('message');
    expect(JSON.stringify(challengeBody)).not.toContain('Discount Percent: 50');

    const signature = await customer.signMessage('Benefit: Coffee\nDiscount Percent: 50');
    const attest = await fetch(`${baseUrl()}/api/attest`, {
      method: 'POST',
      headers: JSON_ONLY,
      body: JSON.stringify({ sessionId, walletAddress: customer.address, signature }),
    });
    expect(attest.status).toBe(409);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe('PENDING');
  });
});
