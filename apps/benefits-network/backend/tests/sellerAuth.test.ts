import { ethers } from 'ethers';
import { buildSellerAuthMessage, verifySellerSignature } from '../src/services/sellerAuth';

describe('Seller wallet authorization', () => {
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
});
