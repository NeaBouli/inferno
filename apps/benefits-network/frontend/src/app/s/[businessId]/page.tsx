'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { PublicCatalogProduct, getBusinessProducts } from '@/lib/api';

export default function SellerCatalogPage({ params }: { params: { businessId: string } }) {
  const [businessName, setBusinessName] = useState('Seller catalog');
  const [products, setProducts] = useState<PublicCatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [shareStatus, setShareStatus] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    getBusinessProducts(params.businessId)
      .then((result) => {
        setBusinessName(result.business.name);
        setProducts(result.products);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [params.businessId]);

  const categories = useMemo(() => {
    const grouped = new Map<string, PublicCatalogProduct[]>();
    for (const product of products) {
      const current = grouped.get(product.category) || [];
      current.push(product);
      grouped.set(product.category, current);
    }
    return Array.from(grouped.entries());
  }, [products]);

  async function shareCatalog() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${businessName} IFR benefits`, url });
        setShareStatus('Catalog shared.');
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareStatus('Catalog link copied.');
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setShareStatus('Could not share in this browser.');
    }
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-5 pb-20 pt-8">
        <section className="border-b border-orange-200/15 pb-8">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">IFR member benefits</p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-5">
            <div>
              <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">{businessName}</h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-stone-300">
                Browse active products and services with benefits for customers who verify locked IFR at checkout.
              </p>
            </div>
            <button type="button" onClick={shareCatalog} className="rounded-full border border-orange-200/40 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-orange-50">
              Share catalog
            </button>
          </div>
          {shareStatus ? <p className="mt-3 text-sm text-green-100">{shareStatus}</p> : null}
        </section>

        <section className="grid gap-3 border-b border-white/10 py-6 sm:grid-cols-3">
          <div className="border-l-2 border-orange-300 pl-4">
            <p className="text-xs uppercase tracking-[0.14em] text-stone-400">1. Choose</p>
            <p className="mt-1 font-bold text-white">Select an active offer below</p>
          </div>
          <div className="border-l-2 border-green-300 pl-4">
            <p className="text-xs uppercase tracking-[0.14em] text-stone-400">2. Verify</p>
            <p className="mt-1 font-bold text-white">Seller starts a one-time QR checkout</p>
          </div>
          <div className="border-l-2 border-orange-300 pl-4">
            <p className="text-xs uppercase tracking-[0.14em] text-stone-400">3. Receive</p>
            <p className="mt-1 font-bold text-white">Sign and prove the required IFR lock</p>
          </div>
        </section>

        {loading ? <p className="py-12 text-stone-300">Loading active catalog...</p> : null}
        {error ? <p className="my-8 border-l-2 border-red-400 pl-4 text-red-100">{error}</p> : null}
        {!loading && !error && categories.length === 0 ? (
          <section className="py-12">
            <h2 className="text-2xl font-black text-white">No public offers yet</h2>
            <p className="mt-2 text-stone-300">This seller has not published an active catalog item with benefits.</p>
          </section>
        ) : null}

        <div className="divide-y divide-white/10">
          {categories.map(([category, categoryProducts]) => (
            <section key={category} className="py-8">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-green-100/80">{category}</p>
              <div className="mt-4 grid gap-5 md:grid-cols-2">
                {categoryProducts.map((product) => (
                  <article key={product.id} className="border-l-2 border-orange-200/40 bg-white/[0.03] p-5">
                    <h2 className="text-2xl font-black text-white">{product.name}</h2>
                    {product.description ? <p className="mt-2 text-sm leading-6 text-stone-300">{product.description}</p> : null}
                    {product.benefitRules.length > 0 ? (
                      <div className="mt-5 grid gap-3">
                        {product.benefitRules.map((rule) => (
                          <div key={rule.id} className="border-t border-white/10 pt-3">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <p className="font-black text-orange-100">{rule.discountPercent}% benefit</p>
                              <p className="text-xs font-bold uppercase tracking-[0.12em] text-stone-400">{rule.label}</p>
                            </div>
                            <p className="mt-1 text-sm text-stone-300">
                              Verify at least {rule.requiredLockIFR.toLocaleString('en-US')} locked IFR at checkout.
                            </p>
                            <p className="mt-1 text-xs text-stone-400">
                              Per wallet: {rule.dailyRedemptionLimit || 'unlimited'} / UTC day and {rule.monthlyRedemptionLimit || 'unlimited'} / UTC month.
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-stone-400">Listed for IFR members; no active discount rule is published.</p>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>

        <section className="mt-8 flex flex-wrap gap-3 border-t border-white/10 pt-6">
          <Link href="/#customer-wallet" className="rounded-full bg-green-300 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-950">Check or lock IFR</Link>
          <Link href="/guide" className="rounded-full border border-white/15 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-100">Checkout guide</Link>
        </section>
      </div>
    </AppShell>
  );
}
