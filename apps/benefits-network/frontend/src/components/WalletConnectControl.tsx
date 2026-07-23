'use client';

import { useEffect, useState } from 'react';
import { useAccount, useChainId, useConnect, useDisconnect } from 'wagmi';
import { getMobileWalletLaunches } from '@/lib/walletLaunch';
import { hasWalletConnectProjectId } from '@/lib/wagmi';
import {
  selectPreferredWalletConnector,
  walletConnectionErrorMessage,
  walletConnectorLabel,
} from '@/lib/walletConnectorSelection.mjs';

function shortAddress(address?: string) {
  if (!address) return 'Not connected';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function redactAddress(address?: string) {
  if (!address) return 'not-connected';
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
  const [evidenceStatus, setEvidenceStatus] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('');
  const mobileWalletLaunches = getMobileWalletLaunches(currentUrl);

  useEffect(() => {
    setCurrentUrl(window.location.href);
    setWalletHint(getWalletBrowserHint());
    setEnvironment(getWalletEnvironment());
  }, []);

  async function connectInjectedWallet() {
    const connector = await selectPreferredWalletConnector(connectors);
    if (!connector) {
      setConnectionStatus('No wallet connector is available in this browser.');
      return;
    }
    await connectWallet(connector);
  }

  async function connectWallet(targetConnector: (typeof connectors)[number]) {
    setConnectionStatus('');
    try {
      await connectAsync({ connector: targetConnector });
    } catch (err) {
      setConnectionStatus(walletConnectionErrorMessage(err));
    }
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
          title: 'IFR Benefits Network',
          text: 'Open IFR Benefits Network in your wallet browser.',
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

  function getEvidenceText() {
    return [
      'IFR Benefits Network wallet test evidence',
      `Time: ${new Date().toISOString()}`,
      `URL: ${currentUrl}`,
      `Surface: ${environment.surface}`,
      `Provider: ${environment.provider}`,
      `Chain: ${chainId === 1 ? 'Ethereum Mainnet' : `Chain ${chainId}`}`,
      `Connector: ${connector?.name || 'not-connected'}`,
      `Connected: ${isConnected ? 'yes' : 'no'}`,
      `Wallet: ${redactAddress(address)}`,
      `WalletConnect modal configured: ${hasWalletConnectProjectId ? 'yes' : 'no'}`,
      'No private keys, seed phrases or full wallet inventories are included.',
    ].join('\n');
  }

  async function copyEvidence() {
    try {
      await navigator.clipboard.writeText(getEvidenceText());
      setEvidenceStatus('Test evidence copied.');
    } catch {
      setEvidenceStatus('Copy failed. Use Share evidence or take a screenshot without secrets.');
    }
  }

  async function shareEvidence() {
    const evidence = getEvidenceText();
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'IFRp wallet test evidence',
          text: evidence,
        });
        setEvidenceStatus('Evidence share sheet opened.');
        return;
      }
      await copyEvidence();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setEvidenceStatus('Share failed. Use Copy evidence instead.');
    }
  }

  return (
    <div data-wallet-connect-control className="grid gap-4 rounded-2xl border border-orange-200/15 bg-[linear-gradient(145deg,rgba(255,255,255,0.08),rgba(236,118,51,0.08)_48%,rgba(0,0,0,0.2))] p-4 shadow-xl shadow-black/25">
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
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={copyEvidence}
            className="flex-1 rounded-xl border border-white/10 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-stone-100 transition hover:border-orange-200/60"
          >
            Copy evidence
          </button>
          <button
            type="button"
            onClick={shareEvidence}
            className="flex-1 rounded-xl border border-white/10 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-stone-100 transition hover:border-orange-200/60"
          >
            Share evidence
          </button>
        </div>
        {evidenceStatus ? <p className="mt-2 text-xs font-semibold text-orange-100">{evidenceStatus}</p> : null}
      </div>

      {!isConnected ? (
        <div className="grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-3">
          <div className="grid grid-cols-2 gap-2 text-[0.68rem] font-black uppercase tracking-[0.12em] text-stone-300 sm:grid-cols-4">
            {['MetaMask', 'Coinbase', 'Trust', 'OKX', 'Rainbow', 'Phantom'].map((wallet) => (
              <span key={wallet} className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-center">
                {wallet}
              </span>
            ))}
          </div>
          {environment.surface !== 'Desktop' && environment.surface !== 'Checking browser' ? (
            <div className="grid gap-2" aria-label="Open the shop in a mobile wallet browser">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-200/80">
                Open in wallet app
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {mobileWalletLaunches.map((wallet) => (
                  <a
                    key={wallet.id}
                    data-wallet-launch={wallet.id}
                    href={wallet.href}
                    rel="noopener"
                    className="rounded-xl border border-orange-200/20 bg-white/[0.07] px-3 py-3 text-center text-xs font-black uppercase tracking-[0.1em] text-stone-100 transition hover:border-orange-200/60 hover:bg-orange-200/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-200"
                  >
                    {wallet.label}
                  </a>
                ))}
              </div>
              <p className="text-xs leading-5 text-stone-400">
                Coinbase and Rainbow users can use Share or Copy link, then open it in the wallet browser.
              </p>
            </div>
          ) : null}
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
          {connectors.length > 1 ? (
            <details className="rounded-xl border border-orange-200/15 bg-white/[0.04] p-3">
              <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.12em] text-orange-100">
                Choose wallet connection
              </summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Choose a wallet connection">
                {connectors.map((availableConnector) => (
                  <button
                    key={availableConnector.uid}
                    type="button"
                    onClick={() => connectWallet(availableConnector)}
                    disabled={isPending}
                    className="rounded-xl border border-orange-200/20 bg-orange-300 px-4 py-3 text-xs font-black uppercase tracking-[0.1em] text-stone-950 transition hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isPending ? 'Connecting...' : walletConnectorLabel(availableConnector)}
                  </button>
                ))}
              </div>
            </details>
          ) : null}
          {connectionStatus ? (
            <p role="status" className="text-xs font-semibold leading-5 text-orange-100">
              {connectionStatus}
            </p>
          ) : null}
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
          data-wallet-action="connect"
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
