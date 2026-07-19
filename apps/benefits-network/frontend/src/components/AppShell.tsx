import Link from 'next/link';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="shop-shell min-h-screen text-stone-50">
      <header className="shop-header">
        <div className="shop-header-inner">
          <Link href="/" className="shop-brand" aria-label="IFR Benefits Network home">
            <img src="/icons/ifr-official-v10.svg" alt="Official Inferno Protocol IFR icon" width="40" height="40" />
            <span className="shop-brand-copy">
              <strong>IFR BENEFITS</strong>
              <small>Inferno Protocol · $IFRp</small>
            </span>
          </Link>
          <nav className="shop-nav" aria-label="Benefits Network navigation">
          <Link href="/" className="shop-nav-link">
            Benefits
          </Link>
          <a href="/#seller-workspace" className="shop-nav-link">
            For sellers
          </a>
          <Link href="/guide" className="shop-nav-link">
            Guide
          </Link>
          <a href="/#customer-wallet" className="shop-nav-link">
            Lock IFR
          </a>
          <a
            href="https://ifrunit.tech/"
            className="shop-nav-project"
          >
            IFR Unit
          </a>
        </nav>
        </div>
      </header>
      {children}
      <footer className="shop-footer">
        <div className="shop-footer-inner">
          <div>
            <strong>Inferno Protocol</strong>
            <p>IFR Benefits Network · on-chain symbol IFR · social cashtag $IFRp</p>
          </div>
          <nav aria-label="Protocol links">
            <a href="https://ifrunit.tech/">IFR Unit</a>
            <a href="https://web3.ifrunit.tech/">Web3</a>
            <a href="https://ifrunit.tech/wiki/">Wiki</a>
            <a href="https://ifrunit.tech/#contracts">Contracts</a>
          </nav>
          <p>© 2026 IFR Protocol · Inferno Protocol</p>
        </div>
      </footer>
    </main>
  );
}
