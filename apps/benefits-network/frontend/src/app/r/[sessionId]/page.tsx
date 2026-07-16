'use client';

import { useEffect, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect, useSignMessage } from 'wagmi';
import { AppShell } from '@/components/AppShell';
import { Countdown } from '@/components/Countdown';
import { StatusBadge } from '@/components/StatusBadge';
import { AttestResult, BusinessInfo, SessionStatus, getBusiness, getChallenge, getSessionStatus, submitAttest } from '@/lib/api';

export default function CustomerSession({ params }: { params: { sessionId: string } }) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  const [result, setResult] = useState<AttestResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadSession() {
      try {
        const nextStatus = await getSessionStatus(params.sessionId);
        setStatus(nextStatus);
        setBusiness(await getBusiness(nextStatus.businessId));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load session');
      }
    }
    loadSession();
  }, [params.sessionId]);

  async function signAndVerify() {
    setLoading(true);
    setError('');
    try {
      const challenge = await getChallenge(params.sessionId);
      const signature = await signMessageAsync({ message: challenge.message });
      const nextResult = await submitAttest(params.sessionId, signature);
      setResult(nextResult);
      setStatus(await getSessionStatus(params.sessionId));
    } catch (err) {
      if (err instanceof Error && err.message.toLowerCase().includes('rejected')) {
        setError('Signature rejected. Please try again.');
      } else {
        setError(err instanceof Error ? err.message : 'Verification failed');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <section className="mx-auto grid min-h-[calc(100vh-6rem)] w-full max-w-3xl place-items-center px-5 pb-16 pt-8">
        <div className="w-full rounded-[2rem] border border-white/10 bg-white/[0.06] p-6 shadow-2xl shadow-black/30">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-200/80">
                Customer proof
              </p>
              <h1 className="mt-2 text-4xl font-black text-white">Sign to verify IFR access</h1>
            </div>
            {status ? <StatusBadge status={status.status} /> : null}
          </div>

          <p className="mt-5 text-sm leading-6 text-stone-300">
            Connect your wallet and sign the one-time challenge. The app verifies your IFRLock status on-chain.
            No tokens move during verification.
          </p>

          {business ? (
            <div className="mt-5 grid gap-3 rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-stone-300">
              <div className="flex justify-between gap-4">
                <span>Seller</span>
                <strong className="text-white">{business.name}</strong>
              </div>
              <div className="flex justify-between gap-4">
                <span>Benefit</span>
                <strong className="text-white">{status?.benefit.discountPercent ?? business.discountPercent}%</strong>
              </div>
              <div className="flex justify-between gap-4">
                <span>Required lock</span>
                <strong className="text-white">{(status?.benefit.requiredLockIFR ?? business.requiredLockIFR).toLocaleString('en-US')} IFR</strong>
              </div>
              {status?.benefit.productName ? (
                <>
                  <div className="flex justify-between gap-4">
                    <span>Rule</span>
                    <strong className="text-right text-white">{status.benefit.label || 'IFR Benefit'}</strong>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span>Product</span>
                    <strong className="text-right text-white">{status.benefit.productName}</strong>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {status && ['APPROVED', 'REDEEMED', 'REJECTED', 'EXPIRED'].includes(status.status) && !result ? (
            <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4 text-sm leading-6 text-stone-200">
              <p className="font-bold text-white">Session {status.status.toLowerCase()}</p>
              <p className="text-stone-300">Ask the seller for a fresh QR code if you still need verification.</p>
              {status.reason ? <p className="text-red-200">{status.reason}</p> : null}
            </div>
          ) : null}

          <div className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-4">
            <ConnectButton />
          </div>

          <button
            type="button"
            onClick={signAndVerify}
            disabled={!isConnected || loading || Boolean(status && ['APPROVED', 'REDEEMED', 'REJECTED', 'EXPIRED'].includes(status.status))}
            className="mt-6 w-full rounded-2xl bg-orange-300 px-5 py-4 text-sm font-black uppercase tracking-[0.16em] text-stone-950 shadow-xl shadow-orange-950/40 transition hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Verifying...' : 'Sign and verify'}
          </button>

          {result ? (
            <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4 text-sm leading-6 text-stone-200">
              <p className="font-bold text-white">{result.status}</p>
              {result.wallet ? <p className="break-all text-stone-300">Wallet: {result.wallet}</p> : null}
              {result.reason ? <p className="text-red-200">{result.reason}</p> : null}
              {status?.expiresAt ? (
                <p className="mt-3 text-stone-300">Valid for <Countdown expiresAt={status.expiresAt} /></p>
              ) : null}
            </div>
          ) : null}

          {address ? (
            <button
              type="button"
              onClick={() => disconnect()}
              className="mt-4 text-sm font-semibold text-stone-400 underline decoration-stone-600 underline-offset-4 hover:text-stone-200"
            >
              Disconnect {address.slice(0, 6)}...{address.slice(-4)}
            </button>
          ) : null}

          {error ? <p className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
        </div>
      </section>
    </AppShell>
  );
}
