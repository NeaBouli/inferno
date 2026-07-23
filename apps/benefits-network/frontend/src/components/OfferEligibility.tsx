'use client';

import Link from 'next/link';
import { useAccount, useReadContract } from 'wagmi';
import {
  CHAIN_ID,
  IFR_DECIMALS,
  IFRLOCK_ABI,
  IFRLOCK_ADDRESS,
  IFR_TOKEN_ABI,
  IFR_TOKEN_ADDRESS,
} from '@/lib/contracts';

const IFR_UNIT = BigInt(10) ** BigInt(IFR_DECIMALS);
const DISPLAY_SCALE = BigInt(1_000);
const DISPLAY_UNIT = IFR_UNIT / DISPLAY_SCALE;

export type IfrLockEligibility =
  | { status: 'disconnected' }
  | { status: 'wrong-chain' }
  | { status: 'checking' }
  | { status: 'unavailable' }
  | {
      status: 'ready';
      lockedRaw: bigint;
      walletBalanceStatus: 'checking' | 'unavailable' | 'ready';
      walletRaw: bigint | null;
    };

export function useIfrLockEligibility(): IfrLockEligibility {
  const { address, chainId, isConnected } = useAccount();
  const canRead = Boolean(
    isConnected &&
    address &&
    chainId === CHAIN_ID &&
    IFRLOCK_ADDRESS
  );
  const lockedBalance = useReadContract({
    address: IFRLOCK_ADDRESS || undefined,
    abi: IFRLOCK_ABI,
    functionName: 'lockedBalance',
    args: address ? [address] : undefined,
    query: { enabled: canRead, retry: false },
  });
  const walletBalance = useReadContract({
    address: IFR_TOKEN_ADDRESS || undefined,
    abi: IFR_TOKEN_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: canRead && Boolean(IFR_TOKEN_ADDRESS), retry: false },
  });

  if (!isConnected || !address) return { status: 'disconnected' };
  if (chainId !== CHAIN_ID) return { status: 'wrong-chain' };
  if (!IFRLOCK_ADDRESS || lockedBalance.isError) return { status: 'unavailable' };
  if (lockedBalance.isLoading || lockedBalance.data === undefined) return { status: 'checking' };
  return {
    status: 'ready',
    lockedRaw: lockedBalance.data as bigint,
    walletBalanceStatus: !IFR_TOKEN_ADDRESS || walletBalance.isError
      ? 'unavailable'
      : walletBalance.isLoading || walletBalance.data === undefined
        ? 'checking'
        : 'ready',
    walletRaw: walletBalance.data === undefined ? null : walletBalance.data as bigint,
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

export function OfferEligibility({
  requiredLockIFR,
  minIFRHeld,
  eligibility,
}: {
  requiredLockIFR: number;
  minIFRHeld: number;
  eligibility: IfrLockEligibility;
}) {
  const requiredRaw = requiredIFRRaw(requiredLockIFR);
  const heldRequiredRaw = requiredIFRRaw(minIFRHeld, true);
  let tone = 'border-stone-500 text-stone-300';
  let label = 'Eligibility unavailable';
  let detail = 'Final eligibility is verified at checkout.';
  let action = false;

  if (eligibility.status === 'disconnected') {
    label = 'Connect wallet to check';
    detail = 'No wallet data is sent to the seller.';
    action = true;
  } else if (eligibility.status === 'wrong-chain') {
    tone = 'border-orange-300 text-orange-100';
    label = 'Switch to Ethereum Mainnet';
    detail = 'Eligibility cannot be determined on another network.';
    action = true;
  } else if (eligibility.status === 'checking') {
    label = 'Checking locked IFR';
    detail = 'Reading IFRLock on Ethereum Mainnet.';
  } else if (
    eligibility.status === 'ready' &&
    requiredRaw !== null &&
    heldRequiredRaw !== null &&
    minIFRHeld > 0 &&
    eligibility.walletBalanceStatus === 'checking'
  ) {
    label = 'Checking IFR balances';
    detail = 'Reading IFRLock and the freely held wallet balance.';
  } else if (
    eligibility.status === 'ready' &&
    requiredRaw !== null &&
    heldRequiredRaw !== null &&
    minIFRHeld > 0 &&
    eligibility.walletBalanceStatus === 'unavailable'
  ) {
    label = 'Wallet balance unavailable';
    detail = 'Final eligibility will fail closed unless both balances can be verified.';
  } else if (eligibility.status === 'ready' && requiredRaw !== null && heldRequiredRaw !== null) {
    const zero = BigInt(0);
    const walletRaw = eligibility.walletRaw ?? zero;
    const lockDeficit = eligibility.lockedRaw >= requiredRaw ? zero : requiredRaw - eligibility.lockedRaw;
    const heldDeficit = walletRaw >= heldRequiredRaw ? zero : heldRequiredRaw - walletRaw;
    if (lockDeficit === zero && heldDeficit === zero) {
      tone = 'border-green-300 text-green-100';
      label = 'Eligible with this wallet';
      detail = minIFRHeld > 0
        ? 'The seller verifies both balances again at checkout.'
        : 'The seller verifies the lock again at checkout.';
    } else {
      tone = 'border-orange-300 text-orange-100';
      const purchaseDeficit = lockDeficit + heldRequiredRaw > walletRaw
        ? lockDeficit + heldRequiredRaw - walletRaw
        : zero;
      if (purchaseDeficit > zero) {
        label = `Add ${formatAdditionalIFR(purchaseDeficit)} IFR first`;
        detail = `Then lock ${formatAdditionalIFR(lockDeficit)} IFR while retaining ${minIFRHeld.toLocaleString('en-US')} IFR in the wallet.`;
      } else if (lockDeficit > zero) {
        label = `Lock ${formatAdditionalIFR(lockDeficit)} more IFR`;
        detail = minIFRHeld > 0
          ? `Retain at least ${minIFRHeld.toLocaleString('en-US')} IFR in the wallet after locking.`
          : 'Increase the IFRLock balance before checkout.';
      } else {
        label = `Hold ${formatAdditionalIFR(heldDeficit)} more IFR`;
        detail = 'Keep the minimum free IFR balance in this wallet before checkout.';
      }
      action = true;
    }
  }

  return (
    <div className={`mt-4 border-l-2 pl-3 ${tone}`} data-offer-eligibility={eligibility.status}>
      <p className="text-xs font-black uppercase tracking-[0.12em]">{label}</p>
      <p className="mt-1 text-xs leading-5 text-stone-400">{detail}</p>
      {action ? (
        <Link href="/#customer-wallet" className="mt-2 inline-flex text-xs font-black text-orange-100 underline decoration-orange-300/60 underline-offset-4">
          Open wallet and lock panel
        </Link>
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
        : eligibility.status === 'unavailable'
          ? 'Wallet eligibility is unavailable.'
          : 'Wallet eligibility updated for the visible offers.';

  return <p role="status" aria-live="polite" className="sr-only">{message}</p>;
}
