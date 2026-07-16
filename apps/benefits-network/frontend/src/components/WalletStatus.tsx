'use client';

import { useAccount, useBalance, useReadContract } from 'wagmi';
import { formatEther } from 'viem';
import { WalletConnectControl } from '@/components/WalletConnectControl';
import { IFR_DECIMALS, IFRLOCK_ABI, IFRLOCK_ADDRESS, IFR_TOKEN_ADDRESS, formatIFR } from '@/lib/contracts';

const MIN_CUSTOMER_LOCK = 1000;
const MIN_CUSTOMER_LOCK_RAW = BigInt(MIN_CUSTOMER_LOCK) * BigInt(10) ** BigInt(IFR_DECIMALS);
const BENEFIT_TIERS = [
  { label: 'Bronze', amount: 1000 },
  { label: 'Silver', amount: 5000 },
  { label: 'Gold', amount: 25000 },
  { label: 'Diamond', amount: 100000 },
];
const UNISWAP_IFR_URL = 'https://app.uniswap.org/swap?outputCurrency=0x77e99917Eca8539c62F509ED1193ac36580A6e7B';

function shortAddress(address?: string) {
  if (!address) return 'Not connected';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTokenAmount(value?: string) {
  if (!value) return '0 IFR';
  return `${Number(value).toLocaleString('en-US', { maximumFractionDigits: 3 })} IFR`;
}

function getTier(lockedRaw?: bigint) {
  if (!lockedRaw) return null;
  return [...BENEFIT_TIERS]
    .reverse()
    .find((tier) => lockedRaw >= BigInt(tier.amount) * BigInt(10) ** BigInt(IFR_DECIMALS)) ?? null;
}

export function WalletStatus() {
  const { address, isConnected } = useAccount();
  const ethBalance = useBalance({
    address,
    query: { enabled: Boolean(address) },
  });
  const ifrBalance = useBalance({
    address,
    token: IFR_TOKEN_ADDRESS || undefined,
    query: { enabled: Boolean(address && IFR_TOKEN_ADDRESS) },
  });
  const lockedBalance = useReadContract({
    address: IFRLOCK_ADDRESS || undefined,
    abi: IFRLOCK_ABI,
    functionName: 'lockedBalance',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && IFRLOCK_ADDRESS) },
  });
  const lockedRaw = lockedBalance.data as bigint | undefined;
  const ifrRaw = ifrBalance.data?.value;
  const ethRaw = ethBalance.data?.value;
  const tier = getTier(lockedRaw);
  const hasCustomerLock = Boolean(lockedRaw && lockedRaw >= MIN_CUSTOMER_LOCK_RAW);
  const hasIFR = Boolean(ifrRaw && ifrRaw > BigInt(0));
  const hasEth = Boolean(ethRaw && ethRaw > BigInt(0));
  const statusLabel = !isConnected
    ? 'Connect wallet'
    : hasCustomerLock
      ? 'Ready for checkout'
      : hasIFR
        ? 'Lock IFR'
        : 'Get IFR';
  const statusText = !isConnected
    ? 'Connect a wallet to read IFR balance, ETH gas and locked access.'
    : hasCustomerLock
      ? `Eligible for typical ${MIN_CUSTOMER_LOCK.toLocaleString('en-US')} IFR customer rules. Some sellers may require a higher tier.`
      : hasIFR
        ? 'You hold IFR, but it is not locked for access yet. Lock IFR before scanning seller QR codes.'
        : 'No IFR detected in this wallet. Buy IFR first, then lock it for benefits.';
  const checklist = [
    { label: 'Wallet connected', done: isConnected },
    { label: 'ETH for gas', done: hasEth },
    { label: 'IFR in wallet', done: hasIFR || hasCustomerLock },
    { label: `${MIN_CUSTOMER_LOCK.toLocaleString('en-US')}+ IFR locked`, done: hasCustomerLock },
  ];

  return (
    <section className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/30 backdrop-blur">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-200/80">
            Customer wallet
          </p>
          <h2 className="mt-1 text-2xl font-black text-white">Access status</h2>
        </div>
        <WalletConnectControl />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-stone-400">Wallet</p>
          <p className="mt-2 text-lg font-bold">{shortAddress(address)}</p>
          <p className="mt-1 text-xs text-stone-400">{isConnected ? 'Connected' : 'Connect to read status'}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-stone-400">IFR balance</p>
          <p className="mt-2 text-lg font-bold">
            {formatTokenAmount(ifrBalance.data?.formatted)}
          </p>
          <p className="mt-1 break-words text-xs text-stone-400">
            {IFR_TOKEN_ADDRESS ? 'ERC-20' : 'Set NEXT_PUBLIC_IFR_TOKEN_ADDRESS'}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-stone-400">IFR locked</p>
          <p className="mt-2 text-lg font-bold">{formatIFR(lockedBalance.data as bigint | undefined)} IFR</p>
          <p className="mt-1 text-xs text-stone-400">
            ETH {ethBalance.data ? Number(formatEther(ethBalance.data.value)).toLocaleString('en-US', { maximumFractionDigits: 5 }) : '0'}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-[1.5rem] border border-orange-200/15 bg-[linear-gradient(145deg,rgba(249,115,22,0.14),rgba(255,255,255,0.055)_50%,rgba(20,83,45,0.12))] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-200/80">
              Checkout readiness
            </p>
            <h3 className="mt-1 text-xl font-black text-white">{statusLabel}</h3>
            <p className="mt-2 max-w-xl text-sm leading-6 text-stone-300">{statusText}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-right">
            <p className="text-xs uppercase tracking-[0.14em] text-stone-400">Current tier</p>
            <p className="mt-1 text-lg font-black text-orange-100">{tier?.label || 'None'}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          {checklist.map((item) => (
            <div
              key={item.label}
              className={`rounded-2xl border px-3 py-3 text-sm ${
                item.done
                  ? 'border-green-300/20 bg-green-300/10 text-green-100'
                  : 'border-white/10 bg-black/20 text-stone-300'
              }`}
            >
              <span className="font-black">{item.done ? 'Ready' : 'Needed'}</span>
              <p className="mt-1 text-xs leading-5 opacity-85">{item.label}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <a
            href="https://web3.ifrunit.tech"
            className="rounded-2xl bg-orange-300 px-4 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-orange-950/25 transition hover:-translate-y-0.5 hover:bg-orange-200"
          >
            Lock IFR
          </a>
          <a
            href={UNISWAP_IFR_URL}
            target="_blank"
            rel="noopener"
            className="rounded-2xl border border-white/15 px-4 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-orange-200/60"
          >
            Buy IFR
          </a>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {BENEFIT_TIERS.map((item) => {
            const active = Boolean(lockedRaw && lockedRaw >= BigInt(item.amount) * BigInt(10) ** BigInt(IFR_DECIMALS));
            return (
              <span
                key={item.label}
                className={`rounded-full border px-3 py-2 text-xs font-bold ${
                  active
                    ? 'border-green-300/25 bg-green-300/10 text-green-100'
                    : 'border-white/10 bg-black/20 text-stone-400'
                }`}
              >
                {item.label} / {item.amount.toLocaleString('en-US')} IFR
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}
