'use client';

import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { SellerRuleBuilder } from '@/components/SellerRuleBuilder';
import { WalletStatus } from '@/components/WalletStatus';

type Role = 'customer' | 'seller';

export default function Home() {
  const [role, setRole] = useState<Role>('customer');

  return (
    <AppShell>
      <section className="mx-auto grid w-full max-w-6xl gap-8 px-5 pb-16 pt-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
        <div className="pt-4">
          <p className="text-sm font-bold uppercase tracking-[0.24em] text-orange-200/70">
            Lock IFR. Prove access. Redeem benefits.
          </p>
          <h1 className="mt-5 max-w-3xl text-5xl font-black leading-[0.95] text-white md:text-7xl">
            One IFRp app for customers and sellers.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-300">
            Customers connect a wallet, check ETH/IFR balances, lock IFR and sign QR proofs.
            Sellers scan those proofs and apply their configured discount or service rule.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setRole('customer')}
              className={`rounded-3xl border p-5 text-left transition ${
                role === 'customer'
                  ? 'border-orange-300 bg-orange-300/15 shadow-2xl shadow-orange-950/40'
                  : 'border-white/10 bg-white/[0.05] hover:border-orange-200/50'
              }`}
            >
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-orange-200">
                Customer
              </span>
              <span className="mt-3 block text-xl font-black text-white">Use benefits</span>
              <span className="mt-2 block text-sm leading-6 text-stone-300">
                Connect wallet, check IFR, lock access, and sign seller QR sessions.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setRole('seller')}
              className={`rounded-3xl border p-5 text-left transition ${
                role === 'seller'
                  ? 'border-orange-300 bg-orange-300/15 shadow-2xl shadow-orange-950/40'
                  : 'border-white/10 bg-white/[0.05] hover:border-orange-200/50'
              }`}
            >
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-orange-200">
                Seller
              </span>
              <span className="mt-3 block text-xl font-black text-white">Scan and redeem</span>
              <span className="mt-2 block text-sm leading-6 text-stone-300">
                Configure a benefit rule, open a merchant scanner, and redeem approved sessions.
              </span>
            </button>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="https://app.uniswap.org/swap?outputCurrency=0x77e99917Eca8539c62F509ED1193ac36580A6e7B"
              target="_blank"
              rel="noopener"
              className="rounded-full bg-orange-300 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-stone-950 shadow-xl shadow-orange-950/40 transition hover:-translate-y-0.5 hover:bg-orange-200"
            >
              Get IFR
            </a>
            <a
              href="https://web3.ifrunit.tech"
              className="rounded-full border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-stone-100 transition hover:border-orange-200/60"
            >
              Web3 terminal
            </a>
          </div>
        </div>

        <div className="grid gap-5">
          {role === 'customer' ? <WalletStatus /> : <SellerRuleBuilder />}
          <section className="rounded-[2rem] border border-white/10 bg-black/20 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">
              MVP flow
            </p>
            <ol className="mt-4 grid gap-3 text-sm leading-6 text-stone-300">
              <li><strong className="text-white">1.</strong> Seller opens <code>/b/&lt;businessId&gt;</code> and creates a QR session.</li>
              <li><strong className="text-white">2.</strong> Customer scans <code>/r/&lt;sessionId&gt;</code>, connects wallet, and signs.</li>
              <li><strong className="text-white">3.</strong> Backend verifies IFRLock on-chain and seller redeems once.</li>
            </ol>
          </section>
        </div>
      </section>
    </AppShell>
  );
}
