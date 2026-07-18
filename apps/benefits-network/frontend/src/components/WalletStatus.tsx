'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccount, useBalance, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { formatEther, formatUnits, parseUnits } from 'viem';
import { WalletConnectControl } from '@/components/WalletConnectControl';
import { SwapRiskNotice } from '@/components/SwapRiskNotice';
import { CHAIN_ID, IFR_DECIMALS, IFRLOCK_ABI, IFRLOCK_ADDRESS, IFR_TOKEN_ABI, IFR_TOKEN_ADDRESS, formatIFR } from '@/lib/contracts';
import { requestWalletAsset, selectWalletAssetProvider } from '@/lib/walletAssetProvider.mjs';

const MIN_CUSTOMER_LOCK = 1000;
const MIN_CUSTOMER_LOCK_RAW = BigInt(MIN_CUSTOMER_LOCK) * BigInt(10) ** BigInt(IFR_DECIMALS);
const BENEFIT_TIERS = [
  { label: 'Bronze', amount: 1000 },
  { label: 'Silver', amount: 5000 },
  { label: 'Gold', amount: 25000 },
  { label: 'Diamond', amount: 100000 },
];
const UNISWAP_IFR_URL = 'https://app.uniswap.org/swap?outputCurrency=0x77e99917Eca8539c62F509ED1193ac36580A6e7B';
const IFR_ICON_URL = 'https://ifrunit.tech/assets/ifr_icon_256.png';

function walletAssetError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? Number(error.code) : undefined;
  const message = error instanceof Error ? error.message : '';
  if (code === 4001 || /reject|denied|cancel/i.test(message)) return 'Token import cancelled in the wallet.';
  if (code === -32601 || /unsupported|not supported|method not found/i.test(message)) {
    return 'This wallet does not support automatic token import. Use the IFR contract address shown below.';
  }
  return message || 'The wallet could not add IFR automatically.';
}

function shortAddress(address?: string) {
  if (!address) return 'Not connected';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatInputAmount(raw?: bigint) {
  if (!raw) return '0';
  return formatUnits(raw, IFR_DECIMALS);
}

function shortTx(hash?: `0x${string}`) {
  if (!hash) return '';
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

function getTier(lockedRaw?: bigint) {
  if (!lockedRaw) return null;
  return [...BENEFIT_TIERS]
    .reverse()
    .find((tier) => lockedRaw >= BigInt(tier.amount) * BigInt(10) ** BigInt(IFR_DECIMALS)) ?? null;
}

export function WalletStatus() {
  const { address, connector, isConnected } = useAccount();
  const [lockAmount, setLockAmount] = useState('1000');
  const [lockMessage, setLockMessage] = useState('');
  const [lockError, setLockError] = useState('');
  const [assetMessage, setAssetMessage] = useState('');
  const [assetError, setAssetError] = useState('');
  const [assetPromptOpen, setAssetPromptOpen] = useState(false);
  const [pendingHash, setPendingHash] = useState<`0x${string}` | undefined>();
  const [pendingAction, setPendingAction] = useState<'approve' | 'lock' | 'unlock' | ''>('');
  const { writeContractAsync, isPending: walletPromptOpen } = useWriteContract();
  const txReceipt = useWaitForTransactionReceipt({
    hash: pendingHash,
    query: { enabled: Boolean(pendingHash) },
  });
  const ethBalance = useBalance({
    address,
    query: { enabled: Boolean(address) },
  });
  const ifrBalance = useReadContract({
    address: IFR_TOKEN_ADDRESS || undefined,
    abi: IFR_TOKEN_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && IFR_TOKEN_ADDRESS) },
  });
  const lockedBalance = useReadContract({
    address: IFRLOCK_ADDRESS || undefined,
    abi: IFRLOCK_ABI,
    functionName: 'lockedBalance',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && IFRLOCK_ADDRESS) },
  });
  const allowance = useReadContract({
    address: IFR_TOKEN_ADDRESS || undefined,
    abi: IFR_TOKEN_ABI,
    functionName: 'allowance',
    args: address && IFRLOCK_ADDRESS ? [address, IFRLOCK_ADDRESS] : undefined,
    query: { enabled: Boolean(address && IFR_TOKEN_ADDRESS && IFRLOCK_ADDRESS) },
  });
  const lockedRaw = lockedBalance.data as bigint | undefined;
  const allowanceRaw = allowance.data as bigint | undefined;
  const ifrRaw = ifrBalance.data as bigint | undefined;
  const ethRaw = ethBalance.data?.value;
  const amountRaw = useMemo(() => {
    try {
      const normalized = lockAmount.trim().replace(/,/g, '');
      if (!normalized || Number(normalized) <= 0) return BigInt(0);
      return parseUnits(normalized, IFR_DECIMALS);
    } catch {
      return BigInt(0);
    }
  }, [lockAmount]);
  const tier = getTier(lockedRaw);
  const hasCustomerLock = Boolean(lockedRaw && lockedRaw >= MIN_CUSTOMER_LOCK_RAW);
  const hasIFR = Boolean(ifrRaw && ifrRaw > BigInt(0));
  const hasEth = Boolean(ethRaw && ethRaw > BigInt(0));
  const hasContracts = Boolean(IFR_TOKEN_ADDRESS && IFRLOCK_ADDRESS);
  const amountValid = amountRaw > BigInt(0);
  const hasEnoughIFR = Boolean(ifrRaw && ifrRaw >= amountRaw);
  const hasEnoughAllowance = Boolean(allowanceRaw && allowanceRaw >= amountRaw);
  const isWaitingForReceipt = Boolean(pendingHash && txReceipt.isLoading);
  const txBusy = walletPromptOpen || isWaitingForReceipt;
  const enteredAmount = amountValid
    ? Number(formatUnits(amountRaw, IFR_DECIMALS)).toLocaleString('en-US', { maximumFractionDigits: 3 })
    : '0';
  const recommendedAction = !isConnected
    ? {
        label: 'Connect wallet',
        detail: 'Start with the wallet that holds ETH and IFR.',
        disabledReason: '',
      }
    : !hasContracts
      ? {
          label: 'Contracts unavailable',
          detail: 'IFR token or IFRLock address is not configured for this deployment.',
          disabledReason: 'Missing contract configuration.',
        }
      : !amountValid
        ? {
            label: 'Enter IFR amount',
            detail: 'Choose a tier or enter the exact IFR amount you want to lock.',
            disabledReason: 'Enter a positive IFR amount.',
          }
        : !hasEnoughIFR
          ? {
              label: 'Buy IFR',
              detail: `This wallet needs ${enteredAmount} unlocked IFR before it can lock that amount.`,
              disabledReason: '',
            }
          : !hasEnoughAllowance
            ? {
                label: `Approve ${enteredAmount} IFR`,
                detail: 'One approval lets IFRLock move only the amount currently entered.',
                disabledReason: '',
              }
            : {
                label: `Lock ${enteredAmount} IFR`,
                detail: 'Approval is ready. Confirm the IFRLock transaction in your wallet.',
                disabledReason: '',
              };
  const recommendedActionDisabled = txBusy || Boolean(recommendedAction.disabledReason);
  const statusLabel = !isConnected
    ? 'Connect wallet'
    : hasCustomerLock
      ? 'Ready for checkout'
      : hasIFR
        ? 'Lock IFR'
        : 'Get IFR';
  const statusText = !isConnected
    ? 'Connect a wallet to read IFR balance, ETH gas and locked access.'
    : hasCustomerLock
      ? `Eligible for typical ${MIN_CUSTOMER_LOCK.toLocaleString('en-US')} IFR customer rules. Some sellers may require a higher tier.`
      : hasIFR
        ? 'You hold IFR, but it is not locked for access yet. Lock IFR before scanning seller QR codes.'
        : 'No IFR detected in this wallet. Buy IFR first, then lock it for benefits.';
  const checklist = [
    { label: 'Wallet connected', done: isConnected },
    { label: 'ETH for gas', done: hasEth },
    { label: 'IFR in wallet', done: hasIFR || hasCustomerLock },
    { label: `${MIN_CUSTOMER_LOCK.toLocaleString('en-US')}+ IFR locked`, done: hasCustomerLock },
  ];
  const transactionSteps = [
    {
      label: 'Connect',
      detail: 'Use the wallet that holds IFR.',
      done: isConnected,
      active: !isConnected,
    },
    {
      label: 'Approve',
      detail: 'Allow IFRLock to move only the amount you enter.',
      done: hasEnoughAllowance && amountValid,
      active: isConnected && amountValid && hasEnoughIFR && !hasEnoughAllowance,
    },
    {
      label: 'Lock',
      detail: 'Confirm IFRLock.lock(amount) in your wallet.',
      done: Boolean(lockedRaw && lockedRaw >= amountRaw && amountValid),
      active: isConnected && amountValid && hasEnoughIFR && hasEnoughAllowance,
    },
    {
      label: 'Ready',
      detail: 'Use seller QR proofs and redeem benefits once.',
      done: hasCustomerLock,
      active: hasCustomerLock,
    },
  ];

  useEffect(() => {
    if (!pendingHash || !txReceipt.isSuccess) return;
    const completedAction = pendingAction;
    setPendingHash(undefined);
    setPendingAction('');
    setLockError('');
    setLockMessage(
      completedAction === 'approve'
        ? 'Approval confirmed. You can lock IFR now.'
        : completedAction === 'unlock'
          ? 'Unlock confirmed. Wallet status is refreshing.'
          : 'Lock confirmed. Wallet status is refreshing.'
    );
    void allowance.refetch();
    void lockedBalance.refetch();
    void ifrBalance.refetch();
    void ethBalance.refetch();
  }, [allowance, ethBalance, ifrBalance, lockedBalance, pendingAction, pendingHash, txReceipt.isSuccess]);

  useEffect(() => {
    if (!pendingHash || !txReceipt.isError) return;
    setLockError(txReceipt.error?.message || 'Transaction failed.');
    setPendingHash(undefined);
    setPendingAction('');
  }, [pendingHash, txReceipt.error, txReceipt.isError]);

  function setMaxLockAmount() {
    setLockAmount(formatInputAmount(ifrRaw));
  }

  function selectTierAmount(amount: number) {
    setLockAmount(String(amount));
    setLockError('');
    setLockMessage(`Selected ${amount.toLocaleString('en-US')} IFR tier amount.`);
  }

  async function runRecommendedAction() {
    if (!isConnected || !amountValid || !hasContracts) return;
    if (!hasEnoughIFR) {
      window.open(UNISWAP_IFR_URL, '_blank', 'noopener');
      return;
    }
    if (!hasEnoughAllowance) {
      await approveLockAmount();
      return;
    }
    await lockIFR();
  }

  async function approveLockAmount() {
    if (!address || !isConnected) {
      setLockError('Connect your wallet before approving IFR.');
      return;
    }
    if (!hasContracts || !IFR_TOKEN_ADDRESS || !IFRLOCK_ADDRESS) {
      setLockError('IFR token or IFRLock address is not configured.');
      return;
    }
    if (!amountValid) {
      setLockError('Enter a positive IFR amount.');
      return;
    }
    setLockError('');
    setLockMessage('Approve IFRLock in your wallet.');
    try {
      const hash = await writeContractAsync({
        address: IFR_TOKEN_ADDRESS,
        abi: IFR_TOKEN_ABI,
        functionName: 'approve',
        args: [IFRLOCK_ADDRESS, amountRaw],
      });
      setPendingHash(hash);
      setPendingAction('approve');
      setLockMessage(`Approval submitted: ${shortTx(hash)}`);
    } catch (err) {
      setLockError(err instanceof Error ? err.message : 'Approval failed.');
      setLockMessage('');
    }
  }

  async function lockIFR() {
    if (!address || !isConnected) {
      setLockError('Connect your wallet before locking IFR.');
      return;
    }
    if (!hasContracts || !IFRLOCK_ADDRESS) {
      setLockError('IFRLock address is not configured.');
      return;
    }
    if (!amountValid) {
      setLockError('Enter a positive IFR amount.');
      return;
    }
    if (!hasEnoughIFR) {
      setLockError('This wallet does not hold enough unlocked IFR for that lock amount.');
      return;
    }
    if (!hasEnoughAllowance) {
      setLockError('Approve IFRLock first, then lock.');
      return;
    }
    setLockError('');
    setLockMessage('Confirm the IFRLock transaction in your wallet.');
    try {
      const hash = await writeContractAsync({
        address: IFRLOCK_ADDRESS,
        abi: IFRLOCK_ABI,
        functionName: 'lock',
        args: [amountRaw],
      });
      setPendingHash(hash);
      setPendingAction('lock');
      setLockMessage(`Lock submitted: ${shortTx(hash)}`);
    } catch (err) {
      setLockError(err instanceof Error ? err.message : 'Lock failed.');
      setLockMessage('');
    }
  }

  async function unlockAll() {
    if (!address || !isConnected) {
      setLockError('Connect your wallet before unlocking IFR.');
      return;
    }
    if (!hasContracts || !IFRLOCK_ADDRESS) {
      setLockError('IFRLock address is not configured.');
      return;
    }
    if (!lockedRaw || lockedRaw === BigInt(0)) {
      setLockError('No IFRLock balance is available to unlock.');
      return;
    }
    setLockError('');
    setLockMessage('Confirm unlock in your wallet. This unlocks the full simple IFRLock balance.');
    try {
      const hash = await writeContractAsync({
        address: IFRLOCK_ADDRESS,
        abi: IFRLOCK_ABI,
        functionName: 'unlock',
      });
      setPendingHash(hash);
      setPendingAction('unlock');
      setLockMessage(`Unlock submitted: ${shortTx(hash)}`);
    } catch (err) {
      setLockError(err instanceof Error ? err.message : 'Unlock failed.');
      setLockMessage('');
    }
  }

  async function addIFRToWallet() {
    if (!IFR_TOKEN_ADDRESS) {
      setAssetError('IFR token address is not configured for this deployment.');
      return;
    }

    setAssetError('');
    setAssetMessage('');
    setAssetPromptOpen(true);
    try {
      const connectorProvider = connector ? await connector.getProvider() : undefined;
      const injectedProvider = (window as Window & { ethereum?: unknown }).ethereum;
      const provider = selectWalletAssetProvider({
        connectorActive: Boolean(connector),
        connectorProvider,
        injectedProvider,
      });
      if (!provider) {
        setAssetError(
          connector
            ? 'The connected wallet does not expose automatic token import. Use the IFR contract address shown below.'
            : 'Open this page inside a wallet app or browser with an Ethereum wallet, then try again.'
        );
        return;
      }

      const added = await requestWalletAsset({
        provider,
        chainId: CHAIN_ID,
        address: IFR_TOKEN_ADDRESS,
        symbol: 'IFR',
        decimals: IFR_DECIMALS,
        image: IFR_ICON_URL,
      });
      if (added === false) {
        setAssetError('Token import cancelled in the wallet.');
        return;
      }
      setAssetMessage('Wallet accepted the IFR token-import request.');
    } catch (error) {
      setAssetError(walletAssetError(error));
    } finally {
      setAssetPromptOpen(false);
    }
  }

  return (
    <section id="customer-wallet" className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/30 backdrop-blur">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-200/80">
            Customer wallet
          </p>
          <h2 className="mt-1 text-2xl font-black text-white">Access status</h2>
        </div>
        <WalletConnectControl />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-stone-400">Wallet</p>
          <p className="mt-2 text-lg font-bold">{shortAddress(address)}</p>
          <p className="mt-1 text-xs text-stone-400">{isConnected ? 'Connected' : 'Connect to read status'}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-stone-400">IFR balance</p>
          <p className="mt-2 text-lg font-bold">
            {formatIFR(ifrRaw)} IFR
          </p>
          <p className="mt-1 break-words text-xs text-stone-400">
            {IFR_TOKEN_ADDRESS ? 'ERC-20' : 'Set NEXT_PUBLIC_IFR_TOKEN_ADDRESS'}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-stone-400">IFR locked</p>
          <p className="mt-2 text-lg font-bold">{formatIFR(lockedBalance.data as bigint | undefined)} IFR</p>
          <p className="mt-1 text-xs text-stone-400">
            ETH {ethBalance.data ? Number(formatEther(ethBalance.data.value)).toLocaleString('en-US', { maximumFractionDigits: 5 }) : '0'}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-[1.5rem] border border-orange-200/15 bg-[linear-gradient(145deg,rgba(249,115,22,0.14),rgba(255,255,255,0.055)_50%,rgba(20,83,45,0.12))] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-200/80">
              Checkout readiness
            </p>
            <h3 className="mt-1 text-xl font-black text-white">{statusLabel}</h3>
            <p className="mt-2 max-w-xl text-sm leading-6 text-stone-300">{statusText}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-right">
            <p className="text-xs uppercase tracking-[0.14em] text-stone-400">Current tier</p>
            <p className="mt-1 text-lg font-black text-orange-100">{tier?.label || 'None'}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          {checklist.map((item) => (
            <div
              key={item.label}
              className={`rounded-2xl border px-3 py-3 text-sm ${
                item.done
                  ? 'border-green-300/20 bg-green-300/10 text-green-100'
                  : 'border-white/10 bg-black/20 text-stone-300'
              }`}
            >
              <span className="font-black">{item.done ? 'Ready' : 'Needed'}</span>
              <p className="mt-1 text-xs leading-5 opacity-85">{item.label}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="mb-4 rounded-2xl border border-orange-200/15 bg-black/20 p-3">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-200/80">
              Lock transaction path
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              {transactionSteps.map((step, index) => (
                <div
                  key={step.label}
                  className={`rounded-2xl border p-3 text-xs ${
                    step.done
                      ? 'border-green-300/25 bg-green-300/[0.08] text-green-50'
                      : step.active
                        ? 'border-orange-200/40 bg-orange-200/[0.1] text-orange-50'
                        : 'border-white/10 bg-black/20 text-stone-400'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-full border border-current text-[0.65rem] font-black">
                      {step.done ? 'OK' : index + 1}
                    </span>
                    <span className="font-black uppercase tracking-[0.12em]">{step.label}</span>
                  </div>
                  <p className="mt-2 leading-5 opacity-85">{step.detail}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <label className="grid gap-2 text-sm font-semibold text-stone-200">
              IFR amount to lock
              <input
                inputMode="decimal"
                value={lockAmount}
                onChange={(event) => {
                  setLockAmount(event.target.value);
                  setLockError('');
                  setLockMessage('');
                }}
                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
              />
            </label>
            <button
              type="button"
              onClick={setMaxLockAmount}
              disabled={!ifrRaw}
              className="rounded-2xl border border-white/15 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-orange-200/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Use max
            </button>
          </div>
          <div className="mt-3 grid gap-2 text-xs text-stone-400 sm:grid-cols-3">
            <p>Allowance: <span className="text-stone-200">{formatIFR(allowanceRaw)} IFR</span></p>
            <p>Available: <span className="text-stone-200">{formatIFR(ifrRaw)} IFR</span></p>
            <p>Locked: <span className="text-stone-200">{formatIFR(lockedRaw)} IFR</span></p>
          </div>
          <div className="mt-4 rounded-2xl border border-orange-200/20 bg-[linear-gradient(145deg,rgba(251,146,60,0.18),rgba(0,0,0,0.22))] p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-200/80">
              Recommended next step
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <h4 className="text-xl font-black text-white">{recommendedAction.label}</h4>
                <p className="mt-1 text-sm leading-6 text-stone-300">{recommendedAction.detail}</p>
                {!hasEnoughIFR && amountValid && isConnected ? (
                  <p className="mt-2 text-xs font-semibold text-orange-100">Not enough unlocked IFR for this amount.</p>
                ) : recommendedAction.disabledReason ? (
                  <p className="mt-2 text-xs font-semibold text-orange-100">{recommendedAction.disabledReason}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={runRecommendedAction}
                disabled={recommendedActionDisabled || !isConnected}
                className="rounded-2xl bg-orange-300 px-5 py-4 text-xs font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-orange-950/25 transition hover:-translate-y-0.5 hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {txBusy ? 'Waiting...' : recommendedAction.label}
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={approveLockAmount}
              disabled={!isConnected || !amountValid || txBusy}
              className="rounded-2xl border border-orange-200/35 px-4 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-orange-50 transition hover:bg-orange-200/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={lockIFR}
              disabled={!isConnected || !amountValid || !hasEnoughIFR || !hasEnoughAllowance || txBusy}
              className="rounded-2xl bg-orange-300 px-4 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-orange-950/25 transition hover:-translate-y-0.5 hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Lock IFR
            </button>
            <button
              type="button"
              onClick={unlockAll}
              disabled={!isConnected || !lockedRaw || lockedRaw === BigInt(0) || txBusy}
              className="rounded-2xl border border-white/15 px-4 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-orange-200/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Unlock all
            </button>
          </div>
          {lockMessage ? <p className="mt-3 text-xs font-semibold text-green-100">{lockMessage}</p> : null}
          {lockError ? <p className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-100">{lockError}</p> : null}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <a
            href={UNISWAP_IFR_URL}
            target="_blank"
            rel="noopener"
            className="rounded-2xl border border-white/15 px-4 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-orange-200/60"
          >
            Buy IFR
          </a>
          <button
            type="button"
            data-wallet-action="watch-ifr"
            onClick={addIFRToWallet}
            disabled={assetPromptOpen || !IFR_TOKEN_ADDRESS}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-orange-200/35 px-4 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-orange-50 transition hover:bg-orange-200/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <img src="/icons/ifr-official-64-v5.png" alt="" aria-hidden="true" width="22" height="22" />
            {assetPromptOpen ? 'Open wallet...' : 'Add IFR to wallet'}
          </button>
        </div>
        <SwapRiskNotice />
        <p className="mt-2 break-all text-xs leading-5 text-stone-400">
          IFR on {CHAIN_ID === 1 ? 'Ethereum Mainnet' : `chain ${CHAIN_ID}`}: {IFR_TOKEN_ADDRESS || 'Not configured'}
        </p>
        {assetMessage ? <p role="status" className="mt-2 text-xs font-semibold text-green-100">{assetMessage}</p> : null}
        {assetError ? <p role="alert" className="mt-2 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-xs text-red-100">{assetError}</p> : null}

        <div className="mt-4">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-stone-400">
            Quick tier amounts
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
          {BENEFIT_TIERS.map((item) => {
            const active = Boolean(lockedRaw && lockedRaw >= BigInt(item.amount) * BigInt(10) ** BigInt(IFR_DECIMALS));
            return (
              <button
                type="button"
                key={item.label}
                onClick={() => selectTierAmount(item.amount)}
                className={`rounded-full border px-3 py-2 text-xs font-bold ${
                  active
                    ? 'border-green-300/25 bg-green-300/10 text-green-100'
                    : 'border-white/10 bg-black/20 text-stone-300 transition hover:border-orange-200/60 hover:text-orange-50'
                }`}
              >
                {item.label} / {item.amount.toLocaleString('en-US')} IFR
              </button>
            );
          })}
          </div>
        </div>
      </div>
    </section>
  );
}
