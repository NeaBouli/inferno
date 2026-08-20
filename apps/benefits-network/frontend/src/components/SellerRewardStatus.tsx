'use client';

import { useEffect, useState } from 'react';
import { useSignMessage } from 'wagmi';
import { useHydratedAccount } from '@/hooks/useHydratedAccount';
import {
  SellerAuth,
  SellerRewardStatus as SellerRewardStatusData,
  SellerRewardWalletProof,
  applyForSellerRewards,
  confirmSellerRewardWallet,
  disableSellerRewards,
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

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function SellerRewardStatus({ businessId, ownerAddress }: { businessId: string; ownerAddress: string | null }) {
  const { address, isConnected } = useHydratedAccount();
  const { signMessageAsync } = useSignMessage();
  const [data, setData] = useState<SellerRewardStatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [rewardWalletInput, setRewardWalletInput] = useState('');
  const [walletProof, setWalletProof] = useState<(SellerRewardWalletProof & { rewardWallet: string }) | null>(null);

  useEffect(() => {
    setData(null);
    setMessage('');
    setError('');
    setRewardWalletInput('');
    setWalletProof(null);
  }, [businessId]);

  async function signAction(action: string, scope?: string): Promise<SellerAuth> {
    if (!address || !isConnected) throw new Error('Connect the seller owner wallet first.');
    const mutating = action !== 'rewards:read';
    const challenge = await getSellerAuthMessage(
      action,
      businessId,
      mutating ? { walletAddress: address, scope: scope ?? businessId } : undefined
    );
    if (mutating && !challenge.nonce) throw new Error('Seller authorization challenge is incomplete');
    const signature = await signMessageAsync({ message: challenge.message });
    return {
      walletAddress: address,
      signature,
      timestamp: challenge.timestamp,
      nonce: challenge.nonce,
    };
  }

  function requireOwnerWallet() {
    const ownerWallet = ownerAddress;
    if (ownerWallet && address?.toLowerCase() !== ownerWallet.toLowerCase()) {
      throw new Error(`Switch the connected account back to the seller owner wallet ${shortAddress(ownerWallet)}.`);
    }
  }

  async function run(action: () => Promise<void>) {
    if (!businessId) {
      setError('Select a seller profile first.');
      return;
    }
    setLoading(true);
    setMessage('');
    setError('');
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The reward action failed.');
    } finally {
      setLoading(false);
    }
  }

  function refresh() {
    return run(async () => {
      const result = await getSellerRewardStatus(businessId, await signAction('rewards:read'));
      setData(result);
      setMessage(result.link ? 'Reward status refreshed.' : 'No reward application exists for this seller profile.');
    });
  }

  function apply() {
    return run(async () => {
      const result = await applyForSellerRewards(businessId, await signAction('rewards:apply'));
      setData({ link: result.link, onChain: null, onChainError: null, eventCount: 0 });
      setMessage('Application recorded. Governance registration and PartnerVault activation are still required.');
    });
  }

  function disable() {
    return run(async () => {
      requireOwnerWallet();
      const result = await disableSellerRewards(businessId, await signAction('rewards:disable'));
      setData((current) => ({ link: result.link, onChain: null, onChainError: null, eventCount: current?.eventCount ?? 0 }));
      setMessage('Rewards disabled. No new reward events are created and none progress until you re-apply and governance re-verifies.');
    });
  }

  function prepareWalletProof() {
    return run(async () => {
      const rewardWallet = rewardWalletInput.trim();
      if (!EVM_ADDRESS_PATTERN.test(rewardWallet)) throw new Error('Enter a valid 0x reward wallet address.');
      if (ownerAddress && rewardWallet.toLowerCase() === ownerAddress.toLowerCase()) {
        throw new Error('The reward wallet must differ from the owner wallet; clear it instead to pay the owner wallet.');
      }
      if (!address || !isConnected) throw new Error('Connect the reward wallet first.');
      if (address.toLowerCase() !== rewardWallet.toLowerCase()) {
        throw new Error(`Switch the connected wallet to ${rewardWallet} and retry: only the reward wallet itself can sign its proof.`);
      }
      const challenge = await getSellerAuthMessage('rewards:reward-wallet', businessId, {
        walletAddress: address,
        scope: rewardWallet.toLowerCase(),
      });
      if (!challenge.nonce) throw new Error('Seller authorization challenge is incomplete');
      const signature = await signMessageAsync({ message: challenge.message });
      setWalletProof({ rewardWallet, signature, timestamp: challenge.timestamp, nonce: challenge.nonce });
      setMessage('Reward wallet proof signed. Switch back to the owner wallet and confirm within ten minutes.');
    });
  }

  function confirmWallet() {
    return run(async () => {
      const rewardWallet = rewardWalletInput.trim();
      if (!EVM_ADDRESS_PATTERN.test(rewardWallet)) throw new Error('Enter a valid 0x reward wallet address.');
      if (!walletProof || walletProof.rewardWallet.toLowerCase() !== rewardWallet.toLowerCase()) {
        throw new Error('Sign the reward wallet proof first.');
      }
      requireOwnerWallet();
      const auth = await signAction('rewards:reward-wallet', rewardWallet.toLowerCase());
      const result = await confirmSellerRewardWallet(businessId, auth, {
        rewardWallet,
        proof: { signature: walletProof.signature, timestamp: walletProof.timestamp, nonce: walletProof.nonce },
      });
      setWalletProof(null);
      setRewardWalletInput('');
      setData((current) => ({ link: result.link, onChain: null, onChainError: null, eventCount: current?.eventCount ?? 0 }));
      setMessage('Reward wallet confirmed. Governance must re-verify the PartnerVault beneficiary before rewards resume.');
    });
  }

  function clearWallet() {
    return run(async () => {
      requireOwnerWallet();
      const auth = await signAction('rewards:reward-wallet', 'owner-wallet');
      const result = await confirmSellerRewardWallet(businessId, auth, { rewardWallet: null });
      setData((current) => ({ link: result.link, onChain: null, onChainError: null, eventCount: current?.eventCount ?? 0 }));
      setMessage('Separate reward wallet cleared. Payouts fall back to the owner wallet after governance re-verification.');
    });
  }

  const link = data?.link;
  const onChain = data?.onChain;
  const verified = Boolean(link?.status === 'VERIFIED' && onChain?.verified);
  const canApply = !link || link.status === 'REVOKED' || link.status === 'STALE' || link.status === 'DISABLED';

  return (
    <section className="mb-5 border-y border-violet-200/20 bg-violet-200/[0.045] px-1 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4 px-3">
        <div className="max-w-2xl">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-200/80">Verified seller rewards</p>
          <h3 className="mt-1 text-xl font-black text-white">
            {verified ? 'Governance verified' : link ? link.status.replace('_', ' ') : 'Not applied'}
          </h3>
          <p className="mt-2 text-sm leading-6 text-stone-300">
            Creating a seller profile never enables rewards: they stay off until the owner wallet signs a separate
            application here, and only after the seller owner is active in BuilderRegistry and the matching
            PartnerVault partner is active. Applying never creates a PartnerVault allocation and never moves tokens.
            An owner-signed disable stops reward accrual immediately. Sellers that never apply simply run benefits
            with rewards off.
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
          {canApply ? (
            <button
              type="button"
              onClick={apply}
              disabled={loading || !businessId || !isConnected}
              className="rounded-xl bg-violet-200 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-stone-950 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {link?.status === 'DISABLED' ? 'Re-apply for review' : 'Apply for review'}
            </button>
          ) : null}
          {link && link.status !== 'DISABLED' ? (
            <button
              type="button"
              onClick={disable}
              disabled={loading || !businessId || !isConnected}
              className="rounded-xl border border-red-300/40 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-red-100 transition hover:bg-red-300/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Disable rewards
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

      {link ? (
        <div className="mt-4 border-t border-violet-200/15 px-3 pt-4">
          <p className="text-[11px] uppercase tracking-[0.13em] text-stone-500">Separate reward wallet</p>
          <p className="mt-1 text-sm text-stone-200">
            {link.rewardWallet
              ? `Confirmed payout wallet ${shortAddress(link.rewardWallet)}${link.rewardWalletConfirmedAt ? ` on ${new Date(link.rewardWalletConfirmedAt).toLocaleString('en-US')}` : ''}.`
              : 'No separate reward wallet. PartnerVault payouts must go to the seller owner wallet.'}
          </p>
          <p className="mt-2 text-xs leading-5 text-stone-400">
            Optional. Confirming a separate payout wallet (currently a standard EVM account, not a smart-contract
            wallet) requires the
            reward wallet itself to sign a fresh one-time proof plus an owner signature. Changing or clearing the
            wallet pauses rewards until governance re-verifies the PartnerVault beneficiary. The app never asks for
            a seed phrase or private key.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={rewardWalletInput}
              onChange={(event) => {
                setRewardWalletInput(event.target.value);
                setWalletProof(null);
              }}
              placeholder="0x reward wallet address"
              spellCheck={false}
              autoComplete="off"
              className="min-w-64 flex-1 rounded-xl border border-white/15 bg-black/30 px-4 py-3 font-mono text-xs text-stone-100 placeholder:text-stone-500 focus:border-violet-200/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={prepareWalletProof}
              disabled={loading || !businessId || !isConnected || !EVM_ADDRESS_PATTERN.test(rewardWalletInput.trim())}
              className="rounded-xl border border-violet-200/35 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-violet-50 transition hover:bg-violet-200/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              1. Sign as reward wallet
            </button>
            <button
              type="button"
              onClick={confirmWallet}
              disabled={loading || !businessId || !isConnected || !walletProof}
              className="rounded-xl bg-violet-200 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-stone-950 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              2. Confirm as owner
            </button>
            {link.rewardWallet ? (
              <button
                type="button"
                onClick={clearWallet}
                disabled={loading || !businessId || !isConnected}
                className="rounded-xl border border-white/15 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-stone-100 transition hover:border-violet-200/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Pay owner wallet instead
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {onChain ? (
        <div className="mt-4 flex flex-wrap gap-2 px-3 text-xs font-bold">
          <span className={onChain.builderActive ? 'text-green-200' : 'text-stone-400'}>BuilderRegistry {onChain.builderActive ? 'active' : 'not active'}</span>
          <span className={onChain.partnerActive ? 'text-green-200' : 'text-stone-400'}>PartnerVault {onChain.partnerActive ? 'active' : 'not active'}</span>
          <span className={onChain.beneficiaryMatchesRewardWallet ? 'text-green-200' : 'text-amber-200'}>
            Beneficiary {onChain.beneficiaryMatchesRewardWallet ? 'matches payout wallet' : 'mismatch'}
          </span>
          <span className={onChain.submissionReady ? 'text-green-200' : 'text-amber-200'}>
            Submission {onChain.submissionReady ? 'authorized' : 'not authorized'}
          </span>
          <span className="text-stone-500">Block {onChain.blockNumber.toLocaleString('en-US')}</span>
        </div>
      ) : null}
      {data?.onChainError ? <p className="mt-3 px-3 text-sm text-amber-200">{data.onChainError}</p> : null}
      {link?.reason ? <p className="mt-3 px-3 text-sm text-stone-300">{link.reason}</p> : null}
      {data?.eventCount ? (
        <p className="mt-3 px-3 text-xs text-stone-400">
          {data.eventCount} local reward event{data.eventCount === 1 ? '' : 's'} recorded. PENDING or READY does not mean submitted or paid.
        </p>
      ) : null}
      {message ? <p className="mt-3 px-3 text-sm text-green-200">{message}</p> : null}
      {error ? <p className="mt-3 px-3 text-sm text-red-200">{error}</p> : null}
    </section>
  );
}
