'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi';
import QRCode from 'react-qr-code';
import { AppShell } from '@/components/AppShell';
import { Countdown } from '@/components/Countdown';
import { StatusBadge } from '@/components/StatusBadge';
import {
  BenefitRule,
  BusinessInfo,
  SessionCreated,
  SessionStatus,
  createSession,
  getBusiness,
  getBusinessRules,
  getSellerAuthMessage,
  getSessionStatus,
  redeemSession,
} from '@/lib/api';

export default function BusinessConsole({ params }: { params: { businessId: string } }) {
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
  const [loading, setLoading] = useState(false);
  const isDone = status && ['REDEEMED', 'EXPIRED', 'REJECTED'].includes(status.status);

  useEffect(() => {
    setOrigin(window.location.origin);
    Promise.all([getBusiness(params.businessId), getBusinessRules(params.businessId)])
      .then(([nextBusiness, rulesResult]) => {
        setBusiness(nextBusiness);
        setRules(rulesResult.rules);
        setSelectedRuleId(rulesResult.rules[0]?.id ?? '');
      })
      .catch((err: Error) => setError(err.message));
  }, [params.businessId]);

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
    if (!session || !origin) return '';
    return `${origin}${session.qrUrl}`;
  }, [origin, session]);

  const selectedRule = useMemo(
    () => rules.find((rule) => rule.id === selectedRuleId) ?? null,
    [rules, selectedRuleId]
  );

  const previewBenefit = session ?? selectedRule ?? business;
  const sellerWalletLabel = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not connected';

  async function startSession() {
    setLoading(true);
    setError('');
    try {
      const nextSession = await createSession(params.businessId, selectedRuleId || undefined);
      setSession(nextSession);
      setStatus(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Session failed');
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
    setLoading(true);
    setError('');
    try {
      const challenge = await getSellerAuthMessage('sessions:redeem', session.sessionId);
      const signature = await signMessageAsync({ message: challenge.message });
      await redeemSession(session.sessionId, {
        walletAddress: address,
        signature,
        timestamp: challenge.timestamp,
      });
      setStatus(await getSessionStatus(session.sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Redeem failed');
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

  return (
    <AppShell>
      <section className="mx-auto grid w-full max-w-5xl gap-6 px-5 pb-16 pt-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-6 shadow-2xl shadow-black/30">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-200/80">
            Seller scanner
          </p>
          <h1 className="mt-2 text-4xl font-black text-white">{business?.name || 'Business console'}</h1>
          <p className="mt-4 text-sm leading-6 text-stone-300">
            Start a short-lived verification session. The customer signs the QR challenge;
            the backend checks IFRLock on-chain and this screen updates automatically.
          </p>

          <div className="mt-5 rounded-2xl border border-green-300/20 bg-green-300/[0.07] p-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-green-100/80">
              Seller wallet for redeem
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-sm text-stone-200">{sellerWalletLabel}</p>
              {address ? (
                <button
                  type="button"
                  onClick={() => disconnect()}
                  className="rounded-xl border border-white/15 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-stone-100 transition hover:border-green-200/60"
                >
                  Disconnect
                </button>
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
              Redeem is a seller action. The backend requires a fresh wallet signature from the business owner.
            </p>
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
            disabled={!business || loading}
            className="mt-6 w-full rounded-2xl bg-orange-300 px-5 py-4 text-sm font-black uppercase tracking-[0.16em] text-stone-950 shadow-xl shadow-orange-950/40 transition hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Working...' : session ? 'Create new QR session' : 'Create QR session'}
          </button>
          {error ? <p className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
        </div>

        <div className="rounded-[2rem] border border-white/10 bg-stone-100 p-6 text-stone-950 shadow-2xl shadow-black/30">
          {session && customerUrl ? (
            <div className="grid gap-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-500">Customer QR</p>
                  <h2 className="mt-1 text-2xl font-black">Scan to verify</h2>
                </div>
                {status ? <StatusBadge status={status.status} /> : <StatusBadge status="PENDING" />}
              </div>

              {status?.status === 'APPROVED' ? (
                <div className="rounded-3xl border border-green-300/40 bg-green-50 p-6 text-center">
                  <p className="text-5xl">✓</p>
                  <h3 className="mt-3 text-3xl font-black text-green-800">Approved</h3>
                  <p className="mt-2 text-sm text-green-900">
                    {status.recoveredAddress ? `Wallet ${status.recoveredAddress.slice(0, 6)}...${status.recoveredAddress.slice(-4)} verified.` : 'Wallet verified.'}
                  </p>
                  <p className="mt-4 text-2xl font-black">{status.benefit.discountPercent}% benefit</p>
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
                <div className="break-all text-xs text-stone-500">{customerUrl}</div>
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
                  disabled={loading}
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
