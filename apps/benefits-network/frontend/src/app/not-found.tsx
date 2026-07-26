import Link from 'next/link';
import { AppShell } from '@/components/AppShell';

export default function NotFound() {
  return (
    <AppShell>
      <section
        data-testid="shop-not-found"
        aria-labelledby="not-found-title"
        className="mx-auto grid min-h-[68vh] w-full max-w-7xl place-items-center px-5 py-12"
      >
        <div className="w-full max-w-3xl border-y border-orange-200/25 py-10 md:py-14">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200">
            404 · Link unavailable
          </p>
          <h1 id="not-found-title" className="mt-4 max-w-2xl text-5xl font-black leading-tight text-white md:text-7xl">
            This benefits link is incomplete.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-stone-300 md:text-lg">
            The seller, customer pass or checkout address may have been shortened,
            mistyped or retired. Return to the Benefits app, scan the original QR
            again, or use the guide to restart safely.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/"
              className="rounded-full bg-orange-300 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-orange-950/30 transition hover:-translate-y-0.5 hover:bg-orange-200"
            >
              Open benefits
            </Link>
            <Link
              href="/scan"
              className="rounded-full border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-orange-200/60"
            >
              Scan QR
            </Link>
            <Link
              href="/support"
              className="rounded-full border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-orange-200/60"
            >
              Support
            </Link>
            <Link
              href="/guide"
              className="rounded-full border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-orange-200/60"
            >
              Read guide
            </Link>
          </div>
          <p className="mt-8 text-sm leading-6 text-stone-400">
            IFR Benefits never asks for a seed phrase or private key to recover a link.
          </p>
        </div>
      </section>
    </AppShell>
  );
}
