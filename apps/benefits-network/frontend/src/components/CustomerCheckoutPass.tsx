'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import QRCode from 'react-qr-code';
import { Countdown } from '@/components/Countdown';
import {
  CustomerPassControlStatus,
  CustomerPassCreated,
  cancelCustomerPass,
  confirmCustomerPass,
  createCustomerPass,
  getCustomerPassChallenge,
  getCustomerPassConfirmationChallenge,
  getCustomerPassStatus,
} from '@/lib/api';

const TAB_STORAGE_KEY = 'ifr.shop.activeCustomerPass';
const CLOSED_CHECKOUT = new Set(['REDEEMED', 'REJECTED', 'EXPIRED']);

type StoredPass = CustomerPassCreated & { walletAddress: string };

export function CustomerCheckoutPass() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [pass, setPass] = useState<StoredPass | null>(null);
  const [status, setStatus] = useState<CustomerPassControlStatus | null>(null);
  const [origin, setOrigin] = useState('https://shop.ifrunit.tech');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('Connect the IFR wallet you want the seller to verify.');
  const activePassRef = useRef<StoredPass | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    try {
      const raw = window.sessionStorage.getItem(TAB_STORAGE_KEY);
      if (raw) {
        const restored = JSON.parse(raw) as StoredPass;
        activePassRef.current = restored;
        setPass(restored);
      }
    } catch {
      // Session storage is a convenience only; a new pass can still be created.
    }
  }, []);

  const refresh = useCallback(async (activePass: StoredPass, announce = false) => {
    const next = await getCustomerPassStatus(activePass.passId, activePass.controlToken);
    const current = activePassRef.current;
    if (!current || current.passId !== activePass.passId || current.controlToken !== activePass.controlToken) {
      return next;
    }
    setStatus(next);
    if (announce) setMessage(`Pass refreshed: ${next.checkout?.status || next.status}`);
    return next;
  }, []);

  useEffect(() => {
    if (!pass) return;
    refresh(pass).catch((err) => setError(err instanceof Error ? err.message : 'Could not load checkout pass.'));
  }, [pass, refresh]);

  useEffect(() => {
    if (!pass || status?.status === 'CANCELLED' || status?.status === 'EXPIRED') return;
    if (status?.checkout && CLOSED_CHECKOUT.has(status.checkout.status)) return;
    const timer = window.setInterval(() => {
      refresh(pass).catch((err) => setError(err instanceof Error ? err.message : 'Could not refresh checkout pass.'));
    }, 2500);
    return () => window.clearInterval(timer);
  }, [pass, refresh, status]);

  const qrUrl = useMemo(() => pass ? `${origin}${pass.qrUrl}` : '', [origin, pass]);
  const walletMatches = Boolean(address && pass && address.toLowerCase() === pass.walletAddress.toLowerCase());
  const canConfirm = Boolean(
    walletMatches && status?.status === 'BOUND' && status.checkout?.status === 'PENDING'
  );

  function remember(next: StoredPass | null) {
    activePassRef.current = next;
    setPass(next);
    try {
      if (next) window.sessionStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(next));
      else window.sessionStorage.removeItem(TAB_STORAGE_KEY);
    } catch {
      // The pass remains usable in React memory when storage is unavailable.
    }
  }

  async function createPass() {
    if (!address || !isConnected) {
      setError('Connect your customer wallet first.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const challenge = await getCustomerPassChallenge(address);
      const signature = await signMessageAsync({ message: challenge.message });
      const created = await createCustomerPass({ walletAddress: address, nonce: challenge.nonce, signature });
      const next = { ...created, walletAddress: address };
      remember(next);
      setStatus({ status: 'OPEN', expiresAt: created.expiresAt, checkout: null });
      setMessage('Pass ready. Let the seller scan this QR, then review the exact offer here.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create checkout pass.');
    } finally {
      setLoading(false);
    }
  }

  async function confirm() {
    if (!pass || !canConfirm) return;
    setLoading(true);
    setError('');
    try {
      const challenge = await getCustomerPassConfirmationChallenge(pass.passId, pass.controlToken);
      const signature = await signMessageAsync({ message: challenge.message });
      const result = await confirmCustomerPass(pass.passId, pass.controlToken, signature);
      setMessage(result.status === 'APPROVED'
        ? 'IFR access approved. The seller can now redeem this checkout once.'
        : result.reason || 'This wallet is not eligible yet.');
      await refresh(pass);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm checkout.');
    } finally {
      setLoading(false);
    }
  }

  async function cancel() {
    if (!pass) return;
    setLoading(true);
    setError('');
    try {
      await cancelCustomerPass(pass.passId, pass.controlToken);
      setStatus((current) => ({ status: 'CANCELLED', expiresAt: current?.expiresAt || pass.expiresAt, checkout: current?.checkout || null }));
      setMessage('Checkout pass cancelled. It cannot be bound or approved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel checkout pass.');
    } finally {
      setLoading(false);
    }
  }

  function startOver() {
    remember(null);
    setStatus(null);
    setError('');
    setMessage('Connect the IFR wallet you want the seller to verify.');
  }

  return (
    <section id="customer-pass" className="scroll-mt-36 rounded-[2rem] border border-orange-200/20 bg-[linear-gradient(145deg,rgba(255,255,255,0.08),rgba(236,118,51,0.08)_52%,rgba(0,0,0,0.2))] p-5 shadow-2xl shadow-black/25">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">Customer checkout pass</p>
          <h2 className="mt-2 text-2xl font-black text-white">Show your QR. Approve the exact offer.</h2>
        </div>
        <span className="rounded-full border border-green-300/25 bg-green-300/[0.08] px-3 py-2 text-xs font-black uppercase text-green-50">
          {status?.checkout?.status || status?.status || 'Not started'}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-stone-300">
        The QR is a short-lived presentation handle, not proof of eligibility. Only a second signature from this wallet can approve the seller and selected benefit.
      </p>

      {!pass ? (
        <button
          type="button"
          onClick={createPass}
          disabled={!isConnected || loading}
          className="mt-5 w-full rounded-2xl bg-orange-300 px-5 py-4 text-sm font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-orange-950/35 transition hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Creating...' : isConnected ? 'Create customer QR' : 'Connect wallet first'}
        </button>
      ) : (
        <div className="mt-5 grid gap-5">
          {status?.status === 'OPEN' ? (
            <div className="grid place-items-center rounded-3xl bg-stone-100 p-5">
              <div className="w-full max-w-[240px] aspect-square"><QRCode value={qrUrl} className="h-full w-full" /></div>
              <p className="mt-4 break-all text-center font-mono text-[11px] text-stone-600">{qrUrl}</p>
            </div>
          ) : null}

          {status?.checkout ? (
            <div className="grid gap-3 rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-stone-300">
              <div className="flex justify-between gap-4"><span>Seller</span><strong className="text-right text-white">{status.checkout.sellerName}</strong></div>
              <div className="flex justify-between gap-4"><span>Offer</span><strong className="text-right text-white">{status.checkout.benefit.label || 'Standard benefit'}</strong></div>
              <div className="flex justify-between gap-4"><span>Product</span><strong className="text-right text-white">{status.checkout.benefit.productName || 'Seller benefit'}</strong></div>
              <div className="flex justify-between gap-4"><span>Benefit</span><strong className="text-orange-100">{status.checkout.benefit.discountPercent}%</strong></div>
              <div className="flex justify-between gap-4"><span>Required IFRLock</span><strong className="text-right text-white">{status.checkout.benefit.requiredLockIFR.toLocaleString('en-US')} IFR</strong></div>
              <div className="flex justify-between gap-4"><span>Expires in</span><strong className="text-white"><Countdown expiresAt={status.checkout.expiresAt} /></strong></div>
            </div>
          ) : null}

          {pass && address && !walletMatches ? (
            <p className="rounded-2xl border border-red-300/25 bg-red-300/[0.08] p-3 text-sm text-red-100">
              Reconnect the wallet that created this pass before confirming it.
            </p>
          ) : null}

          {canConfirm ? (
            <button type="button" onClick={confirm} disabled={loading} className="w-full rounded-2xl bg-green-300 px-5 py-4 text-sm font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-green-950/30 transition hover:bg-green-200 disabled:opacity-50">
              {loading ? 'Confirming...' : 'Confirm this seller and offer'}
            </button>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-3">
            <button type="button" onClick={() => refresh(pass, true)} disabled={loading} className="rounded-xl border border-white/15 px-3 py-3 text-xs font-black uppercase text-stone-100 disabled:opacity-50">Refresh</button>
            {status?.status === 'OPEN' || status?.status === 'BOUND' ? (
              <button type="button" onClick={cancel} disabled={loading} className="rounded-xl border border-red-300/30 px-3 py-3 text-xs font-black uppercase text-red-100 disabled:opacity-50">Cancel</button>
            ) : null}
            <button type="button" onClick={startOver} disabled={loading} className="rounded-xl border border-white/15 px-3 py-3 text-xs font-black uppercase text-stone-100 disabled:opacity-50">New pass</button>
          </div>
        </div>
      )}
      <p className="mt-4 text-xs leading-5 text-stone-400" aria-live="polite">{message}</p>
      {error ? <p className="mt-3 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
    </section>
  );
}
