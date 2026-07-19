import { ethers } from 'ethers';
import { buildSellerAuthMessage, verifySellerSignature } from '../src/services/sellerAuth';
import { buildSellerBusinessLimitError } from '../src/services/sellerLimitPolicy';
import {
  MUTATING_SELLER_ACTIONS,
  READ_ONLY_SELLER_ACTIONS,
  isKnownSellerAction,
  isSafeSellerAuthorizationField,
  requiresSingleUseSellerChallenge,
} from '../src/services/sellerAuthorizationChallenge';

describe('Seller wallet authorization', () => {
  it('allowlists every seller action and requires one-time challenges only for mutations', () => {
    expect(MUTATING_SELLER_ACTIONS).toEqual([
      'business:create',
      'business:update',
      'business:delete',
      'operators:create',
      'operators:delete',
      'products:create',
      'products:update',
      'products:delete',
      'rewards:apply',
      'rules:create',
      'rules:update',
      'rules:delete',
      'sessions:create',
      'sessions:redeem',
      'passes:bind',
    ]);
    expect(READ_ONLY_SELLER_ACTIONS.every((action) => isKnownSellerAction(action))).toBe(true);
    expect(MUTATING_SELLER_ACTIONS.every((action) => requiresSingleUseSellerChallenge(action))).toBe(true);
    expect(READ_ONLY_SELLER_ACTIONS.some((action) => requiresSingleUseSellerChallenge(action))).toBe(false);
    expect(isKnownSellerAction('business:transfer')).toBe(false);
    expect(isSafeSellerAuthorizationField('business_123')).toBe(true);
    expect(isSafeSellerAuthorizationField(' business_123')).toBe(false);
    expect(isSafeSellerAuthorizationField('business_123\nNonce: misleading')).toBe(false);
  });

  it('rejects a partially bound authorization instead of falling back to an unbound message', async () => {
    const wallet = ethers.Wallet.createRandom();
    const timestamp = Date.now().toString();
    const signature = await wallet.signMessage(
      buildSellerAuthMessage('rules:update', 'biz_123', timestamp)
    );

    expect(() => verifySellerSignature({
      walletAddress: wallet.address,
      signature,
      timestamp,
      action: 'rules:update',
      businessId: 'biz_123',
      nonce: 'nonce-without-scope',
    })).toThrow('Incomplete seller authorization binding');
  });

  it('rejects an unbound signature for every mutating action', async () => {
    const wallet = ethers.Wallet.createRandom();
    const timestamp = Date.now().toString();
    const signature = await wallet.signMessage(
      buildSellerAuthMessage('rules:update', 'biz_123', timestamp)
    );

    expect(() => verifySellerSignature({
      walletAddress: wallet.address,
      signature,
      timestamp,
      action: 'rules:update',
      businessId: 'biz_123',
    })).toThrow('binding is required for mutations');
  });

  it('builds the deterministic seller auth message format', () => {
    const message = buildSellerAuthMessage('business:list', 'seller', '1784154000000');

    expect(message).toBe([
      'IFR Benefits Network - Seller Authorization',
      'Action: business:list',
      'Business: seller',
      'Timestamp: 1784154000000',
      'Only sign this message inside shop.ifrunit.tech.',
    ].join('\n'));
  });

  it('verifies a seller wallet signature for a business action', async () => {
    const wallet = ethers.Wallet.createRandom();
    const timestamp = Date.now().toString();
    const binding = { nonce: 'nonce_rules_create', scope: 'biz_123' };
    const message = buildSellerAuthMessage('rules:create', 'biz_123', timestamp, binding);
    const signature = await wallet.signMessage(message);

    const recovered = verifySellerSignature({
      walletAddress: wallet.address,
      signature,
      timestamp,
      action: 'rules:create',
      businessId: 'biz_123',
      ...binding,
    });

    expect(recovered).toBe(wallet.address);
  });

  it('rejects signatures for a different action', async () => {
    const wallet = ethers.Wallet.createRandom();
    const timestamp = Date.now().toString();
    const binding = { nonce: 'nonce_rules_action', scope: 'biz_123' };
    const signature = await wallet.signMessage(
      buildSellerAuthMessage('rules:create', 'biz_123', timestamp, binding)
    );

    expect(() =>
      verifySellerSignature({
        walletAddress: wallet.address,
        signature,
        timestamp,
        action: 'rules:delete',
        businessId: 'biz_123',
        ...binding,
      })
    ).toThrow('signature mismatch');
  });

  it('rejects stale seller authorizations', async () => {
    const wallet = ethers.Wallet.createRandom();
    const timestamp = String(Date.now() - 11 * 60 * 1000);
    const binding = { nonce: 'nonce_stale_business', scope: 'new' };
    const signature = await wallet.signMessage(
      buildSellerAuthMessage('business:create', 'new', timestamp, binding)
    );

    expect(() =>
      verifySellerSignature({
        walletAddress: wallet.address,
        signature,
        timestamp,
        action: 'business:create',
        businessId: 'new',
        ...binding,
      })
    ).toThrow('expired');
  });

  it('verifies the seller profile list action message', async () => {
    const wallet = ethers.Wallet.createRandom();
    const timestamp = Date.now().toString();
    const signature = await wallet.signMessage(
      buildSellerAuthMessage('business:list', 'seller', timestamp)
    );

    expect(
      verifySellerSignature({
        walletAddress: wallet.address,
        signature,
        timestamp,
        action: 'business:list',
        businessId: 'seller',
      })
    ).toBe(wallet.address);
  });

  it('verifies the seller profile delete action message', async () => {
    const wallet = ethers.Wallet.createRandom();
    const timestamp = Date.now().toString();
    const binding = { nonce: 'nonce_business_delete', scope: 'biz_delete' };
    const signature = await wallet.signMessage(
      buildSellerAuthMessage('business:delete', 'biz_delete', timestamp, binding)
    );

    expect(
      verifySellerSignature({
        walletAddress: wallet.address,
        signature,
        timestamp,
        action: 'business:delete',
        businessId: 'biz_delete',
        ...binding,
      })
    ).toBe(wallet.address);
  });

  it('verifies the seller redeem action message', async () => {
    const wallet = ethers.Wallet.createRandom();
    const timestamp = Date.now().toString();
    const binding = { nonce: 'nonce_session_redeem', scope: 'session_redeem' };
    const signature = await wallet.signMessage(
      buildSellerAuthMessage('sessions:redeem', 'session_redeem', timestamp, binding)
    );

    expect(
      verifySellerSignature({
        walletAddress: wallet.address,
        signature,
        timestamp,
        action: 'sessions:redeem',
        businessId: 'session_redeem',
        ...binding,
      })
    ).toBe(wallet.address);
  });

  it('builds a seller profile limit error once the active profile cap is reached', () => {
    expect(buildSellerBusinessLimitError(4, 5)).toBeNull();
    expect(buildSellerBusinessLimitError(5, 5)?.message).toContain('profile limit reached: 5/5');
  });
});
