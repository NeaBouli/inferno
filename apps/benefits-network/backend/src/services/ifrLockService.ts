import { ethers } from 'ethers';
import { config } from '../config';

const IFRLOCK_ABI = [
  'function isLocked(address user, uint256 minAmount) view returns (bool)',
  'function lockedBalance(address user) view returns (uint256)',
  'function lockInfo(address user) view returns (uint256 amount, uint256 lockedAt)',
  'function token() view returns (address)',
];
const ERC20_BALANCE_ABI = ['function balanceOf(address account) view returns (uint256)'];

const IFR_DECIMALS = 9;

let provider: ethers.JsonRpcProvider;
let ifrLock: ethers.Contract;

export function initProvider(): void {
  provider = new ethers.JsonRpcProvider(config.RPC_URL);
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
  const minUnits = BigInt(requiredIFR) * 10n ** BigInt(IFR_DECIMALS);

  const [eligible, rawBalance] = await Promise.all([
    ifrLock.isLocked(address, minUnits) as Promise<boolean>,
    ifrLock.lockedBalance(address) as Promise<bigint>,
  ]);

  const lockedAmount = ethers.formatUnits(rawBalance, IFR_DECIMALS);

  return { eligible, lockedAmount };
}

export type BenefitEligibility = {
  eligible: boolean;
  lockEligible: boolean;
  heldEligible: boolean;
  lockedAmount: string;
  walletAmount: string;
  walletBalanceRaw: string;
};

/**
 * Check the IFRLock threshold and a separate freely-held IFR wallet threshold
 * against one block. The token address comes from IFRLock's immutable token().
 */
export async function checkBenefitEligibility(
  address: string,
  requiredLockIFR: number,
  minIFRHeld: number
): Promise<BenefitEligibility> {
  if (!Number.isSafeInteger(requiredLockIFR) || requiredLockIFR <= 0) {
    throw new Error('Required IFRLock threshold must be a positive safe integer');
  }
  if (!Number.isSafeInteger(minIFRHeld) || minIFRHeld <= 0) {
    throw new Error('Held IFR threshold must be a positive safe integer');
  }

  const blockTag = await provider.getBlockNumber();
  const tokenAddress = await ifrLock.token({ blockTag }) as string;
  if (!ethers.isAddress(tokenAddress) || tokenAddress === ethers.ZeroAddress) {
    throw new Error('IFRLock returned an invalid token address');
  }

  const token = new ethers.Contract(tokenAddress, ERC20_BALANCE_ABI, provider);
  const requiredLockUnits = BigInt(requiredLockIFR) * 10n ** BigInt(IFR_DECIMALS);
  const requiredHeldUnits = BigInt(minIFRHeld) * 10n ** BigInt(IFR_DECIMALS);
  const [lockEligible, lockedRaw, walletRaw] = await Promise.all([
    ifrLock.isLocked(address, requiredLockUnits, { blockTag }) as Promise<boolean>,
    ifrLock.lockedBalance(address, { blockTag }) as Promise<bigint>,
    token.balanceOf(address, { blockTag }) as Promise<bigint>,
  ]);
  const heldEligible = walletRaw >= requiredHeldUnits;

  return {
    eligible: lockEligible && heldEligible,
    lockEligible,
    heldEligible,
    lockedAmount: ethers.formatUnits(lockedRaw, IFR_DECIMALS),
    walletAmount: ethers.formatUnits(walletRaw, IFR_DECIMALS),
    walletBalanceRaw: walletRaw.toString(),
  };
}

/**
 * Verify an EIP-191 personal_sign message.
 * @returns The recovered wallet address (checksummed)
 */
export function recoverSigner(message: string, signature: string): string {
  return ethers.verifyMessage(message, signature);
}
