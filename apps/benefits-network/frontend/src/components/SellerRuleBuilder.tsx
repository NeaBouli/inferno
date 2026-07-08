'use client';

import { useMemo, useState } from 'react';

const categories = ['Coffee', 'Retail', 'Digital access', 'Events', 'Services'];

export function SellerRuleBuilder() {
  const [category, setCategory] = useState(categories[0]);
  const [product, setProduct] = useState('Premium customer discount');
  const [discount, setDiscount] = useState(10);
  const [minLocked, setMinLocked] = useState(1000);
  const [ttl, setTtl] = useState(90);

  const payload = useMemo(
    () => ({
      name: product || 'IFR Benefit',
      discountPercent: discount,
      requiredLockIFR: minLocked,
      ttlSeconds: ttl,
      tierLabel: category,
    }),
    [category, discount, minLocked, product, ttl]
  );

  return (
    <section className="rounded-[2rem] border border-orange-200/15 bg-orange-100/[0.06] p-5 shadow-2xl shadow-black/30 backdrop-blur">
      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-200/80">
          Seller mode
        </p>
        <h2 className="mt-1 text-2xl font-black text-white">Rule builder preview</h2>
        <p className="mt-2 text-sm leading-6 text-stone-300">
          This is the first UI slice for seller-configured QR benefits. Persisting rules still goes through the guarded admin API.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Category
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          >
            {categories.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Product or service
          <input
            value={product}
            onChange={(event) => setProduct(event.target.value)}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Discount: {discount}%
          <input
            type="range"
            min="1"
            max="50"
            value={discount}
            onChange={(event) => setDiscount(Number(event.target.value))}
            className="accent-orange-400"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Minimum locked IFR
          <input
            type="number"
            min="1"
            value={minLocked}
            onChange={(event) => setMinLocked(Number(event.target.value))}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          QR session TTL
          <input
            type="number"
            min="10"
            max="3600"
            value={ttl}
            onChange={(event) => setTtl(Number(event.target.value))}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          />
        </label>
        <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-stone-400">Customer result</p>
          <p className="mt-2 text-xl font-black text-orange-100">
            {discount}% off when {minLocked.toLocaleString('en-US')} IFR is locked
          </p>
          <p className="mt-2 text-sm text-stone-300">{category} / {product}</p>
        </div>
      </div>

      <pre className="mt-5 overflow-auto rounded-2xl border border-white/10 bg-black/30 p-4 text-xs leading-5 text-stone-300">
        {JSON.stringify(payload, null, 2)}
      </pre>
    </section>
  );
}
