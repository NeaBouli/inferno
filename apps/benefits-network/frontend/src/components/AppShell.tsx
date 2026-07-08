import Link from 'next/link';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(192,57,43,0.18),transparent_34%),linear-gradient(135deg,#080807,#15110f_48%,#090909)] text-stone-50">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
        <Link href="/" className="flex items-center gap-3 text-sm font-black uppercase tracking-[0.18em]">
          <span className="grid h-9 w-9 place-items-center rounded-full border border-orange-300/40 bg-orange-200/10 text-orange-200">
            IFR
          </span>
          <span>IFRp Commerce</span>
        </Link>
        <a
          href="https://ifrunit.tech"
          className="rounded-full border border-stone-500/30 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-stone-300 transition hover:border-orange-300/60 hover:text-orange-100"
        >
          IFR Unit
        </a>
      </header>
      {children}
    </main>
  );
}
