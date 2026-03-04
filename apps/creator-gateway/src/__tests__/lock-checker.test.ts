import { LockChecker } from '../services/lock-checker';

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      providers: {
        JsonRpcProvider: jest.fn().mockImplementation(() => ({})),
      },
      Contract: jest.fn().mockImplementation(() => ({
        isLocked: jest.fn(),
        lockedBalance: jest.fn(),
      })),
      utils: actual.ethers.utils,
    },
  };
});

describe('LockChecker', () => {
  test('returns false on RPC error (fail-closed)', async () => {
    const checker = new LockChecker();
    (checker as any).contract.isLocked = jest.fn().mockRejectedValue(new Error('RPC Error'));
    const result = await checker.isLocked('0x1234567890123456789012345678901234567890');
    expect(result).toBe(false);
  });

  test('returns true when contract returns true', async () => {
    const checker = new LockChecker();
    (checker as any).contract.isLocked = jest.fn().mockResolvedValue(true);
    const result = await checker.isLocked('0x1234567890123456789012345678901234567890', '1000');
    expect(result).toBe(true);
  });

  test('returns false when contract returns false', async () => {
    const checker = new LockChecker();
    (checker as any).contract.isLocked = jest.fn().mockResolvedValue(false);
    const result = await checker.isLocked('0x1234567890123456789012345678901234567890', '5000');
    expect(result).toBe(false);
  });

  test('returns 0 on lockedBalance RPC error', async () => {
    const checker = new LockChecker();
    (checker as any).contract.lockedBalance = jest.fn().mockRejectedValue(new Error('RPC'));
    const amount = await checker.lockedBalance('0x1234567890123456789012345678901234567890');
    expect(amount).toBe('0');
  });
});
