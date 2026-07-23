import { ethers } from 'ethers';
import { config } from '../config';
import type { LockSource, VerifiedLockSource } from './lockSource';

const IFRLOCK_ABI = [
  'function isLocked(address user, uint256 minAmount) view returns (bool)',
  'function lockedBalance(address user) view returns (uint256)',
  'function lockInfo(address user) view returns (uint256 amount, uint256 lockedAt)',
  'function token() view returns (address)',
];
const COMMITMENT_VAULT_ABI = [
  'function ifrToken() view returns (address)',
  'function getTranches(address wallet) view returns (tuple(uint256 amount,uint8 cType,uint256 unlockTime,uint256 p0Multiplier,bool unlocked,uint256 conditionMetAt)[])',
];
const ERC20_BALANCE_ABI = ['function balanceOf(address account) view returns (uint256)'];

const IFR_DECIMALS = 9;
const MAX_COMMITMENT_TRANCHES = 50;

let provider: ethers.JsonRpcProvider;
let ifrLock: ethers.Contract;
let commitmentVault: ethers.Contract;

export function initProvider(): void {
  provider = new ethers.JsonRpcProvider(config.RPC_URL);
  ifrLock = new ethers.Contract(config.IFRLOCK_ADDRESS, IFRLOCK_ABI, provider);
  commitmentVault = new ethers.Contract(
    config.COMMITMENT_VAULT_ADDRESS,
    COMMITMENT_VAULT_ABI,
    provider
  );
}

function canonicalAddress(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(`${label} returned an invalid address`);
  }
  return ethers.getAddress(value);
}

function requireContractCode(code: unknown, label: string): void {
  if (typeof code !== 'string' || code === '0x' || code.length <= 2) {
    throw new Error(`${label} bytecode is missing`);
  }
}

function tupleValue(value: unknown, name: string, index: number): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const tuple = value as Record<string | number, unknown>;
  return tuple[name] ?? tuple[index];
}

export function sumActiveTimeOnlyTranches(rawTranches: unknown): bigint {
  if (!Array.isArray(rawTranches)) {
    throw new Error('CommitmentVault returned malformed tranches');
  }
  if (rawTranches.length > MAX_COMMITMENT_TRANCHES) {
    throw new Error('CommitmentVault returned too many tranches');
  }

  let total = 0n;
  for (const raw of rawTranches) {
    const amount = tupleValue(raw, 'amount', 0);
    const cTypeValue = tupleValue(raw, 'cType', 1);
    const unlocked = tupleValue(raw, 'unlocked', 4);
    if (typeof amount !== 'bigint' || amount < 0n) {
      throw new Error('CommitmentVault returned an invalid tranche amount');
    }
    if (
      (typeof cTypeValue !== 'bigint' && typeof cTypeValue !== 'number') ||
      !Number.isInteger(Number(cTypeValue)) ||
      Number(cTypeValue) < 0 ||
      Number(cTypeValue) > 3
    ) {
      throw new Error('CommitmentVault returned an invalid condition type');
    }
    if (typeof unlocked !== 'boolean') {
      throw new Error('CommitmentVault returned an invalid unlocked flag');
    }

    // Price-conditioned tranches are deliberately excluded until a separate,
    // audited oracle-backed vault exists.
    if (!unlocked && Number(cTypeValue) === 0 && amount > 0n) total += amount;
  }
  return total;
}

export type BenefitEligibility = {
  eligible: boolean;
  lockEligible: boolean;
  heldEligible: boolean;
  lockedAmount: string;
  walletAmount: string | null;
  walletBalanceRaw: string | null;
  ifrLockAmount: string | null;
  commitmentAmount: string | null;
  verifiedLockSource: VerifiedLockSource | null;
  verificationBlock: number;
};

function validateThreshold(value: number, label: string, allowZero = false): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${label} must be ${allowZero ? 'a nonnegative' : 'a positive'} safe integer`);
  }
}

/**
 * Verify the selected lock source and optional free-wallet threshold at one
 * Ethereum block. TIME_ONLY is the only CommitmentVault condition accepted.
 */
export async function checkBenefitEligibility(
  address: string,
  requiredLockIFR: number,
  minIFRHeld: number,
  lockSource: LockSource = 'ifrlock'
): Promise<BenefitEligibility> {
  validateThreshold(requiredLockIFR, 'Required lock threshold');
  validateThreshold(minIFRHeld, 'Held IFR threshold', true);
  const wallet = canonicalAddress(address, 'Wallet');
  const expectedToken = canonicalAddress(config.IFR_TOKEN_ADDRESS, 'Configured IFR token');
  const blockTag = await provider.getBlockNumber();

  const needsIFRLock = lockSource === 'ifrlock' || lockSource === 'either';
  const needsCommitment = lockSource === 'commitment_time_only' || lockSource === 'either';
  const requiredLockUnits = BigInt(requiredLockIFR) * 10n ** BigInt(IFR_DECIMALS);
  const requiredHeldUnits = BigInt(minIFRHeld) * 10n ** BigInt(IFR_DECIMALS);

  const [
    network,
    ifrLockCode,
    expectedTokenCode,
    ifrLockTokenValue,
    commitmentCode,
    commitmentTokenValue,
    ifrLockEligibleValue,
    ifrLockBalanceValue,
    commitmentTranchesValue,
  ] = await Promise.all([
    provider.getNetwork(),
    needsIFRLock
      ? provider.getCode(config.IFRLOCK_ADDRESS, blockTag)
      : Promise.resolve('0x01'),
    provider.getCode(expectedToken, blockTag),
    needsIFRLock
      ? ifrLock.token({ blockTag }) as Promise<string>
      : Promise.resolve(expectedToken),
    needsCommitment
      ? provider.getCode(config.COMMITMENT_VAULT_ADDRESS, blockTag)
      : Promise.resolve('0x01'),
    needsCommitment
      ? commitmentVault.ifrToken({ blockTag }) as Promise<string>
      : Promise.resolve(expectedToken),
    needsIFRLock
      ? ifrLock.isLocked(wallet, requiredLockUnits, { blockTag }) as Promise<boolean>
      : Promise.resolve(false),
    needsIFRLock
      ? ifrLock.lockedBalance(wallet, { blockTag }) as Promise<bigint>
      : Promise.resolve(0n),
    needsCommitment
      ? commitmentVault.getTranches(wallet, { blockTag }) as Promise<unknown>
      : Promise.resolve([]),
  ]);

  if (Number(network.chainId) !== config.CHAIN_ID) {
    throw new Error(`Eligibility RPC is on chain ${network.chainId}, expected ${config.CHAIN_ID}`);
  }
  if (needsIFRLock) requireContractCode(ifrLockCode, 'IFRLock');
  requireContractCode(expectedTokenCode, 'IFR token');
  if (needsCommitment) requireContractCode(commitmentCode, 'CommitmentVault');

  if (needsIFRLock) {
    const ifrLockToken = canonicalAddress(ifrLockTokenValue, 'IFRLock token');
    if (ifrLockToken !== expectedToken) {
      throw new Error('IFRLock token does not match the configured IFR token');
    }
  }
  if (needsCommitment) {
    const commitmentToken = canonicalAddress(commitmentTokenValue, 'CommitmentVault token');
    if (commitmentToken !== expectedToken) {
      throw new Error('CommitmentVault token does not match the configured IFR token');
    }
  }
  if (typeof ifrLockEligibleValue !== 'boolean' || typeof ifrLockBalanceValue !== 'bigint') {
    throw new Error('IFRLock returned malformed eligibility data');
  }

  const ifrLockRaw = needsIFRLock ? ifrLockBalanceValue : null;
  const ifrLockEligible = needsIFRLock
    ? ifrLockEligibleValue && ifrLockBalanceValue >= requiredLockUnits
    : false;
  const commitmentRaw = needsCommitment
    ? sumActiveTimeOnlyTranches(commitmentTranchesValue)
    : null;
  const commitmentEligible = commitmentRaw !== null && commitmentRaw >= requiredLockUnits;
  const lockEligible = lockSource === 'ifrlock'
    ? ifrLockEligible
    : lockSource === 'commitment_time_only'
      ? commitmentEligible
      : ifrLockEligible || commitmentEligible;
  const verifiedLockSource: VerifiedLockSource | null = ifrLockEligible
    ? 'ifrlock'
    : commitmentEligible
      ? 'commitment_time_only'
      : null;
  const selectedRaw = verifiedLockSource === 'ifrlock'
    ? ifrLockRaw ?? 0n
    : verifiedLockSource === 'commitment_time_only'
      ? commitmentRaw ?? 0n
      : lockSource === 'commitment_time_only'
        ? commitmentRaw ?? 0n
        : lockSource === 'either'
          ? (ifrLockRaw ?? 0n) > (commitmentRaw ?? 0n)
            ? ifrLockRaw ?? 0n
            : commitmentRaw ?? 0n
          : ifrLockRaw ?? 0n;

  let walletRaw: bigint | null = null;
  if (minIFRHeld > 0) {
    const token = new ethers.Contract(expectedToken, ERC20_BALANCE_ABI, provider);
    const value = await token.balanceOf(wallet, { blockTag }) as unknown;
    if (typeof value !== 'bigint' || value < 0n) {
      throw new Error('IFR token returned an invalid wallet balance');
    }
    walletRaw = value;
  }
  const heldEligible = walletRaw === null || walletRaw >= requiredHeldUnits;

  return {
    eligible: lockEligible && heldEligible,
    lockEligible,
    heldEligible,
    lockedAmount: ethers.formatUnits(selectedRaw, IFR_DECIMALS),
    walletAmount: walletRaw === null ? null : ethers.formatUnits(walletRaw, IFR_DECIMALS),
    walletBalanceRaw: walletRaw?.toString() ?? null,
    ifrLockAmount: ifrLockRaw === null ? null : ethers.formatUnits(ifrLockRaw, IFR_DECIMALS),
    commitmentAmount: commitmentRaw === null ? null : ethers.formatUnits(commitmentRaw, IFR_DECIMALS),
    verifiedLockSource,
    verificationBlock: blockTag,
  };
}

export async function checkLock(
  address: string,
  requiredIFR: number
): Promise<{ eligible: boolean; lockedAmount: string }> {
  const result = await checkBenefitEligibility(address, requiredIFR, 0, 'ifrlock');
  return { eligible: result.eligible, lockedAmount: result.lockedAmount };
}

export function recoverSigner(message: string, signature: string): string {
  return ethers.verifyMessage(message, signature);
}
