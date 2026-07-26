'use client';

import Link from 'next/link';
import { AppShell } from '@/components/AppShell';

export default function RootError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AppShell>
      <section
        role="alert"
        aria-labelledby="root-error-title"
        className="mx-auto grid min-h-[68vh] w-full max-w-7xl place-items-center px-5 py-12"
      >
        <div className="w-full max-w-3xl border-y border-orange-200/25 py-10 md:py-14">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200">
            Temporary app problem
          </p>
          <h1 id="root-error-title" className="mt-4 max-w-2xl text-5xl font-black leading-tight text-white md:text-7xl">
            Your wallet remains in your control.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-stone-300 md:text-lg">
            This screen did not finish loading. Retry the current view, or return
            to Benefits and reconnect your wallet if needed. Never repeat a
            transaction unless your wallet shows that the previous one failed.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={reset}
              className="rounded-full bg-orange-300 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-orange-950/30 transition hover:-translate-y-0.5 hover:bg-orange-200"
            >
              Try again
            </button>
            <Link
              href="/"
              className="rounded-full border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-orange-200/60"
            >
              Open benefits
            </Link>
            <Link
              href="/guide"
              className="rounded-full border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-orange-200/60"
            >
              Recovery guide
            </Link>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
