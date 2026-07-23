'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EligibilityLiveSummary, OfferEligibility, useIfrLockEligibility } from '@/components/OfferEligibility';
import { discoverOffers, type PublicOffer } from '@/lib/api';

const PAGE_SIZE = 8;

interface OfferDiscoveryProps {
  mode: 'customer' | 'seller';
  onOpenSellerTools: () => void;
}

export function OfferDiscovery({ mode, onOpenSellerTools }: OfferDiscoveryProps) {
  const eligibility = useIfrLockEligibility();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [serviceArea, setServiceArea] = useState('');
  const [offers, setOffers] = useState<PublicOffer[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [serviceAreas, setServiceAreas] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const result = await discoverOffers({
          query: query.trim(),
          category,
          serviceArea,
          page,
          limit: PAGE_SIZE,
        });
        if (cancelled) return;
        setOffers(result.offers);
        setCategories(result.categories);
        setServiceAreas(result.serviceAreas);
        setHasNext(result.pagination.hasNext);
        setTotal(result.pagination.total);
      } catch (err) {
        if (cancelled) return;
        setOffers([]);
        setHasNext(false);
        setError(err instanceof Error ? err.message : 'Offers could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, category, serviceArea, page, reloadKey]);

  function updateQuery(value: string) {
    setLoading(true);
    setQuery(value);
    setPage(1);
  }

  function updateCategory(value: string) {
    setLoading(true);
    setCategory(value);
    setPage(1);
  }

  function updateServiceArea(value: string) {
    setLoading(true);
    setServiceArea(value);
    setPage(1);
  }

  function clearFilters() {
    setLoading(true);
    setQuery('');
    setCategory('');
    setServiceArea('');
    setPage(1);
  }

  const hasActiveFilters = Boolean(query.trim() || category || serviceArea);

  return (
    <section id="offers" className="mx-auto w-full max-w-7xl scroll-mt-28 px-5 pb-12">
      <EligibilityLiveSummary eligibility={eligibility} />
      <div className="border-y border-white/10 py-8 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-green-100/80">Live member offers</p>
            <h2 className="mt-2 text-3xl font-black text-white sm:text-4xl">Find an IFR benefit</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-300">
              Browse active seller offers by category and availability, then open the seller catalog for checkout details.
            </p>
          </div>
          <p role="status" aria-live="polite" className="font-mono text-sm text-stone-400">{loading ? 'Loading...' : `${total} active offer${total === 1 ? '' : 's'}`}</p>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem_14rem]">
          <label className="grid gap-2 text-xs font-black uppercase tracking-[0.14em] text-stone-300">
            Search offers
            <input
              type="search"
              value={query}
              maxLength={80}
              onChange={(event) => updateQuery(event.target.value)}
              placeholder="Seller, product or benefit"
              className="min-w-0 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm font-medium normal-case tracking-[0] text-white outline-none transition placeholder:text-stone-500 focus:border-orange-300"
            />
          </label>
          <label className="grid gap-2 text-xs font-black uppercase tracking-[0.14em] text-stone-300">
            Category
            <select
              value={category}
              onChange={(event) => updateCategory(event.target.value)}
              className="min-w-0 rounded-2xl border border-white/10 bg-[#160f0b] px-4 py-3 text-sm font-medium normal-case tracking-[0] text-white outline-none transition focus:border-orange-300"
            >
              <option value="">All categories</option>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="grid gap-2 text-xs font-black uppercase tracking-[0.14em] text-stone-300">
            Available in
            <select
              value={serviceArea}
              onChange={(event) => updateServiceArea(event.target.value)}
              className="min-w-0 rounded-2xl border border-white/10 bg-[#160f0b] px-4 py-3 text-sm font-medium normal-case tracking-[0] text-white outline-none transition focus:border-orange-300"
            >
              <option value="">All areas</option>
              {serviceAreas.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>

        {error ? (
          <div role="alert" className="mt-6 border-l-2 border-red-400 pl-4 text-sm text-red-100">
            <p>{error}</p>
            <button type="button" onClick={() => setReloadKey((current) => current + 1)} className="mt-2 font-black uppercase tracking-[0.12em]">Try again</button>
          </div>
        ) : null}

        {!loading && !error && offers.length === 0 && hasActiveFilters ? (
          <div role="status" className="mt-8 border-l-2 border-orange-300 pl-5">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-200/80">Search result</p>
            <h3 className="mt-2 text-xl font-black text-white">No offers match these filters</h3>
            <p className="mt-2 text-sm text-stone-300">Clear the search, category and area to see every active offer.</p>
            <button
              type="button"
              onClick={clearFilters}
              className="mt-4 rounded-full border border-orange-200/40 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-orange-50 transition hover:bg-orange-200/10"
            >
              Clear filters
            </button>
          </div>
        ) : null}

        {!loading && !error && offers.length === 0 && !hasActiveFilters ? (
          <div role="status" className="mt-8 border-y border-orange-200/25 py-7">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-200/80">Network launch</p>
                <h3 className="mt-2 text-2xl font-black text-white">The first public seller offers are still being prepared.</h3>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-300">
                  No active offer is being hidden or replaced with demo data. Seller setup is live: connect the owner wallet, create a public profile, add a product and publish an active IFR benefit rule.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                <button
                  type="button"
                  onClick={onOpenSellerTools}
                  className="rounded-full bg-orange-300 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-orange-950/35 transition hover:-translate-y-0.5 hover:bg-orange-200"
                >
                  {mode === 'seller' ? 'Continue seller setup' : 'Become a seller'}
                </button>
                {mode === 'customer' ? (
                  <a
                    href="#customer-wallet"
                    className="rounded-full border border-white/15 px-5 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-green-200/50"
                  >
                    Prepare my IFR access
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-7 grid gap-4 md:grid-cols-2">
          {offers.map((offer) => (
            <article key={offer.id} className="rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-green-100/80">{offer.category}</p>
                  <h3 className="mt-2 text-2xl font-black text-white">{offer.productName}</h3>
                  <p className="mt-1 text-sm font-semibold text-stone-300">{offer.business.name}</p>
                  {offer.business.serviceArea ? (
                    <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-orange-100/85">
                      Available in {offer.business.serviceArea}
                    </p>
                  ) : null}
                  {offer.business.description ? (
                    <p className="mt-2 max-w-xl text-sm leading-6 text-stone-400">{offer.business.description}</p>
                  ) : null}
                </div>
                <span className="rounded-full border border-orange-200/30 bg-orange-200/10 px-3 py-2 text-sm font-black text-orange-100">
                  {offer.discountPercent}% benefit
                </span>
              </div>
              {offer.product?.description ? <p className="mt-4 text-sm leading-6 text-stone-300">{offer.product.description}</p> : null}
              {offer.business.categories.length ? (
                <div className="mt-4 flex flex-wrap gap-2" aria-label={`${offer.business.name} categories`}>
                  {offer.business.categories.slice(0, 4).map((businessCategory) => (
                    <span key={businessCategory} className="rounded-full border border-green-200/20 px-3 py-1 text-xs font-bold text-green-50">
                      {businessCategory}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-stone-400">
                <span>{offer.label}</span>
                <span>{offer.requiredLockIFR.toLocaleString('en-US')} IFR lock</span>
              </div>
              <OfferEligibility requiredLockIFR={offer.requiredLockIFR} eligibility={eligibility} />
              <Link href={`/s/${encodeURIComponent(offer.business.id)}`} className="mt-5 inline-flex rounded-full bg-green-300 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-950 transition hover:-translate-y-0.5 hover:bg-green-200">
                Open seller catalog
              </Link>
            </article>
          ))}
        </div>

        {total > PAGE_SIZE ? (
          <div className="mt-7 flex items-center justify-between gap-3 border-t border-white/10 pt-5">
            <button type="button" disabled={page === 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-full border border-white/15 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-stone-100 disabled:opacity-35">Previous</button>
            <span className="font-mono text-xs text-stone-400">Page {page}</span>
            <button type="button" disabled={!hasNext || loading} onClick={() => setPage((current) => current + 1)} className="rounded-full border border-white/15 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-stone-100 disabled:opacity-35">Next</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
