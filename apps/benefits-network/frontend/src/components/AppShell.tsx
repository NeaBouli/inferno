import Link from 'next/link';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_16%_8%,rgba(230,126,34,0.2),transparent_30rem),radial-gradient(circle_at_82%_18%,rgba(39,174,96,0.12),transparent_26rem),linear-gradient(135deg,#080807,#15110f_48%,#090909)] text-stone-50">
      <header className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-5">
        <Link href="/" className="flex items-center gap-3 text-sm font-black uppercase tracking-[0.18em]">
          <span className="grid h-9 w-9 place-items-center rounded-full border border-orange-300/40 bg-orange-200/10 text-orange-200">
            IFR
          </span>
          <span>IFRp Shop</span>
        </Link>
        <nav className="flex flex-wrap items-center gap-2">
          <Link href="/" className="rounded-full border border-stone-500/30 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-stone-300 transition hover:border-orange-300/60 hover:text-orange-100">
            App
          </Link>
          <Link href="/guide" className="rounded-full border border-stone-500/30 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-stone-300 transition hover:border-orange-300/60 hover:text-orange-100">
            Guide
          </Link>
          <a href="/#integrate" className="rounded-full border border-stone-500/30 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-stone-300 transition hover:border-orange-300/60 hover:text-orange-100">
            Integrate
          </a>
          <a href="/#customer-wallet" className="rounded-full border border-stone-500/30 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-stone-300 transition hover:border-orange-300/60 hover:text-orange-100">
            Lock
          </a>
          <a
            href="https://ifrunit.tech"
            className="rounded-full bg-orange-300 px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-stone-950 transition hover:bg-orange-200"
          >
            IFR Project
          </a>
        </nav>
      </header>
      {children}
    </main>
  );
}
