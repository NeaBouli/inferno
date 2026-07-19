'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount, useDisconnect, useSignMessage } from 'wagmi';
import { AppShell } from '@/components/AppShell';
import { Countdown } from '@/components/Countdown';
import { StatusBadge } from '@/components/StatusBadge';
import { SwapRiskNotice } from '@/components/SwapRiskNotice';
import { WalletConnectControl } from '@/components/WalletConnectControl';
import { AttestResult, BusinessInfo, SessionStatus, getBusiness, getChallenge, getSessionStatus, submitAttest } from '@/lib/api';
import { redactVerifiedAddress, saveCustomerProofHistoryItem } from '@/lib/customerHistory';

const CLOSED_STATUSES = ['REDEEMED', 'REJECTED', 'EXPIRED'];
const TERMINAL_STATUSES = ['APPROVED', ...CLOSED_STATUSES];
const UNISWAP_IFR_URL = 'https://app.uniswap.org/swap?outputCurrency=0x77e99917Eca8539c62F509ED1193ac36580A6e7B';

export function CustomerSessionClient({ sessionId }: { sessionId: string }) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  const [result, setResult] = useState<AttestResult | null>(null);
  const [error, setError] = useState('');
  const [refreshMessage, setRefreshMessage] = useState('');
  const [receiptStatus, setReceiptStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const sessionLoaded = Boolean(status);
  const currentSessionStatus = status?.status || '';
  const proofApproved = status?.status === 'APPROVED' || result?.status === 'APPROVED';
  const proofRejected = status?.status === 'REJECTED' || result?.status === 'REJECTED';
  const sellerRedeemed = status?.status === 'REDEEMED';
  const canSign = Boolean(isConnected && status && !TERMINAL_STATUSES.includes(status.status));
  const proofStatus = !sessionLoaded
    ? 'Load verification'
    : sellerRedeemed
      ? 'Benefit redeemed'
      : proofApproved
        ? 'Approved - show seller'
        : proofRejected
          ? 'Not eligible'
          : CLOSED_STATUSES.includes(currentSessionStatus)
            ? 'Session closed'
            : !isConnected
              ? 'Connect wallet'
              : 'Sign proof';
  const proofNextStep = !sessionLoaded
    ? 'The app is loading the QR session from the seller.'
    : sellerRedeemed
      ? 'This benefit was already redeemed by the seller. Ask for a new QR code for another checkout.'
      : proofApproved
        ? 'Show this screen to the seller. This page refreshes while they redeem the approved benefit once.'
          : proofRejected
          ? (status?.status === 'PENDING' && result?.attemptsRemaining
            ? `${result.reason || 'This wallet does not meet the current locked IFR requirement.'} Retry after locking more IFR. ${result.attemptsRemaining} verification attempt${result.attemptsRemaining === 1 ? '' : 's'} left.`
            : status?.reason || result?.reason || 'This wallet does not meet the current locked IFR requirement.')
          : CLOSED_STATUSES.includes(currentSessionStatus)
            ? 'Ask the seller for a fresh QR code if you still need verification.'
            : !isConnected
              ? 'Connect the wallet that holds or locks IFR. No tokens move during this check.'
              : 'Sign the one-time challenge. The backend checks IFRLock on-chain and returns the result.';
  const proofReadinessSteps = [
    { label: 'QR session loaded', ready: sessionLoaded },
    { label: 'Wallet connected', ready: isConnected },
    { label: 'One-time proof signed', ready: Boolean(result) || Boolean(status && TERMINAL_STATUSES.includes(status.status)) },
    { label: 'IFR access approved', ready: proofApproved || sellerRedeemed },
    { label: 'Seller redeem complete', ready: sellerRedeemed },
  ];
  const proofReceipt = useMemo(() => {
    if (!status) return '';

    const benefit = status.benefit;
    const verifiedWallet = result?.wallet
      ? redactVerifiedAddress(result.wallet)
      : 'private - reconnecting does not re-identify this proof';

    return [
      'IFR Benefits Network customer proof',
      `Session: ${sessionId}`,
      `Seller: ${business?.name || status.businessId}`,
      `Status: ${status.status}`,
      `Verification attempts: ${status.attestAttempts}/3`,
      `Benefit: ${benefit.discountPercent}%`,
      `Required lock: ${benefit.requiredLockIFR.toLocaleString('en-US')} IFR`,
      `Rule: ${benefit.label || 'Business default'}`,
      `Product: ${benefit.productName || 'Business default benefit'}`,
      `Customer wallet: ${verifiedWallet}`,
      `Expires: ${status.expiresAt}`,
      `Redeemed: ${status.redeemedAt || 'not redeemed'}`,
      'Note: seller redemption still requires the seller scanner and seller wallet signature.',
    ].join('\n');
  }, [business?.name, result?.wallet, sessionId, status]);

  const loadSession = useCallback(async (showMessage = false) => {
    const nextStatus = await getSessionStatus(sessionId);
    setStatus(nextStatus);
    if (business?.id !== nextStatus.businessId) {
      setBusiness(await getBusiness(nextStatus.businessId));
    }
    if (showMessage) setRefreshMessage(`Status refreshed: ${nextStatus.status}`);
    return nextStatus;
  }, [business?.id, sessionId]);

  useEffect(() => {
    loadSession().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load session'));
  }, [loadSession]);

  useEffect(() => {
    if (!status || CLOSED_STATUSES.includes(status.status)) return;
    const timer = window.setInterval(() => {
      loadSession().catch((err) => setError(err instanceof Error ? err.message : 'Failed to refresh session'));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [loadSession, status]);

  useEffect(() => {
    if (!status) return;
    saveCustomerProofHistoryItem({
      sessionId,
      sellerName: business?.name,
      status,
      verifiedWalletAddress: result?.wallet,
    });
  }, [business?.name, result?.wallet, sessionId, status]);

  async function refreshStatus() {
    setError('');
    setRefreshMessage('');
    try {
      await loadSession(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh session');
    }
  }

  async function signAndVerify() {
    setLoading(true);
    setError('');
    try {
      const challenge = await getChallenge(sessionId);
      const signature = await signMessageAsync({ message: challenge.message });
      const nextResult = await submitAttest(sessionId, signature);
      setResult(nextResult);
      await loadSession(true);
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

  async function copyProofReceipt() {
    if (!proofReceipt) {
      setError('Load verification before copying a proof receipt.');
      return;
    }
    try {
      await navigator.clipboard.writeText(proofReceipt);
      setError('');
      setReceiptStatus('Proof receipt copied.');
    } catch {
      setReceiptStatus('');
      setError('Could not copy the proof receipt in this browser.');
    }
  }

  async function shareProofReceipt() {
    if (!proofReceipt) {
      setError('Load verification before sharing a proof receipt.');
      return;
    }
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${business?.name || 'IFR'} customer proof`,
          text: proofReceipt,
        });
        setError('');
        setReceiptStatus('Proof receipt shared.');
        return;
      }
      await copyProofReceipt();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setReceiptStatus('');
      setError(err instanceof Error ? err.message : 'Could not share the proof receipt.');
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

          <div className="mt-5 rounded-2xl border border-orange-200/20 bg-[#1d130c] p-4 shadow-xl shadow-black/20">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-200/80">
                  Proof readiness
                </p>
                <h2 className="mt-1 text-2xl font-black text-white">{proofStatus}</h2>
                <p className="mt-2 text-sm leading-6 text-stone-300">{proofNextStep}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-right">
                <p className="text-xs uppercase tracking-[0.14em] text-stone-500">Customer wallet</p>
                <p className="mt-1 font-mono text-sm font-black text-white">
                  {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not connected'}
                </p>
                <p className="mt-1 text-xs text-stone-400">{status?.status || 'Loading'}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {proofReadinessSteps.map((step) => (
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
          </div>

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
              <div className="flex justify-between gap-4">
                <span>Verification attempts</span>
                <strong className="text-white">{status?.attestAttempts ?? 0}/3</strong>
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

          <div className="mt-5 rounded-2xl border border-green-300/20 bg-[linear-gradient(145deg,rgba(134,239,172,0.08),rgba(255,255,255,0.045)_48%,rgba(249,115,22,0.08))] p-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-green-100/80">
              Customer recovery
            </p>
            <h2 className="mt-1 text-xl font-black text-white">Need more locked IFR?</h2>
            <p className="mt-2 text-sm leading-6 text-stone-300">
              If this wallet is rejected or the seller requires a higher tier, open the shop app with the same wallet, buy IFR if needed, lock access, then retry this QR session while it is still valid. Ask the seller for a fresh QR only after expiry or exhausted attempts.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <a
                href="/#customer-wallet"
                className="rounded-2xl bg-green-300 px-4 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-green-950/25 transition hover:bg-green-200"
              >
                Lock IFR
              </a>
              <a
                href={UNISWAP_IFR_URL}
                target="_blank"
                rel="noopener"
                className="rounded-2xl border border-green-200/35 px-4 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-green-50 transition hover:bg-green-200/10"
              >
                Buy IFR
              </a>
              <a
                href="/guide"
                className="rounded-2xl border border-white/15 px-4 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-green-200/60"
              >
                Open guide
              </a>
            </div>
            <SwapRiskNotice />
          </div>

          {status && ['APPROVED', 'REDEEMED', 'REJECTED', 'EXPIRED'].includes(status.status) && !result ? (
            <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4 text-sm leading-6 text-stone-200">
              <p className="font-bold text-white">Session {status.status.toLowerCase()}</p>
              <p className="text-stone-300">Ask the seller for a fresh QR code if you still need verification.</p>
              {status.reason ? <p className="text-red-200">{status.reason}</p> : null}
            </div>
          ) : null}

          <div className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-4">
            <WalletConnectControl />
          </div>

          <button
            type="button"
            onClick={signAndVerify}
            disabled={!canSign || loading}
            className="mt-6 w-full rounded-2xl bg-orange-300 px-5 py-4 text-sm font-black uppercase tracking-[0.16em] text-stone-950 shadow-xl shadow-orange-950/40 transition hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Verifying...' : proofRejected && canSign ? 'Retry verification' : 'Sign and verify'}
          </button>

          <button
            type="button"
            onClick={refreshStatus}
            disabled={!sessionLoaded || loading}
            className="mt-3 w-full rounded-2xl border border-white/15 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-orange-200/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Refresh status
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

          <div className="mt-5 rounded-2xl border border-orange-200/20 bg-[#20140c] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-200/80">
                  Customer proof receipt
                </p>
                <h2 className="mt-1 text-xl font-black text-white">
                  {status ? `${status.status} evidence` : 'Waiting for verification'}
                </h2>
                <p className="mt-2 text-sm leading-6 text-stone-300">
                  Copy or share a redacted proof summary for the seller counter or support.
                  It never includes private keys, signatures or full wallet inventories.
                </p>
              </div>
              {status ? <StatusBadge status={status.status} /> : null}
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-3">
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs leading-6 text-orange-50">
                {proofReceipt || 'Load verification to generate a customer proof receipt.'}
              </pre>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={copyProofReceipt}
                disabled={!proofReceipt}
                className="rounded-2xl border border-orange-200/35 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-orange-50 transition hover:bg-orange-200/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Copy proof
              </button>
              <button
                type="button"
                onClick={shareProofReceipt}
                disabled={!proofReceipt}
                className="rounded-2xl border border-white/15 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-orange-200/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Share proof
              </button>
            </div>
            {receiptStatus ? <p className="mt-3 text-xs font-semibold text-green-100">{receiptStatus}</p> : null}
          </div>

          {refreshMessage ? <p className="mt-3 text-xs font-semibold text-green-100">{refreshMessage}</p> : null}

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
