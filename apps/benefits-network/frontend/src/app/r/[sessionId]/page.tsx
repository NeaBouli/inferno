'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useConnect, useSignMessage, useDisconnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { Countdown } from '@/components/Countdown';
import {
  getSessionStatus,
  getChallenge,
  submitAttest,
  getBusiness,
  type SessionStatus,
  type BusinessInfo,
} from '@/lib/api';

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

type Step = 'connect' | 'sign' | 'result';

export default function CustomerPage({
  params,
}: {
  params: { sessionId: string };
}) {
  const { sessionId } = params;

  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();

  const [step, setStep] = useState<Step>('connect');
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attestResult, setAttestResult] = useState<{
    status: string;
    reason?: string;
  } | null>(null);

  // Load session + business info
  useEffect(() => {
    async function load() {
      try {
        const s = await getSessionStatus(sessionId);
        setSession(s);
        // We need businessId from session — fetch via challenge message parsing
        // Actually, we get it from the session's business info
        // The API doesn't expose businessId directly, so we parse the challenge
        const challenge = await getChallenge(sessionId);
        const businessLine = challenge.message
          .split('\n')
          .find((l) => l.startsWith('Business: '));
        if (businessLine) {
          const bizId = businessLine.replace('Business: ', '');
          const biz = await getBusiness(bizId);
          setBusiness(biz);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load session');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [sessionId]);

  // Auto-advance to sign step when wallet connects
  useEffect(() => {
    if (isConnected && step === 'connect') {
      setStep('sign');
    }
  }, [isConnected, step]);

  const handleConnect = useCallback(() => {
    connect({ connector: injected() });
  }, [connect]);

  const handleSign = useCallback(async () => {
    setError(null);
    setSigning(true);
    try {
      const challenge = await getChallenge(sessionId);
      const signature = await signMessageAsync({ message: challenge.message });
      const result = await submitAttest(sessionId, signature);
      setAttestResult(result);
      setStep('result');
    } catch (err) {
      if (err instanceof Error && err.message.includes('User rejected')) {
        setError('Signature rejected. Please try again.');
      } else {
        setError(err instanceof Error ? err.message : 'Verification failed');
      }
    } finally {
      setSigning(false);
    }
  }, [sessionId, signMessageAsync]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-ifr-red border-t-transparent rounded-full" />
      </div>
    );
  }

  // Session already used
  if (
    session &&
    ['EXPIRED', 'REDEEMED', 'REJECTED', 'APPROVED'].includes(session.status) &&
    !attestResult
  ) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="bg-gray-500/10 border border-gray-500/30 rounded-xl p-6">
            <h2 className="text-lg font-bold text-gray-400">
              Session {session.status.toLowerCase()}
            </h2>
            <p className="text-gray-500 text-sm mt-2">
              Please ask the merchant for a new QR code.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── RESULT STEP ──
  if (step === 'result' && attestResult) {
    if (attestResult.status === 'APPROVED') {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center p-6 bg-ifr-green/5">
          <div className="w-full max-w-sm text-center space-y-6">
            <div className="text-6xl">&#10003;</div>
            <h1 className="text-3xl font-bold text-ifr-green">Verified!</h1>
            <p className="text-gray-300">Show this screen to the merchant.</p>
            {business && (
              <p className="text-2xl font-bold">
                {business.discountPercent}% Discount
              </p>
            )}
            {session && (
              <div className="bg-black/30 rounded-xl p-4">
                <p className="text-sm text-gray-400 mb-1">Valid for</p>
                <Countdown expiresAt={session.expiresAt} />
              </div>
            )}
            <p className="text-gray-500 text-xs">
              Wallet: {address ? shortAddr(address) : '—'}
            </p>
          </div>
        </div>
      );
    }

    // REJECTED
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm text-center space-y-6">
          <div className="bg-ifr-red/10 border border-ifr-red/30 rounded-xl p-6">
            <h2 className="text-xl font-bold text-ifr-red mb-2">
              Not Eligible
            </h2>
            <p className="text-gray-400 text-sm">
              {attestResult.reason ||
                `Not enough IFR locked.${
                  business
                    ? ` Required: ${business.requiredLockIFR.toLocaleString()} IFR`
                    : ''
                }`}
            </p>
          </div>
          <button
            onClick={() => disconnect()}
            className="text-gray-500 text-sm underline"
          >
            Disconnect wallet
          </button>
        </div>
      </div>
    );
  }

  // ── CONNECT / SIGN STEPS ──
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        {/* Business Info */}
        {business && (
          <div className="text-center">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">
              IFR Benefits Network
            </p>
            <h1 className="text-xl font-bold">{business.name}</h1>
            <p className="text-ifr-red text-lg font-semibold mt-1">
              {business.discountPercent}% Discount
            </p>
            <p className="text-gray-500 text-xs mt-2">
              Requires {business.requiredLockIFR.toLocaleString()} IFR locked
            </p>
          </div>
        )}

        {/* Step 1: Connect Wallet */}
        {step === 'connect' && (
          <button
            onClick={handleConnect}
            className="w-full py-4 bg-ifr-red text-white text-lg font-bold rounded-xl hover:bg-ifr-red/90 transition"
          >
            Connect Wallet
          </button>
        )}

        {/* Step 2: Sign */}
        {step === 'sign' && (
          <div className="space-y-4">
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
              <p className="text-gray-400 text-sm">Connected as</p>
              <p className="font-mono text-white">
                {address ? shortAddr(address) : '—'}
              </p>
            </div>
            <button
              onClick={handleSign}
              disabled={signing}
              className="w-full py-4 bg-ifr-red text-white text-lg font-bold rounded-xl hover:bg-ifr-red/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {signing ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
                  Verifying...
                </span>
              ) : (
                'Sign & Verify'
              )}
            </button>
            <button
              onClick={() => {
                disconnect();
                setStep('connect');
              }}
              className="w-full text-gray-500 text-sm underline"
            >
              Disconnect
            </button>
          </div>
        )}

        {error && <p className="text-ifr-red text-sm text-center">{error}</p>}
      </div>
    </div>
  );
}
