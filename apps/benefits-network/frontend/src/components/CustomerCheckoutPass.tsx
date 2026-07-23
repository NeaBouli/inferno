'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAccount, useSignMessage } from 'wagmi';
import QRCode from 'react-qr-code';
import { Countdown } from '@/components/Countdown';
import { BusinessLogo } from '@/components/BusinessLogo';
import {
  CustomerPassControlStatus,
  CustomerPassCreated,
  type BenefitRule,
  cancelCustomerPass,
  confirmCustomerPass,
  createCustomerPass,
  getCustomerPassChallenge,
  getCustomerPassConfirmationChallenge,
  getCustomerPassStatus,
  getBusiness,
  getBusinessRules,
} from '@/lib/api';
import { lockSourceLabel, lockSourceRequirement } from '@/lib/lockSource';
import { formatProductPrice } from '@/lib/money';

const TAB_STORAGE_KEY = 'ifr.shop.activeCustomerPass';
const CLOSED_CHECKOUT = new Set(['REDEEMED', 'REJECTED', 'EXPIRED']);

type StoredPass = CustomerPassCreated & { walletAddress: string };
type SelectedOffer = { businessId: string; sellerName: string; sellerLogoUrl: string | null; rule: BenefitRule };

export function CustomerCheckoutPass() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const searchParams = useSearchParams();
  const [pass, setPass] = useState<StoredPass | null>(null);
  const [status, setStatus] = useState<CustomerPassControlStatus | null>(null);
  const [origin, setOrigin] = useState('https://shop.ifrunit.tech');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('Connect the IFR wallet you want the seller to verify.');
  const [selectedOffer, setSelectedOffer] = useState<SelectedOffer | null>(null);
  const [offerMessage, setOfferMessage] = useState('');
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

  useEffect(() => {
    const businessId = searchParams.get('seller') || '';
    const ruleId = searchParams.get('offer') || '';
    setSelectedOffer(null);
    setOfferMessage('');
    if (!businessId && !ruleId) return;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(businessId) || !/^[A-Za-z0-9_-]{1,80}$/.test(ruleId)) {
      setOfferMessage('This offer link is invalid. Browse the current public offers below.');
      return;
    }
    const controller = new AbortController();
    setOfferMessage('Checking the selected public offer...');
    Promise.all([getBusiness(businessId), getBusinessRules(businessId, controller.signal)])
      .then(([business, result]) => {
        const rule = result.rules.find((candidate) => candidate.id === ruleId && candidate.active);
        if (!rule) throw new Error('Selected offer is no longer active.');
        setSelectedOffer({
          businessId: business.id,
          sellerName: business.name,
          sellerLogoUrl: business.logoUrl,
          rule,
        });
        setOfferMessage('Offer verified. The seller still binds it and you approve the exact checkout snapshot.');
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setOfferMessage(err.message || 'Selected offer could not be verified.');
      });
    return () => controller.abort();
  }, [searchParams]);

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
  const selectedOfferMismatch = Boolean(
    selectedOffer && status?.checkout && (
      status.checkout.businessId !== selectedOffer.businessId ||
      status.checkout.benefitRuleId !== selectedOffer.rule.id
    )
  );
  const canConfirm = Boolean(
    walletMatches && status?.status === 'BOUND' && status.checkout?.status === 'PENDING' &&
    !selectedOfferMismatch
  );
  const checkoutClosed = Boolean(status?.checkout && CLOSED_CHECKOUT.has(status.checkout.status));
  const mustCancelBeforeReset = status !== null && (
    (status.status === 'OPEN' || status.status === 'BOUND') && !checkoutClosed
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

  async function cancel(startNewPass = false) {
    if (!pass) return;
    setLoading(true);
    setError('');
    try {
      await cancelCustomerPass(pass.passId, pass.controlToken);
      if (startNewPass) {
        remember(null);
        setStatus(null);
        setMessage('Previous pass cancelled. You can create a new customer QR.');
      } else {
        setStatus((current) => ({ status: 'CANCELLED', expiresAt: current?.expiresAt || pass.expiresAt, checkout: current?.checkout || null }));
        setMessage('Checkout pass cancelled. It cannot be bound or approved.');
      }
    } catch (err) {
      const detail = err instanceof Error ? ` ${err.message}` : '';
      setError(`Could not cancel checkout pass. The current pass was kept.${detail}`);
    } finally {
      setLoading(false);
    }
  }

  function clearClosedPass() {
    remember(null);
    setStatus(null);
    setError('');
    setMessage('Connect the IFR wallet you want the seller to verify.');
  }

  function clearSelectedOffer() {
    const url = new URL(window.location.href);
    url.searchParams.delete('seller');
    url.searchParams.delete('offer');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    setSelectedOffer(null);
    setOfferMessage('Offer selection cleared. You can still create a general customer QR.');
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

      {selectedOffer ? (
        <div className="mt-4 rounded-2xl border border-orange-200/25 bg-orange-200/[0.08] p-4 text-sm text-stone-200">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <BusinessLogo name={selectedOffer.sellerName} logoUrl={selectedOffer.sellerLogoUrl} size="sm" />
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-orange-100">Selected public offer</p>
                <p className="mt-2 break-words font-black text-white">{selectedOffer.rule.productName} · {selectedOffer.sellerName}</p>
                <p className="mt-1 text-stone-300">
                  {selectedOffer.rule.discountPercent}% benefit · {selectedOffer.rule.requiredLockIFR.toLocaleString('en-US')} IFR lock
                  {' '}{lockSourceRequirement(selectedOffer.rule.lockSource)}
                  {selectedOffer.rule.minIFRHeld > 0
                    ? ` · ${selectedOffer.rule.minIFRHeld.toLocaleString('en-US')} IFR held`
                    : ''}
                </p>
              </div>
            </div>
            <button type="button" onClick={clearSelectedOffer} className="text-xs font-black uppercase tracking-[0.12em] text-orange-100">Clear</button>
          </div>
          <p className="mt-3 text-xs leading-5 text-stone-400">Show this selection to the seller. Your QR does not grant it automatically; approve only after the same offer appears below.</p>
        </div>
      ) : null}
      {offerMessage ? <p className="mt-3 text-xs leading-5 text-stone-400" aria-live="polite">{offerMessage}</p> : null}

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
              <div className="flex items-center justify-between gap-4">
                <span>Seller</span>
                <span className="flex min-w-0 items-center justify-end gap-3">
                  <BusinessLogo name={status.checkout.sellerName} logoUrl={status.checkout.sellerLogoUrl} size="sm" />
                  <strong className="break-words text-right text-white">{status.checkout.sellerName}</strong>
                </span>
              </div>
              <div className="flex justify-between gap-4"><span>Offer</span><strong className="text-right text-white">{status.checkout.benefit.label || 'Standard benefit'}</strong></div>
              <div className="flex justify-between gap-4"><span>Product</span><strong className="text-right text-white">{status.checkout.benefit.productName || 'Seller benefit'}</strong></div>
              {formatProductPrice(status.checkout.benefit.basePriceMinor, status.checkout.benefit.currency) ? (
                <div className="flex justify-between gap-4">
                  <span>Reference price</span>
                  <strong className="text-right text-white">
                    {formatProductPrice(status.checkout.benefit.basePriceMinor, status.checkout.benefit.currency)}
                  </strong>
                </div>
              ) : null}
              <div className="flex justify-between gap-4"><span>Benefit</span><strong className="text-orange-100">{status.checkout.benefit.discountPercent}%</strong></div>
              <div className="flex justify-between gap-4"><span>Accepted lock source</span><strong className="text-right text-white">{lockSourceLabel(status.checkout.benefit.lockSource)}</strong></div>
              <div className="flex justify-between gap-4"><span>Required locked IFR</span><strong className="text-right text-white">{status.checkout.benefit.requiredLockIFR.toLocaleString('en-US')} IFR</strong></div>
              {status.checkout.benefit.minIFRHeld > 0 ? (
                <div className="flex justify-between gap-4"><span>Required in wallet</span><strong className="text-right text-white">{status.checkout.benefit.minIFRHeld.toLocaleString('en-US')} IFR</strong></div>
              ) : null}
              <div className="flex justify-between gap-4"><span>Expires in</span><strong className="text-white"><Countdown expiresAt={status.checkout.expiresAt} /></strong></div>
            </div>
          ) : null}

          {selectedOfferMismatch ? (
            <div className="rounded-2xl border border-amber-300/35 bg-amber-300/[0.1] p-4 text-sm leading-6 text-amber-50" role="alert">
              The seller bound a different offer than the public offer you selected. Review the checkout snapshot above. Clear the prior selection only if you intentionally accept this new seller offer.
            </div>
          ) : selectedOffer && status?.checkout ? (
            <p className="rounded-2xl border border-green-300/25 bg-green-300/[0.08] p-3 text-sm text-green-50">
              The bound checkout matches your selected public offer.
            </p>
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
              <button type="button" onClick={() => void cancel()} disabled={loading} className="rounded-xl border border-red-300/30 px-3 py-3 text-xs font-black uppercase text-red-100 disabled:opacity-50">Cancel</button>
            ) : null}
            <button
              type="button"
              onClick={() => mustCancelBeforeReset ? void cancel(true) : clearClosedPass()}
              disabled={loading || !status}
              className="rounded-xl border border-white/15 px-3 py-3 text-xs font-black uppercase text-stone-100 disabled:opacity-50"
            >
              {!status ? 'Checking pass...' : loading && mustCancelBeforeReset ? 'Cancelling...' : mustCancelBeforeReset ? 'Cancel & new pass' : 'New pass'}
            </button>
          </div>
        </div>
      )}
      <p className="mt-4 text-xs leading-5 text-stone-400" aria-live="polite">{message}</p>
      {error ? <p className="mt-3 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
    </section>
  );
}
