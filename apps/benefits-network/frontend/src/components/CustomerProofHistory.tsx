'use client';

import { useEffect, useState } from 'react';
import {
  CustomerProofHistoryItem,
  clearCustomerProofHistory,
  readCustomerProofHistory,
} from '@/lib/customerHistory';

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
  const [items, setItems] = useState<CustomerProofHistoryItem[]>([]);

  useEffect(() => {
    setItems(readCustomerProofHistory());
  }, []);

  function clearHistory() {
    clearCustomerProofHistory();
    setItems([]);
  }

  return (
    <section className="rounded-[2rem] border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/25 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">
            Customer history
          </p>
          <h2 className="mt-2 text-2xl font-black text-white">Recent customer proofs</h2>
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
        This device keeps a redacted list of QR proofs you opened, so you can return to a checkout without storing private keys, signatures or full wallet data.
      </p>

      {items.length > 0 ? (
        <div className="mt-4 grid gap-3">
          {items.map((item) => (
            <article key={item.sessionId} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-white">{item.sellerName}</h3>
                  <p className="mt-1 text-xs leading-5 text-stone-400">
                    {item.productName} / {item.discountPercent}% / {item.requiredLockIFR.toLocaleString('en-US')} IFR
                  </p>
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
