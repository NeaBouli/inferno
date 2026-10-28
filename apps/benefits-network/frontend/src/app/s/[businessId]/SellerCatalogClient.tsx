'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { BusinessLogo } from '@/components/BusinessLogo';
import { EligibilityLiveSummary, OfferEligibility, useIfrLockEligibility } from '@/components/OfferEligibility';
import {
  BenefitRule,
  PublicBusinessProfile,
  PublicCatalogProduct,
  getBusinessProducts,
  getBusinessRules,
} from '@/lib/api';
import { lockSourceRequirement } from '@/lib/lockSource';
import { formatProductPrice } from '@/lib/money';
import { businessPublicReference } from '@/lib/businessSlug';

export function SellerCatalogClient({ businessId }: { businessId: string }) {
  const eligibility = useIfrLockEligibility();
  const [business, setBusiness] = useState<PublicBusinessProfile | null>(null);
  const [products, setProducts] = useState<PublicCatalogProduct[]>([]);
  const [standaloneRules, setStandaloneRules] = useState<BenefitRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [shareStatus, setShareStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setBusiness(null);
    setProducts([]);
    setStandaloneRules([]);
    setSearchQuery('');
    setSelectedCategory('all');
    Promise.all([
      getBusinessProducts(businessId, controller.signal),
      getBusinessRules(businessId, controller.signal),
    ])
      .then(([catalogResult, rulesResult]) => {
        setBusiness(catalogResult.business);
        setProducts(catalogResult.products);
        setStandaloneRules(rulesResult.rules.filter((rule) => rule.productId === null && rule.active));
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [businessId]);

  const categories = useMemo(() => {
    const grouped = new Map<string, PublicCatalogProduct[]>();
    for (const product of products) {
      const current = grouped.get(product.category) || [];
      current.push(product);
      grouped.set(product.category, current);
    }
    return Array.from(grouped.entries());
  }, [products]);
  const filteredCatalog = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const matchingCategories = categories.flatMap(([category, categoryProducts]) => {
      if (selectedCategory !== 'all' && selectedCategory !== `category:${category}`) return [];
      const matchingProducts = categoryProducts.filter((product) => (
        [product.name, product.description || '', ...product.benefitRules.map((rule) => rule.label)]
          .some((text) => text.toLowerCase().includes(query))
      ));
      return matchingProducts.length ? [[category, matchingProducts] as const] : [];
    });
    const matchingRules = selectedCategory === 'all' || selectedCategory === 'general'
      ? standaloneRules.filter((rule) => rule.label.toLowerCase().includes(query))
      : [];
    return {
      categories: matchingCategories,
      rules: matchingRules,
      count: matchingCategories.reduce((count, [, items]) => count + items.length, 0) + matchingRules.length,
    };
  }, [categories, standaloneRules, searchQuery, selectedCategory]);
  const totalEntries = products.length + standaloneRules.length;
  const hasFilters = searchQuery.length > 0 || selectedCategory !== 'all';
  const publicReference = business ? businessPublicReference(business) : businessId;

  async function shareCatalog() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${business?.name || 'Seller'} IFR benefits`, url });
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
        <EligibilityLiveSummary eligibility={eligibility} />
        <section className="border-b border-orange-200/15 pb-8">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">IFR member benefits</p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-5">
            <div className="flex min-w-0 items-start gap-4">
              <BusinessLogo
                name={business?.name || 'Seller catalog'}
                logoUrl={business?.logoUrl}
                size="lg"
                eager
              />
              <div className="min-w-0">
                <h1 className="break-words text-4xl font-black tracking-tight text-white sm:text-5xl">
                  {business?.name || 'Seller catalog'}
                </h1>
                <p className="mt-3 max-w-2xl text-base leading-7 text-stone-300">
                  {business?.description
                    || 'Browse active products and services with benefits for customers who verify locked IFR at checkout.'}
                </p>
                {business?.serviceArea ? (
                  <p className="mt-4 text-sm font-black uppercase tracking-[0.13em] text-orange-100">
                    Available in {business.serviceArea}
                  </p>
                ) : null}
                {business?.categories.length ? (
                  <div className="mt-4 flex flex-wrap gap-2" aria-label="Seller categories">
                    {business.categories.map((category) => (
                      <span key={category} className="rounded-full border border-green-200/25 bg-green-200/[0.08] px-3 py-2 text-xs font-bold text-green-50">
                        {category}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {business?.website ? (
                <a
                  href={business.website}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex min-h-11 items-center rounded-full border border-green-200/35 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-green-50"
                >
                  Seller website
                </a>
              ) : null}
              <button type="button" onClick={shareCatalog} className="rounded-full border border-orange-200/40 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-orange-50">
                Share catalog
              </button>
            </div>
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

        {!loading && !error && totalEntries > 0 ? (
          <section aria-labelledby="catalog-filters-heading" className="border-b border-white/10 py-6" data-catalog-filters>
            <h2 id="catalog-filters-heading" className="text-xl font-black text-white">Find an offer</h2>
            <p id="catalog-search-help" className="mt-2 text-sm leading-6 text-stone-300">
              Search product names, descriptions and offer labels. Matching products keep all their offers.
            </p>
            <div role="search" aria-label="Seller catalog filters" className="mt-4 grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto]">
              <div className="min-w-0">
                <label className="block text-sm font-bold text-stone-200" htmlFor="catalog-search">Search this catalog</label>
                <input
                  id="catalog-search"
                  type="search"
                  autoComplete="off"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  aria-describedby="catalog-search-help"
                  aria-controls="catalog-results"
                  className="mt-2 min-h-12 w-full min-w-0 rounded-lg border border-white/15 px-4 py-3 font-normal focus-visible:outline-[#8f3519]"
                />
              </div>
              <div className="min-w-0">
                <label className="block text-sm font-bold text-stone-200" htmlFor="catalog-category">Category</label>
                <select
                  id="catalog-category"
                  value={selectedCategory}
                  onChange={(event) => setSelectedCategory(event.target.value)}
                  aria-controls="catalog-results"
                  className="mt-2 min-h-12 w-full min-w-0 rounded-lg border border-white/15 px-4 py-3 font-normal focus-visible:outline-[#8f3519]"
                >
                  <option value="all">All categories</option>
                  {categories.map(([category]) => (
                    <option key={category} value={`category:${category}`}>{category}</option>
                  ))}
                  {standaloneRules.length > 0 ? <option value="general">General offers only</option> : null}
                </select>
              </div>
              <button
                type="button"
                disabled={!hasFilters}
                onClick={() => { setSearchQuery(''); setSelectedCategory('all'); }}
                className="min-h-12 rounded-full border border-orange-200/40 px-5 py-3 text-sm font-black text-orange-50 disabled:opacity-50 focus-visible:outline-[#8f3519]"
              >
                Reset filters
              </button>
            </div>
            <p className="mt-3 text-sm text-stone-300" role="status" aria-live="polite" aria-atomic="true" data-catalog-result-count>
              Showing {filteredCatalog.count} of {totalEntries} catalog {totalEntries === 1 ? 'entry' : 'entries'}.
            </p>
          </section>
        ) : null}

        {loading ? <p className="py-12 text-stone-300">Loading active catalog...</p> : null}
        {error ? <p className="my-8 border-l-2 border-red-400 pl-4 text-red-100">{error}</p> : null}
        {!loading && !error && categories.length === 0 && standaloneRules.length === 0 ? (
          <section className="py-12">
            <h2 className="text-2xl font-black text-white">No public offers yet</h2>
            <p className="mt-2 text-stone-300">This seller has not published an active catalog item with benefits.</p>
          </section>
        ) : null}

        <div id="catalog-results">
        {!loading && !error && totalEntries > 0 && filteredCatalog.count === 0 ? (
          <section className="py-12">
            <h2 className="text-2xl font-black text-white">No matching catalog entries</h2>
            <p className="mt-2 text-stone-300">Try another search or choose All categories. You can also reset the filters above.</p>
          </section>
        ) : null}
        <div className="divide-y divide-white/10">
          {filteredCatalog.categories.map(([category, categoryProducts]) => (
            <section key={category} className="py-8">
              <p className="break-words text-xs font-black uppercase tracking-[0.18em] text-green-100/80">{category}</p>
              <div className="mt-4 grid gap-5 md:grid-cols-2">
                {categoryProducts.map((product) => (
                  <article key={product.id} data-catalog-entry={product.id} className="min-w-0 border-l-2 border-orange-200/40 bg-white/[0.03] p-5">
                    <h2 className="break-words text-2xl font-black text-white">{product.name}</h2>
                    {product.description ? <p className="mt-2 break-words text-sm leading-6 text-stone-300">{product.description}</p> : null}
                    {formatProductPrice(product.basePriceMinor, product.currency) ? (
                      <p className="mt-3 break-words text-sm font-black text-orange-100">
                        Reference price: {formatProductPrice(product.basePriceMinor, product.currency)}
                      </p>
                    ) : null}
                    {product.benefitRules.length > 0 ? (
                      <div className="mt-5 grid gap-3">
                        {product.benefitRules.map((rule) => (
                          <div key={rule.id} data-catalog-rule={rule.id} className="min-w-0 border-t border-white/10 pt-3">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <p className="font-black text-orange-100">{rule.discountPercent}% benefit</p>
                              <p className="min-w-0 break-words text-xs font-bold uppercase tracking-[0.12em] text-stone-400">{rule.label}</p>
                            </div>
                            <p className="mt-1 text-sm text-stone-300">
                              Verify at least {rule.requiredLockIFR.toLocaleString('en-US')} IFR {lockSourceRequirement(rule.lockSource)}
                              {rule.minIFRHeld > 0
                                ? ` and ${rule.minIFRHeld.toLocaleString('en-US')} IFR held`
                                : ''} at checkout.
                            </p>
                            <OfferEligibility
                              requiredLockIFR={rule.requiredLockIFR}
                              minIFRHeld={rule.minIFRHeld}
                              lockSource={rule.lockSource}
                              eligibility={eligibility}
                            />
                            <Link href={`/?seller=${encodeURIComponent(publicReference)}&offer=${encodeURIComponent(rule.id)}#customer-pass`} className="mt-3 inline-flex min-h-11 items-center rounded-full bg-orange-300 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-stone-950">
                              Use this offer
                            </Link>
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

        {filteredCatalog.rules.length > 0 ? (
          <section className="border-t border-white/10 py-8">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-green-100/80">Other member benefits</p>
            <div className="mt-4 grid gap-5 md:grid-cols-2">
              {filteredCatalog.rules.map((rule) => (
                <article key={rule.id} data-catalog-entry={rule.id} className="min-w-0 border-l-2 border-orange-200/40 bg-white/[0.03] p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="min-w-0 break-words text-2xl font-black text-white">{rule.productName}</h2>
                    <p className="min-w-0 break-words text-xs font-bold uppercase tracking-[0.12em] text-stone-400">{rule.label}</p>
                  </div>
                  <p className="mt-2 text-sm font-black text-orange-100">{rule.discountPercent}% benefit</p>
                  <p className="mt-1 text-sm text-stone-300">
                    Verify at least {rule.requiredLockIFR.toLocaleString('en-US')} IFR {lockSourceRequirement(rule.lockSource)}
                    {rule.minIFRHeld > 0
                      ? ` and ${rule.minIFRHeld.toLocaleString('en-US')} IFR held`
                      : ''} at checkout.
                  </p>
                  <OfferEligibility
                    requiredLockIFR={rule.requiredLockIFR}
                    minIFRHeld={rule.minIFRHeld}
                    lockSource={rule.lockSource}
                    eligibility={eligibility}
                  />
                  <p className="mt-1 text-xs text-stone-400">
                    {rule.category}
                  </p>
                  <Link href={`/?seller=${encodeURIComponent(publicReference)}&offer=${encodeURIComponent(rule.id)}#customer-pass`} className="mt-3 inline-flex min-h-11 items-center rounded-full bg-orange-300 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-stone-950">
                    Use this offer
                  </Link>
                </article>
              ))}
            </div>
          </section>
        ) : null}
        </div>

        <section className="mt-8 flex flex-wrap gap-3 border-t border-white/10 pt-6">
          <Link href="/#customer-wallet" className="inline-flex min-h-11 items-center rounded-full bg-green-300 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-950">Check or lock IFR</Link>
          <Link href="/guide" className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-100">Checkout guide</Link>
        </section>
      </div>
    </AppShell>
  );
}
