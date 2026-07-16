'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi';
import {
  AdminBusinessCreated,
  BenefitRule,
  BenefitRuleInput,
  SellerAuth,
  SellerBusinessSummary,
  SellerSessionSummary,
  createAdminBusiness,
  createAdminBusinessRule,
  createSellerBusiness,
  createSellerBusinessRule,
  deleteAdminBusinessRule,
  deleteSellerBusiness,
  deleteSellerBusinessRule,
  getAdminBusinessRules,
  getSellerAuthMessage,
  getSellerBusinesses,
  getSellerBusinessRules,
  getSellerBusinessSessions,
  updateAdminBusinessRule,
  updateSellerBusinessRule,
} from '@/lib/api';

const categories = ['Coffee', 'Retail', 'Digital access', 'Events', 'Services'];
const LAST_BUSINESS_STORAGE_KEY = 'ifr.shop.lastSellerBusinessId';

export function SellerRuleBuilder() {
  const { address, isConnected } = useAccount();
  const { connectors, connectAsync, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const [businessId, setBusinessId] = useState('');
  const [adminSecret, setAdminSecret] = useState('');
  const [businessName, setBusinessName] = useState('IFR Partner Shop');
  const [defaultTier, setDefaultTier] = useState('IFR Access');
  const [category, setCategory] = useState(categories[0]);
  const [product, setProduct] = useState('Premium customer discount');
  const [label, setLabel] = useState('Bronze');
  const [discount, setDiscount] = useState(10);
  const [minLocked, setMinLocked] = useState(1000);
  const [ttl, setTtl] = useState(90);
  const [rules, setRules] = useState<BenefitRule[]>([]);
  const [sessions, setSessions] = useState<SellerSessionSummary[]>([]);
  const [sellerBusinesses, setSellerBusinesses] = useState<SellerBusinessSummary[]>([]);
  const [createdBusiness, setCreatedBusiness] = useState<AdminBusinessCreated | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const scannerUrl = businessId ? `https://shop.ifrunit.tech/b/${businessId}` : '';
  const canUseWalletOwner = Boolean(address && isConnected);
  const canUseOperatorFallback = Boolean(adminSecret);
  const canManage = canUseWalletOwner || canUseOperatorFallback;
  const checkoutKitText = useMemo(
    () => [
      `${businessName || 'IFR Partner Shop'} IFR checkout kit`,
      `Scanner: ${scannerUrl || 'Create or select a seller profile first.'}`,
      `Default benefit: ${discount}% off when ${minLocked.toLocaleString('en-US')} IFR is locked`,
      `Rule draft: ${label || 'IFR Benefit'} / ${category} / ${product || 'IFR Benefit'}`,
      'At checkout: open scanner, create QR session, let the customer scan and sign, then redeem only after APPROVED.',
    ].join('\n'),
    [businessName, category, discount, label, minLocked, product, scannerUrl]
  );

  useEffect(() => {
    try {
      const lastBusinessId = window.localStorage.getItem(LAST_BUSINESS_STORAGE_KEY);
      if (lastBusinessId) setBusinessId(lastBusinessId);
    } catch {
      // Local storage can be unavailable in private modes; the manual field still works.
    }
  }, []);

  useEffect(() => {
    if (!businessId) return;
    try {
      window.localStorage.setItem(LAST_BUSINESS_STORAGE_KEY, businessId);
    } catch {
      // Ignore storage failures; this is only a convenience cache.
    }
  }, [businessId]);

  const payload: BenefitRuleInput = useMemo(
    () => ({
      label: label || 'IFR Benefit',
      category,
      productName: product || 'IFR Benefit',
      discountPercent: discount,
      requiredLockIFR: minLocked,
      ttlSeconds: ttl,
      active: true,
    }),
    [category, discount, label, minLocked, product, ttl]
  );

  async function createBusiness() {
    if (!canManage) {
      setError('Connect a seller wallet or use the operator admin fallback.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const input = {
        name: businessName || 'IFR Partner Shop',
        discountPercent: discount,
        requiredLockIFR: minLocked,
        ttlSeconds: ttl,
        tierLabel: defaultTier || undefined,
      };
      const business = canUseWalletOwner
        ? await createSellerBusiness(await signSellerAction('business:create', 'new'), input)
        : await createAdminBusiness(adminSecret, input);
      setCreatedBusiness(business);
      setBusinessId(business.id);
      setRules([]);
      setSessions([]);
      setSellerBusinesses((current) => [
        {
          id: business.id,
          ownerAddress: business.ownerAddress,
          verifyUrl: business.verifyUrl,
          qrUrl: business.qrUrl,
          name: input.name,
          discountPercent: input.discountPercent,
          requiredLockIFR: input.requiredLockIFR,
          tierLabel: input.tierLabel || null,
          createdAt: new Date().toISOString(),
          rulesCount: 0,
        },
        ...current.filter((item) => item.id !== business.id),
      ]);
      setStatus(canUseWalletOwner
        ? 'Seller profile created and bound to your wallet. Business ID and scanner link are ready.'
        : 'Operator-created seller profile is ready. Business ID and scanner link are ready.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create seller profile');
    } finally {
      setLoading(false);
    }
  }

  async function loadRules() {
    if (!businessId || !canManage) {
      setError('Business ID plus seller wallet or admin secret are required.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const result = canUseWalletOwner
        ? await getSellerBusinessRules(businessId, await signSellerAction('rules:list', businessId))
        : await getAdminBusinessRules(businessId, adminSecret);
      setRules(result.rules);
      setStatus(`Loaded ${result.rules.length} rule${result.rules.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rules');
    } finally {
      setLoading(false);
    }
  }

  async function loadSessions() {
    if (!businessId || !canUseWalletOwner) {
      setError('Business ID plus seller wallet are required to load session history.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const result = await getSellerBusinessSessions(
        businessId,
        await signSellerAction('sessions:list', businessId),
        10
      );
      setSessions(result.sessions);
      setStatus(`Loaded ${result.sessions.length} recent session${result.sessions.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session history');
    } finally {
      setLoading(false);
    }
  }

  async function loadSellerBusinesses() {
    if (!canUseWalletOwner) {
      setError('Connect the seller wallet to load owned seller profiles.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const result = await getSellerBusinesses(await signSellerAction('business:list', 'seller'));
      setSellerBusinesses(result.businesses);
      if (!businessId && result.businesses[0]) {
        setBusinessId(result.businesses[0].id);
        setSessions([]);
      }
      setStatus(`Loaded ${result.businesses.length} seller profile${result.businesses.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load seller profiles');
    } finally {
      setLoading(false);
    }
  }

  async function deactivateSellerBusiness(targetBusinessId: string) {
    if (!canUseWalletOwner) {
      setError('Connect the seller wallet to deactivate a seller profile.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      await deleteSellerBusiness(targetBusinessId, await signSellerAction('business:delete', targetBusinessId));
      setSellerBusinesses((current) => current.filter((item) => item.id !== targetBusinessId));
      if (businessId === targetBusinessId) {
        setBusinessId('');
        setRules([]);
        setSessions([]);
      }
      setStatus('Seller profile deactivated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deactivate seller profile');
    } finally {
      setLoading(false);
    }
  }

  async function saveRule() {
    if (!businessId || !canManage) {
      setError('Business ID plus seller wallet or admin secret are required.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const rule = canUseWalletOwner
        ? await createSellerBusinessRule(businessId, await signSellerAction('rules:create', businessId), payload)
        : await createAdminBusinessRule(businessId, adminSecret, payload);
      setRules((current) => [...current, rule].sort((a, b) => a.requiredLockIFR - b.requiredLockIFR));
      setStatus('Rule saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save rule');
    } finally {
      setLoading(false);
    }
  }

  async function toggleRule(rule: BenefitRule) {
    if (!canManage) {
      setError('Connect the seller wallet or use the operator admin fallback.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const updated = canUseWalletOwner
        ? await updateSellerBusinessRule(rule.id, await signSellerAction('rules:update', rule.businessId), { active: !rule.active })
        : await updateAdminBusinessRule(rule.id, adminSecret, { active: !rule.active });
      setRules((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setStatus(updated.active ? 'Rule activated.' : 'Rule paused.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rule');
    } finally {
      setLoading(false);
    }
  }

  async function deleteRule(ruleId: string) {
    const rule = rules.find((item) => item.id === ruleId);
    if (!canManage || !rule) {
      setError('Connect the seller wallet or use the operator admin fallback.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      if (canUseWalletOwner) {
        await deleteSellerBusinessRule(ruleId, await signSellerAction('rules:delete', rule.businessId));
      } else {
        await deleteAdminBusinessRule(ruleId, adminSecret);
      }
      setRules((current) => current.filter((item) => item.id !== ruleId));
      setStatus('Rule deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete rule');
    } finally {
      setLoading(false);
    }
  }

  async function connectSellerWallet() {
    setError('');
    setStatus('');
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

  async function signSellerAction(action: string, targetBusinessId: string): Promise<SellerAuth> {
    if (!address) throw new Error('Connect the seller wallet first.');
    const challenge = await getSellerAuthMessage(action, targetBusinessId);
    const signature = await signMessageAsync({ message: challenge.message });
    return { walletAddress: address, signature, timestamp: challenge.timestamp };
  }

  async function copyToClipboard(labelText: string, value: string) {
    if (!value) {
      setError(`${labelText} is not ready yet.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setError('');
      setStatus(`${labelText} copied.`);
    } catch {
      setError(`Could not copy ${labelText.toLowerCase()} in this browser.`);
    }
  }

  async function shareScannerLink() {
    if (!scannerUrl) {
      setError('Create or select a seller profile before sharing the scanner link.');
      return;
    }
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${businessName || 'IFR Partner Shop'} IFR scanner`,
          text: 'Open this scanner at checkout to verify locked IFR access.',
          url: scannerUrl,
        });
        setError('');
        setStatus('Scanner link shared.');
        return;
      }
      await copyToClipboard('Scanner link', scannerUrl);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Could not share scanner link.');
    }
  }

  return (
    <section className="rounded-[2rem] border border-orange-200/15 bg-orange-100/[0.06] p-5 shadow-2xl shadow-black/30 backdrop-blur">
      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-200/80">
          Seller mode
        </p>
        <h2 className="mt-1 text-2xl font-black text-white">Benefit rule manager</h2>
        <p className="mt-2 text-sm leading-6 text-stone-300">
          Create a seller profile with a wallet signature, define discount rules, then open the scanner link at checkout. Operator admin fallback remains available for controlled setup.
        </p>
      </div>

      <div className="mb-5 rounded-3xl border border-green-300/20 bg-green-300/[0.07] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-green-100/80">Seller wallet owner</p>
            <h3 className="mt-1 text-xl font-black text-white">
              {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Connect seller wallet'}
            </h3>
            <p className="mt-2 text-sm leading-6 text-stone-300">
              Seller actions are authorized with short-lived wallet signatures. No customer tokens are moved, no private key is stored, and public profile creation is rate-limited.
            </p>
          </div>
          {address ? (
            <button
              type="button"
              onClick={() => disconnect()}
              className="rounded-2xl border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-stone-100 hover:border-green-200/60"
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={connectSellerWallet}
              disabled={connecting}
              className="rounded-2xl bg-green-300 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-green-950/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {connecting ? 'Connecting...' : 'Connect wallet'}
            </button>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={loadSellerBusinesses}
            disabled={loading || !canUseWalletOwner}
            className="rounded-2xl border border-green-200/40 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-green-50 transition hover:bg-green-200/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Load my seller profiles
          </button>
          {businessId ? (
            <a
              href={scannerUrl}
              className="rounded-2xl border border-white/15 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-green-200/60"
            >
              Open scanner
            </a>
          ) : null}
        </div>
        {sellerBusinesses.length > 0 ? (
          <div className="mt-4 grid gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-green-100/70">My seller profiles</p>
            {sellerBusinesses.map((business) => (
              <div
                key={business.id}
                className={`rounded-2xl border p-3 text-left transition ${
                  business.id === businessId
                    ? 'border-green-200/60 bg-green-200/15'
                    : 'border-white/10 bg-black/20 hover:border-green-200/40'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setBusinessId(business.id);
                    setRules([]);
                    setSessions([]);
                    setStatus(`${business.name} selected. Load rules when you need the current list.`);
                  }}
                  className="block w-full text-left"
                >
                  <span className="block text-sm font-black text-white">{business.name}</span>
                  <span className="mt-1 block text-xs leading-5 text-stone-300">
                    {business.rulesCount} rule{business.rulesCount === 1 ? '' : 's'} / {business.discountPercent}% default / {business.requiredLockIFR.toLocaleString('en-US')} IFR
                  </span>
                  <span className="mt-1 block break-all font-mono text-[11px] text-stone-500">{business.id}</span>
                </button>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBusinessId(business.id);
                      setRules([]);
                      setSessions([]);
                      setStatus(`${business.name} selected. Load rules when you need the current list.`);
                    }}
                    className="rounded-xl border border-green-200/30 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-green-50 transition hover:bg-green-200/10"
                  >
                    Select
                  </button>
                  <button
                    type="button"
                    onClick={() => deactivateSellerBusiness(business.id)}
                    disabled={loading}
                    className="rounded-xl border border-red-200/30 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-red-100 transition hover:bg-red-200/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Deactivate
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mb-5 rounded-3xl border border-white/10 bg-black/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">Seller onboarding</p>
            <h3 className="mt-1 text-xl font-black text-white">Create a seller profile</h3>
            <p className="mt-2 text-sm leading-6 text-stone-300">
              Preferred path: connect the seller wallet and sign. Admin secret is only the operator fallback.
            </p>
          </div>
          {createdBusiness ? (
            <span className="rounded-full bg-green-400/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-green-100">
              Created
            </span>
          ) : null}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="grid gap-2 text-sm font-semibold text-stone-200">
            Shop or seller name
            <input
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
              className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-stone-200">
            Access tier label
            <input
              value={defaultTier}
              onChange={(event) => setDefaultTier(event.target.value)}
              className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-stone-200">
            Admin secret
            <input
              type="password"
              value={adminSecret}
              onChange={(event) => setAdminSecret(event.target.value)}
              placeholder="Operator fallback only"
              className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={createBusiness}
          disabled={loading || !canManage}
          className="mt-4 w-full rounded-2xl border border-orange-200/40 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-orange-100 transition hover:bg-orange-200/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {canUseWalletOwner ? 'Create wallet-owned seller profile' : 'Create seller profile'}
        </button>
        {businessId ? (
          <div className="mt-4 rounded-2xl border border-orange-200/20 bg-orange-200/10 p-4 text-sm leading-6 text-orange-50">
            <p>
              <strong>Business ID:</strong> <span className="break-all font-mono">{businessId}</span>
            </p>
            <p className="mt-1">
              <strong>Scanner:</strong>{' '}
              <a href={scannerUrl} className="break-all text-orange-100 underline underline-offset-4">
                {scannerUrl}
              </a>
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => copyToClipboard('Business ID', businessId)}
                className="rounded-xl border border-orange-200/30 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-orange-50 transition hover:bg-orange-200/10"
              >
                Copy ID
              </button>
              <button
                type="button"
                onClick={() => copyToClipboard('Scanner link', scannerUrl)}
                className="rounded-xl border border-orange-200/30 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-orange-50 transition hover:bg-orange-200/10"
              >
                Copy link
              </button>
              <button
                type="button"
                onClick={shareScannerLink}
                className="rounded-xl border border-orange-200/30 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-orange-50 transition hover:bg-orange-200/10"
              >
                Share
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {businessId ? (
        <div className="mb-5 rounded-3xl border border-white/10 bg-[#120d09] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">Checkout kit</p>
              <h3 className="mt-1 text-xl font-black text-white">Share with the counter team</h3>
              <p className="mt-2 text-sm leading-6 text-stone-300">
                Keep this with the POS or send it to staff. It contains no secret and points the team to the seller scanner.
              </p>
            </div>
            <button
              type="button"
              onClick={() => copyToClipboard('Checkout kit', checkoutKitText)}
              className="rounded-2xl border border-white/15 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-orange-200/60"
            >
              Copy kit
            </button>
          </div>
          <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/35 p-4 text-xs leading-6 text-orange-50">
            {checkoutKitText}
          </pre>
        </div>
      ) : null}

      {businessId ? (
        <div className="mb-5 rounded-3xl border border-green-300/20 bg-green-300/[0.06] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-green-100/80">Session history</p>
              <h3 className="mt-1 text-xl font-black text-white">Recent customer checks</h3>
              <p className="mt-2 text-sm leading-6 text-stone-300">
                Load the latest QR sessions for this seller profile. This requires the owner wallet signature and shows no private customer data beyond the verified wallet address.
              </p>
            </div>
            <button
              type="button"
              onClick={loadSessions}
              disabled={loading || !canUseWalletOwner}
              className="rounded-2xl border border-green-200/40 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-green-50 transition hover:bg-green-200/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Load sessions
            </button>
          </div>
          {sessions.length > 0 ? (
            <div className="mt-4 grid gap-3">
              {sessions.map((session) => (
                <div key={session.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-white">
                        {session.label || 'Business default'} {session.productName ? `/ ${session.productName}` : ''}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-stone-400">
                        {new Date(session.createdAt).toLocaleString()} / {session.discountPercent}% / {session.requiredLockIFR.toLocaleString('en-US')} IFR
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] ${
                        session.status === 'APPROVED' || session.status === 'REDEEMED'
                          ? 'bg-green-400/15 text-green-100'
                          : session.status === 'REJECTED' || session.status === 'EXPIRED'
                            ? 'bg-red-400/15 text-red-100'
                            : 'bg-orange-300/15 text-orange-100'
                      }`}
                    >
                      {session.status}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs leading-5 text-stone-400">
                    <p className="break-all font-mono">Session: {session.id}</p>
                    {session.recoveredAddress ? <p className="break-all font-mono">Wallet: {session.recoveredAddress}</p> : null}
                    {session.lockAmountRaw ? <p>Locked: {session.lockAmountRaw} IFR</p> : null}
                    {session.reason ? <p className="text-red-100">Reason: {session.reason}</p> : null}
                    {session.redeemedAt ? <p>Redeemed: {new Date(session.redeemedAt).toLocaleString()}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-stone-400">
              No session history loaded yet.
            </p>
          )}
        </div>
      ) : null}

      <div className="mb-5 grid gap-3 md:grid-cols-[1fr_auto]">
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Business ID
          <input
            value={businessId}
            onChange={(event) => setBusinessId(event.target.value)}
            placeholder="cuid..."
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          />
        </label>
        <button
          type="button"
          onClick={loadRules}
          disabled={loading}
          className="self-end rounded-2xl border border-orange-200/40 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-orange-100 transition hover:bg-orange-200/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Load
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Rule label
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Category
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          >
            {categories.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Product or service
          <input
            value={product}
            onChange={(event) => setProduct(event.target.value)}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Discount: {discount}%
          <input
            type="range"
            min="1"
            max="50"
            value={discount}
            onChange={(event) => setDiscount(Number(event.target.value))}
            className="accent-orange-400"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Minimum locked IFR
          <input
            type="number"
            min="1"
            value={minLocked}
            onChange={(event) => setMinLocked(Number(event.target.value))}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          QR session TTL
          <input
            type="number"
            min="10"
            max="3600"
            value={ttl}
            onChange={(event) => setTtl(Number(event.target.value))}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          />
        </label>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
        <p className="text-xs uppercase tracking-[0.14em] text-stone-400">Customer result</p>
        <p className="mt-2 text-xl font-black text-orange-100">
          {discount}% off when {minLocked.toLocaleString('en-US')} IFR is locked
        </p>
        <p className="mt-2 text-sm text-stone-300">{label} / {category} / {product}</p>
      </div>

      <button
          type="button"
          onClick={saveRule}
        disabled={loading || !canManage}
        className="mt-5 w-full rounded-2xl bg-orange-300 px-5 py-4 text-sm font-black uppercase tracking-[0.16em] text-stone-950 shadow-xl shadow-orange-950/40 transition hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? 'Working...' : 'Save rule'}
      </button>

      {status ? <p className="mt-4 rounded-2xl border border-green-300/30 bg-green-500/10 p-3 text-sm text-green-100">{status}</p> : null}
      {error ? <p className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}

      {rules.length > 0 ? (
        <div className="mt-5 grid gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">
            Saved rules
          </p>
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-black text-white">{rule.label}</p>
                  <p className="mt-1 text-sm text-stone-300">
                    {rule.category} / {rule.productName}
                  </p>
                  <p className="mt-2 text-sm text-orange-100">
                    {rule.discountPercent}% off at {rule.requiredLockIFR.toLocaleString('en-US')} locked IFR
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] ${rule.active ? 'bg-green-400/15 text-green-100' : 'bg-stone-500/20 text-stone-300'}`}>
                  {rule.active ? 'Active' : 'Paused'}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => toggleRule(rule)}
                  disabled={loading || !canManage}
                  className="rounded-full border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-stone-100 hover:border-orange-200/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {rule.active ? 'Pause' : 'Activate'}
                </button>
                <button
                  type="button"
                  onClick={() => deleteRule(rule.id)}
                  disabled={loading || !canManage}
                  className="rounded-full border border-red-300/30 px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-red-100 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
