import type { Metadata } from 'next';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { SupportDiagnostics } from '@/components/SupportDiagnostics';

export const metadata: Metadata = {
  title: 'Support & Diagnostics | IFR Benefits',
  description: 'Private self-service checks and safe recovery steps for the IFR Benefits customer and seller app.',
  alternates: { canonical: 'https://shop.ifrunit.tech/support' },
};

const recoverySteps = [
  {
    title: 'Page or API unavailable',
    body: 'Check your connection, run the checks again and retry the page. Do not repeat an approve, lock or redeem action unless your wallet or the app clearly shows the previous action failed.',
  },
  {
    title: 'Wallet does not open',
    body: 'Open shop.ifrunit.tech inside your trusted wallet browser or use its installed browser extension. Keep the wallet unlocked and verify that Ethereum Mainnet is selected.',
  },
  {
    title: 'Installed app looks outdated',
    body: 'Reload while online. If the installed app still shows old content, close it completely and reopen it. Clearing IFR Benefits cache is available on the Privacy & data page.',
  },
  {
    title: 'QR cannot be scanned',
    body: 'Allow camera access for shop.ifrunit.tech, improve lighting, or use the manual seller/pass link field. Never scan a link whose hostname is not shop.ifrunit.tech.',
  },
];

export default function SupportPage() {
  return (
    <AppShell>
      <section className="mx-auto w-full max-w-7xl px-5 pb-16 pt-6">
        <div className="rounded-[2.25rem] border border-orange-200/15 bg-[linear-gradient(135deg,rgba(248,164,92,0.16),rgba(255,255,255,0.055)_44%,rgba(49,151,103,0.12))] p-6 shadow-2xl shadow-black/30 md:p-10">
          <div className="max-w-4xl">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-orange-100">IFR Benefits support</p>
            <h1 className="mt-4 text-5xl font-black leading-[0.95] text-white md:text-7xl">
              Find the problem without exposing your wallet.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-stone-300">
              Run private device and service checks, copy a redacted report and follow safe recovery steps.
              Nothing here connects a wallet, requests an account, asks for a signature or starts a transaction.
            </p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#diagnostics"
              className="rounded-full bg-orange-300 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-stone-950 shadow-xl shadow-orange-950/40 transition hover:-translate-y-0.5 hover:bg-orange-200"
            >
              Run diagnostics
            </a>
            <Link
              href="/guide"
              className="rounded-full border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-stone-100 transition hover:border-orange-200/60"
            >
              Open guide
            </Link>
            <Link
              href="/privacy"
              className="rounded-full border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-stone-100 transition hover:border-orange-200/60"
            >
              Privacy &amp; data
            </Link>
          </div>
        </div>

        <div id="diagnostics" className="mt-6 scroll-mt-24">
          <SupportDiagnostics />
        </div>

        <section className="mt-6 rounded-[2rem] border border-white/10 bg-white/[0.055] p-6 shadow-2xl shadow-black/25">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">Recovery</p>
          <h2 className="mt-2 text-3xl font-black text-white">Safe steps for common problems</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {recoverySteps.map((step) => (
              <article key={step.title} className="rounded-3xl border border-white/10 bg-black/20 p-5">
                <h3 className="text-xl font-black text-white">{step.title}</h3>
                <p className="mt-2 text-sm leading-7 text-stone-300">{step.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-[2rem] border border-orange-300/20 bg-[#160f0b] p-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">Security boundary</p>
          <h2 className="mt-2 text-3xl font-black text-white">There is no wallet recovery form here.</h2>
          <p className="mt-4 max-w-4xl text-sm leading-7 text-stone-300">
            IFR Benefits never needs your seed phrase or private key. This self-service page does not send
            the report anywhere and does not promise a dedicated support response or service level. Keep any
            report redacted and share it only through a support channel that IFR Protocol publishes in the future.
          </p>
          <nav className="mt-5 flex flex-wrap gap-3" aria-label="Support recovery links">
            <Link href="/" className="rounded-full border border-white/15 px-4 py-2 text-sm font-black text-stone-100">
              Benefits home
            </Link>
            <Link href="/scan" className="rounded-full border border-white/15 px-4 py-2 text-sm font-black text-stone-100">
              QR scanner
            </Link>
            <Link href="/privacy" className="rounded-full border border-white/15 px-4 py-2 text-sm font-black text-stone-100">
              Local data controls
            </Link>
            <a href="https://ifrunit.tech/#contracts" className="rounded-full border border-white/15 px-4 py-2 text-sm font-black text-stone-100">
              Verified contracts
            </a>
          </nav>
        </section>
      </section>
    </AppShell>
  );
}
