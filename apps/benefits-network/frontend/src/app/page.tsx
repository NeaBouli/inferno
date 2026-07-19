'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { CustomerProofHistory } from '@/components/CustomerProofHistory';
import { CustomerCheckoutPass } from '@/components/CustomerCheckoutPass';
import { OfferDiscovery } from '@/components/OfferDiscovery';
import { SellerRuleBuilder } from '@/components/SellerRuleBuilder';
import { SwapRiskNotice } from '@/components/SwapRiskNotice';
import { WalletStatus } from '@/components/WalletStatus';
import { hasWalletConnectProjectId } from '@/lib/wagmi';

type Role = 'customer' | 'seller';
type CodeMode = 'link' | 'button' | 'api' | 'pos';
const UNISWAP_IFR_URL = 'https://app.uniswap.org/swap?outputCurrency=0x77e99917Eca8539c62F509ED1193ac36580A6e7B';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const flowSteps = [
  {
    title: 'Customer locks IFR for access',
    body: 'The app reads wallet status, IFR balance and the exact IFRLock threshold without moving tokens during verification.',
  },
  {
    title: 'Seller creates a rule',
    body: 'A shop defines product, category, discount, required locked IFR and QR session lifetime.',
  },
  {
    title: 'Present or scan a QR',
    body: 'The customer can present a short-lived pass, or use the compatible seller-QR flow. Neither QR is reusable proof.',
  },
  {
    title: 'Confirm and redeem once',
    body: 'The customer approves the exact seller rule, then the seller redeems the approved checkout once.',
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

const walletOnboardingSteps = [
  {
    title: 'Choose a wallet',
    body: 'Use an Ethereum wallet you control, such as MetaMask, Coinbase Wallet, Trust, OKX or an EVM-ready Phantom session.',
  },
  {
    title: 'Fund gas and IFR',
    body: 'Keep a small ETH balance for gas, then buy or receive IFR in the same wallet before locking access.',
  },
  {
    title: 'Lock inside the app',
    body: 'Approve only the entered IFR amount, lock it in IFRLock, then use the same wallet for seller QR proofs.',
  },
  {
    title: 'Protect recovery',
    body: 'Back up the wallet recovery phrase offline during wallet setup, never paste it into this site, verify shop.ifrunit.tech and Ethereum Mainnet, and disconnect on shared devices.',
  },
];

interface ReadyStatus {
  status: string;
  chainId: number;
  database: string;
}

function PwaInstallCard() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [platformHint, setPlatformHint] = useState('Install from the browser menu when your device supports PWA install.');
  const [platformTitle, setPlatformTitle] = useState('Browser install');
  const [installSteps, setInstallSteps] = useState<string[]>([
    'Open the browser menu.',
    'Choose Install app or Add to Home Screen.',
  ]);
  const [isStandalone, setIsStandalone] = useState(false);
  const [platform, setPlatform] = useState<'ios' | 'android' | 'desktop' | 'installed'>('desktop');
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
      setPlatform('installed');
      setPlatformTitle('Installed mode');
      setPlatformHint('Installed app mode is active on this device.');
      setInstallSteps(['Launch it from the home screen whenever you need customer or seller mode.']);
    } else if (isIos) {
      setPlatform('ios');
      setPlatformTitle('iPhone / iPad install');
      setPlatformHint('iOS does not show a real in-page install prompt. Add the app from the browser share sheet instead.');
      setInstallSteps([
        'Open shop.ifrunit.tech in Safari for the cleanest install path.',
        'Tap the Share icon in the browser toolbar.',
        'Choose Add to Home Screen. In Chrome on iPad, open Share first, then Add to Home Screen if iOS offers it.',
        'Open IFR Benefits from the new home-screen icon.',
      ]);
    } else if (isAndroid) {
      setPlatform('android');
      setPlatformTitle('Android install');
      setPlatformHint('Android: tap Install app here when available, or use the browser menu and choose Install app.');
      setInstallSteps(['Tap Install app if this browser exposes it.', 'Otherwise open the browser menu.', 'Choose Install app or Add to Home Screen.']);
    } else {
      setPlatform('desktop');
      setPlatformTitle('Desktop install');
      setPlatformHint('Desktop: install from the browser address bar or use the button when it becomes available.');
      setInstallSteps(['Use the install icon in the address bar when visible.', 'Or open the browser menu and choose Install app.']);
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
      setMessage(platform === 'ios' ? 'Use Safari Share -> Add to Home Screen on iPhone or iPad.' : platformHint);
      return;
    }
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setInstallEvent(null);
    setMessage(choice.outcome === 'accepted' ? 'Install accepted.' : 'Install dismissed. You can install later from the browser menu.');
  }

  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-orange-200/20 bg-[#fff4e7] p-5 text-stone-950 shadow-2xl shadow-black/25">
      <div className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-orange-300/30 blur-3xl" />
      <div className="relative">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#a34222]">Mobile app</p>
            <h2 className="mt-2 text-2xl font-black">Install once. Use as customer or seller.</h2>
          </div>
          <span className="rounded-full border border-[#d78962]/45 bg-white/65 px-3 py-2 text-[0.68rem] font-black uppercase tracking-[0.14em] text-[#8f3219]">
            {platformTitle}
          </span>
        </div>
      <p className="mt-3 text-sm leading-6 text-stone-700">
        The same PWA works on desktop, tablet and smartphone. Customers use it for wallet status and QR proofs; sellers use it for rules, scanner links and redemptions.
      </p>
      <div className="mt-4 rounded-2xl border border-[#d78962]/35 bg-white/70 p-4 text-sm leading-6 text-stone-700 shadow-inner shadow-orange-900/5">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#b84625] text-lg font-black text-white shadow-lg shadow-orange-900/25">
            {platform === 'ios' ? '↑' : platform === 'installed' ? '✓' : '+'}
          </span>
          <strong className="text-stone-950">{isStandalone ? 'Installed' : platform === 'ios' ? 'iPad/iPhone steps' : 'Install help'}</strong>
        </div>
        <p className="mt-1">{platformHint}</p>
        <ol className="mt-3 grid gap-2">
          {installSteps.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#b84625] text-xs font-black text-white">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>
      <button
        type="button"
        onClick={install}
        className="mt-5 w-full rounded-2xl bg-[#b84625] px-5 py-4 text-sm font-black uppercase tracking-[0.16em] text-white shadow-xl shadow-orange-900/30 transition hover:-translate-y-0.5 hover:bg-[#9f351b]"
      >
        {isStandalone ? 'App installed' : installEvent ? 'Install app' : platform === 'ios' ? 'Show iPad install steps' : 'Show install steps'}
      </button>
      <p className="mt-3 text-xs leading-5 text-stone-600">{message}</p>
      </div>
    </section>
  );
}

function CodeGenerator() {
  const [businessId, setBusinessId] = useState('your-business-id');
  const [ruleLabel, setRuleLabel] = useState('Bronze 10%');
  const [mode, setMode] = useState<CodeMode>('link');
  const [copyStatus, setCopyStatus] = useState('');

  const normalizedBusinessId = businessId.trim() || 'your-business-id';
  const scannerUrl = useMemo(
    () => `https://shop.ifrunit.tech/b/${encodeURIComponent(normalizedBusinessId)}`,
    [normalizedBusinessId]
  );

  const code = useMemo(() => {
    if (mode === 'button') {
      return `<a href="${scannerUrl}" target="_blank" rel="noopener">Verify IFR discount</a>`;
    }
    if (mode === 'api') {
      return `GET https://shop.ifrunit.tech/api/seller/auth-message?action=sessions%3Acreate&businessId=${encodeURIComponent(normalizedBusinessId)}&walletAddress=<seller-wallet>&scope=<benefit-rule-id-or-default>\n\nSign the returned one-time message, then:\nPOST https://shop.ifrunit.tech/api/sessions\nAction: sessions:create\nBusiness: ${normalizedBusinessId}\nRequired signed headers: x-ifr-wallet, x-ifr-signature, x-ifr-timestamp, x-ifr-nonce\n\n${JSON.stringify({
        businessId: normalizedBusinessId,
        benefitRuleId: 'selected-active-rule-id',
      }, null, 2)}`;
    }
    if (mode === 'pos') {
      return `async function createIFRCheckout(benefitRuleId, sellerAuth) {
  const response = await fetch("https://shop.ifrunit.tech/api/sessions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ifr-wallet": sellerAuth.walletAddress,
      "x-ifr-signature": sellerAuth.signature,
      "x-ifr-timestamp": sellerAuth.timestamp,
      "x-ifr-nonce": sellerAuth.nonce
    },
    body: JSON.stringify({
      businessId: ${JSON.stringify(normalizedBusinessId)},
      benefitRuleId
    })
  });

  if (!response.ok) {
    throw new Error(\`IFR checkout failed: \${response.status}\`);
  }

  const session = await response.json();
  return {
    ...session,
    customerUrl: new URL(session.qrUrl, "https://shop.ifrunit.tech").toString()
  };
}

// sellerAuth signs the server-issued one-time message bound to this rule ID.
const checkout = await createIFRCheckout("selected-active-rule-id", sellerAuth);`;
    }
    return scannerUrl;
  }, [mode, normalizedBusinessId, scannerUrl]);

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

      <div className="mt-4 grid grid-cols-2 rounded-2xl border border-white/10 bg-black/25 p-1 sm:grid-cols-4">
        {(['link', 'button', 'api', 'pos'] as CodeMode[]).map((item) => (
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
      {mode === 'pos' ? (
        <p className="mt-3 text-xs leading-5 text-stone-400">
          Server-side POS JavaScript. It returns the short-lived customer URL for your QR renderer; no seller secret or wallet key belongs in this snippet.
        </p>
      ) : null}
      {copyStatus ? <p className="mt-3 text-xs font-semibold text-stone-300">{copyStatus}</p> : null}
    </section>
  );
}

function WalletStarterKit() {
  return (
    <section className="rounded-[2rem] border border-green-300/20 bg-[radial-gradient(circle_at_top_left,rgba(134,239,172,0.16),transparent_34%),linear-gradient(145deg,rgba(255,255,255,0.07),rgba(8,7,6,0.38))] p-5 shadow-2xl shadow-black/25 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-green-100/80">Wallet starter kit</p>
          <h2 className="mt-2 text-2xl font-black text-white">Bring or create your IFR wallet safely.</h2>
        </div>
        <span className="rounded-full border border-green-200/25 bg-green-200/10 px-3 py-2 text-[0.68rem] font-black uppercase tracking-[0.14em] text-green-100">
          Non-custodial
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-stone-300">
        The shop app never creates, stores or asks for seed phrases. New users create a wallet in a trusted wallet app, then return here to connect, buy IFR, lock access and scan seller QR codes.
      </p>
      <div className="mt-5 grid gap-3">
        {walletOnboardingSteps.map((step, index) => (
          <article key={step.title} className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-green-200/25 bg-green-200/10 font-mono text-xs font-black text-green-100">
                {index + 1}
              </span>
              <div>
                <h3 className="text-sm font-black text-white">{step.title}</h3>
                <p className="mt-1 text-sm leading-6 text-stone-300">{step.body}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <a
          href="#customer-wallet"
          className="rounded-2xl bg-green-200 px-4 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-green-950/25 transition hover:-translate-y-0.5 hover:bg-green-100"
        >
          Connect or lock
        </a>
        <a
          href={UNISWAP_IFR_URL}
          target="_blank"
          rel="noopener"
          className="rounded-2xl border border-white/15 px-4 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-green-200/60"
        >
          Buy IFR
        </a>
      </div>
      <SwapRiskNotice />
    </section>
  );
}

function SystemReadinessCard() {
  const [ready, setReady] = useState<ReadyStatus | null>(null);
  const [checkedAt, setCheckedAt] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function refreshReadiness() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/ready', { headers: { accept: 'application/json' } });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || data?.status || `HTTP ${response.status}`);
      }
      setReady(data as ReadyStatus);
      setCheckedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err) {
      setReady(null);
      setError(err instanceof Error ? err.message : 'Readiness check failed.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshReadiness();
  }, []);

  const apiReady = ready?.status === 'ready' && ready.database === 'ok';
  const chainReady = Number(ready?.chainId) === 1;
  const checks = [
    {
      label: 'API + database',
      value: apiReady ? 'Ready' : ready ? 'Needs attention' : 'Checking',
      ok: apiReady,
    },
    {
      label: 'Ethereum Mainnet',
      value: chainReady ? 'Chain 1' : ready?.chainId ? `Chain ${ready.chainId}` : 'Checking',
      ok: chainReady,
    },
    {
      label: 'Wallet coverage',
      value: hasWalletConnectProjectId ? 'Multi-wallet ready' : 'Browser wallets active',
      ok: hasWalletConnectProjectId,
    },
  ];

  return (
    <section className="rounded-[2rem] border border-white/10 bg-[linear-gradient(145deg,rgba(255,255,255,0.07),rgba(8,7,6,0.4))] p-5 shadow-2xl shadow-black/25 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">System readiness</p>
          <h2 className="mt-2 text-2xl font-black text-white">Live shop diagnostics</h2>
        </div>
        <button
          type="button"
          onClick={refreshReadiness}
          disabled={loading}
          className="rounded-full border border-white/15 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-orange-200/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Checking' : 'Refresh'}
        </button>
      </div>
      <p className="mt-3 text-sm leading-6 text-stone-300">
        Public checks for this app. Browser wallet apps and extensions are active; universal WalletConnect coverage still requires its production project configuration.
      </p>

      <div className="mt-4 grid gap-2">
        {checks.map((check) => (
          <div
            key={check.label}
            className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${
              check.ok
                ? 'border-green-300/20 bg-green-300/[0.08] text-green-50'
                : 'border-orange-200/20 bg-orange-200/[0.08] text-orange-50'
            }`}
          >
            <span className="font-semibold">{check.label}</span>
            <span className="font-black">{check.value}</span>
          </div>
        ))}
      </div>

      {checkedAt ? <p className="mt-3 text-xs text-stone-400">Last checked: {checkedAt}</p> : null}
      {error ? <p className="mt-3 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-200">{error}</p> : null}
    </section>
  );
}

export default function Home() {
  const [role, setRole] = useState<Role>('customer');

  useEffect(() => {
    const syncRoleFromHash = () => {
      const sellerHashes = new Set(['#seller-workspace', '#integrate', '#seller-session-history']);
      const customerHashes = new Set(['#customer-pass', '#customer-wallet', '#my-benefits']);
      const requestedMode = new URLSearchParams(window.location.search).get('mode');
      if (sellerHashes.has(window.location.hash) || requestedMode === 'seller') setRole('seller');
      if (customerHashes.has(window.location.hash) || requestedMode === 'customer') setRole('customer');
    };
    syncRoleFromHash();
    window.addEventListener('hashchange', syncRoleFromHash);
    return () => window.removeEventListener('hashchange', syncRoleFromHash);
  }, []);

  useEffect(() => {
    const rawTargetId = window.location.hash.slice(1);
    if (!rawTargetId) return;
    let targetId = rawTargetId;
    try {
      targetId = decodeURIComponent(rawTargetId);
    } catch {
      return;
    }
    let secondFrame = 0;
    const scrollToTarget = () => document.getElementById(targetId)?.scrollIntoView({ block: 'start' });
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        scrollToTarget();
      });
    });
    const layoutRetry = window.setTimeout(scrollToTarget, 700);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(layoutRetry);
    };
  }, [role]);

  return (
    <AppShell>
      <section className="mx-auto grid w-full max-w-7xl gap-8 px-5 pb-10 pt-6 sm:pt-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
        <div>
          <div className="inline-flex items-center gap-3 rounded-full border border-orange-200/20 bg-black/25 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-orange-100">
            <span className="h-2 w-2 rounded-full bg-green-300 shadow-[0_0_22px_rgba(134,239,172,0.9)]" />
            Inferno Protocol · IFR Benefits Network
          </div>
          <h1 className="mt-4 max-w-4xl text-4xl font-black leading-[0.98] text-white sm:mt-6 sm:text-5xl md:text-6xl">
            Locked IFR. Benefits at checkout.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-stone-300 sm:mt-6 sm:text-lg sm:leading-8">
            Customers prove access without sending tokens. Present a short-lived customer QR, approve the exact seller offer, and let the seller redeem it once.
          </p>

          <div id="choose-mode" className="mt-6 grid scroll-mt-36 grid-cols-2 gap-3 sm:mt-8" aria-label="Choose app mode">
            <button
              type="button"
              onClick={() => setRole('customer')}
              aria-pressed={role === 'customer'}
              className={`rounded-3xl border p-4 text-left transition sm:p-5 ${
                role === 'customer'
                  ? 'border-orange-300 bg-orange-300/15 shadow-2xl shadow-orange-950/40'
                  : 'border-white/10 bg-white/[0.05] hover:border-orange-200/50'
              }`}
            >
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-orange-200">Customer</span>
              <span className="mt-2 block text-base font-black text-white sm:mt-3 sm:text-xl">Unlock benefits</span>
              <span className="mt-2 hidden text-sm leading-6 text-stone-300 sm:block">
                Connect wallet, read IFR status, create your checkout QR, or verify a compatible seller QR.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setRole('seller')}
              aria-pressed={role === 'seller'}
              className={`rounded-3xl border p-4 text-left transition sm:p-5 ${
                role === 'seller'
                  ? 'border-orange-300 bg-orange-300/15 shadow-2xl shadow-orange-950/40'
                  : 'border-white/10 bg-white/[0.05] hover:border-orange-200/50'
              }`}
            >
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-orange-200">Seller</span>
              <span className="mt-2 block text-base font-black text-white sm:mt-3 sm:text-xl">Offer discounts</span>
              <span className="mt-2 hidden text-sm leading-6 text-stone-300 sm:block">
                Create benefit rules, launch a scanner, verify locked IFR and redeem each checkout once.
              </span>
            </button>
          </div>

          <div className="mt-6 flex flex-wrap gap-3 sm:mt-8">
            <a
              href={role === 'customer' ? '#customer-pass' : '#seller-workspace'}
              className="rounded-full bg-orange-300 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-stone-950 shadow-xl shadow-orange-950/40 transition hover:-translate-y-0.5 hover:bg-orange-200"
            >
              {role === 'customer' ? 'Create checkout QR' : 'Open seller tools'}
            </a>
            <a
              href={role === 'customer' ? '/scan' : '/guide'}
              className="rounded-full border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-stone-100 transition hover:border-orange-200/60"
            >
              {role === 'customer' ? 'Scan seller QR' : 'Seller guide'}
            </a>
            <a
              href="/guide"
              className="rounded-full border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-stone-100 transition hover:border-orange-200/60"
            >
              {role === 'customer' ? 'How it works' : 'Full guide'}
            </a>
          </div>
          <p className="mt-4 max-w-xl text-xs leading-5 text-stone-400 sm:mt-6 sm:text-sm sm:leading-6">
            Non-custodial: the app never asks for a seed phrase and never moves tokens during a benefit check.
          </p>
        </div>

        <div id="seller-workspace" className="grid scroll-mt-36 gap-5">
          {role === 'customer' ? (
            <>
              <WalletStatus />
              <CustomerCheckoutPass />
              <div id="install-app" className="scroll-mt-36">
                <PwaInstallCard />
              </div>
              <div id="my-benefits" className="scroll-mt-36">
                <CustomerProofHistory />
              </div>
              <WalletStarterKit />
            </>
          ) : (
            <>
              <SellerRuleBuilder />
              <CodeGenerator />
              <div id="install-app" className="scroll-mt-36">
                <PwaInstallCard />
              </div>
            </>
          )}
          {role === 'seller' ? <section className="rounded-[2rem] border border-white/10 bg-black/20 p-5">
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
          </section> : null}
        </div>
      </section>

      <OfferDiscovery />

      <section className="mx-auto w-full max-w-7xl px-5 pb-12">
        <div className="border-y border-white/10 py-8">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">One checkout, four clear steps</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {flowSteps.map((step, index) => (
              <article key={step.title} className="rounded-3xl border border-white/10 bg-black/20 p-5">
                <p className="font-mono text-sm text-orange-200">0{index + 1}</p>
                <h2 className="mt-3 text-xl font-black text-white">{step.title}</h2>
                <p className="mt-2 text-sm leading-6 text-stone-300">{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-5 px-5 pb-16 lg:grid-cols-[1.08fr_0.92fr]">
        <div className="rounded-[2rem] border border-white/10 bg-[#160f0b] p-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">For customers and sellers</p>
          <h2 className="mt-3 text-3xl font-black text-white">A lock check, not a token payment.</h2>
          <p className="mt-4 text-sm leading-7 text-stone-300">
            The customer keeps custody of IFR. A short-lived two-phase pass binds one seller rule, requires explicit customer approval, checks IFRLock and can be redeemed only once. The compatible seller-QR flow remains available.
          </p>
          <div className="mt-5 grid gap-3 text-sm text-stone-300 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <strong className="text-white">What the seller sees</strong>
              <p className="mt-1">Product, discount, required locked IFR, approval state and expiry.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <strong className="text-white">What stays private</strong>
              <p className="mt-1">No seed phrase, no private key and no transfer during verification.</p>
            </div>
          </div>
        </div>
        <SystemReadinessCard />
      </section>
    </AppShell>
  );
}
