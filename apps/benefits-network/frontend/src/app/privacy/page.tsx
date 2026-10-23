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
    body: 'The app stores a small set of localStorage keys whose names start with ifr.shop. : your preferred role, the last seller business ID you used, recent checkout session references and your customer receipts. These stay in this browser and are never sent as analytics.',
  },
  {
    title: 'Device-local customer receipts',
    body: 'After a successful checkout proof, this browser keeps the exact text you signed (including your full wallet address, the shop, the checkout and its terms) and your signature, so you can re-verify it on this device. It keeps up to 12 receipts without time-based deletion. There is no server receipt-history retrieval service; merchant checkout records and conditional reward pseudonyms are separate backend records. Clearing browser data or changing device loses these local receipts.',
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
    title: 'No customer wallet address in checkout records',
    body: 'The ordinary checkout processes your raw wallet address and signature within the proof request to check signature, on-chain eligibility and seller-controlled-wallet status. The checkout service does not write the raw customer address, signature, signed text, measured lock or balance amounts, customer verification block or customer payment transaction hash to its records. The conditional Model B reward path can retain a wallet-derived pseudonym as described below. Seller and operator wallet addresses are stored for account and checkout authorization.',
  },
  {
    title: 'Conditional Model B reward pseudonyms',
    body: 'When a verified Model B pilot and its dedicated deduplication key are configured, a reward-eligible checkout can store rewardDedupKey, a keyed HMAC scoped to chain, vault, partner and UTC month, plus rewardPeriod in RewardEvent. This prevents a second reward for the same wallet, partner and month; it does not prevent another checkout. The key is linked to a checkout and is pseudonymous, not anonymous: a holder of the secret can recompute it for candidate wallets. Its scope does not cause automatic deletion. Retention period not yet defined. This describes the implemented conditional path, not a claim that a pilot is active.',
  },
  {
    title: 'Merchant checkout records do exist',
    body: 'For each checkout the backend keeps a merchant session record: a fresh random checkout ID and nonce, the shop and rule, snapshotted offer terms, status, timestamps, proof version and attempt count, qualifying lock source and seller-controlled-wallet flag, plus any customer-pass link. It keeps the opening seller wallet, role and operator reference, seller-side audit events and any reward-event linkage and outcome. These records let one checkout be redeemed exactly once; they are not anonymous, and timing, offer details or reward pseudonyms may be linkable with other information. Retention period not yet defined.',
  },
  {
    title: 'Hashed control tokens',
    body: 'Customer checkout passes are created without any wallet. The backend stores a SHA-256 hash of the random control token, the pass ID, status and lifecycle timestamps; a bound pass is linked to its checkout. Expiry ends validity but does not delete the record. Linked passes are protected from the current pruning tool; retention period not yet defined.',
  },
  {
    title: 'Limits are up to the shop',
    body: 'IFR does not enforce per-customer checkout redemption limits; nonzero daily or monthly rule limits are refused. Conditional Model B reward deduplication limits rewards for a partner and month, not checkout use. A shop that wants checkout limits must enforce them in its own systems.',
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
    body: 'Your browser-injected Ethereum wallet provider and the public RPC endpoints used for chain reads see your IP address and the requests made through them, under their own policies. To check eligibility, the backend asks its Ethereum RPC provider for your on-chain lock and balance, so that provider sees your wallet address in that request.',
  },
  {
    title: 'Network logs and rate limits',
    body: 'Hosting and proxy infrastructure may log IP addresses and request paths. Public rate limits use IP or IPv6-prefix counters and pass-ID/authorization-digest counters. Authenticated seller limits also use the full normalized seller wallet in memory or Redis. Redis seller counters expire after a one-hour window; memory entries may remain until reuse, capacity cleanup or process exit. Customer proofs send wallet addresses and signatures in JSON bodies; seller authorization also supports x-ifr-* headers, including x-ifr-signature. These are not URL fields in the current client flows. Retention period not yet defined for infrastructure logs, Redis persistence and backups.',
  },
  {
    title: 'Coinbase Wallet and WalletConnect',
    body: 'Coinbase Wallet is offered as a fallback connector. The full WalletConnect modal is only active when a WalletConnect Project ID is configured; when it is, connecting through it involves WalletConnect infrastructure.',
  },
  {
    title: 'External swap links',
    body: 'Uniswap is only contacted when you explicitly click a swap link.',
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
      <section className=" mx-auto w-full max-w-7xl px-5 pb-16 pt-6">
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
              The copies below live in this browser. You can inspect and clear the app&apos;s own keys and caches here. Clearing them does not affect backend records or on-chain data, does not touch wallet-provider storage or any other site&apos;s data, and does not disconnect your wallet.
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
            intro="What the Benefits backend keeps, and what it deliberately does not keep:"
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
            <p className="text-xs font-black uppercase tracking-[0.18em] text-green-100/80">Seller history</p>
            <h2 className="mt-2 text-3xl font-black text-white">Sellers see checkout outcomes, not your wallet.</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-stone-300">
              Seller session history shows the status of each checkout, whether a customer proof was verified, the qualifying lock source and whether the proof came from a seller-controlled wallet. It contains no raw customer wallet address. Backend merchant checkout records and conditional scoped reward HMACs still retain linkable information. This is not anonymity: a seller who sees you at the counter, the time of a checkout or public on-chain data can still connect information, and anything you sign on-chain is public.
            </p>
          </section>

          <section className="rounded-[2rem] border border-white/10 bg-[#160f0b] p-6">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">Open items</p>
            <h2 className="mt-2 text-3xl font-black text-white">What is not decided yet</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-stone-300">
              The backend has a manual operator tool for counting and removing old admin audit rows and expired, unlinked authorization artifacts after an approved cutoff. It does not automatically delete checkout sessions, session audit records, reward records or passes linked to sessions. Seller/profile/operator and reward-link records also have no complete erasure path. Admin audit rows include an IP-derived digest, which is not anonymous. The customer-privacy migration of 11 October 2026 removed legacy raw customer fields and server receipt-history tables; it does not exclude the later conditional Model B reward pseudonym. Older databases, journals, backups and exports may retain legacy customer data. Their deletion has not been established by the current source; retention period not yet defined. The long-term server-side retention, deletion and support policy is not finalized. This page therefore makes no promise that backend records can be deleted on request, and it does not claim compliance with GDPR or any other specific legal framework. There is no dedicated privacy support channel at this time. When a final policy exists, this page will be updated to match it.
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
