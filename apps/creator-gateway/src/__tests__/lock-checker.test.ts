import { describe, expect, test, vi } from 'vitest';
import { LockChecker } from '../services/lock-checker';

vi.mock('ethers', async () => {
  const actual = await vi.importActual<typeof import('ethers')>('ethers');
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: vi.fn().mockImplementation(function () { return {}; }),
      Contract: vi.fn().mockImplementation(function () { return {
        isLocked: vi.fn(),
        lockedBalance: vi.fn(),
      }; }),
    },
  };
});

describe('LockChecker', () => {
  test('returns false on RPC error (fail-closed)', async () => {
    const checker = new LockChecker();
    (checker as any).contract.isLocked = vi.fn().mockRejectedValue(new Error('RPC Error'));
    const result = await checker.isLocked('0x1234567890123456789012345678901234567890');
    expect(result).toBe(false);
  });

  test('returns true when contract returns true', async () => {
    const checker = new LockChecker();
    (checker as any).contract.isLocked = vi.fn().mockResolvedValue(true);
    const result = await checker.isLocked('0x1234567890123456789012345678901234567890', '1000');
    expect(result).toBe(true);
  });

  test('returns false when contract returns false', async () => {
    const checker = new LockChecker();
    (checker as any).contract.isLocked = vi.fn().mockResolvedValue(false);
    const result = await checker.isLocked('0x1234567890123456789012345678901234567890', '5000');
    expect(result).toBe(false);
  });

  test('returns 0 on lockedBalance RPC error', async () => {
    const checker = new LockChecker();
    (checker as any).contract.lockedBalance = vi.fn().mockRejectedValue(new Error('RPC'));
    const amount = await checker.lockedBalance('0x1234567890123456789012345678901234567890');
    expect(amount).toBe('0');
  });
});
