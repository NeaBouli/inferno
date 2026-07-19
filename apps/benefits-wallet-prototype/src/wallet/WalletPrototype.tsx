import { useMemo } from 'react';
import {
  CDPReactProvider,
  ExportWalletModal,
  ExportWalletModalTrigger,
  SignIn,
  SignOutButton,
} from '@coinbase/cdp-react';
import { QueryClientProvider } from '@tanstack/react-query';
import { sepolia } from 'viem/chains';
import { useAccount, useChainId, WagmiProvider } from 'wagmi';
import { createPrototypeConfig } from './config';

type WalletPrototypeProps = {
  projectId: string;
};

function shortAddress(address?: string) {
  if (!address) return 'Not created';
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function WalletWorkspace() {
  const { address, isConnected, status } = useAccount();
  const chainId = useChainId();
  const isExpectedChain = chainId === sepolia.id;

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
        <h1>Your test wallet, with an exit path you control.</h1>
        <p className="lede">
          Create an empty test EOA by email, inspect its address and prove the provider-isolated
          export journey. Transactions and IFR actions are not part of this lab.
        </p>
      </section>

      {!isConnected ? (
        <section className="auth-layout" aria-label="Create test wallet">
          <div className="auth-copy">
            <p className="step-label">Step 1 of 2</p>
            <h2>Create an empty Sepolia wallet</h2>
            <p>
              Use a test email address. CDP sends a one-time code and creates an exportable EOA
              after successful sign-in. Do not fund it with Mainnet assets.
            </p>
            <ul className="plain-checks">
              <li>No seed phrase is requested by IFR Protocol</li>
              <li>No transaction method exists in this prototype</li>
              <li>Analytics are disabled in the SDK configuration</li>
            </ul>
          </div>
          <div className="auth-surface">
            <SignIn authMethods={['email']} />
          </div>
        </section>
      ) : (
        <section className="wallet-layout" aria-label="Embedded test wallet status">
          <div className="wallet-summary">
            <div className="summary-heading">
              <div>
                <p className="step-label">Step 2 of 2</p>
                <h2>Test wallet ready</h2>
              </div>
              <span className={isExpectedChain ? 'status-ok' : 'status-blocked'}>
                {isExpectedChain ? 'Network verified' : 'Wrong network'}
              </span>
            </div>

            <dl className="wallet-facts">
              <div><dt>Address</dt><dd>{shortAddress(address)}</dd></div>
              <div><dt>Network</dt><dd>{isExpectedChain ? 'Ethereum Sepolia' : `Unsupported chain ${chainId}`}</dd></div>
              <div><dt>Account type</dt><dd>Exportable EOA</dd></div>
              <div><dt>Connection</dt><dd>{status}</dd></div>
            </dl>

            {!isExpectedChain ? (
              <p className="blocking-notice" role="alert">
                This prototype is fail-closed outside Ethereum Sepolia. Export and all future
                experiments must stop until the configured test network is restored.
              </p>
            ) : null}
          </div>

          <div className="escape-panel">
            <p className="step-label">Owner escape hatch</p>
            <h2>Prove portability before features</h2>
            <p>
              The export screen is supplied by CDP in an isolated frame. IFR Protocol code does
              not receive or store the private key. Complete this only on a private device.
            </p>
            <div className="action-stack">
              {address && isExpectedChain ? (
                <ExportWalletModal address={address} skipMfa={false}>
                  <ExportWalletModalTrigger label="Open protected export" fullWidth />
                </ExportWalletModal>
              ) : null}
              <SignOutButton />
            </div>
            <p className="risk-note">
              Never paste an exported key into IFR Benefits, support chat or any QR flow. Anyone
              with that key controls the wallet.
            </p>
          </div>
        </section>
      )}

      <section className="boundary-band" aria-labelledby="boundary-title">
        <div>
          <p className="step-label">Prototype boundary</p>
          <h2 id="boundary-title">Deliberately unable to move funds</h2>
        </div>
        <div className="boundary-grid">
          <span>Ethereum Sepolia only</span>
          <span>Email + one-time code</span>
          <span>Exportable EOA</span>
          <span>No transfers or approvals</span>
          <span>No IFR contracts</span>
          <span>No seller or reward access</span>
        </div>
      </section>

      <footer className="lab-footer">
        <span>Security lab · no production funds</span>
        <a href="https://shop.ifrunit.tech">Return to IFR Benefits</a>
      </footer>
    </main>
  );
}

export default function WalletPrototype({ projectId }: WalletPrototypeProps) {
  const config = useMemo(() => createPrototypeConfig(projectId), [projectId]);

  return (
    <CDPReactProvider config={config.reactConfig}>
      <WagmiProvider config={config.wagmiConfig}>
        <QueryClientProvider client={config.queryClient}>
          <WalletWorkspace />
        </QueryClientProvider>
      </WagmiProvider>
    </CDPReactProvider>
  );
}
