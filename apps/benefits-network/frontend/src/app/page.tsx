'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { SellerRuleBuilder } from '@/components/SellerRuleBuilder';
import { WalletStatus } from '@/components/WalletStatus';

type Role = 'customer' | 'seller';
type CodeMode = 'link' | 'button' | 'api';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const flowSteps = [
  {
    title: 'Customer locks or holds IFR',
    body: 'The app reads wallet status, IFR balance and IFRLock access without moving tokens during verification.',
  },
  {
    title: 'Seller creates a rule',
    body: 'A shop defines product, category, discount, required locked IFR and QR session lifetime.',
  },
  {
    title: 'QR proof at checkout',
    body: 'The customer scans, signs a one-time message, and the backend checks the selected rule on-chain.',
  },
  {
    title: 'Redeem once',
    body: 'The seller sees APPROVED, grants the benefit, and redeems the session so it cannot be reused.',
  },
];

const sellerCategories = [
  'Coffee and food',
  'Retail',
  'Digital access',
  'Events',
  'Local services',
  'Creator rewards',
];

function PwaInstallCard() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [platformHint, setPlatformHint] = useState('Install from the browser menu when your device supports PWA install.');
  const [isStandalone, setIsStandalone] = useState(false);
  const [message, setMessage] = useState('Ready for desktop, tablet and smartphone.');

  useEffect(() => {
    const ua = window.navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = ua.includes('android');
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in window.navigator && Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone));

    setIsStandalone(standalone);
    if (standalone) {
      setPlatformHint('Installed app mode is active on this device.');
    } else if (isIos) {
      setPlatformHint('iPhone/iPad: tap Share, then Add to Home Screen. Safari supports the most reliable install flow.');
    } else if (isAndroid) {
      setPlatformHint('Android: tap Install app here when available, or use the browser menu and choose Install app.');
    } else {
      setPlatformHint('Desktop: install from the browser address bar or use the button when it becomes available.');
    }

    const handler = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setMessage('Ready to install on this device.');
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function install() {
    if (!installEvent) {
      setMessage(platformHint);
      return;
    }
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setInstallEvent(null);
    setMessage(choice.outcome === 'accepted' ? 'Install accepted.' : 'Install dismissed. You can install later from the browser menu.');
  }

  return (
    <section className="rounded-[2rem] border border-orange-200/20 bg-[#fff4e7] p-5 text-stone-950 shadow-2xl shadow-black/25">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-[#a34222]">Mobile app</p>
      <h2 className="mt-2 text-2xl font-black">Install once. Use as customer or seller.</h2>
      <p className="mt-3 text-sm leading-6 text-stone-700">
        The same PWA works on desktop, tablet and smartphone. Customers use it for wallet status and QR proofs; sellers use it for rules, scanner links and redemptions.
      </p>
      <div className="mt-4 rounded-2xl border border-[#d78962]/35 bg-white/55 p-4 text-sm leading-6 text-stone-700">
        <strong className="text-stone-950">{isStandalone ? 'Installed' : 'Install help'}</strong>
        <p className="mt-1">{platformHint}</p>
      </div>
      <button
        type="button"
        onClick={install}
        className="mt-5 w-full rounded-2xl bg-[#b84625] px-5 py-4 text-sm font-black uppercase tracking-[0.16em] text-white shadow-xl shadow-orange-900/30 transition hover:-translate-y-0.5 hover:bg-[#9f351b]"
      >
        {isStandalone ? 'App installed' : 'Install app'}
      </button>
      <p className="mt-3 text-xs leading-5 text-stone-600">{message}</p>
    </section>
  );
}

function CodeGenerator() {
  const [businessId, setBusinessId] = useState('your-business-id');
  const [ruleLabel, setRuleLabel] = useState('Bronze 10%');
  const [mode, setMode] = useState<CodeMode>('link');
  const [copyStatus, setCopyStatus] = useState('');

  const scannerUrl = useMemo(() => `https://shop.ifrunit.tech/b/${businessId || 'your-business-id'}`, [businessId]);

  const code = useMemo(() => {
    if (mode === 'button') {
      return `<a href="${scannerUrl}" target="_blank" rel="noopener">Verify IFR discount</a>`;
    }
    if (mode === 'api') {
      return `POST /api/sessions
{
  "businessId": "${businessId || 'your-business-id'}",
  "benefitRuleId": "selected-active-rule-id"
}`;
    }
    return scannerUrl;
  }, [businessId, mode, scannerUrl]);

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(code);
      setCopyStatus('Copied.');
    } catch {
      setCopyStatus('Copy failed in this browser.');
    }
  }

  async function shareSnippet() {
    try {
      if (navigator.share) {
        await navigator.share({
          title: `IFR checkout entry - ${ruleLabel || 'Benefit'}`,
          text: code,
          url: mode === 'link' ? code : scannerUrl,
        });
        setCopyStatus('Share sheet opened.');
        return;
      }
      await copySnippet();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setCopyStatus('Share failed in this browser.');
    }
  }

  return (
    <section id="integrate" className="rounded-[2rem] border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/25 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">Code generator</p>
          <h2 className="mt-2 text-2xl font-black text-white">Create a seller entry point</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={copySnippet}
            className="rounded-full border border-green-300/25 bg-green-300/10 px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-green-100 transition hover:bg-green-300/15"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={shareSnippet}
            className="rounded-full border border-orange-200/25 bg-orange-200/10 px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-orange-100 transition hover:bg-orange-200/15"
          >
            Share
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Business ID
          <input
            value={businessId}
            onChange={(event) => setBusinessId(event.target.value)}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Rule label
          <input
            value={ruleLabel}
            onChange={(event) => setRuleLabel(event.target.value)}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          />
        </label>
      </div>

      <div className="mt-4 grid grid-cols-3 rounded-2xl border border-white/10 bg-black/25 p-1">
        {(['link', 'button', 'api'] as CodeMode[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setMode(item)}
            className={`rounded-xl px-3 py-2 text-xs font-black uppercase tracking-[0.12em] transition ${
              mode === item ? 'bg-orange-300 text-stone-950' : 'text-stone-300 hover:text-white'
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-[#080706] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-[0.14em] text-stone-500">Generated for {ruleLabel || 'IFR Benefit'}</p>
          <a href={scannerUrl} className="text-xs font-bold uppercase tracking-[0.14em] text-orange-200 hover:text-orange-100">
            Open scanner
          </a>
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap text-sm leading-6 text-orange-100">{code}</pre>
      </div>
      {copyStatus ? <p className="mt-3 text-xs font-semibold text-stone-300">{copyStatus}</p> : null}
    </section>
  );
}

export default function Home() {
  const [role, setRole] = useState<Role>('customer');

  return (
    <AppShell>
      <section className="mx-auto grid w-full max-w-7xl gap-8 px-5 pb-16 pt-4 lg:grid-cols-[1.03fr_0.97fr] lg:items-start">
        <div className="pt-5">
          <div className="inline-flex items-center gap-3 rounded-full border border-orange-200/20 bg-black/25 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-orange-100">
            <span className="h-2 w-2 rounded-full bg-green-300 shadow-[0_0_22px_rgba(134,239,172,0.9)]" />
            IFRp Benefits Network
          </div>
          <h1 className="mt-6 max-w-4xl text-5xl font-black leading-[0.92] text-white md:text-7xl">
            The shop layer for locked IFR access.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-300">
            One app for customers and sellers: wallet status, QR proofs, discount rules, checkout redemption and developer handoff links for shops that want to accept IFR access.
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
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-orange-200">Customer</span>
              <span className="mt-3 block text-xl font-black text-white">Unlock benefits</span>
              <span className="mt-2 block text-sm leading-6 text-stone-300">
                Connect wallet, read IFR status, lock access in-app, and verify seller QR sessions.
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
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-orange-200">Seller</span>
              <span className="mt-3 block text-xl font-black text-white">Offer discounts</span>
              <span className="mt-2 block text-sm leading-6 text-stone-300">
                Create benefit rules, launch a scanner, verify locked IFR and redeem each checkout once.
              </span>
            </button>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#customer-wallet"
              className="rounded-full bg-orange-300 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-stone-950 shadow-xl shadow-orange-950/40 transition hover:-translate-y-0.5 hover:bg-orange-200"
            >
              Lock IFR
            </a>
            <a
              href="#integrate"
              className="rounded-full border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-stone-100 transition hover:border-orange-200/60"
            >
              Generate shop link
            </a>
            <a
              href="/guide"
              className="rounded-full border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-stone-100 transition hover:border-orange-200/60"
            >
              Open guide
            </a>
            <a
              href="https://ifrunit.tech"
              className="rounded-full border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-stone-100 transition hover:border-orange-200/60"
            >
              IFR Project
            </a>
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-2">
            {flowSteps.map((step, index) => (
              <article key={step.title} className="rounded-3xl border border-white/10 bg-black/20 p-5">
                <p className="font-mono text-sm text-orange-200">0{index + 1}</p>
                <h2 className="mt-3 text-xl font-black text-white">{step.title}</h2>
                <p className="mt-2 text-sm leading-6 text-stone-300">{step.body}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="grid gap-5">
          <PwaInstallCard />
          {role === 'customer' ? <WalletStatus /> : <SellerRuleBuilder />}
          <section className="rounded-[2rem] border border-white/10 bg-black/20 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">
              Seller categories
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {sellerCategories.map((item) => (
                <span key={item} className="rounded-full border border-white/10 bg-white/[0.045] px-3 py-2 text-xs font-bold text-stone-200">
                  {item}
                </span>
              ))}
            </div>
          </section>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-5 px-5 pb-16 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-[2rem] border border-white/10 bg-[#160f0b] p-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">For shops</p>
          <h2 className="mt-3 text-3xl font-black text-white">A discount rule becomes a checkout proof.</h2>
          <p className="mt-4 text-sm leading-7 text-stone-300">
            Sellers do not need to custody customer tokens. They configure what a locked IFR balance unlocks, then the app issues a short-lived QR session. The customer signs, the backend checks IFRLock, and the seller redeems the approved benefit once.
          </p>
          <div className="mt-5 grid gap-3 text-sm text-stone-300">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <strong className="text-white">Rule data</strong>
              <p className="mt-1">Category, product/service, discount, required IFR and TTL.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <strong className="text-white">Proof data</strong>
              <p className="mt-1">Business ID, rule ID, nonce, expiry, wallet signature and on-chain lock status.</p>
            </div>
          </div>
        </div>
        <CodeGenerator />
      </section>
    </AppShell>
  );
}
