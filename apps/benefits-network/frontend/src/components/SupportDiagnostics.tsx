'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CHAIN_ID,
  COMMITMENT_VAULT_ADDRESS,
  IFRLOCK_ADDRESS,
  IFR_TOKEN_ADDRESS,
} from '@/lib/contracts';
import { hasValidWalletConnectProjectId } from '@/lib/walletConnectProjectId.mjs';

const hasWalletConnectProjectId = hasValidWalletConnectProjectId(
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
);

type ApiCheck = {
  status: 'checking' | 'available' | 'unavailable';
  expectedChain: boolean | null;
};

type DiagnosticReport = {
  schema: 'ifr-benefits-support-v1';
  generatedAt: string;
  app: 'IFR Benefits Network';
  route: '/support';
  expectedChainId: number;
  checks: {
    online: boolean;
    apiAvailable: boolean;
    apiExpectedChain: boolean | null;
    serviceWorkerSupported: boolean;
    serviceWorkerControllingPage: boolean;
    standaloneDisplay: boolean;
    injectedWalletAvailable: boolean;
    coinbaseConnectorConfigured: true;
    walletConnectConfigured: boolean;
    ifrTokenConfigured: boolean;
    ifrLockConfigured: boolean;
    commitmentVaultConfigured: boolean;
  };
};

declare global {
  interface Window {
    ethereum?: unknown;
  }
}

function hasContractAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function copyTextFallback(text: string): boolean {
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  return copied;
}

export function SupportDiagnostics() {
  const [online, setOnline] = useState(true);
  const [api, setApi] = useState<ApiCheck>({ status: 'checking', expectedChain: null });
  const [checkedAt, setCheckedAt] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [clientReady, setClientReady] = useState(false);

  const runChecks = useCallback(async () => {
    setApi({ status: 'checking', expectedChain: null });
    setCopyStatus('');

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);

    try {
      const response = await fetch('/api/ready', {
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      const payload = await response.json() as {
        status?: unknown;
        chainId?: unknown;
        database?: unknown;
        rateLimitStore?: unknown;
      };
      const available = response.ok
        && payload.status === 'ready'
        && payload.database === 'ok'
        && payload.rateLimitStore === 'ok';
      setApi({
        status: available ? 'available' : 'unavailable',
        expectedChain: typeof payload.chainId === 'number' ? payload.chainId === CHAIN_ID : null,
      });
    } catch {
      setApi({ status: 'unavailable', expectedChain: null });
    } finally {
      window.clearTimeout(timeout);
      setCheckedAt(new Date().toISOString());
    }
  }, []);

  useEffect(() => {
    const updateNetwork = () => setOnline(navigator.onLine);
    updateNetwork();
    setClientReady(true);
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    void runChecks();
    return () => {
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
    };
  }, [runChecks]);

  const capabilities = useMemo(() => {
    if (!clientReady) {
      return {
        serviceWorkerSupported: false,
        serviceWorkerControllingPage: false,
        standaloneDisplay: false,
        injectedWalletAvailable: false,
      };
    }
    return {
      serviceWorkerSupported: 'serviceWorker' in navigator,
      serviceWorkerControllingPage: Boolean(navigator.serviceWorker?.controller),
      standaloneDisplay: window.matchMedia('(display-mode: standalone)').matches,
      injectedWalletAvailable: Boolean(window.ethereum),
    };
  }, [clientReady]);

  const report = useMemo<DiagnosticReport>(() => ({
    schema: 'ifr-benefits-support-v1',
    generatedAt: checkedAt,
    app: 'IFR Benefits Network',
    route: '/support',
    expectedChainId: CHAIN_ID,
    checks: {
      online,
      apiAvailable: api.status === 'available',
      apiExpectedChain: api.expectedChain,
      ...capabilities,
      coinbaseConnectorConfigured: true,
      walletConnectConfigured: hasWalletConnectProjectId,
      ifrTokenConfigured: CHAIN_ID === 1 && hasContractAddress(IFR_TOKEN_ADDRESS),
      ifrLockConfigured: CHAIN_ID === 1 && hasContractAddress(IFRLOCK_ADDRESS),
      commitmentVaultConfigured: CHAIN_ID === 1 && hasContractAddress(COMMITMENT_VAULT_ADDRESS),
    },
  }), [api, capabilities, checkedAt, online]);

  const reportText = JSON.stringify(report, null, 2);

  async function copyReport() {
    try {
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(reportText);
          copied = true;
        } catch {
          copied = false;
        }
      }
      if (!copied) copied = copyTextFallback(reportText);
      setCopyStatus(copied ? 'Redacted report copied.' : 'Copy was blocked by this browser.');
    } catch {
      setCopyStatus('Copy was blocked by this browser.');
    }
  }

  const checks = [
    {
      label: 'Internet connection',
      value: online ? 'Online' : 'Offline',
      ok: online,
    },
    {
      label: 'Benefits API',
      value: api.status === 'checking' ? 'Checking' : api.status === 'available' ? 'Available' : 'Unavailable',
      ok: api.status === 'available',
    },
    {
      label: 'API network',
      value: api.expectedChain === null
        ? 'Not reported'
        : api.expectedChain
          ? CHAIN_ID === 1 ? 'Ethereum Mainnet' : `Expected chain ${CHAIN_ID}`
          : 'Wrong network',
      ok: api.expectedChain === true,
    },
    {
      label: 'Wallet options',
      value: capabilities.injectedWalletAvailable
        ? 'Browser wallet found'
        : hasWalletConnectProjectId
          ? 'WalletConnect available'
          : 'Coinbase fallback available',
      ok: true,
    },
    {
      label: 'Installable app support',
      value: capabilities.serviceWorkerSupported ? 'Supported' : 'Browser limited',
      ok: capabilities.serviceWorkerSupported,
    },
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-[1.02fr_0.98fr]">
      <section
        className="min-w-0 rounded-[2rem] border border-white/10 bg-white/[0.055] p-6 shadow-2xl shadow-black/25"
        aria-labelledby="support-checks-title"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">Live checks</p>
            <h2 id="support-checks-title" className="mt-2 text-3xl font-black text-white">Check this device</h2>
          </div>
          <button
            type="button"
            onClick={() => void runChecks()}
            disabled={api.status === 'checking'}
            className="rounded-full border border-orange-300/35 px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-orange-100 transition hover:border-orange-300 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {api.status === 'checking' ? 'Checking' : 'Run checks'}
          </button>
        </div>

        <div className="mt-5 grid gap-3" aria-live="polite">
          {checks.map((check) => (
            <div
              key={check.label}
              className={`flex min-h-14 flex-col items-start justify-between gap-1 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:gap-4 ${
                check.ok
                  ? 'border-green-300/25 bg-green-300/[0.08]'
                  : 'border-orange-300/25 bg-orange-300/[0.08]'
              }`}
            >
              <span className="text-sm font-semibold text-stone-200">{check.label}</span>
              <span className="text-left text-sm font-black text-white sm:text-right">{check.value}</span>
            </div>
          ))}
        </div>

        <p className="mt-4 text-sm leading-6 text-stone-300">
          This page cannot inspect which network your connected wallet has selected. Verify
          <strong className="text-white">
            {CHAIN_ID === 1 ? ' Ethereum Mainnet' : ` chain ${CHAIN_ID}`}
          </strong> inside your wallet before approving or signing.
        </p>
        {checkedAt ? (
          <p className="mt-3 text-xs text-stone-400">
            Last check: <time dateTime={checkedAt}>{new Date(checkedAt).toLocaleString()}</time>
          </p>
        ) : null}
      </section>

      <section
        className="min-w-0 rounded-[2rem] border border-green-300/20 bg-green-300/[0.07] p-6 shadow-2xl shadow-black/20"
        aria-labelledby="diagnostic-report-title"
      >
        <p className="text-xs font-black uppercase tracking-[0.18em] text-green-100/80">Safe to share</p>
        <h2 id="diagnostic-report-title" className="mt-2 text-3xl font-black text-white">Redacted diagnostic report</h2>
        <p className="mt-3 text-sm leading-7 text-stone-300">
          The report contains only capability booleans, public app configuration and the check time.
          It excludes wallet addresses, signatures, transactions, browser identity, the current URL,
          query parameters and browser-storage values.
        </p>
        <pre
          data-testid="support-report"
          tabIndex={0}
          aria-label="Redacted diagnostic report contents"
          className="mt-5 w-full max-w-full overflow-auto rounded-2xl border border-white/10 bg-black/20 p-4 text-xs leading-6 text-stone-200 sm:max-h-80"
        >
          {reportText}
        </pre>
        <button
          type="button"
          onClick={() => void copyReport()}
          disabled={!checkedAt}
          className="mt-4 w-full rounded-2xl bg-green-200 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-stone-950 transition hover:-translate-y-0.5 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {checkedAt ? 'Copy redacted report' : 'Preparing report'}
        </button>
        <p className="mt-3 min-h-6 text-sm text-stone-300" role="status" aria-live="polite">
          {copyStatus}
        </p>
      </section>
    </div>
  );
}
