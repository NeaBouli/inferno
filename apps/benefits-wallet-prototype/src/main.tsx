import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const projectId = import.meta.env.VITE_CDP_PROJECT_ID?.trim();
const WalletPrototype = lazy(() => import('./wallet/WalletPrototype'));

function ConfigurationGate() {
  return (
    <main className="lab-shell">
      <header className="lab-header">
        <a href="https://shop.ifrunit.tech" className="brand" rel="noopener">
          <img
            src="https://shop.ifrunit.tech/icons/ifr-token-256-v11.png"
            alt="Official Inferno Protocol IFR icon"
            width="42"
            height="42"
          />
          <span><strong>IFR WALLET LAB</strong><small>Inferno Protocol · $IFRp</small></span>
        </a>
        <span className="network-badge">Sepolia only</span>
      </header>

      <section className="intro-band">
        <p className="eyebrow">Embedded wallet security prototype</p>
        <h1>Create a test wallet without weakening self-custody.</h1>
        <p className="lede">
          This isolated lab validates sign-in, an exportable EOA and recovery UX before any
          production integration. It cannot send funds or interact with IFR contracts.
        </p>
      </section>

      <section className="preflight" aria-labelledby="preflight-title">
        <div>
          <p className="step-label">Configuration required</p>
          <h2 id="preflight-title">Wallet creation is locked</h2>
          <p>
            Add a dedicated CDP test Project ID to <code>VITE_CDP_PROJECT_ID</code> and allowlist
            <code>http://localhost:3012</code>. Never reuse a production credential or import an
            existing wallet into this prototype.
          </p>
        </div>
        <div className="gate-list" aria-label="Prototype safety gates">
          <span><b>1</b> Dedicated CDP test project</span>
          <span><b>2</b> Local origin allowlisted</span>
          <span><b>3</b> Test identity only</span>
        </div>
      </section>

      <footer className="lab-footer">
        <span>Not connected · No wallet created</span>
        <a href="https://shop.ifrunit.tech">Return to IFR Benefits</a>
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {projectId ? (
      <Suspense fallback={<div className="loading-screen">Preparing secure wallet lab...</div>}>
        <WalletPrototype projectId={projectId} />
      </Suspense>
    ) : (
      <ConfigurationGate />
    )}
  </StrictMode>,
);
