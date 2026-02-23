import { ethers } from 'ethers';
import { config } from '../config';

const IFRLOCK_ABI = [
  'function isLocked(address user, uint256 minAmount) view returns (bool)',
  'function lockedBalance(address user) view returns (uint256)',
  'function lockInfo(address user) view returns (uint256 amount, uint256 lockedAt)',
];

const IFR_DECIMALS = 9;

let provider: ethers.providers.JsonRpcProvider;
let ifrLock: ethers.Contract;

export function initProvider(): void {
  provider = new ethers.providers.JsonRpcProvider(config.RPC_URL);
  ifrLock = new ethers.Contract(config.IFRLOCK_ADDRESS, IFRLOCK_ABI, provider);
}

/**
 * Check if a wallet has enough IFR locked.
 * @param address - Wallet address to check
 * @param requiredIFR - Required IFR in human units (e.g. 5000)
 * @returns { eligible, lockedAmount } where lockedAmount is in human units
 */
export async function checkLock(
  address: string,
  requiredIFR: number
): Promise<{ eligible: boolean; lockedAmount: string }> {
  const minUnits = ethers.BigNumber.from(requiredIFR).mul(
    ethers.BigNumber.from(10).pow(IFR_DECIMALS)
  );

  const [eligible, rawBalance] = await Promise.all([
    ifrLock.isLocked(address, minUnits) as Promise<boolean>,
    ifrLock.lockedBalance(address) as Promise<ethers.BigNumber>,
  ]);

  const lockedAmount = ethers.utils.formatUnits(rawBalance, IFR_DECIMALS);

  return { eligible, lockedAmount };
}

/**
 * Verify an EIP-191 personal_sign message.
 * @returns The recovered wallet address (checksummed)
 */
export function recoverSigner(message: string, signature: string): string {
  return ethers.utils.verifyMessage(message, signature);
}
