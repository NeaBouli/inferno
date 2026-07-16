'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useEffect, useState } from 'react';
import { useAccount, useChainId, useConnect, useDisconnect } from 'wagmi';
import { hasWalletConnectProjectId } from '@/lib/wagmi';

function shortAddress(address?: string) {
  if (!address) return 'Not connected';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getWalletBrowserHint() {
  if (typeof window === 'undefined') return 'Open this page inside a wallet app browser, then connect.';
  const ua = window.navigator.userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = ua.includes('android');
  if (isIos) return 'iPad/iPhone: copy or share this page, open MetaMask/Coinbase/Trust/OKX, then paste it into the wallet browser.';
  if (isAndroid) return 'Android: open this page in your wallet app browser, then tap Connect wallet.';
  return 'Desktop: use a browser extension wallet such as MetaMask or Coinbase Wallet.';
}

function getWalletEnvironment() {
  if (typeof window === 'undefined') {
    return {
      surface: 'Unknown',
      provider: 'Waiting for browser',
      detail: 'Open the app in a browser or wallet browser.',
    };
  }

  const ua = window.navigator.userAgent.toLowerCase();
  const ethereum = (window as Window & {
    ethereum?: {
      isMetaMask?: boolean;
      isCoinbaseWallet?: boolean;
      isTrust?: boolean;
      isOkxWallet?: boolean;
      isPhantom?: boolean;
      providers?: unknown[];
    };
  }).ethereum;
  const isIos = /iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = ua.includes('android');
  const surface = isIos ? 'iPad/iPhone' : isAndroid ? 'Android' : 'Desktop';
  const provider =
    ethereum?.isMetaMask
      ? 'MetaMask provider'
      : ethereum?.isCoinbaseWallet
        ? 'Coinbase provider'
        : ethereum?.isTrust
          ? 'Trust provider'
          : ethereum?.isOkxWallet
            ? 'OKX provider'
            : ethereum?.isPhantom
              ? 'Phantom provider'
              : ethereum
                ? 'Injected Ethereum provider'
                : 'No injected provider';
  const providerCount = Array.isArray(ethereum?.providers) ? ethereum.providers.length : ethereum ? 1 : 0;
  const detail = ethereum
    ? `${providerCount} provider${providerCount === 1 ? '' : 's'} available in this browser.`
    : 'Open this page inside MetaMask, Coinbase, Trust, OKX or another EVM wallet browser.';

  return { surface, provider, detail };
}

const DEFAULT_WALLET_ENVIRONMENT = {
  surface: 'Checking browser',
  provider: 'Checking provider',
  detail: 'Wallet diagnostics load after the page opens in your browser.',
};

export function WalletConnectControl() {
  const { address, connector, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectors, connectAsync, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [currentUrl, setCurrentUrl] = useState('https://shop.ifrunit.tech');
  const [walletHint, setWalletHint] = useState('Open this page inside a wallet app browser, then connect.');
  const [environment, setEnvironment] = useState(DEFAULT_WALLET_ENVIRONMENT);
  const [copyStatus, setCopyStatus] = useState('');

  useEffect(() => {
    setCurrentUrl(window.location.href);
    setWalletHint(getWalletBrowserHint());
    setEnvironment(getWalletEnvironment());
  }, []);

  async function connectInjectedWallet() {
    const connector =
      connectors.find((item) => item.id === 'injected') ||
      connectors.find((item) => item.id === 'metaMask') ||
      connectors.find((item) => item.id === 'coinbaseWalletSDK') ||
      connectors[0];
    if (!connector) return;
    await connectAsync({ connector });
  }

  async function copyCurrentLink() {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopyStatus('Link copied.');
    } catch {
      setCopyStatus('Copy failed. Use your browser share menu.');
    }
  }

  async function shareCurrentLink() {
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'IFRp Benefits Network',
          text: 'Open IFRp Benefits Network in your wallet browser.',
          url: currentUrl,
        });
        setCopyStatus('Share sheet opened.');
        return;
      }
      await copyCurrentLink();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setCopyStatus('Share failed. Use Copy link instead.');
    }
  }

  if (hasWalletConnectProjectId) {
    return <ConnectButton />;
  }

  return (
    <div className="grid gap-4 rounded-2xl border border-orange-200/15 bg-[linear-gradient(145deg,rgba(255,255,255,0.08),rgba(236,118,51,0.08)_48%,rgba(0,0,0,0.2))] p-4 shadow-xl shadow-black/25">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-200/80">
          Wallet entry
        </p>
        <p className="mt-1 font-mono text-sm text-stone-200">{shortAddress(address)}</p>
        <p className="mt-2 text-xs leading-5 text-stone-300">
          {walletHint}
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-stone-400">
          Wallet diagnostics
        </p>
        <div className="mt-3 grid gap-2 text-xs text-stone-300 sm:grid-cols-2">
          <p>
            Surface: <span className="font-semibold text-stone-100">{environment.surface}</span>
          </p>
          <p>
            Provider: <span className="font-semibold text-stone-100">{environment.provider}</span>
          </p>
          <p>
            Chain: <span className="font-semibold text-stone-100">{chainId === 1 ? 'Ethereum Mainnet' : `Chain ${chainId}`}</span>
          </p>
          <p>
            Connector: <span className="font-semibold text-stone-100">{connector?.name || 'Not connected'}</span>
          </p>
        </div>
        <p className="mt-2 text-xs leading-5 text-stone-400">{environment.detail}</p>
        {!hasWalletConnectProjectId ? (
          <p className="mt-2 text-xs leading-5 text-orange-100">
            WalletConnect modal is not configured yet; injected wallet browsers and browser extensions are active.
          </p>
        ) : null}
      </div>

      {!isConnected ? (
        <div className="grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-3">
          <div className="grid grid-cols-2 gap-2 text-[0.68rem] font-black uppercase tracking-[0.12em] text-stone-300 sm:grid-cols-4">
            {['MetaMask', 'Coinbase', 'Trust', 'OKX'].map((wallet) => (
              <span key={wallet} className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-center">
                {wallet}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyCurrentLink}
              className="flex-1 rounded-xl border border-white/10 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-stone-100 transition hover:border-orange-200/60"
            >
              Copy link
            </button>
            <button
              type="button"
              onClick={shareCurrentLink}
              className="flex-1 rounded-xl border border-white/10 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-stone-100 transition hover:border-orange-200/60"
            >
              Share
            </button>
          </div>
          {copyStatus ? <p className="text-xs font-semibold text-orange-100">{copyStatus}</p> : null}
        </div>
      ) : null}

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
