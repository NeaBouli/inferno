'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { hasWalletConnectProjectId } from '@/lib/wagmi';

function shortAddress(address?: string) {
  if (!address) return 'Not connected';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function WalletConnectControl() {
  const { address, isConnected } = useAccount();
  const { connectors, connectAsync, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  async function connectInjectedWallet() {
    const connector =
      connectors.find((item) => item.id === 'injected') ||
      connectors.find((item) => item.id === 'metaMask') ||
      connectors.find((item) => item.id === 'coinbaseWalletSDK') ||
      connectors[0];
    if (!connector) return;
    await connectAsync({ connector });
  }

  if (hasWalletConnectProjectId) {
    return <ConnectButton />;
  }

  return (
    <div className="grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-200/80">
          Browser wallet
        </p>
        <p className="mt-1 font-mono text-sm text-stone-200">{shortAddress(address)}</p>
        <p className="mt-2 text-xs leading-5 text-stone-400">
          MetaMask, Coinbase Wallet and injected mobile wallet browsers work here. WalletConnect, Rainbow, Trust and OKX need the production WalletConnect project id.
        </p>
      </div>
      {isConnected ? (
        <button
          type="button"
          onClick={() => disconnect()}
          className="rounded-2xl border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-orange-200/60"
        >
          Disconnect
        </button>
      ) : (
        <button
          type="button"
          onClick={connectInjectedWallet}
          disabled={isPending || connectors.length === 0}
          className="rounded-2xl bg-orange-300 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-orange-950/30 transition hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? 'Connecting...' : 'Connect wallet'}
        </button>
      )}
    </div>
  );
}
