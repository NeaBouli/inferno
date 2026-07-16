'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useBalance, useReadContract } from 'wagmi';
import { formatEther } from 'viem';
import { IFRLOCK_ABI, IFRLOCK_ADDRESS, IFR_TOKEN_ADDRESS, formatIFR } from '@/lib/contracts';
import { hasWalletConnectProjectId } from '@/lib/wagmi';

function shortAddress(address?: string) {
  if (!address) return 'Not connected';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function WalletConfigNotice() {
  return (
    <section className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/30 backdrop-blur">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-200/80">
          Customer wallet
        </p>
        <h2 className="mt-1 text-2xl font-black text-white">Wallet connection is being prepared</h2>
        <p className="mt-3 text-sm leading-6 text-stone-300">
          This deployment still needs its WalletConnect project key before the multi-wallet connector is enabled.
          After that, MetaMask, Rainbow, Trust Wallet, Coinbase, OKX and WalletConnect-compatible wallets can connect here.
        </p>
        <p className="mt-2 break-words text-xs leading-5 text-stone-500">
          Operator note: set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.
        </p>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-stone-400">Chain</p>
          <p className="mt-2 text-lg font-bold">Ethereum Mainnet</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-stone-400">IFR token</p>
          <p className="mt-2 break-all text-sm font-bold">{IFR_TOKEN_ADDRESS || 'Not configured'}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-stone-400">IFRLock</p>
          <p className="mt-2 break-all text-sm font-bold">{IFRLOCK_ADDRESS || 'Not configured'}</p>
        </div>
      </div>
    </section>
  );
}

function ConnectedWalletStatus() {
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

  return (
    <section className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/30 backdrop-blur">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-200/80">
            Customer wallet
          </p>
          <h2 className="mt-1 text-2xl font-black text-white">Access status</h2>
        </div>
        <ConnectButton />
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
            {ifrBalance.data ? `${Number(ifrBalance.data.formatted).toLocaleString('en-US', { maximumFractionDigits: 3 })} IFR` : '0 IFR'}
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
    </section>
  );
}

export function WalletStatus() {
  if (!hasWalletConnectProjectId) {
    return <WalletConfigNotice />;
  }

  return <ConnectedWalletStatus />;
}
