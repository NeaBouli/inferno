import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { LocalDataControls } from '@/components/LocalDataControls';

export const metadata: Metadata = {
  title: 'Privacy & data | IFR Benefits',
  description: 'What the IFR Benefits Network keeps in your browser, what the backend stores, and what is public. Honest status, not a final legal policy.',
  alternates: { canonical: 'https://shop.ifrunit.tech/privacy' },
};

const browserItems = [
  {
    title: 'ifr.shop.* browser keys',
    body: 'The app stores a small set of localStorage keys whose names start with ifr.shop. : your preferred role, the last seller business ID you used, recent checkout session references and a cached customer proof history. These stay in this browser and are never sent as analytics.',
  },
  {
    title: 'Active pass control token',
    body: 'When you create a customer checkout pass, its control token is kept only in this tab\'s sessionStorage so the pass survives a page refresh. Closing the tab discards it.',
  },
  {
    title: 'Static app shell cache',
    body: 'The service worker keeps a CacheStorage cache named ifr-benefits-* with the static app shell so pages load faster. It holds application files, not your activity. If you clear it, the app can create it again when it next loads assets.',
  },
];

const backendItems = [
  {
    title: 'Wallet address',
    body: 'The backend stores the wallet addresses that verify or interact, together with verification amounts, statuses and timestamps, so it can enforce eligibility, limits and rewards.',
  },
  {
    title: 'Hashed control tokens and audit events',
    body: 'Customer pass control tokens are stored only as hashes, and security-relevant actions are recorded as audit events.',
  },
  {
    title: 'Signatures are verified, not stored',
    body: 'Wallet signatures are request inputs: the backend verifies each one transiently to authorize a single action. They are not modeled as stored signature fields.',
  },
];

const publicItems = [
  {
    title: 'Public seller and catalog data',
    body: 'Seller profiles and product catalogs published on the Benefits Network are public by design and can be indexed by search engines.',
  },
  {
    title: 'Public Ethereum data',
    body: 'The app reads public on-chain data such as ETH, IFR and IFRLock status. Any approve or lock transaction you sign is a public Ethereum transaction, visible to anyone on the network forever.',
  },
];

const thirdPartyItems = [
  {
    title: 'Wallet providers and public RPC',
    body: 'Your browser-injected Ethereum wallet provider and the public RPC endpoints used for chain reads see your IP address and the requests made through them, under their own policies.',
  },
  {
    title: 'Coinbase Wallet and WalletConnect',
    body: 'Coinbase Wallet is offered as a fallback connector. The full WalletConnect modal is only active when a WalletConnect Project ID is configured; when it is, connecting through it involves WalletConnect infrastructure.',
  },
  {
    title: 'Copilot and Uniswap',
    body: 'The AI Copilot only loads when you open it, and it is embedded with referrer policy no-referrer. Uniswap is only contacted when you explicitly click a swap link.',
  },
];

function FactGrid({ eyebrow, title, intro, items }: { eyebrow: string; title: string; intro: string; items: typeof browserItems }) {
  return (
    <section className="rounded-[2rem] border border-white/10 bg-white/[0.055] p-6 shadow-2xl shadow-black/25">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-black text-white">{title}</h2>
      <p className="mt-3 max-w-3xl text-sm leading-7 text-stone-300">{intro}</p>
      <div className="mt-5 grid gap-3">
        {items.map((item) => (
          <article key={item.title} className="rounded-3xl border border-white/10 bg-black/20 p-4">
            <h3 className="text-lg font-black text-white">{item.title}</h3>
            <p className="mt-2 text-sm leading-6 text-stone-300">{item.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <AppShell>
      <section className="mx-auto w-full max-w-7xl px-5 pb-16 pt-6">
        <div className="rounded-[2.25rem] border border-orange-200/15 bg-[linear-gradient(135deg,rgba(248,164,92,0.16),rgba(255,255,255,0.055)_44%,rgba(49,151,103,0.12))] p-6 shadow-2xl shadow-black/30 md:p-10">
          <div className="max-w-4xl">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-100">IFR Benefits Network</p>
            <h1 className="mt-4 text-5xl font-black leading-[0.95] text-white md:text-7xl">
              Privacy &amp; data, stated plainly.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-stone-300">
              This page describes what the current shop app actually keeps in your browser, what the backend stores, and what is public by design. It is an honest technical status, not a finalized legal policy.
            </p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#local-data-controls"
              className="rounded-full bg-orange-300 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-stone-950 shadow-xl shadow-orange-950/40 transition hover:-translate-y-0.5 hover:bg-orange-200"
            >
              Manage local data
            </a>
            <a
              href="/guide"
              className="rounded-full border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-stone-100 transition hover:border-orange-200/60"
            >
              Read the guide
            </a>
          </div>
        </div>

        <div className="mt-6 grid gap-5">
          <section className="rounded-[2rem] border border-white/10 bg-white/[0.055] p-6 shadow-2xl shadow-black/25" id="local-data-controls">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">Your browser</p>
            <h2 className="mt-2 text-3xl font-black text-white">What stays on this device</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-stone-300">
              Everything below lives only in this browser. You can inspect and clear the app&apos;s own keys and caches here. Clearing them does not affect backend records or on-chain data, does not touch wallet-provider storage or any other site&apos;s data, and does not disconnect your wallet.
            </p>
            <div className="mt-5 grid gap-3">
              {browserItems.map((item) => (
                <article key={item.title} className="rounded-3xl border border-white/10 bg-black/20 p-4">
                  <h3 className="text-lg font-black text-white">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-stone-300">{item.body}</p>
                </article>
              ))}
            </div>
            <div className="mt-5">
              <LocalDataControls />
            </div>
          </section>

          <FactGrid
            eyebrow="Backend"
            title="What the backend stores"
            intro="The Benefits backend keeps records used to run verification, eligibility, limits and rewards:"
            items={backendItems}
          />

          <div className="grid gap-5 lg:grid-cols-2">
            <FactGrid
              eyebrow="Public by design"
              title="What anyone can see"
              intro="Some data in this system is intentionally public:"
              items={publicItems}
            />
            <FactGrid
              eyebrow="Third parties"
              title="Who else is involved"
              intro="Using the app can involve these external services, each under its own policy:"
              items={thirdPartyItems}
            />
          </div>

          <section className="rounded-[2rem] border border-green-300/20 bg-green-300/[0.07] p-6">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-green-100/80">Masked seller history</p>
            <h2 className="mt-2 text-3xl font-black text-white">Sellers see a masked wallet, not the full address.</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-stone-300">
              Seller-facing session history displays masked wallet identifiers, so a seller reviewing recent checks does not receive your full address in that history response. Seller reward status returns only an event count, not customer event details. The backend still retains the full wallet address, because eligibility checks, usage limits and rewards depend on it. Masking is a display choice in seller views, not anonymity.
            </p>
          </section>

          <section className="rounded-[2rem] border border-white/10 bg-[#160f0b] p-6">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">Open items</p>
            <h2 className="mt-2 text-3xl font-black text-white">What is not decided yet</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-stone-300">
              The backend has a manual operator tool for counting and removing expired, unlinked authorization artifacts after an approved cutoff. It does not automatically delete checkout sessions, session audit records, reward records or passes linked to sessions. The long-term server-side retention, deletion and support policy is not finalized. This page therefore makes no promise that backend records can be deleted on request, and it does not claim compliance with GDPR or any other specific legal framework. There is no dedicated privacy support channel at this time. When a final policy exists, this page will be updated to match it.
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-stone-300">
              What you can always do today: clear this browser&apos;s local app data with the controls above, disconnect your wallet in your wallet app, and simply stop using the service. On-chain transactions you have already signed remain public on Ethereum and cannot be altered or removed by anyone.
            </p>
          </section>
        </div>
      </section>
    </AppShell>
  );
}
