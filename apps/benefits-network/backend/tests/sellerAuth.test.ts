import { ethers } from 'ethers';
import { buildSellerAuthMessage, verifySellerSignature } from '../src/services/sellerAuth';
import { buildSellerBusinessLimitError } from '../src/services/sellerLimitPolicy';

describe('Seller wallet authorization', () => {
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
    const message = buildSellerAuthMessage('rules:create', 'biz_123', timestamp);
    const signature = await wallet.signMessage(message);

    const recovered = verifySellerSignature({
      walletAddress: wallet.address,
      signature,
      timestamp,
      action: 'rules:create',
      businessId: 'biz_123',
    });

    expect(recovered).toBe(wallet.address);
  });

  it('rejects signatures for a different action', async () => {
    const wallet = ethers.Wallet.createRandom();
    const timestamp = Date.now().toString();
    const signature = await wallet.signMessage(
      buildSellerAuthMessage('rules:create', 'biz_123', timestamp)
    );

    expect(() =>
      verifySellerSignature({
        walletAddress: wallet.address,
        signature,
        timestamp,
        action: 'rules:delete',
        businessId: 'biz_123',
      })
    ).toThrow('signature mismatch');
  });

  it('rejects stale seller authorizations', async () => {
    const wallet = ethers.Wallet.createRandom();
    const timestamp = String(Date.now() - 11 * 60 * 1000);
    const signature = await wallet.signMessage(
      buildSellerAuthMessage('business:create', 'new', timestamp)
    );

    expect(() =>
      verifySellerSignature({
        walletAddress: wallet.address,
        signature,
        timestamp,
        action: 'business:create',
        businessId: 'new',
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

  it('builds a seller profile limit error once the active profile cap is reached', () => {
    expect(buildSellerBusinessLimitError(4, 5)).toBeNull();
    expect(buildSellerBusinessLimitError(5, 5)?.message).toContain('profile limit reached: 5/5');
  });
});
