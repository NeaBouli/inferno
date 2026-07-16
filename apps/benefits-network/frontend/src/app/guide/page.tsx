import { AppShell } from '@/components/AppShell';

const customerSteps = [
  {
    title: 'Install or open the app',
    body: 'Use shop.ifrunit.tech in the browser, or add it to the home screen on iPhone, iPad or Android when the browser offers PWA install.',
  },
  {
    title: 'Connect an Ethereum wallet',
    body: 'The app reads ETH, IFR and IFRLock status. Verification never transfers tokens; it only asks for a one-time signature.',
  },
  {
    title: 'Lock IFR on Web3 when needed',
    body: 'If a seller rule requires more locked IFR than the wallet has, use the Web3 app to lock IFR first, then return to the seller QR.',
  },
  {
    title: 'Scan, sign, receive the benefit',
    body: 'Scan the seller QR, review seller, product, discount and required IFR, then sign. The seller screen shows APPROVED or the reason for rejection.',
  },
];

const sellerSteps = [
  {
    title: 'Create a seller profile',
    body: 'Connect the seller wallet, create a profile, and keep the Business ID. The profile is owned by that wallet and active profiles are rate-limited.',
  },
  {
    title: 'Create benefit rules',
    body: 'Define category, product or service, discount, minimum locked IFR and QR lifetime. Active rules appear in the scanner.',
  },
  {
    title: 'Put the scanner at checkout',
    body: 'Open /b/:businessId on the counter device. Use the Checkout kit or copied link for staff. Each checkout creates a fresh QR session.',
  },
  {
    title: 'Redeem only after APPROVED',
    body: 'The customer signs the QR challenge, the backend checks IFRLock on-chain, and the seller wallet signs the one-time redeem action.',
  },
];

const developerItems = [
  ['Seller profile', 'POST /api/seller/businesses with a server-issued seller signature.'],
  ['Rules', 'GET/POST /api/seller/businesses/:id/rules and PATCH/DELETE /api/seller/rules/:id.'],
  ['QR session', 'POST /api/sessions with businessId and optional benefitRuleId.'],
  ['Customer proof', 'GET /api/sessions/:id/challenge, then POST /api/attest with the customer signature.'],
  ['Redeem', 'POST /api/sessions/:id/redeem with a fresh seller signature for Action: sessions:redeem.'],
];

function StepList({ title, eyebrow, steps }: { title: string; eyebrow: string; steps: typeof customerSteps }) {
  return (
    <section className="rounded-[2rem] border border-white/10 bg-white/[0.055] p-6 shadow-2xl shadow-black/25">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-black text-white">{title}</h2>
      <div className="mt-6 grid gap-3">
        {steps.map((step, index) => (
          <article key={step.title} className="rounded-3xl border border-white/10 bg-black/20 p-4">
            <div className="flex gap-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-orange-200/30 bg-orange-200/10 font-mono text-sm text-orange-100">
                {index + 1}
              </span>
              <div>
                <h3 className="text-lg font-black text-white">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-stone-300">{step.body}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function GuidePage() {
  return (
    <AppShell>
      <section className="mx-auto w-full max-w-7xl px-5 pb-16 pt-6">
        <div className="rounded-[2.25rem] border border-orange-200/15 bg-[linear-gradient(135deg,rgba(248,164,92,0.16),rgba(255,255,255,0.055)_44%,rgba(49,151,103,0.12))] p-6 shadow-2xl shadow-black/30 md:p-10">
          <div className="max-w-4xl">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-100">IFRp Benefits Network guide</p>
            <h1 className="mt-4 text-5xl font-black leading-[0.95] text-white md:text-7xl">
              Customer proof and seller checkout, without ceremony.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-stone-300">
              This is the operating guide for the current shop app: customer QR proof, wallet-owned seller profiles, rule-based discounts and seller-signed redemption.
            </p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="/"
              className="rounded-full bg-orange-300 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-stone-950 shadow-xl shadow-orange-950/40 transition hover:-translate-y-0.5 hover:bg-orange-200"
            >
              Open app
            </a>
            <a
              href="https://web3.ifrunit.tech"
              className="rounded-full border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-stone-100 transition hover:border-orange-200/60"
            >
              Lock IFR
            </a>
            <a
              href="https://ifrunit.tech"
              className="rounded-full border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-stone-100 transition hover:border-orange-200/60"
            >
              IFR Project
            </a>
          </div>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <StepList eyebrow="Customer path" title="Use a benefit at a seller" steps={customerSteps} />
          <StepList eyebrow="Seller path" title="Offer and redeem benefits" steps={sellerSteps} />
        </div>

        <section className="mt-6 grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[2rem] border border-green-300/20 bg-green-300/[0.07] p-6">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-green-100/80">Wallet support</p>
            <h2 className="mt-2 text-3xl font-black text-white">Use the wallet your browser exposes.</h2>
            <p className="mt-4 text-sm leading-7 text-stone-300">
              Production currently supports browser-injected Ethereum wallets such as MetaMask and Coinbase Wallet. The full WalletConnect modal for Rainbow, Trust, OKX and similar wallets needs a production WalletConnect Project ID before it can be enabled without brittle failures.
            </p>
            <div className="mt-5 grid gap-3 text-sm text-stone-300">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <strong className="text-white">Customer signatures</strong>
                <p className="mt-1">One-time QR challenge; no token transfer during verification.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <strong className="text-white">Seller signatures</strong>
                <p className="mt-1">Short-lived server-issued messages for profile, rules and redeem actions.</p>
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-[#160f0b] p-6">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">Developer hooks</p>
            <h2 className="mt-2 text-3xl font-black text-white">The current API surface</h2>
            <div className="mt-5 grid gap-3">
              {developerItems.map(([label, body]) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-sm font-black text-white">{label}</p>
                  <p className="mt-1 font-mono text-xs leading-6 text-orange-100">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </section>
    </AppShell>
  );
}
