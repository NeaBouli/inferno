import crypto from 'crypto';
import { ethers } from 'ethers';
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
