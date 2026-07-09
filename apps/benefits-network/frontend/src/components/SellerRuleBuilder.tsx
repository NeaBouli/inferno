'use client';

import { useMemo, useState } from 'react';
import {
  BenefitRule,
  BenefitRuleInput,
  createAdminBusinessRule,
  deleteAdminBusinessRule,
  getAdminBusinessRules,
  updateAdminBusinessRule,
} from '@/lib/api';

const categories = ['Coffee', 'Retail', 'Digital access', 'Events', 'Services'];

export function SellerRuleBuilder() {
  const [businessId, setBusinessId] = useState('');
  const [adminSecret, setAdminSecret] = useState('');
  const [category, setCategory] = useState(categories[0]);
  const [product, setProduct] = useState('Premium customer discount');
  const [label, setLabel] = useState('Bronze');
  const [discount, setDiscount] = useState(10);
  const [minLocked, setMinLocked] = useState(1000);
  const [ttl, setTtl] = useState(90);
  const [rules, setRules] = useState<BenefitRule[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const payload: BenefitRuleInput = useMemo(
    () => ({
      label: label || 'IFR Benefit',
      category,
      productName: product || 'IFR Benefit',
      discountPercent: discount,
      requiredLockIFR: minLocked,
      ttlSeconds: ttl,
      active: true,
    }),
    [category, discount, label, minLocked, product, ttl]
  );

  async function loadRules() {
    if (!businessId || !adminSecret) {
      setError('Business ID and admin secret are required.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const result = await getAdminBusinessRules(businessId, adminSecret);
      setRules(result.rules);
      setStatus(`Loaded ${result.rules.length} rule${result.rules.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rules');
    } finally {
      setLoading(false);
    }
  }

  async function saveRule() {
    if (!businessId || !adminSecret) {
      setError('Business ID and admin secret are required.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const rule = await createAdminBusinessRule(businessId, adminSecret, payload);
      setRules((current) => [...current, rule].sort((a, b) => a.requiredLockIFR - b.requiredLockIFR));
      setStatus('Rule saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save rule');
    } finally {
      setLoading(false);
    }
  }

  async function toggleRule(rule: BenefitRule) {
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const updated = await updateAdminBusinessRule(rule.id, adminSecret, { active: !rule.active });
      setRules((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setStatus(updated.active ? 'Rule activated.' : 'Rule paused.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rule');
    } finally {
      setLoading(false);
    }
  }

  async function deleteRule(ruleId: string) {
    setLoading(true);
    setError('');
    setStatus('');
    try {
      await deleteAdminBusinessRule(ruleId, adminSecret);
      setRules((current) => current.filter((item) => item.id !== ruleId));
      setStatus('Rule deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete rule');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-[2rem] border border-orange-200/15 bg-orange-100/[0.06] p-5 shadow-2xl shadow-black/30 backdrop-blur">
      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-200/80">
          Seller mode
        </p>
        <h2 className="mt-1 text-2xl font-black text-white">Benefit rule manager</h2>
        <p className="mt-2 text-sm leading-6 text-stone-300">
          Persist seller discounts through the guarded admin API. The secret stays in this browser session and is never written to the repo.
        </p>
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Business ID
          <input
            value={businessId}
            onChange={(event) => setBusinessId(event.target.value)}
            placeholder="cuid..."
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Admin secret
          <input
            type="password"
            value={adminSecret}
            onChange={(event) => setAdminSecret(event.target.value)}
            placeholder="Bearer secret"
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          />
        </label>
        <button
          type="button"
          onClick={loadRules}
          disabled={loading}
          className="self-end rounded-2xl border border-orange-200/40 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-orange-100 transition hover:bg-orange-200/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Load
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Rule label
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          />
        </label>
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
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
        <p className="text-xs uppercase tracking-[0.14em] text-stone-400">Customer result</p>
        <p className="mt-2 text-xl font-black text-orange-100">
          {discount}% off when {minLocked.toLocaleString('en-US')} IFR is locked
        </p>
        <p className="mt-2 text-sm text-stone-300">{label} / {category} / {product}</p>
      </div>

      <button
        type="button"
        onClick={saveRule}
        disabled={loading}
        className="mt-5 w-full rounded-2xl bg-orange-300 px-5 py-4 text-sm font-black uppercase tracking-[0.16em] text-stone-950 shadow-xl shadow-orange-950/40 transition hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? 'Working...' : 'Save rule'}
      </button>

      {status ? <p className="mt-4 rounded-2xl border border-green-300/30 bg-green-500/10 p-3 text-sm text-green-100">{status}</p> : null}
      {error ? <p className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}

      {rules.length > 0 ? (
        <div className="mt-5 grid gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">
            Saved rules
          </p>
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-black text-white">{rule.label}</p>
                  <p className="mt-1 text-sm text-stone-300">
                    {rule.category} / {rule.productName}
                  </p>
                  <p className="mt-2 text-sm text-orange-100">
                    {rule.discountPercent}% off at {rule.requiredLockIFR.toLocaleString('en-US')} locked IFR
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] ${rule.active ? 'bg-green-400/15 text-green-100' : 'bg-stone-500/20 text-stone-300'}`}>
                  {rule.active ? 'Active' : 'Paused'}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => toggleRule(rule)}
                  disabled={loading || !adminSecret}
                  className="rounded-full border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-stone-100 hover:border-orange-200/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {rule.active ? 'Pause' : 'Activate'}
                </button>
                <button
                  type="button"
                  onClick={() => deleteRule(rule.id)}
                  disabled={loading || !adminSecret}
                  className="rounded-full border border-red-300/30 px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-red-100 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
