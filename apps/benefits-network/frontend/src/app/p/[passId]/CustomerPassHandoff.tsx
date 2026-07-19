'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { Countdown } from '@/components/Countdown';
import { getPublicCustomerPass } from '@/lib/api';

const LAST_BUSINESS_STORAGE_KEY = 'ifr.shop.lastSellerBusinessId';

export function CustomerPassHandoff({ passId }: { passId: string }) {
  const router = useRouter();
  const [businessId, setBusinessId] = useState('');
  const [available, setAvailable] = useState<boolean | null>(null);
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      setBusinessId(window.localStorage.getItem(LAST_BUSINESS_STORAGE_KEY) || '');
    } catch {
      // Manual seller profile entry remains available.
    }
    getPublicCustomerPass(passId)
      .then((pass) => {
        setAvailable(pass.available);
        setExpiresAt(pass.expiresAt);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not read checkout pass.'));
  }, [passId]);

  function openSeller(event: FormEvent) {
    event.preventDefault();
    const id = businessId.trim();
    if (!id) {
      setError('Enter or restore your seller profile ID first.');
      return;
    }
    try { window.localStorage.setItem(LAST_BUSINESS_STORAGE_KEY, id); } catch {}
    router.push(`/b/${encodeURIComponent(id)}?pass=${encodeURIComponent(passId)}`);
  }

  return (
    <AppShell>
      <main className="mx-auto grid min-h-[calc(100vh-6rem)] w-full max-w-2xl place-items-center px-5 py-10">
        <section className="w-full rounded-[2rem] border border-orange-200/20 bg-white/[0.065] p-6 shadow-2xl shadow-black/30">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">Seller handoff</p>
              <h1 className="mt-2 text-4xl font-black text-white">Customer checkout pass</h1>
            </div>
            <span className={`rounded-full border px-3 py-2 text-xs font-black uppercase ${available ? 'border-green-300/25 bg-green-300/[0.08] text-green-50' : 'border-white/10 bg-black/20 text-stone-300'}`}>
              {available === null ? 'Checking' : available ? 'Ready' : 'Unavailable'}
            </span>
          </div>
          <p className="mt-4 text-sm leading-6 text-stone-300">
            The customer is presenting a short-lived IFR checkout pass. Open it in the correct seller profile, select the intended active rule and sign the binding request. The customer must then approve the exact offer on their own device.
          </p>
          {expiresAt ? <p className="mt-3 text-sm text-stone-400">Pass expires in <strong className="text-white"><Countdown expiresAt={expiresAt} /></strong></p> : null}

          <form onSubmit={openSeller} className="mt-6 grid gap-3">
            <label className="grid gap-2 text-sm font-semibold text-stone-200">
              Seller profile ID
              <input
                value={businessId}
                onChange={(event) => setBusinessId(event.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                className="min-w-0 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
                placeholder="Your seller business ID"
              />
            </label>
            <button type="submit" disabled={!available} className="rounded-2xl bg-orange-300 px-5 py-4 text-sm font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-orange-950/35 transition hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-50">
              Open seller checkout
            </button>
          </form>
          <p className="mt-4 break-all font-mono text-[11px] text-stone-500">Pass {passId}</p>
          {error ? <p className="mt-4 rounded-2xl border border-red-300/25 bg-red-300/[0.08] p-3 text-sm text-red-100">{error}</p> : null}
        </section>
      </main>
    </AppShell>
  );
}
