'use client';

import Link from 'next/link';
import { useAccount, useBlockNumber, useReadContract } from 'wagmi';
import type { LockSource } from '@/lib/api';
import { sumPreviewTimeOnlyTranches } from '@/lib/lockSource';
import {
  CHAIN_ID,
  COMMITMENT_VAULT_ABI,
  COMMITMENT_VAULT_ADDRESS,
  IFR_DECIMALS,
  IFRLOCK_ABI,
  IFRLOCK_ADDRESS,
  IFR_TOKEN_ABI,
  IFR_TOKEN_ADDRESS,
} from '@/lib/contracts';

const IFR_UNIT = BigInt(10) ** BigInt(IFR_DECIMALS);
const DISPLAY_SCALE = BigInt(1_000);
const DISPLAY_UNIT = IFR_UNIT / DISPLAY_SCALE;

type BalanceRead =
  | { status: 'checking'; raw: null }
  | { status: 'unavailable'; raw: null }
  | { status: 'ready'; raw: bigint };

export type IfrLockEligibility =
  | { status: 'disconnected' }
  | { status: 'wrong-chain' }
  | { status: 'checking' }
  | {
      status: 'ready';
      ifrLock: BalanceRead;
      commitmentTimeOnly: BalanceRead;
      walletBalance: BalanceRead;
      blockNumber: bigint;
    };

function addressMatches(value: unknown, expected: string): boolean {
  return typeof value === 'string' && value.toLowerCase() === expected.toLowerCase();
}

export function useIfrLockEligibility(): IfrLockEligibility {
  const { address, chainId, isConnected } = useAccount();
  const canRead = Boolean(
    isConnected &&
    address &&
    chainId === CHAIN_ID &&
    IFR_TOKEN_ADDRESS &&
    IFRLOCK_ADDRESS
  );
  const blockNumber = useBlockNumber({
    watch: true,
    query: { enabled: canRead, retry: false },
  });
  const pinnedBlock = blockNumber.data;
  const queryEnabled = canRead && pinnedBlock !== undefined;
  const ifrLockToken = useReadContract({
    address: IFRLOCK_ADDRESS || undefined,
    abi: IFRLOCK_ABI,
    functionName: 'token',
    blockNumber: pinnedBlock,
    query: { enabled: queryEnabled, retry: false },
  });
  const lockedBalance = useReadContract({
    address: IFRLOCK_ADDRESS || undefined,
    abi: IFRLOCK_ABI,
    functionName: 'lockedBalance',
    args: address ? [address] : undefined,
    blockNumber: pinnedBlock,
    query: { enabled: queryEnabled, retry: false },
  });
  const commitmentToken = useReadContract({
    address: COMMITMENT_VAULT_ADDRESS || undefined,
    abi: COMMITMENT_VAULT_ABI,
    functionName: 'ifrToken',
    blockNumber: pinnedBlock,
    query: { enabled: queryEnabled && Boolean(COMMITMENT_VAULT_ADDRESS), retry: false },
  });
  const commitmentTranches = useReadContract({
    address: COMMITMENT_VAULT_ADDRESS || undefined,
    abi: COMMITMENT_VAULT_ABI,
    functionName: 'getTranches',
    args: address ? [address] : undefined,
    blockNumber: pinnedBlock,
    query: { enabled: queryEnabled && Boolean(COMMITMENT_VAULT_ADDRESS), retry: false },
  });
  const walletBalance = useReadContract({
    address: IFR_TOKEN_ADDRESS || undefined,
    abi: IFR_TOKEN_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    blockNumber: pinnedBlock,
    query: { enabled: queryEnabled, retry: false },
  });

  if (!isConnected || !address) return { status: 'disconnected' };
  if (chainId !== CHAIN_ID) return { status: 'wrong-chain' };
  if (!queryEnabled || blockNumber.isLoading) return { status: 'checking' };

  const canonicalTokenReady = addressMatches(ifrLockToken.data, IFR_TOKEN_ADDRESS);
  const ifrLock: BalanceRead = (
    !IFRLOCK_ADDRESS ||
    ifrLockToken.isError ||
    lockedBalance.isError ||
    (ifrLockToken.data !== undefined && !canonicalTokenReady)
  )
    ? { status: 'unavailable', raw: null }
    : ifrLockToken.isLoading || lockedBalance.isLoading ||
      ifrLockToken.data === undefined || lockedBalance.data === undefined
      ? { status: 'checking', raw: null }
      : { status: 'ready', raw: lockedBalance.data as bigint };

  const commitmentTotal = sumPreviewTimeOnlyTranches(commitmentTranches.data);
  const commitmentIdentityReady = addressMatches(commitmentToken.data, IFR_TOKEN_ADDRESS);
  const commitmentTimeOnly: BalanceRead = (
    !COMMITMENT_VAULT_ADDRESS ||
    commitmentToken.isError ||
    commitmentTranches.isError ||
    (commitmentToken.data !== undefined && !commitmentIdentityReady) ||
    (commitmentTranches.data !== undefined && commitmentTotal === null)
  )
    ? { status: 'unavailable', raw: null }
    : commitmentToken.isLoading || commitmentTranches.isLoading ||
      commitmentToken.data === undefined || commitmentTranches.data === undefined
      ? { status: 'checking', raw: null }
      : { status: 'ready', raw: commitmentTotal ?? BigInt(0) };

  const wallet: BalanceRead = walletBalance.isError
    ? { status: 'unavailable', raw: null }
    : walletBalance.isLoading || walletBalance.data === undefined
      ? { status: 'checking', raw: null }
      : { status: 'ready', raw: walletBalance.data as bigint };

  return {
    status: 'ready',
    ifrLock,
    commitmentTimeOnly,
    walletBalance: wallet,
    blockNumber: pinnedBlock,
  };
}

function requiredIFRRaw(requiredIFR: number, allowZero = false): bigint | null {
  if (!Number.isSafeInteger(requiredIFR) || requiredIFR < (allowZero ? 0 : 1)) return null;
  return BigInt(requiredIFR) * IFR_UNIT;
}

function formatAdditionalIFR(raw: bigint): string {
  const roundedMillis = (raw + DISPLAY_UNIT - BigInt(1)) / DISPLAY_UNIT;
  const whole = roundedMillis / DISPLAY_SCALE;
  const fraction = (roundedMillis % DISPLAY_SCALE).toString().padStart(3, '0').replace(/0+$/, '');
  return fraction ? `${whole.toLocaleString('en-US')}.${fraction}` : whole.toLocaleString('en-US');
}

function sourceLabel(lockSource: LockSource): string {
  if (lockSource === 'ifrlock') return 'IFRLock';
  if (lockSource === 'commitment_time_only') return 'TIME_ONLY CommitmentVault';
  return 'IFRLock or TIME_ONLY CommitmentVault';
}

export function OfferEligibility({
  requiredLockIFR,
  minIFRHeld,
  lockSource,
  eligibility,
}: {
  requiredLockIFR: number;
  minIFRHeld: number;
  lockSource: LockSource;
  eligibility: IfrLockEligibility;
}) {
  const requiredRaw = requiredIFRRaw(requiredLockIFR);
  const heldRequiredRaw = requiredIFRRaw(minIFRHeld, true);
  let tone = 'border-stone-500 text-stone-300';
  let label = 'Eligibility unavailable';
  let detail = 'Final eligibility is verified at checkout.';
  let action = false;
  let commitmentAction = lockSource !== 'ifrlock';

  if (eligibility.status === 'disconnected') {
    label = 'Connect wallet to check';
    detail = 'No wallet data is sent to the seller.';
    action = true;
    commitmentAction = false;
  } else if (eligibility.status === 'wrong-chain') {
    tone = 'border-orange-300 text-orange-100';
    label = 'Switch to Ethereum Mainnet';
    detail = 'Eligibility cannot be determined on another network.';
    action = true;
    commitmentAction = false;
  } else if (eligibility.status === 'checking') {
    label = 'Checking locked IFR';
    detail = 'Reading the selected lock source on Ethereum Mainnet.';
  } else if (requiredRaw === null || heldRequiredRaw === null) {
    label = 'Invalid benefit threshold';
  } else {
    const requiredReads = lockSource === 'ifrlock'
      ? [eligibility.ifrLock]
      : lockSource === 'commitment_time_only'
        ? [eligibility.commitmentTimeOnly]
        : [eligibility.ifrLock, eligibility.commitmentTimeOnly];
    if (requiredReads.some((read) => read.status === 'checking')) {
      label = `Checking ${sourceLabel(lockSource)}`;
      detail = lockSource === 'either'
        ? 'The two lock balances are checked independently and never added together.'
        : 'The preview is pinned to one Ethereum block.';
    } else if (requiredReads.some((read) => read.status === 'unavailable')) {
      label = 'Lock preview unavailable';
      detail = 'Checkout will fail closed unless the selected on-chain source can be verified.';
    } else if (minIFRHeld > 0 && eligibility.walletBalance.status === 'checking') {
      label = 'Checking IFR balances';
      detail = 'Reading the lock source and freely held wallet balance at one block.';
    } else if (minIFRHeld > 0 && eligibility.walletBalance.status === 'unavailable') {
      label = 'Wallet balance unavailable';
      detail = 'Checkout will fail closed unless both conditions can be verified.';
    } else {
      const ifrRaw = eligibility.ifrLock.status === 'ready' ? eligibility.ifrLock.raw : BigInt(0);
      const commitmentRaw = eligibility.commitmentTimeOnly.status === 'ready'
        ? eligibility.commitmentTimeOnly.raw
        : BigInt(0);
      const sourceEligible = lockSource === 'ifrlock'
        ? ifrRaw >= requiredRaw
        : lockSource === 'commitment_time_only'
          ? commitmentRaw >= requiredRaw
          : ifrRaw >= requiredRaw || commitmentRaw >= requiredRaw;
      const walletRaw = eligibility.walletBalance.status === 'ready'
        ? eligibility.walletBalance.raw
        : BigInt(0);
      const heldEligible = walletRaw >= heldRequiredRaw;

      if (sourceEligible && heldEligible) {
        tone = 'border-green-300 text-green-100';
        label = 'Eligible with this wallet';
        detail = lockSource === 'either'
          ? 'At least one lock source independently meets the threshold. The seller verifies it again at checkout.'
          : `The seller verifies ${sourceLabel(lockSource)} again at checkout.`;
      } else if (!sourceEligible) {
        tone = 'border-orange-300 text-orange-100';
        action = true;
        if (lockSource === 'either') {
          label = `Reach ${requiredLockIFR.toLocaleString('en-US')} IFR in one lock`;
          detail = `IFRLock: ${formatAdditionalIFR(ifrRaw)} IFR. TIME_ONLY CommitmentVault: ${formatAdditionalIFR(commitmentRaw)} IFR. Partial balances are not combined.`;
        } else {
          const current = lockSource === 'ifrlock' ? ifrRaw : commitmentRaw;
          label = `Lock ${formatAdditionalIFR(requiredRaw - current)} more IFR`;
          detail = `Use ${sourceLabel(lockSource)}${minIFRHeld > 0 ? ` and retain ${minIFRHeld.toLocaleString('en-US')} IFR in the wallet` : ''}.`;
        }
      } else {
        tone = 'border-orange-300 text-orange-100';
        label = `Hold ${formatAdditionalIFR(heldRequiredRaw - walletRaw)} more IFR`;
        detail = 'Keep the minimum free IFR balance in this wallet before checkout.';
        action = true;
        commitmentAction = false;
      }
    }
  }

  return (
    <div className={`mt-4 border-l-2 pl-3 ${tone}`} data-offer-eligibility={eligibility.status}>
      <p className="text-xs font-black uppercase tracking-[0.12em]">{label}</p>
      <p className="mt-1 text-xs leading-5 text-stone-400">{detail}</p>
      {action ? (
        commitmentAction ? (
          <a
            href="https://web3.ifrunit.tech/?action=commitment-lock#access"
            className="mt-2 inline-flex text-xs font-black text-orange-100 underline decoration-orange-300/60 underline-offset-4"
          >
            Open TIME_ONLY commitment lock
          </a>
        ) : (
          <Link href="/#customer-wallet" className="mt-2 inline-flex text-xs font-black text-orange-100 underline decoration-orange-300/60 underline-offset-4">
            Open wallet and lock panel
          </Link>
        )
      ) : null}
    </div>
  );
}

export function EligibilityLiveSummary({ eligibility }: { eligibility: IfrLockEligibility }) {
  const message = eligibility.status === 'disconnected'
    ? 'Connect a wallet to check offer eligibility.'
    : eligibility.status === 'wrong-chain'
      ? 'Switch to Ethereum Mainnet to check offer eligibility.'
      : eligibility.status === 'checking'
        ? 'Checking wallet eligibility.'
        : 'Wallet eligibility updated for the visible offers.';

  return <p role="status" aria-live="polite" className="sr-only">{message}</p>;
}
