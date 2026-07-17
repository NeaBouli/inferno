'use client';

import { useEffect, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import {
  SellerAuth,
  SellerRewardStatus as SellerRewardStatusData,
  applyForSellerRewards,
  getSellerAuthMessage,
  getSellerRewardStatus,
} from '@/lib/api';

function formatIFRBaseUnits(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return '0';
  const padded = value.padStart(10, '0');
  const whole = padded.slice(0, -9).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = padded.slice(-9).replace(/0+$/, '').slice(0, 3);
  return fraction ? `${whole}.${fraction}` : whole;
}

function shortAddress(value: string | null | undefined) {
  return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : 'Not linked';
}

export function SellerRewardStatus({ businessId }: { businessId: string }) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [data, setData] = useState<SellerRewardStatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    setMessage('');
    setError('');
  }, [businessId]);

  async function signAction(action: string): Promise<SellerAuth> {
    if (!address || !isConnected) throw new Error('Connect the seller owner wallet first.');
    const challenge = await getSellerAuthMessage(action, businessId);
    const signature = await signMessageAsync({ message: challenge.message });
    return { walletAddress: address, signature, timestamp: challenge.timestamp };
  }

  async function refresh() {
    if (!businessId) {
      setError('Select a seller profile first.');
      return;
    }
    setLoading(true);
    setMessage('');
    setError('');
    try {
      const result = await getSellerRewardStatus(businessId, await signAction('rewards:read'));
      setData(result);
      setMessage(result.link ? 'Reward status refreshed.' : 'No reward application exists for this seller profile.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load reward status.');
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    if (!businessId) {
      setError('Select a seller profile first.');
      return;
    }
    setLoading(true);
    setMessage('');
    setError('');
    try {
      const result = await applyForSellerRewards(businessId, await signAction('rewards:apply'));
      setData({ link: result.link, onChain: null, onChainError: null, events: [] });
      setMessage('Application recorded. Governance registration and PartnerVault activation are still required.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the reward application.');
    } finally {
      setLoading(false);
    }
  }

  const link = data?.link;
  const onChain = data?.onChain;
  const verified = Boolean(link?.status === 'VERIFIED' && onChain?.verified);

  return (
    <section className="mb-5 border-y border-violet-200/20 bg-violet-200/[0.045] px-1 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4 px-3">
        <div className="max-w-2xl">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-200/80">Verified seller rewards</p>
          <h3 className="mt-1 text-xl font-black text-white">
            {verified ? 'Governance verified' : link ? link.status.replace('_', ' ') : 'Not applied'}
          </h3>
          <p className="mt-2 text-sm leading-6 text-stone-300">
            Rewards are available only after the seller owner is active in BuilderRegistry and the matching PartnerVault partner is active. Applying here never creates a PartnerVault allocation and never moves tokens.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={loading || !businessId || !isConnected}
            className="rounded-xl border border-violet-200/35 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-violet-50 transition hover:bg-violet-200/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Refresh status
          </button>
          {!link || link.status === 'REVOKED' || link.status === 'STALE' ? (
            <button
              type="button"
              onClick={apply}
              disabled={loading || !businessId || !isConnected}
              className="rounded-xl bg-violet-200 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-stone-950 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply for review
            </button>
          ) : null}
        </div>
      </div>

      {link ? (
        <div className="mt-4 grid gap-3 px-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="border-l-2 border-violet-200/40 pl-3">
            <p className="text-[11px] uppercase tracking-[0.13em] text-stone-500">Partner ID</p>
            <p className="mt-1 break-all font-mono text-xs text-stone-200">{link.partnerId || 'Awaiting governance'}</p>
          </div>
          <div className="border-l-2 border-violet-200/40 pl-3">
            <p className="text-[11px] uppercase tracking-[0.13em] text-stone-500">Beneficiary</p>
            <p className="mt-1 text-sm font-bold text-stone-100">{shortAddress(onChain?.beneficiary)}</p>
          </div>
          <div className="border-l-2 border-violet-200/40 pl-3">
            <p className="text-[11px] uppercase tracking-[0.13em] text-stone-500">Reward accrued</p>
            <p className="mt-1 text-sm font-bold text-stone-100">{formatIFRBaseUnits(onChain?.rewardAccruedRaw)} IFR</p>
          </div>
          <div className="border-l-2 border-violet-200/40 pl-3">
            <p className="text-[11px] uppercase tracking-[0.13em] text-stone-500">Claimable now</p>
            <p className="mt-1 text-sm font-bold text-stone-100">{formatIFRBaseUnits(onChain?.claimableRaw)} IFR</p>
          </div>
        </div>
      ) : null}

      {onChain ? (
        <div className="mt-4 flex flex-wrap gap-2 px-3 text-xs font-bold">
          <span className={onChain.builderActive ? 'text-green-200' : 'text-stone-400'}>BuilderRegistry {onChain.builderActive ? 'active' : 'not active'}</span>
          <span className={onChain.partnerActive ? 'text-green-200' : 'text-stone-400'}>PartnerVault {onChain.partnerActive ? 'active' : 'not active'}</span>
          <span className={onChain.submissionReady ? 'text-green-200' : 'text-amber-200'}>
            Submission {onChain.submissionReady ? 'authorized' : 'not authorized'}
          </span>
          <span className="text-stone-500">Block {onChain.blockNumber.toLocaleString('en-US')}</span>
        </div>
      ) : null}
      {data?.onChainError ? <p className="mt-3 px-3 text-sm text-amber-200">{data.onChainError}</p> : null}
      {link?.reason ? <p className="mt-3 px-3 text-sm text-stone-300">{link.reason}</p> : null}
      {data?.events.length ? (
        <p className="mt-3 px-3 text-xs text-stone-400">
          {data.events.length} local reward event{data.events.length === 1 ? '' : 's'} recorded. PENDING or READY does not mean submitted or paid.
        </p>
      ) : null}
      {message ? <p className="mt-3 px-3 text-sm text-green-200">{message}</p> : null}
      {error ? <p className="mt-3 px-3 text-sm text-red-200">{error}</p> : null}
    </section>
  );
}
