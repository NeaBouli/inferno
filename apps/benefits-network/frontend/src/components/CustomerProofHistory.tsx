'use client';

import { useEffect, useState } from 'react';
import { recoverMessageAddress } from 'viem';
import {
  CustomerProofHistoryItem,
  ReceiptVerification,
  clearCustomerProofHistory,
  readCustomerProofHistory,
  verifyCustomerProofReceipt,
} from '@/lib/customerHistory';
import { formatProductPrice } from '@/lib/money';
import { lockSourceRequirement } from '@/lib/lockSource';
import { CHAIN_ID } from '@/lib/contracts';

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

const verifier = {
  recover: (message: string, signature: string) =>
    recoverMessageAddress({ message, signature: signature as `0x${string}` }),
  sha256Hex: async (text: string) => {
    const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  },
};

/**
 * Owner decision B (T-231b): customer history exists only on this device. The server keeps no
 * customer-linked history, so there is nothing to load across devices.
 */
export function CustomerProofHistory() {
  const [items, setItems] = useState<CustomerProofHistoryItem[]>([]);
  const [checks, setChecks] = useState<Record<string, ReceiptVerification>>({});

  useEffect(() => {
    setItems(readCustomerProofHistory());
  }, []);

  function clearHistory() {
    clearCustomerProofHistory();
    setItems([]);
    setChecks({});
  }

  async function verifyItem(item: CustomerProofHistoryItem) {
    const result = await verifyCustomerProofReceipt(item, verifier, {
      expectedAudience: window.location.host,
      expectedChainId: CHAIN_ID,
      receipts: items,
    });
    setChecks((current) => ({ ...current, [item.sessionId]: result }));
  }

  return (
    <section data-testid="device-history" className="shop-launcher-band-clearance rounded-[2rem] border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/25 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">
            Customer history
          </p>
          <h2 className="mt-2 text-2xl font-black text-white">My benefits</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="/scan"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-orange-300 px-3 py-2 text-xs font-black uppercase text-stone-950 transition hover:bg-orange-200"
          >
            Scan QR
          </a>
          {items.length > 0 ? (
            <button
              type="button"
              onClick={clearHistory}
              className="min-h-11 rounded-full border border-white/15 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-orange-200/60"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div data-testid="device-history-notice" className="mt-4 rounded-2xl border border-green-300/20 bg-green-300/[0.07] p-4 text-xs leading-5 text-stone-200">
        <p className="font-black text-green-50">Stored only on this device</p>
        <p className="mt-1">
          The shop server keeps no list of your checkouts and no wallet address. Your receipts, including the
          signed checkout text with your full wallet address and your signature, stay in this browser until you
          clear them. Clearing browser data or switching devices loses this history; it cannot be restored.
        </p>
      </div>

      {items.length > 0 ? (
        <div className="mt-4 grid gap-3">
          {items.map((item) => {
            const check = checks[item.sessionId];
            return (
              <article key={item.sessionId} data-testid="device-receipt" className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="min-w-0">
                  <p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-stone-400">
                    {item.proof ? 'Signed checkout terms' : 'Saved checkout (no signed proof)'}
                  </p>
                  <p className="mt-1 break-words text-sm font-black text-white">
                    {item.productName} / {item.discountPercent}% / {item.requiredLockIFR.toLocaleString('en-US')} IFR locked
                    {' '}{lockSourceRequirement(item.lockSource)}
                    {item.minIFRHeld > 0 ? ` + ${item.minIFRHeld.toLocaleString('en-US')} held` : ''}
                  </p>
                  <div className="mt-2 grid gap-1 text-xs leading-5 text-stone-400 sm:grid-cols-2">
                    <p className="break-words">Rule: <span className="text-stone-200">{item.ruleLabel}</span></p>
                    {formatProductPrice(item.basePriceMinor, item.currency) ? (
                      <p>Reference price: <span className="text-stone-200">{formatProductPrice(item.basePriceMinor, item.currency)}</span></p>
                    ) : null}
                    <p>Wallet: <span className="font-mono text-stone-200">{item.walletLabel}</span></p>
                    <p>Offer valid until: <span className="text-stone-200">{formatDate(item.expiresAt)}</span></p>
                    <p className="break-all">Checkout: <span className="font-mono text-stone-200">{item.sessionId}</span></p>
                    <p className="break-all">Shop ID: <span className="font-mono text-stone-200">{item.businessId}</span></p>
                  </div>
                </div>
                <div data-testid="receipt-unverified-notes" className="mt-3 rounded-xl border border-white/10 p-3 text-xs leading-5 text-stone-400">
                  <p className="font-black uppercase tracking-[0.12em] text-stone-300">Saved on this device - not verified</p>
                  <p className="mt-1 break-words">
                    Seller: <span className="text-stone-200">{item.sellerName}</span>
                    {' '}/ Last seen status: <span className="text-stone-200">{item.status}</span>
                    {item.redeemedAt ? <> / Redeemed: <span className="text-stone-200">{formatDate(item.redeemedAt)}</span></> : null}
                    {' '}/ Saved: <span className="text-stone-200">{formatDate(item.savedAt)}</span>
                  </p>
                  <p className="mt-1">Use Check status for the shop&apos;s current answer; your signature does not prove redemption.</p>
                </div>
                {check ? (
                  <p
                    role="status"
                    className={`mt-3 text-xs font-semibold ${check.ok ? 'text-green-100' : 'text-red-200'}`}
                  >
                    {check.ok
                      ? 'Signed terms verified on this device: your wallet signed exactly these checkout terms. This does not prove redemption.'
                      : `Receipt invalid: ${check.reason}`}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.proof ? (
                    <button
                      type="button"
                      onClick={() => void verifyItem(item)}
                      className="inline-flex min-h-11 items-center rounded-2xl border border-green-200/35 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-green-50 transition hover:bg-green-200/10"
                    >
                      Verify receipt
                    </button>
                  ) : null}
                  <a
                    href={`/r/${item.sessionId}`}
                    className="inline-flex min-h-11 items-center rounded-2xl border border-orange-200/35 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-orange-50 transition hover:bg-orange-200/10"
                  >
                    Check status
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-stone-300">
          No receipts on this device yet. Scan a seller QR or show your checkout pass; after a successful proof the
          receipt appears here.
        </div>
      )}
    </section>
  );
}
