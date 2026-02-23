'use client';

import { useState, useEffect, useCallback } from 'react';
import QRCode from 'react-qr-code';
import { Countdown } from '@/components/Countdown';
import { StatusBadge } from '@/components/StatusBadge';
import {
  getBusiness,
  createSession,
  getSessionStatus,
  redeemSession,
  type BusinessInfo,
  type SessionStatus,
} from '@/lib/api';

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function MerchantPage({
  params,
}: {
  params: { businessId: string };
}) {
  const { businessId } = params;

  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [redeemed, setRedeemed] = useState(false);

  // Load business info
  useEffect(() => {
    getBusiness(businessId)
      .then(setBusiness)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [businessId]);

  // Poll session status
  useEffect(() => {
    if (!sessionId) return;
    const interval = setInterval(async () => {
      try {
        const status = await getSessionStatus(sessionId);
        setSession(status);
        if (
          status.status === 'REDEEMED' ||
          status.status === 'EXPIRED' ||
          status.status === 'REJECTED'
        ) {
          clearInterval(interval);
        }
      } catch {
        // ignore polling errors
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [sessionId]);

  const handleStart = useCallback(async () => {
    setError(null);
    setSession(null);
    setRedeemed(false);
    try {
      const result = await createSession(businessId);
      setSessionId(result.sessionId);
      setSession({
        status: 'PENDING',
        recoveredAddress: null,
        reason: null,
        redeemedAt: null,
        expiresAt: result.expiresAt,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    }
  }, [businessId]);

  const handleRedeem = useCallback(async () => {
    if (!sessionId) return;
    try {
      await redeemSession(sessionId);
      setRedeemed(true);
      setSession((s) => (s ? { ...s, status: 'REDEEMED' } : s));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Redeem failed');
    }
  }, [sessionId]);

  const handleExpired = useCallback(() => {
    setSession((s) => (s ? { ...s, status: 'EXPIRED' } : s));
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-ifr-red border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error && !business) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-6 text-center max-w-sm">
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!business) return null;

  // ── APPROVED: Full-screen green ──
  if (session?.status === 'APPROVED' && !redeemed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6 bg-ifr-green/5">
        <div className="w-full max-w-sm text-center space-y-6">
          <div className="text-6xl">&#10003;</div>
          <h1 className="text-3xl font-bold text-ifr-green">APPROVED</h1>
          <p className="text-gray-300">
            Wallet:{' '}
            <span className="font-mono text-white">
              {session.recoveredAddress
                ? shortAddr(session.recoveredAddress)
                : '—'}
            </span>
          </p>
          <div className="bg-black/30 rounded-xl p-4">
            <p className="text-sm text-gray-400 mb-1">Valid for</p>
            <Countdown expiresAt={session.expiresAt} onExpired={handleExpired} />
          </div>
          <p className="text-2xl font-bold">
            {business.discountPercent}% Discount
            {business.tierLabel && (
              <span className="ml-2 text-lg text-gray-400">
                ({business.tierLabel})
              </span>
            )}
          </p>
          <button
            onClick={handleRedeem}
            className="w-full py-4 bg-ifr-green text-white text-lg font-bold rounded-xl hover:bg-ifr-green/90 transition"
          >
            Redeem
          </button>
        </div>
      </div>
    );
  }

  // ── REDEEMED ──
  if (session?.status === 'REDEEMED' || redeemed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm text-center space-y-6">
          <div className="text-6xl">&#10003;</div>
          <h1 className="text-2xl font-bold text-ifr-green">Redeemed</h1>
          <p className="text-gray-400">Discount has been applied.</p>
          <button
            onClick={handleStart}
            className="w-full py-3 bg-white/10 text-white rounded-xl hover:bg-white/15 transition"
          >
            New Verification
          </button>
        </div>
      </div>
    );
  }

  // ── REJECTED ──
  if (session?.status === 'REJECTED') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm text-center space-y-6">
          <div className="bg-ifr-red/10 border border-ifr-red/30 rounded-xl p-6">
            <h2 className="text-xl font-bold text-ifr-red mb-2">Not Eligible</h2>
            <p className="text-gray-400 text-sm">{session.reason || 'Lock requirement not met.'}</p>
          </div>
          <button
            onClick={handleStart}
            className="w-full py-3 bg-white/10 text-white rounded-xl hover:bg-white/15 transition"
          >
            New Verification
          </button>
        </div>
      </div>
    );
  }

  // ── EXPIRED ──
  if (session?.status === 'EXPIRED') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm text-center space-y-6">
          <div className="bg-gray-500/10 border border-gray-500/30 rounded-xl p-6">
            <h2 className="text-xl font-bold text-gray-400">Expired</h2>
            <p className="text-gray-500 text-sm mt-2">Session timed out.</p>
          </div>
          <button
            onClick={handleStart}
            className="w-full py-3 bg-white/10 text-white rounded-xl hover:bg-white/15 transition"
          >
            New Verification
          </button>
        </div>
      </div>
    );
  }

  // ── DEFAULT: Business Info + Start / QR + Polling ──
  const customerUrl =
    typeof window !== 'undefined' && sessionId
      ? `${window.location.origin}/r/${sessionId}`
      : '';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="text-center">
          <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">
            IFR Benefits Network
          </p>
          <h1 className="text-2xl font-bold">{business.name}</h1>
          <p className="text-ifr-red text-xl font-semibold mt-1">
            {business.discountPercent}% Discount
          </p>
          {business.tierLabel && (
            <p className="text-gray-400 text-sm">{business.tierLabel} Tier</p>
          )}
          <p className="text-gray-500 text-xs mt-2">
            Requires {business.requiredLockIFR.toLocaleString()} IFR locked
          </p>
        </div>

        {/* No active session: show start button */}
        {!sessionId && (
          <button
            onClick={handleStart}
            className="w-full py-4 bg-ifr-red text-white text-lg font-bold rounded-xl hover:bg-ifr-red/90 transition"
          >
            Start Verification
          </button>
        )}

        {/* Active session: QR + status */}
        {sessionId && session?.status === 'PENDING' && (
          <>
            <div className="bg-white p-4 rounded-xl mx-auto w-fit">
              <QRCode value={customerUrl} size={256} />
            </div>
            <p className="text-center text-gray-400 text-sm">
              Customer scans this QR code to verify
            </p>
            <div className="flex items-center justify-center gap-3">
              <div className="animate-spin h-4 w-4 border-2 border-ifr-orange border-t-transparent rounded-full" />
              <span className="text-gray-400">Waiting for customer...</span>
              <Countdown expiresAt={session.expiresAt} onExpired={handleExpired} />
            </div>
          </>
        )}

        {error && (
          <p className="text-ifr-red text-sm text-center">{error}</p>
        )}
      </div>
    </div>
  );
}
