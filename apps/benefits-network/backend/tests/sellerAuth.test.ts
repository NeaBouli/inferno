import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
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

import { prisma } from '../src/services/sessionService';
import { server } from '../src/index';
import {
  buildSellerAuthMessage,
  resolveSellerAuthContext,
  verifySellerSignature,
  type SellerAuthContext,
} from '../src/services/sellerAuth';
import { buildSellerBusinessLimitError } from '../src/services/sellerLimitPolicy';
import { getSellerAuthConfigIssues } from '../src/services/sellerAuthConfigPolicy';
import {
  MUTATING_SELLER_ACTIONS,
  READ_ONLY_SELLER_ACTIONS,
  isKnownSellerAction,
  isReadOnlySellerAction,
  isSafeSellerAuthorizationField,
  requiresSingleUseSellerChallenge,
  consumeSellerAuthorizationChallenge,
  issueSellerAuthorizationChallenge,
} from '../src/services/sellerAuthorizationChallenge';

const CONTEXT: SellerAuthContext = { domain: 'shop.example.test', chainId: 11155111 };

function freshNonce() {
  return crypto.randomBytes(32).toString('hex');
}

async function signedInput(
  action: string,
  businessId: string,
  scope: string,
  options: { context?: SellerAuthContext; timestamp?: string } = {}
) {
  const wallet = ethers.Wallet.createRandom();
  const timestamp = options.timestamp ?? Date.now().toString();
  const binding = { nonce: freshNonce(), scope };
  const signature = await wallet.signMessage(
    buildSellerAuthMessage(options.context ?? CONTEXT, action, businessId, timestamp, binding)
  );
  return {
    wallet,
    input: {
      context: CONTEXT,
      walletAddress: wallet.address,
      signature,
      timestamp,
      action,
      businessId,
      ...binding,
    },
  };
}

describe('Seller wallet authorization', () => {
  it('allowlists every seller action and requires one-time challenges for reads and mutations', () => {
    expect(MUTATING_SELLER_ACTIONS).toEqual([
      'business:create',
      'business:slug',
      'business:update',
      'business:delete',
      'business:reactivate',
      'operators:create',
      'operators:delete',
      'products:create',
      'products:update',
      'products:delete',
      'rewards:apply',
      'rewards:disable',
      'rewards:reward-wallet',
      'rules:create',
      'rules:update',
      'rules:delete',
      'sessions:create',
      'sessions:redeem',
      'passes:bind',
    ]);
    expect(READ_ONLY_SELLER_ACTIONS.every((action) => isKnownSellerAction(action))).toBe(true);
    expect(MUTATING_SELLER_ACTIONS.every((action) => requiresSingleUseSellerChallenge(action))).toBe(true);
    expect(READ_ONLY_SELLER_ACTIONS.every((action) => requiresSingleUseSellerChallenge(action))).toBe(true);
    expect(READ_ONLY_SELLER_ACTIONS.every((action) => isReadOnlySellerAction(action))).toBe(true);
    expect(MUTATING_SELLER_ACTIONS.some((action) => isReadOnlySellerAction(action))).toBe(false);
    expect(isKnownSellerAction('business:transfer')).toBe(false);
    expect(requiresSingleUseSellerChallenge('business:transfer')).toBe(false);
    expect(isSafeSellerAuthorizationField('business_123')).toBe(true);
    expect(isSafeSellerAuthorizationField(' business_123')).toBe(false);
    expect(isSafeSellerAuthorizationField('business_123\nNonce: misleading')).toBe(false);
  });

  it('builds the deterministic domain- and chain-bound seller auth message format', () => {
    const nonce = 'a'.repeat(64);
    const message = buildSellerAuthMessage(CONTEXT, 'business:list', 'seller', '1784154000000', {
      nonce,
      scope: 'read',
    });

    expect(message).toBe([
      'IFR Benefits Network - Seller Authorization',
      'Domain: shop.example.test',
      'Chain ID: 11155111',
      'Action: business:list',
      'Business: seller',
      'Scope: read',
      `Nonce: ${nonce}`,
      'Timestamp: 1784154000000',
      `Expires: ${new Date(1784154000000 + 10 * 60 * 1000).toISOString()}`,
      'Only sign this message inside shop.example.test.',
    ].join('\n'));
  });

  it('verifies a bound seller wallet signature for a mutation and for a read', async () => {
    const mutation = await signedInput('rules:create', 'biz_123', 'biz_123');
    expect(verifySellerSignature(mutation.input)).toBe(mutation.wallet.address);

    const read = await signedInput('business:list', 'seller', 'read');
    expect(verifySellerSignature(read.input)).toBe(read.wallet.address);
  });

  it('rejects an unbound signature for every action, including reads', async () => {
    const { input } = await signedInput('business:list', 'seller', 'read');
    expect(() => verifySellerSignature({ ...input, nonce: undefined })).toThrow('nonce and scope are required');
    expect(() => verifySellerSignature({ ...input, scope: undefined })).toThrow('nonce and scope are required');
  });

  it('rejects nonces that are not 32 random bytes in lowercase hex', async () => {
    const { input } = await signedInput('rules:update', 'biz_123', 'rule_1');
    for (const nonce of ['nonce_rules_update', 'A'.repeat(64), 'a'.repeat(63)]) {
      expect(() => verifySellerSignature({ ...input, nonce })).toThrow('Invalid seller authorization nonce');
    }
  });

  it('rejects unknown actions before verifying a signature', async () => {
    const { input } = await signedInput('rules:update', 'biz_123', 'rule_1');
    expect(() => verifySellerSignature({ ...input, action: 'business:transfer' }))
      .toThrow('Unknown seller authorization action');
  });

  it('rejects signatures for a different action, business, scope or nonce', async () => {
    const { input } = await signedInput('rules:create', 'biz_123', 'biz_123');
    expect(() => verifySellerSignature({ ...input, action: 'rules:delete' })).toThrow('signature mismatch');
    expect(() => verifySellerSignature({ ...input, businessId: 'biz_456' })).toThrow('signature mismatch');
    expect(() => verifySellerSignature({ ...input, scope: 'biz_456' })).toThrow('signature mismatch');
    expect(() => verifySellerSignature({ ...input, nonce: freshNonce() })).toThrow('signature mismatch');
  });

  it('rejects signatures made for another domain or chain', async () => {
    const otherDomain = await signedInput('business:list', 'seller', 'read', {
      context: { domain: 'shop.attacker.test', chainId: CONTEXT.chainId },
    });
    expect(() => verifySellerSignature(otherDomain.input)).toThrow('signature mismatch');

    const otherChain = await signedInput('business:list', 'seller', 'read', {
      context: { domain: CONTEXT.domain, chainId: 1 },
    });
    expect(() => verifySellerSignature(otherChain.input)).toThrow('signature mismatch');
  });

  it('rejects stale, future-dated and malformed timestamps', async () => {
    const stale = await signedInput('business:create', 'new', 'new', {
      timestamp: String(Date.now() - 11 * 60 * 1000),
    });
    expect(() => verifySellerSignature(stale.input)).toThrow('expired');

    const future = await signedInput('business:create', 'new', 'new', {
      timestamp: String(Date.now() + 5 * 60 * 1000),
    });
    expect(() => verifySellerSignature(future.input)).toThrow('expired');

    const { input } = await signedInput('business:create', 'new', 'new');
    expect(() => verifySellerSignature({ ...input, timestamp: '1e12' })).toThrow('Invalid seller authorization timestamp');
    expect(() => verifySellerSignature({ ...input, timestamp: '' })).toThrow('Invalid seller authorization timestamp');
  });

  it('fails closed when the deployment domain or chain is missing or malformed', async () => {
    expect(() => resolveSellerAuthContext({ CHAIN_ID: 1 })).toThrow('not configured');
    expect(() => resolveSellerAuthContext({ SELLER_AUTH_DOMAIN: 'shop.example.test' })).toThrow('not configured');
    expect(() => resolveSellerAuthContext({ SELLER_AUTH_DOMAIN: 'https://shop.example.test', CHAIN_ID: 1 }))
      .toThrow('not configured');
    expect(() => resolveSellerAuthContext({ SELLER_AUTH_DOMAIN: 'shop.example.test', CHAIN_ID: 0 }))
      .toThrow('not configured');
    expect(resolveSellerAuthContext({ SELLER_AUTH_DOMAIN: 'shop.example.test', CHAIN_ID: 1 }))
      .toEqual({ domain: 'shop.example.test', chainId: 1 });

    const { input } = await signedInput('business:list', 'seller', 'read');
    expect(() => verifySellerSignature({ ...input, context: { domain: '', chainId: 1 } })).toThrow('not configured');
  });

  it('refuses production startup without an explicit official domain and chain ID', () => {
    expect(getSellerAuthConfigIssues({ nodeEnv: 'production', rawChainId: '1', sellerAuthDomain: 'shop.ifrunit.tech' }))
      .toEqual([]);
    expect(getSellerAuthConfigIssues({ nodeEnv: 'production', rawChainId: '1' }).map((issue) => issue.path))
      .toEqual(['SELLER_AUTH_DOMAIN']);
    expect(getSellerAuthConfigIssues({ nodeEnv: 'production', sellerAuthDomain: 'shop.ifrunit.tech' })
      .map((issue) => issue.path)).toEqual(['CHAIN_ID']);
    expect(getSellerAuthConfigIssues({ nodeEnv: 'production', rawChainId: '1', sellerAuthDomain: 'localhost' }))
      .toHaveLength(1);
    expect(getSellerAuthConfigIssues({ rawChainId: '1', sellerAuthDomain: 'https://shop.ifrunit.tech/' }))
      .toHaveLength(1);
    expect(getSellerAuthConfigIssues({})).toEqual([]);
  });

  it('builds a seller profile limit error once the active profile cap is reached', () => {
    expect(buildSellerBusinessLimitError(4, 5)).toBeNull();
    expect(buildSellerBusinessLimitError(5, 5)?.message).toContain('profile limit reached: 5/5');
  });
});

// ── P2: wallet-free seller challenge with nonce-only state (owner decision B, decision D1) ──
describe('Wallet-free seller challenge (nonce-only state)', () => {
  const owner = ethers.Wallet.createRandom();
  const stranger = ethers.Wallet.createRandom();
  const customer = ethers.Wallet.createRandom();
  let businessId = '';

  function baseUrl() {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');
    return `http://127.0.0.1:${address.port}`;
  }

  /** Every text value in every table of the test database, for an address search. */
  async function databaseText() {
    const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    );
    const parts: string[] = [];
    for (const { name } of tables) {
      const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "${name}"`);
      parts.push(JSON.stringify(rows, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)));
    }
    return parts.join('\n').toLowerCase();
  }

  async function issue(params: Record<string, string>) {
    const response = await fetch(`${baseUrl()}/api/seller/auth-message?${new URLSearchParams(params)}`);
    return { status: response.status, text: await response.text() };
  }

  async function signedHeaders(signer: ethers.HDNodeWallet, params: Record<string, string>) {
    const issued = await issue(params);
    expect(issued.status).toBe(200);
    const challenge = JSON.parse(issued.text) as { message: string; timestamp: string; nonce: string };
    return {
      'content-type': 'application/json',
      'x-ifr-wallet': signer.address,
      'x-ifr-signature': await signer.signMessage(challenge.message),
      'x-ifr-timestamp': challenge.timestamp,
      'x-ifr-nonce': challenge.nonce,
    };
  }

  beforeAll(async () => {
    await prisma.sellerAuthorizationChallenge.deleteMany();
    const business = await prisma.business.create({
      data: { name: 'P2 Seller', ownerAddress: owner.address, discountPercent: 5, requiredLockIFR: 100 },
    });
    businessId = business.id;
  });

  afterAll(async () => {
    await prisma.sellerAuthorizationChallenge.deleteMany();
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.$disconnect();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('issues a challenge that persists no wallet and stores only nonce, action, business, scope and expiry', async () => {
    const issued = await issue({ action: 'business:list', businessId: 'seller' });
    expect(issued.status).toBe(200);
    const body = JSON.parse(issued.text) as Record<string, unknown>;
    expect(body).not.toHaveProperty('walletAddress');
    const row = await prisma.sellerAuthorizationChallenge.findUniqueOrThrow({ where: { nonce: String(body.nonce) } });
    expect(Object.keys(row).sort()).toEqual(['action', 'businessId', 'consumedAt', 'createdAt', 'expiresAt', 'nonce', 'scope']);
    expect(row).toMatchObject({ action: 'business:list', businessId: 'seller', scope: 'read', consumedAt: null });
    expect(row.nonce).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores a legacy walletAddress parameter (D1): not stored, not echoed, request still served', async () => {
    const before = await prisma.sellerAuthorizationChallenge.count();
    for (const walletAddress of [customer.address, customer.address.toLowerCase(), 'not-an-address']) {
      const issued = await issue({ action: 'business:list', businessId: 'seller', walletAddress });
      expect(issued.status).toBe(200);
      expect(issued.text.toLowerCase()).not.toContain(customer.address.slice(2).toLowerCase());
      expect(JSON.parse(issued.text)).not.toHaveProperty('walletAddress');
    }
    const mutation = await issue({ action: 'rules:create', businessId, scope: businessId, walletAddress: customer.address });
    expect(mutation.status).toBe(200);
    expect(mutation.text.toLowerCase()).not.toContain(customer.address.slice(2).toLowerCase());
    expect(await prisma.sellerAuthorizationChallenge.count()).toBe(before + 4);
    expect(await databaseText()).not.toContain(customer.address.slice(2).toLowerCase());
  });

  it('binds the signer only through the signature and keeps every authorization check', async () => {
    // A nonce is not tied to a wallet: a stranger may sign one, but then authenticates only as itself.
    const strangerRead = await signedHeaders(stranger, { action: 'business:list', businessId: 'seller' });
    const strangerList = await fetch(`${baseUrl()}/api/seller/businesses`, { headers: strangerRead });
    expect(strangerList.status).toBe(200);
    expect(JSON.stringify(await strangerList.json())).not.toContain(businessId);

    // Claiming the owner's wallet with the stranger's signature fails the signature check.
    const claimed = await signedHeaders(stranger, { action: 'business:update', businessId, scope: businessId });
    const forged = await fetch(`${baseUrl()}/api/seller/businesses/${businessId}`, {
      method: 'PATCH',
      headers: { ...claimed, 'x-ifr-wallet': owner.address },
      body: JSON.stringify({ name: 'Forged' }),
    });
    expect(forged.status).toBe(401);

    // Signed honestly, the stranger is authenticated as the stranger and is not the owner.
    const strangerUpdate = await signedHeaders(stranger, { action: 'business:update', businessId, scope: businessId });
    const denied = await fetch(`${baseUrl()}/api/seller/businesses/${businessId}`, {
      method: 'PATCH',
      headers: strangerUpdate,
      body: JSON.stringify({ name: 'Taken over' }),
    });
    expect(denied.status).toBe(403);

    const ownerUpdate = await signedHeaders(owner, { action: 'business:update', businessId, scope: businessId });
    const allowed = await fetch(`${baseUrl()}/api/seller/businesses/${businessId}`, {
      method: 'PATCH',
      headers: ownerUpdate,
      body: JSON.stringify({ name: 'P2 Seller renamed' }),
    });
    expect(allowed.status).toBe(200);
    const replay = await fetch(`${baseUrl()}/api/seller/businesses/${businessId}`, {
      method: 'PATCH',
      headers: ownerUpdate,
      body: JSON.stringify({ name: 'Replayed' }),
    });
    expect(replay.status).toBe(401);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).name).toBe('P2 Seller renamed');
  });

  it('consumes only on exact nonce, action, business and scope, once, before expiry', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const issueOne = () => issueSellerAuthorizationChallenge(prisma, {
      action: 'rules:create', businessId, scope: businessId, expiresAt,
    });
    const nonce = await issueOne();
    const exact = { nonce, action: 'rules:create', businessId, scope: businessId };
    for (const wrong of [
      { ...exact, action: 'rules:delete' },
      { ...exact, businessId: 'other-business' },
      { ...exact, scope: 'other-scope' },
      { ...exact, nonce: crypto.randomBytes(32).toString('hex') },
    ]) {
      await expect(consumeSellerAuthorizationChallenge(prisma, wrong)).rejects.toThrow('invalid, expired, or already used');
    }
    await expect(consumeSellerAuthorizationChallenge(prisma, exact)).resolves.toBeUndefined();
    await expect(consumeSellerAuthorizationChallenge(prisma, exact)).rejects.toThrow('already used');

    const expiredNonce = await issueOne();
    await prisma.sellerAuthorizationChallenge.update({
      where: { nonce: expiredNonce },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(consumeSellerAuthorizationChallenge(prisma, { ...exact, nonce: expiredNonce }))
      .rejects.toThrow('invalid, expired, or already used');
  });

  it('keeps our own clients from sending a wallet to the challenge endpoint', () => {
    const repo = path.resolve(__dirname, '..', '..', '..', '..');
    const sources = [
      'apps/benefits-network/frontend/src/lib/api.ts',
      'apps/benefits-network/backend/scripts/seller-wallet-smoke.js',
      'apps/sdk/src/benefits.ts',
      'apps/sdk/dist/benefits.js',
    ];
    for (const relative of sources) {
      const source = fs.readFileSync(path.join(repo, relative), 'utf8');
      const start = source.indexOf('auth-message');
      expect(start).toBeGreaterThan(-1);
      // The function that builds the challenge request takes no wallet and its query carries none.
      const fnStart = Math.max(source.lastIndexOf('function ', start), source.lastIndexOf('async ', start));
      expect(fnStart).toBeGreaterThan(-1);
      const queries = source.slice(fnStart, start + 400).match(/URLSearchParams\(\{[^}]*\}\)/g) ?? [];
      expect(queries.length).toBeGreaterThan(0);
      const sendsWallet = /wallet/i.test(source.slice(fnStart, start).replace(/^.*\n/, '').replace(/\/\/.*$/gm, ''))
        || queries.some((query) => /wallet/i.test(query));
      expect({ file: relative, sendsWallet }).toEqual({ file: relative, sendsWallet: false });
    }
  });
});
