'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import {
  CustomerProofHistoryItem,
  clearCustomerProofHistory,
  readCustomerProofHistory,
} from '@/lib/customerHistory';
import { formatProductPrice } from '@/lib/money';
import {
  CustomerHistoryItem,
  authorizeCustomerHistory,
  getCustomerHistory,
  getCustomerHistoryChallenge,
} from '@/lib/api';

function statusTone(status: CustomerProofHistoryItem['status']) {
  if (status === 'APPROVED' || status === 'REDEEMED') return 'border-green-300/25 bg-green-300/[0.08] text-green-50';
  if (status === 'REJECTED' || status === 'EXPIRED') return 'border-red-300/25 bg-red-300/[0.08] text-red-50';
  return 'border-orange-200/25 bg-orange-200/[0.08] text-orange-50';
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function CustomerProofHistory() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [items, setItems] = useState<CustomerProofHistoryItem[]>([]);
  const [walletItems, setWalletItems] = useState<CustomerHistoryItem[]>([]);
  const [accessToken, setAccessToken] = useState('');
  const [historyBinding, setHistoryBinding] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingWalletHistory, setLoadingWalletHistory] = useState(false);
  const [walletHistoryStatus, setWalletHistoryStatus] = useState('');
  const [walletHistoryError, setWalletHistoryError] = useState('');
  const activeWalletRef = useRef('');
  const normalizedWallet = isConnected && address ? address.toLowerCase() : '';
  activeWalletRef.current = normalizedWallet;

  useEffect(() => {
    setItems(readCustomerProofHistory());
  }, []);

  useEffect(() => {
    setWalletItems([]);
    setAccessToken('');
    setHistoryBinding('');
    setNextCursor(null);
    setSnapshot(null);
    setHasMore(false);
    setLoadingWalletHistory(false);
    setWalletHistoryStatus('');
    setWalletHistoryError('');
  }, [normalizedWallet]);

  function clearHistory() {
    clearCustomerProofHistory();
    setItems([]);
  }

  async function createReadAccess(requestWallet: string) {
    if (!address || address.toLowerCase() !== requestWallet) {
      throw new Error('Wallet changed before history authorization.');
    }
    const challenge = await getCustomerHistoryChallenge(address);
    const signature = await signMessageAsync({ message: challenge.message });
    if (activeWalletRef.current !== requestWallet) {
      throw new Error('Wallet changed before history authorization completed.');
    }
    return authorizeCustomerHistory({
      walletAddress: address,
      nonce: challenge.nonce,
      signature,
    });
  }

  async function loadWalletHistory() {
    if (!normalizedWallet) {
      setWalletHistoryError('Connect the customer wallet above before loading My benefits.');
      return;
    }
    const requestWallet = normalizedWallet;
    setLoadingWalletHistory(true);
    setWalletHistoryError('');
    setWalletHistoryStatus('Sign the read-only request in your wallet.');
    try {
      const authorization = await createReadAccess(requestWallet);
      const page = await getCustomerHistory(authorization.accessToken, 20);
      if (activeWalletRef.current !== requestWallet) return;
      setAccessToken(authorization.accessToken);
      setHistoryBinding(requestWallet);
      setWalletItems(page.sessions);
      setNextCursor(page.pagination.nextCursor);
      setSnapshot(page.pagination.snapshot);
      setHasMore(page.pagination.hasMore);
      setWalletHistoryStatus(page.sessions.length
        ? `Loaded ${page.sessions.length} verified benefit${page.sessions.length === 1 ? '' : 's'} for this wallet.`
        : 'No verified benefits were found for this wallet.');
    } catch (err) {
      if (activeWalletRef.current !== requestWallet) return;
      setWalletHistoryStatus('');
      setWalletHistoryError(err instanceof Error ? err.message : 'Could not load wallet history.');
    } finally {
      if (activeWalletRef.current === requestWallet) setLoadingWalletHistory(false);
    }
  }

  async function loadMoreWalletHistory() {
    if (
      !normalizedWallet || historyBinding !== normalizedWallet || !nextCursor || !snapshot
    ) {
      setWalletHistoryError('Reload My benefits with the current wallet before loading older entries.');
      return;
    }
    const requestWallet = normalizedWallet;
    const requestCursor = nextCursor;
    const requestSnapshot = snapshot;
    setLoadingWalletHistory(true);
    setWalletHistoryError('');
    try {
      let token = accessToken;
      let page;
      try {
        page = await getCustomerHistory(token, 20, requestCursor, requestSnapshot);
      } catch (err) {
        if (!(err instanceof Error) || !err.message.includes('access expired')) throw err;
        setWalletHistoryStatus('Read access expired. Sign once more to continue.');
        const authorization = await createReadAccess(requestWallet);
        token = authorization.accessToken;
        page = await getCustomerHistory(token, 20, requestCursor, requestSnapshot);
      }
      if (activeWalletRef.current !== requestWallet) return;
      setAccessToken(token);
      setWalletItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...page.sessions.filter((item) => !known.has(item.id))];
      });
      setNextCursor(page.pagination.nextCursor);
      setSnapshot(page.pagination.snapshot);
      setHasMore(page.pagination.hasMore);
      setWalletHistoryStatus(`Loaded ${page.sessions.length} older benefit${page.sessions.length === 1 ? '' : 's'}.`);
    } catch (err) {
      if (activeWalletRef.current !== requestWallet) return;
      setWalletHistoryStatus('');
      setWalletHistoryError(err instanceof Error ? err.message : 'Could not load older benefits.');
    } finally {
      if (activeWalletRef.current === requestWallet) setLoadingWalletHistory(false);
    }
  }

  const walletHistoryVisible = historyBinding === normalizedWallet;

  return (
    <section className="rounded-[2rem] border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/25 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">
            Customer history
          </p>
          <h2 className="mt-2 text-2xl font-black text-white">My benefits</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="/scan"
            className="rounded-full bg-orange-300 px-3 py-2 text-xs font-black uppercase text-stone-950 transition hover:bg-orange-200"
          >
            Scan QR
          </a>
          {items.length > 0 ? (
            <button
              type="button"
              onClick={clearHistory}
              className="rounded-full border border-white/15 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-orange-200/60"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <p className="mt-3 text-sm leading-6 text-stone-300">
        Sign one read-only request to load benefits verified by this wallet across devices. Access stays in memory for ten minutes and cannot move tokens.
      </p>

      <div className="mt-4 rounded-2xl border border-green-300/20 bg-green-300/[0.07] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-green-50">Signed wallet history</h3>
            <p className="mt-1 text-xs leading-5 text-stone-300">
              {normalizedWallet
                ? `Connected: ${address?.slice(0, 6)}...${address?.slice(-4)}`
                : 'Connect the same customer wallet used for checkout.'}
            </p>
          </div>
          <button
            type="button"
            onClick={loadWalletHistory}
            disabled={!normalizedWallet || loadingWalletHistory}
            className="rounded-full bg-green-300 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-stone-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loadingWalletHistory ? 'Loading' : walletHistoryVisible ? 'Refresh history' : 'Load wallet history'}
          </button>
        </div>
        {walletHistoryStatus ? <p role="status" aria-live="polite" className="mt-3 text-xs font-semibold text-green-100">{walletHistoryStatus}</p> : null}
        {walletHistoryError ? <p role="alert" className="mt-3 text-xs font-semibold text-red-200">{walletHistoryError}</p> : null}

        {walletHistoryVisible && walletItems.length > 0 ? (
          <div className="mt-4 grid gap-3">
            {walletItems.map((item) => (
              <article key={item.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-black text-white">{item.seller.name}</h4>
                    <p className="mt-1 text-xs leading-5 text-stone-400">
                      {item.benefit.productName || 'Business benefit'} / {item.benefit.discountPercent}% / {item.benefit.requiredLockIFR.toLocaleString('en-US')} IFR locked
                      {item.benefit.minIFRHeld > 0 ? ` + ${item.benefit.minIFRHeld.toLocaleString('en-US')} held` : ''}
                    </p>
                    {formatProductPrice(item.benefit.basePriceMinor, item.benefit.currency) ? (
                      <p className="mt-1 text-xs text-stone-400">
                        Reference price: {formatProductPrice(item.benefit.basePriceMinor, item.benefit.currency)}
                      </p>
                    ) : null}
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-[0.68rem] font-black uppercase tracking-[0.12em] ${statusTone(item.status)}`}>
                    {item.status}
                  </span>
                </div>
                <div className="mt-3 grid gap-1 text-xs leading-5 text-stone-400 sm:grid-cols-2">
                  <p>Benefit: <span className="text-stone-200">{item.benefit.label || 'Business default'}</span></p>
                  <p>Verified: <span className="text-stone-200">{formatDate(item.createdAt)}</span></p>
                  <p>Expires: <span className="text-stone-200">{formatDate(item.expiresAt)}</span></p>
                  {item.redeemedAt ? <p>Redeemed: <span className="text-stone-200">{formatDate(item.redeemedAt)}</span></p> : null}
                </div>
                {item.reason ? <p className="mt-2 text-xs leading-5 text-stone-300">{item.reason}</p> : null}
              </article>
            ))}
            {hasMore ? (
              <button
                type="button"
                onClick={loadMoreWalletHistory}
                disabled={loadingWalletHistory}
                className="rounded-2xl border border-green-200/30 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-green-50 disabled:opacity-40"
              >
                Load older benefits
              </button>
            ) : <p className="text-center text-xs text-stone-400">All available wallet benefits are loaded.</p>}
          </div>
        ) : null}
      </div>

      <div className="mt-5 border-t border-white/10 pt-5">
        <h3 className="text-sm font-black text-white">Recent proofs on this device</h3>
        <p className="mt-2 text-xs leading-5 text-stone-400">
          This redacted offline list helps reopen a checkout. It stores no private keys, signatures or full wallet addresses.
        </p>
      </div>

      {items.length > 0 ? (
        <div className="mt-4 grid gap-3">
          {items.map((item) => (
            <article key={item.sessionId} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-white">{item.sellerName}</h3>
                  <p className="mt-1 text-xs leading-5 text-stone-400">
                    {item.productName} / {item.discountPercent}% / {item.requiredLockIFR.toLocaleString('en-US')} IFR locked
                    {item.minIFRHeld > 0 ? ` + ${item.minIFRHeld.toLocaleString('en-US')} held` : ''}
                  </p>
                  {formatProductPrice(item.basePriceMinor, item.currency) ? (
                    <p className="mt-1 text-xs text-stone-400">
                      Reference price: {formatProductPrice(item.basePriceMinor, item.currency)}
                    </p>
                  ) : null}
                </div>
                <span className={`rounded-full border px-3 py-1 text-[0.68rem] font-black uppercase tracking-[0.12em] ${statusTone(item.status)}`}>
                  {item.status}
                </span>
              </div>
              <div className="mt-3 grid gap-1 text-xs leading-5 text-stone-400 sm:grid-cols-2">
                <p>Rule: <span className="text-stone-200">{item.ruleLabel}</span></p>
                <p>Wallet: <span className="font-mono text-stone-200">{item.walletLabel}</span></p>
                <p>Saved: <span className="text-stone-200">{formatDate(item.savedAt)}</span></p>
                <p>Expires: <span className="text-stone-200">{formatDate(item.expiresAt)}</span></p>
              </div>
              <a
                href={`/r/${item.sessionId}`}
                className="mt-3 inline-flex rounded-2xl border border-orange-200/35 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-orange-50 transition hover:bg-orange-200/10"
              >
                Reopen proof
              </a>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-stone-300">
          No customer proofs saved on this device yet. Open a seller QR link, sign or refresh the proof, and it will appear here.
        </div>
      )}
    </section>
  );
}
