'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi';
import QRCode from 'react-qr-code';
import { AppShell } from '@/components/AppShell';
import { Countdown } from '@/components/Countdown';
import { StatusBadge } from '@/components/StatusBadge';
import { SellerCustomerPassScanner } from '@/components/SellerCustomerPassScanner';
import { parseCustomerPassQrPayload } from '@/lib/customerPassLink';
import {
  BenefitRule,
  BusinessInfo,
  CheckoutAccess,
  SessionCreated,
  SessionStatus,
  createSession,
  bindCustomerPass,
  getBusiness,
  getBusinessRules,
  getCheckoutOperatorStatus,
  getSellerAuthMessage,
  getSessionStatus,
  redeemSession,
} from '@/lib/api';

export function BusinessConsoleClient({ businessId }: { businessId: string }) {
  const { address, isConnected } = useAccount();
  const { connectors, connectAsync, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  const [session, setSession] = useState<SessionCreated | null>(null);
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [rules, setRules] = useState<BenefitRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState('');
  const [origin, setOrigin] = useState('');
  const [error, setError] = useState('');
  const [linkStatus, setLinkStatus] = useState('');
  const [receiptStatus, setReceiptStatus] = useState('');
  const [restoreInput, setRestoreInput] = useState('');
  const [customerPassInput, setCustomerPassInput] = useState('');
  const [customerPresented, setCustomerPresented] = useState(false);
  const [checkoutAccess, setCheckoutAccess] = useState<CheckoutAccess | null>(null);
  const [accessStatus, setAccessStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const isDone = status && ['REDEEMED', 'EXPIRED', 'REJECTED'].includes(status.status);

  useEffect(() => {
    setOrigin(window.location.origin);
    const incomingPass = new URLSearchParams(window.location.search).get('pass');
    if (incomingPass) setCustomerPassInput(incomingPass);
    Promise.all([getBusiness(businessId), getBusinessRules(businessId)])
      .then(([nextBusiness, rulesResult]) => {
        setBusiness(nextBusiness);
        setRules(rulesResult.rules);
        setSelectedRuleId(rulesResult.rules[0]?.id ?? '');
      })
      .catch((err: Error) => setError(err.message));
  }, [businessId]);

  useEffect(() => {
    setCheckoutAccess(null);
    setAccessStatus('');
  }, [address, businessId]);

  useEffect(() => {
    if (!checkoutAccess?.expiresAt) return;
    const clearExpiredAccess = () => {
      if (new Date(checkoutAccess.expiresAt as string) <= new Date()) {
        setCheckoutAccess(null);
        setAccessStatus('Checkout operator access expired. Ask the owner to renew it.');
      }
    };
    clearExpiredAccess();
    const timer = window.setInterval(clearExpiredAccess, 30_000);
    return () => window.clearInterval(timer);
  }, [checkoutAccess]);

  useEffect(() => {
    if (!session) return;
    const poll = () => {
      getSessionStatus(session.sessionId)
        .then(setStatus)
        .catch((err: Error) => setError(err.message));
    };
    poll();
    const timer = window.setInterval(poll, 3000);
    return () => window.clearInterval(timer);
  }, [session]);

  const customerUrl = useMemo(() => {
    if (!session || !origin || customerPresented) return '';
    return `${origin}${session.qrUrl}`;
  }, [customerPresented, origin, session]);

  const selectedRule = useMemo(
    () => rules.find((rule) => rule.id === selectedRuleId) ?? null,
    [rules, selectedRuleId]
  );

  const previewBenefit = session ?? selectedRule ?? business;
  const previewDailyLimit = session?.dailyRedemptionLimit ?? selectedRule?.dailyRedemptionLimit ?? 0;
  const previewMonthlyLimit = session?.monthlyRedemptionLimit ?? selectedRule?.monthlyRedemptionLimit ?? 0;
  const sellerWalletLabel = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not connected';
  const sessionActive = Boolean(session && !isDone);
  const customerApproved = status?.status === 'APPROVED';
  const sellerWalletReady = Boolean(address && isConnected);
  const checkoutAuthorized = Boolean(
    checkoutAccess?.authorized && address && checkoutAccess.walletAddress.toLowerCase() === address.toLowerCase()
  );
  const scannerStatus = !business
    ? 'Load business'
    : !sellerWalletReady
      ? 'Connect seller wallet'
    : !previewBenefit
      ? 'Select benefit'
      : !session
        ? 'Authorize QR session'
        : customerApproved && checkoutAuthorized
          ? 'Ready to redeem'
          : customerApproved && sellerWalletReady
            ? 'Check seller access'
          : customerApproved
            ? 'Connect seller wallet'
            : isDone
              ? 'Session closed'
              : 'Waiting for customer';
  const scannerNextStep = !business
    ? 'The scanner is waiting for a valid seller profile before checkout can start.'
    : !sellerWalletReady
      ? 'Connect the business owner or an active checkout operator. The app verifies current access when creating the QR.'
    : !session
      ? 'Choose the benefit rule, then sign one short authorization to create the customer QR.'
      : customerApproved && checkoutAuthorized
        ? 'Redeem first to enforce this wallet\'s usage limit. Grant the benefit only after redemption succeeds.'
        : customerApproved && sellerWalletReady
          ? 'Confirm this wallet as the business owner or an active checkout operator.'
        : customerApproved
          ? 'The customer is approved. Connect the seller wallet to redeem once.'
          : isDone
            ? 'This QR session is closed. Create a new verification for the next customer.'
            : 'Show the QR code or share the customer link. This screen updates when the customer signs.';
  const scannerReadinessSteps = [
    { label: 'Seller profile loaded', ready: Boolean(business) },
    { label: 'Benefit or rule selected', ready: Boolean(previewBenefit) },
    { label: 'Checkout wallet connected', ready: sellerWalletReady },
    { label: 'Checkout access confirmed', ready: checkoutAuthorized },
    { label: 'QR session active', ready: sessionActive },
    { label: 'Customer approved', ready: customerApproved },
  ];
  const checkoutReceipt = useMemo(() => {
    if (!session) return '';

    const benefit = status?.benefit ?? session;
    const wallet = status?.status === 'APPROVED' || status?.status === 'REDEEMED'
      ? 'verified (private)'
      : 'not verified yet';
    return [
      'IFR Benefits Network checkout receipt',
      `Seller: ${business?.name || businessId}`,
      `Session: ${session.sessionId}`,
      `Status: ${status?.status || 'PENDING'}`,
      `Verification attempts: ${status?.attestAttempts ?? 0}/3`,
      `Benefit: ${benefit.discountPercent}%`,
      `Required lock: ${benefit.requiredLockIFR.toLocaleString('en-US')} IFR`,
      `Wallet limit: ${benefit.dailyRedemptionLimit || 'unlimited'}/UTC day / ${benefit.monthlyRedemptionLimit || 'unlimited'}/UTC month`,
      `Rule: ${benefit.label || 'Business default'}`,
      `Product: ${benefit.productName || 'Business default benefit'}`,
      `Customer wallet: ${wallet}`,
      `Expires: ${session.expiresAt}`,
      `Redeemed: ${status?.redeemedAt || 'not redeemed'}`,
      `Customer link: ${customerUrl || 'not ready'}`,
    ].join('\n');
  }, [business?.name, businessId, customerUrl, session, status]);
  const lastSessionStorageKey = useMemo(
    () => `ifr.shop.lastCheckoutSession.${businessId}`,
    [businessId]
  );

  function rememberSession(sessionId: string) {
    try {
      window.localStorage.setItem(lastSessionStorageKey, sessionId);
    } catch {
      // Storage is only a counter-device convenience; checkout still works without it.
    }
  }

  function forgetRememberedSession() {
    try {
      window.localStorage.removeItem(lastSessionStorageKey);
    } catch {
      // Ignore private-mode storage failures.
    }
  }

  function sessionFromStatus(sessionId: string, nextStatus: SessionStatus): SessionCreated {
    return {
      sessionId,
      expiresAt: nextStatus.expiresAt,
      qrUrl: `/r/${sessionId}`,
      benefitRuleId: nextStatus.benefitRuleId,
      label: nextStatus.benefit.label,
      category: nextStatus.benefit.category,
      productName: nextStatus.benefit.productName,
      discountPercent: nextStatus.benefit.discountPercent,
      requiredLockIFR: nextStatus.benefit.requiredLockIFR,
      dailyRedemptionLimit: nextStatus.benefit.dailyRedemptionLimit,
      monthlyRedemptionLimit: nextStatus.benefit.monthlyRedemptionLimit,
      tierLabel: nextStatus.benefit.tierLabel,
    };
  }

  function parseSessionId(value: string) {
    const raw = value.trim();
    if (!raw) return '';

    const receiptMatch = raw.match(/^Session:\s*(\S+)/im);
    if (receiptMatch?.[1]) return receiptMatch[1].trim();

    try {
      const url = new URL(raw);
      const proofMatch = url.pathname.match(/\/r\/([^/?#]+)/);
      if (proofMatch?.[1]) return proofMatch[1].trim();
    } catch {
      // Not a URL; treat as raw text below.
    }

    return raw.replace(/^\/?r\//, '').split(/[/?#\s]/)[0].trim();
  }

  async function startSession() {
    if (!address || !isConnected) {
      setError('Connect the business owner or checkout operator wallet before creating a QR session.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const scope = selectedRuleId || 'default';
      const challenge = await getSellerAuthMessage('sessions:create', businessId, {
        walletAddress: address,
        scope,
      });
      if (!challenge.nonce) throw new Error('Seller authorization challenge is incomplete');
      const signature = await signMessageAsync({ message: challenge.message });
      const nextSession = await createSession(businessId, selectedRuleId || undefined, {
        walletAddress: address,
        signature,
        timestamp: challenge.timestamp,
        nonce: challenge.nonce,
      });
      setSession(nextSession);
      setCustomerPresented(false);
      setStatus(null);
      if (nextSession.createdBy) setCheckoutAccess(nextSession.createdBy);
      rememberSession(nextSession.sessionId);
      setLinkStatus('Checkout session saved on this device.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Session failed';
      if (message.includes('authorized for checkout')) {
        setCheckoutAccess(null);
        setAccessStatus('Checkout access changed. Ask the owner or check access again.');
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function redeem() {
    if (!session) return;
    if (!address || !isConnected) {
      setError('Connect the seller wallet before redeeming an approved benefit.');
      return;
    }
    if (!checkoutAuthorized) {
      setError('Check this wallet\'s checkout access before redeeming.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const challenge = await getSellerAuthMessage('sessions:redeem', session.sessionId, {
        walletAddress: address,
        scope: session.sessionId,
      });
      if (!challenge.nonce) throw new Error('Seller authorization challenge is incomplete');
      const signature = await signMessageAsync({ message: challenge.message });
      await redeemSession(session.sessionId, {
        walletAddress: address,
        signature,
        timestamp: challenge.timestamp,
        nonce: challenge.nonce,
      });
      setStatus(await getSessionStatus(session.sessionId));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Redeem failed';
      if (message.includes('authorized for checkout')) {
        setCheckoutAccess(null);
        setAccessStatus('Checkout access changed. Ask the owner or check access again.');
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function parseCustomerPassId(value: string) {
    const raw = value.trim();
    if (/^[A-Za-z0-9_-]{32}$/.test(raw)) return raw;
    if (!origin) return '';
    const candidate = raw.startsWith('/') ? `${origin}${raw}` : raw;
    const parsed = parseCustomerPassQrPayload(candidate, origin);
    return parsed.ok ? parsed.passId : '';
  }

  async function bindPresentedPass() {
    const passId = parseCustomerPassId(customerPassInput);
    if (!/^[A-Za-z0-9_-]{32}$/.test(passId)) {
      setError('Scan or paste a valid IFR customer checkout pass first.');
      return;
    }
    if (!address || !isConnected) {
      setError('Connect the business owner or checkout operator wallet first.');
      return;
    }
    if (!selectedRuleId) {
      setError('Select an active benefit rule before binding the customer pass.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const scope = `${passId}:${selectedRuleId}`;
      const challenge = await getSellerAuthMessage('passes:bind', businessId, {
        walletAddress: address,
        scope,
      });
      if (!challenge.nonce) throw new Error('Seller authorization challenge is incomplete');
      const signature = await signMessageAsync({ message: challenge.message });
      const bound = await bindCustomerPass(passId, businessId, selectedRuleId, {
        walletAddress: address,
        signature,
        timestamp: challenge.timestamp,
        nonce: challenge.nonce,
      });
      const nextStatus = await getSessionStatus(bound.sessionId);
      setSession(sessionFromStatus(bound.sessionId, nextStatus));
      setStatus(nextStatus);
      setCustomerPresented(true);
      setCustomerPassInput('');
      if (bound.createdBy) setCheckoutAccess(bound.createdBy);
      rememberSession(bound.sessionId);
      setLinkStatus('Customer pass bound. Waiting for the customer to approve this exact offer.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not bind customer checkout pass.');
    } finally {
      setLoading(false);
    }
  }

  async function checkCheckoutAccess() {
    if (!address || !isConnected) {
      setError('Connect the business owner or checkout operator wallet first.');
      return;
    }
    setLoading(true);
    setError('');
    setAccessStatus('');
    try {
      const challenge = await getSellerAuthMessage('operators:status', businessId);
      const signature = await signMessageAsync({ message: challenge.message });
      const access = await getCheckoutOperatorStatus(businessId, {
        walletAddress: address,
        signature,
        timestamp: challenge.timestamp,
      });
      setCheckoutAccess(access);
      setAccessStatus(access.role === 'OWNER'
        ? 'Business owner confirmed.'
        : `${access.label || 'Checkout operator'} confirmed.`
      );
    } catch (err) {
      setCheckoutAccess(null);
      setError(err instanceof Error ? err.message : 'Checkout access check failed');
    } finally {
      setLoading(false);
    }
  }

  async function connectSellerWallet() {
    setError('');
    const connector =
      connectors.find((item) => item.id === 'injected') ||
      connectors.find((item) => item.id === 'metaMask') ||
      connectors[0];
    if (!connector) {
      setError('No wallet connector is available in this browser.');
      return;
    }
    await connectAsync({ connector });
  }

  async function copyCustomerUrl() {
    if (!customerUrl) return;
    try {
      await navigator.clipboard.writeText(customerUrl);
      setError('');
      setLinkStatus('Customer link copied.');
    } catch {
      setLinkStatus('');
      setError('Could not copy the customer link in this browser.');
    }
  }

  async function shareCustomerUrl() {
    if (!customerUrl) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${business?.name || 'IFR'} customer verification`,
          text: 'Scan or open this link to verify locked IFR access for this checkout.',
          url: customerUrl,
        });
        setError('');
        setLinkStatus('Customer link shared.');
        return;
      }
      await copyCustomerUrl();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setLinkStatus('');
      setError(err instanceof Error ? err.message : 'Could not share the customer link.');
    }
  }

  async function copyCheckoutReceipt() {
    if (!checkoutReceipt) {
      setError('Create a QR session before copying a checkout receipt.');
      return;
    }
    try {
      await navigator.clipboard.writeText(checkoutReceipt);
      setError('');
      setReceiptStatus('Checkout receipt copied.');
    } catch {
      setReceiptStatus('');
      setError('Could not copy the checkout receipt in this browser.');
    }
  }

  async function shareCheckoutReceipt() {
    if (!checkoutReceipt) {
      setError('Create a QR session before sharing a checkout receipt.');
      return;
    }
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${business?.name || 'IFRp'} checkout receipt`,
          text: checkoutReceipt,
          url: customerUrl || origin || undefined,
        });
        setError('');
        setReceiptStatus('Checkout receipt shared.');
        return;
      }
      await copyCheckoutReceipt();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setReceiptStatus('');
      setError(err instanceof Error ? err.message : 'Could not share the checkout receipt.');
    }
  }

  async function restoreSessionById(candidateSessionId: string, successMessage: string) {
    setError('');
    setLinkStatus('');

    const sessionId = parseSessionId(candidateSessionId);
    if (!sessionId) {
      setError('Paste a checkout session ID, customer link or receipt first.');
      return;
    }

    setLoading(true);
    try {
      const nextStatus = await getSessionStatus(sessionId);
      if (nextStatus.businessId !== businessId) {
        forgetRememberedSession();
        setError('Saved checkout session belongs to another seller profile.');
        return;
      }
      setSession(sessionFromStatus(sessionId, nextStatus));
      setCustomerPresented(nextStatus.presentation === 'CUSTOMER_PASS');
      setStatus(nextStatus);
      rememberSession(sessionId);
      setLinkStatus(`${successMessage}: ${nextStatus.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore checkout session.');
    } finally {
      setLoading(false);
    }
  }

  async function restoreLastSession() {
    let rememberedSessionId = '';
    try {
      rememberedSessionId = window.localStorage.getItem(lastSessionStorageKey) || '';
    } catch {
      setError('Local session recovery is not available in this browser.');
      return;
    }

    await restoreSessionById(rememberedSessionId, 'Restored saved checkout session');
  }

  async function restorePastedSession() {
    await restoreSessionById(restoreInput, 'Restored checkout session');
  }

  return (
    <AppShell>
      <section className="mx-auto grid w-full max-w-5xl gap-6 px-5 pb-16 pt-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-6 shadow-2xl shadow-black/30">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-200/80">
            Seller scanner
          </p>
          <h1 className="mt-2 text-4xl font-black text-white">{business?.name || 'Business console'}</h1>
          <p className="mt-4 text-sm leading-6 text-stone-300">
            Scan a customer-presented pass or create a legacy seller QR. The customer approves the exact
            seller rule, the backend checks IFRLock on-chain and this screen updates automatically.
          </p>
          <a
            href={`/s/${encodeURIComponent(businessId)}`}
            className="mt-4 inline-flex rounded-full border border-green-200/35 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-green-50"
          >
            Open customer catalog
          </a>

          <div className="mt-5 rounded-2xl border border-orange-200/20 bg-[#1d130c] p-4 shadow-xl shadow-black/20">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-200/80">
                  Checkout readiness
                </p>
                <h2 className="mt-1 text-2xl font-black text-white">{scannerStatus}</h2>
                <p className="mt-2 text-sm leading-6 text-stone-300">{scannerNextStep}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-right">
                <p className="text-xs uppercase tracking-[0.14em] text-stone-500">Current session</p>
                <p className="mt-1 text-sm font-black text-white">{status?.status || (session ? 'PENDING' : 'Not started')}</p>
                <p className="mt-1 text-xs text-stone-400">
                  {session?.discountPercent ?? previewBenefit?.discountPercent ?? '-'}% benefit
                  {status ? ` · ${status.attestAttempts}/3 checks` : ''}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {scannerReadinessSteps.map((step) => (
                <div
                  key={step.label}
                  className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm ${
                    step.ready
                      ? 'border-green-300/25 bg-green-300/[0.08] text-green-50'
                      : 'border-white/10 bg-black/20 text-stone-300'
                  }`}
                >
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      step.ready ? 'bg-green-300 shadow-[0_0_16px_rgba(134,239,172,0.75)]' : 'bg-stone-600'
                    }`}
                  />
                  <span className="font-semibold">{step.label}</span>
                </div>
              ))}
            </div>

            {status?.reason ? (
              <div className="mt-4 rounded-2xl border border-orange-200/20 bg-orange-200/[0.07] p-3 text-xs leading-5 text-orange-50">
                <span className="font-black">Customer verification note: </span>
                {status.reason}
              </div>
            ) : null}

            <div className="mt-4 rounded-2xl border border-green-300/20 bg-green-300/[0.07] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-green-100/80">Customer-presented QR</p>
                  <p className="mt-1 text-xs leading-5 text-stone-300">
                    Scan the customer&apos;s pass with the phone camera, or paste its link here. The customer must approve the selected rule after you bind it.
                  </p>
                </div>
                <span className="rounded-full border border-green-200/25 px-3 py-2 text-[10px] font-black uppercase text-green-50">Recommended</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  value={customerPassInput}
                  onChange={(event) => setCustomerPassInput(event.target.value)}
                  placeholder="Paste https://shop.ifrunit.tech/p/... or pass ID"
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="min-w-0 rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-xs text-white outline-none focus:border-green-300"
                />
                <button
                  type="button"
                  onClick={bindPresentedPass}
                  disabled={!sellerWalletReady || !selectedRuleId || loading}
                  className="rounded-xl bg-green-300 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-stone-950 transition hover:bg-green-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Bind selected rule
                </button>
              </div>
              <SellerCustomerPassScanner onPass={setCustomerPassInput} />
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={startSession}
                disabled={!business || !sellerWalletReady || loading}
                className="rounded-2xl border border-orange-200/35 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-orange-50 transition hover:bg-orange-200/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {session ? 'New session' : 'Create QR'}
              </button>
              <button
                type="button"
                onClick={copyCustomerUrl}
                disabled={!customerUrl}
                className="rounded-2xl border border-white/15 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-orange-200/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Copy customer link
              </button>
              <button
                type="button"
                onClick={redeem}
                disabled={loading || !customerApproved || !checkoutAuthorized}
                className="rounded-2xl bg-orange-300 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-orange-950/30 transition hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Redeem
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-orange-200/80">
                    Session recovery
                  </p>
                  <p className="mt-1 text-xs leading-5 text-stone-400">
                    This counter device remembers the last QR session. You can also paste a receipt,
                    customer link or session ID to reopen a checkout after refresh or tablet sleep.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={restoreLastSession}
                  disabled={loading}
                  className="rounded-xl border border-white/15 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-stone-100 transition hover:border-orange-200/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Restore last QR
                </button>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  value={restoreInput}
                  onChange={(event) => setRestoreInput(event.target.value)}
                  placeholder="Paste session ID, customer link or checkout receipt"
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-orange-300"
                />
                <button
                  type="button"
                  onClick={restorePastedSession}
                  disabled={loading}
                  className="rounded-xl border border-orange-200/35 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-orange-50 transition hover:bg-orange-200/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Restore pasted
                </button>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-green-300/20 bg-green-300/[0.07] p-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-green-100/80">
              Checkout wallet
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-sm text-stone-200">{sellerWalletLabel}</p>
                <p className={`mt-1 text-xs font-semibold ${checkoutAuthorized ? 'text-green-100' : 'text-stone-400'}`}>
                  {checkoutAuthorized
                    ? checkoutAccess?.role === 'OWNER'
                      ? 'Authorized as business owner'
                      : `Authorized operator: ${checkoutAccess?.label || 'Checkout operator'}`
                    : address ? 'Access not checked on this device' : 'Connect owner or checkout operator'}
                </p>
              </div>
              {address ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={checkCheckoutAccess}
                    disabled={loading}
                    className="rounded-xl bg-green-300 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-stone-950 transition hover:bg-green-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {checkoutAuthorized ? 'Recheck access' : 'Check access'}
                  </button>
                  <button
                    type="button"
                    onClick={() => disconnect()}
                    className="rounded-xl border border-white/15 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-stone-100 transition hover:border-green-200/60"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={connectSellerWallet}
                  disabled={connecting}
                  className="rounded-xl bg-green-300 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-stone-950 transition hover:bg-green-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {connecting ? 'Connecting...' : 'Connect'}
                </button>
              )}
            </div>
            <p className="mt-2 text-xs leading-5 text-stone-400">
              The owner can authorize checkout wallets in Seller mode. Operators can redeem approved sessions only;
              the backend checks current access again for every redeem signature.
            </p>
            {accessStatus ? <p className="mt-2 text-xs font-semibold text-green-100">{accessStatus}</p> : null}
          </div>

          <div className="mt-5 rounded-2xl border border-orange-200/20 bg-[#20140c] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-200/80">
                  Checkout receipt
                </p>
                <h2 className="mt-1 text-xl font-black text-white">
                  {session ? status?.status || 'PENDING' : 'Create QR first'}
                </h2>
                <p className="mt-2 text-sm leading-6 text-stone-300">
                  Copy a redacted receipt for staff handoff, test evidence or customer support.
                  It never includes private keys, signatures or full wallet inventories.
                </p>
              </div>
              {status ? <StatusBadge status={status.status} /> : null}
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-3">
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs leading-6 text-orange-50">
                {checkoutReceipt || 'Create a QR session to generate a checkout receipt.'}
              </pre>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={copyCheckoutReceipt}
                disabled={!checkoutReceipt}
                className="rounded-2xl border border-orange-200/35 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-orange-50 transition hover:bg-orange-200/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Copy receipt
              </button>
              <button
                type="button"
                onClick={shareCheckoutReceipt}
                disabled={!checkoutReceipt}
                className="rounded-2xl border border-white/15 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-orange-200/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Share receipt
              </button>
            </div>
            {receiptStatus ? <p className="mt-3 text-xs font-semibold text-green-100">{receiptStatus}</p> : null}
          </div>

          <div className="mt-6 grid gap-3 rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-stone-300">
            <div className="flex justify-between gap-4">
              <span>Benefit</span>
              <strong className="text-white">{previewBenefit ? `${previewBenefit.discountPercent}%` : '-'}</strong>
            </div>
            <div className="flex justify-between gap-4">
              <span>Required lock</span>
              <strong className="text-white">{previewBenefit ? `${previewBenefit.requiredLockIFR.toLocaleString('en-US')} IFR` : '-'}</strong>
            </div>
            <div className="flex justify-between gap-4">
              <span>Per-wallet use</span>
              <strong className="text-right text-white">
                {previewDailyLimit || 'unlimited'} / UTC day · {previewMonthlyLimit || 'unlimited'} / UTC month
              </strong>
            </div>
            <div className="flex justify-between gap-4">
              <span>Selected rule</span>
              <strong className="text-white">{selectedRule?.label || business?.tierLabel || 'Standard'}</strong>
            </div>
            {selectedRule ? (
              <div className="flex justify-between gap-4">
                <span>Product</span>
                <strong className="text-right text-white">{selectedRule.productName}</strong>
              </div>
            ) : null}
            {session?.benefitRuleId ? (
              <div className="flex justify-between gap-4">
                <span>Session rule</span>
                <strong className="break-all text-right text-white">{session.benefitRuleId}</strong>
              </div>
            ) : null}
          </div>

          {rules.length > 0 ? (
            <label className="mt-4 grid gap-2 text-sm font-semibold text-stone-200">
              Rule for next QR session
              <select
                value={selectedRuleId}
                onChange={(event) => setSelectedRuleId(event.target.value)}
                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
              >
                {rules.map((rule) => (
                  <option key={rule.id} value={rule.id}>
                    {rule.label} - {rule.productName} - {rule.discountPercent}% / {rule.requiredLockIFR.toLocaleString('en-US')} IFR
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {rules.length > 0 ? (
            <div className="mt-4 grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-stone-400">
                Active seller rules
              </p>
              {rules.map((rule) => (
                <div key={rule.id} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                  <div className="flex justify-between gap-4">
                    <span className="font-bold text-white">{rule.label}</span>
                    <span className="text-orange-100">{rule.discountPercent}%</span>
                  </div>
                  <p className="mt-1 text-xs text-stone-400">
                    {rule.productName} / {rule.requiredLockIFR.toLocaleString('en-US')} IFR locked
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            onClick={startSession}
            disabled={!business || !sellerWalletReady || loading}
            className="mt-6 w-full rounded-2xl bg-orange-300 px-5 py-4 text-sm font-black uppercase tracking-[0.16em] text-stone-950 shadow-xl shadow-orange-950/40 transition hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Working...' : session ? 'Create new QR session' : 'Create QR session'}
          </button>
          {error ? <p className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-stone-100 p-6 text-stone-950 shadow-2xl shadow-black/30">
          {session && (customerUrl || customerPresented) ? (
            <div className="grid gap-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-500">Customer confirmation</p>
                  <h2 className="mt-1 text-2xl font-black">{customerPresented ? 'Waiting on customer device' : 'Scan to verify'}</h2>
                </div>
                {status ? <StatusBadge status={status.status} /> : <StatusBadge status="PENDING" />}
              </div>

              {customerUrl ? <div className="grid gap-2 rounded-2xl border border-orange-200/40 bg-orange-50 p-4 text-sm">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#9f351b]">Customer link</p>
                <p className="break-all font-mono text-xs text-stone-600">{customerUrl}</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={copyCustomerUrl}
                    className="rounded-xl border border-orange-300/50 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-[#9f351b] transition hover:bg-orange-100"
                  >
                    Copy link
                  </button>
                  <button
                    type="button"
                    onClick={shareCustomerUrl}
                    className="rounded-xl border border-orange-300/50 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-[#9f351b] transition hover:bg-orange-100"
                  >
                    Share
                  </button>
                  <a
                    href={customerUrl}
                    target="_blank"
                    rel="noopener"
                    className="rounded-xl border border-orange-300/50 px-3 py-2 text-center text-xs font-black uppercase tracking-[0.12em] text-[#9f351b] transition hover:bg-orange-100"
                  >
                    Open
                  </a>
                </div>
                {linkStatus ? <p className="text-xs font-semibold text-stone-600">{linkStatus}</p> : null}
              </div> : (
                <div className="rounded-2xl border border-green-300/30 bg-green-50 p-4 text-sm leading-6 text-green-950">
                  The customer QR is already bound to this selected rule. No customer session link is exposed here.
                  Ask the customer to review and confirm the offer on the device that created the pass.
                </div>
              )}

              {status?.status === 'APPROVED' ? (
                <div className="rounded-3xl border border-green-300/40 bg-green-50 p-6 text-center">
                  <p className="text-5xl">✓</p>
                  <h3 className="mt-3 text-3xl font-black text-green-800">Approved</h3>
                  <p className="mt-2 text-sm text-green-900">Customer wallet verified privately.</p>
                  <p className="mt-4 text-2xl font-black">{status.benefit.discountPercent}% benefit</p>
                  <p className="mt-2 text-sm font-semibold text-green-900">
                    Redeem now to reserve this use before granting the benefit.
                  </p>
                  {status.benefit.productName ? (
                    <p className="mt-2 text-sm font-semibold text-green-900">
                      {status.benefit.label} / {status.benefit.productName}
                    </p>
                  ) : null}
                </div>
              ) : isDone ? (
                <div className="rounded-3xl border border-stone-200 bg-white p-6 text-center">
                  <h3 className="text-3xl font-black">{status.status}</h3>
                  <p className="mt-2 text-sm leading-6 text-stone-500">
                    {status.reason || 'Create a new session for the next customer.'}
                  </p>
                </div>
              ) : customerPresented ? (
                <div className="grid min-h-[15rem] place-items-center rounded-3xl border border-green-200 bg-green-50 p-6 text-center">
                  <div>
                    <p className="text-4xl text-green-800">✓</p>
                    <h3 className="mt-3 text-2xl font-black text-green-900">Rule bound securely</h3>
                    <p className="mt-2 max-w-sm text-sm leading-6 text-green-900">Waiting for the original customer wallet to approve this seller and offer.</p>
                  </div>
                </div>
              ) : (
                <div className="grid place-items-center rounded-3xl bg-white p-6">
                  <QRCode value={customerUrl} size={240} />
                </div>
              )}

              <div className="grid gap-2 rounded-2xl border border-stone-200 bg-white p-4 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-stone-500">Expires in</span>
                  <strong><Countdown expiresAt={session.expiresAt} /></strong>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-stone-500">Benefit</span>
                  <strong>{session.discountPercent}% / {session.requiredLockIFR.toLocaleString('en-US')} IFR</strong>
                </div>
                {session.productName ? (
                  <div className="flex justify-between gap-4">
                    <span className="text-stone-500">Rule</span>
                    <strong className="text-right">{session.label} / {session.productName}</strong>
                  </div>
                ) : null}
                {customerUrl ? <div className="break-all text-xs text-stone-500">{customerUrl}</div> : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={redeem}
                  disabled={loading || status?.status !== 'APPROVED' || !address}
                  className="rounded-2xl bg-stone-950 px-5 py-4 text-sm font-black uppercase tracking-[0.16em] text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Redeem approved benefit
                </button>
                <button
                  type="button"
                  onClick={startSession}
                  disabled={loading || !sellerWalletReady}
                  className="rounded-2xl border border-stone-300 px-5 py-4 text-sm font-black uppercase tracking-[0.16em] text-stone-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  New verification
                </button>
              </div>
            </div>
          ) : (
            <div className="grid min-h-[28rem] place-items-center text-center">
              <div>
                <p className="text-5xl">QR</p>
                <h2 className="mt-4 text-2xl font-black">No active session</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-stone-500">
                  Create a session to show a customer QR code here.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>
    </AppShell>
  );
}
