'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import { useAccount, useConfig, useConnectors } from 'wagmi';
import { AppShell } from '@/components/AppShell';
import {
  PROBE_METHODS, isEligibleNativeConnector, isOrdinaryWalletBusy, nativeWalletProbe,
  type ProbeMethod, type ProbeRecord, type ProbeSnapshot,
} from '@/lib/nativeWalletProbe.mjs';

const SERVER_SNAPSHOT: ProbeSnapshot = Object.freeze({
  pending: false, current: null, records: Object.freeze([]),
});

function statusText(record: ProbeRecord | null) {
  switch (record?.state) {
    case 'provider_waiting': return 'Checking the selected browser wallet…';
    case 'request_waiting': return 'Waiting for MetaMask to answer…';
    case 'provider_waiting_long':
    case 'request_waiting_long': return 'Still waiting. The request has not been cancelled. Another check stays unavailable until this one finishes.';
    case 'provider_unavailable': return 'No MetaMask browser provider is available for that selection.';
    case 'not_sent': return 'The selected wallet or page changed. The request was not sent.';
    case 'ordinary_busy': return 'A normal wallet connection is still pending. Finish it before asking for another account permission.';
    case 'answered': return 'The wallet answered. This does not confirm a connection to the shop.';
    case 'error': return 'The wallet returned an error. Only its numeric code, when available, is shown in the technical details.';
    default: return 'Choose your browser wallet, then start one check.';
  }
}

export default function NativeWalletProbe() {
  const connectors = useConnectors();
  const config = useConfig();
  const queryClient = useQueryClient();
  const { status } = useAccount();
  const connectPending = useIsMutating({ mutationKey: ['connect'], exact: true }) > 0;
  const ordinaryBusy = connectPending || status === 'connecting' || status === 'reconnecting';
  const candidates = connectors.filter((candidate) => isEligibleNativeConnector(candidate));
  const [chosen, setChosen] = useState<(typeof connectors)[number]>();
  const selected = chosen && candidates.includes(chosen) ? chosen : undefined;
  const selectionRef = useRef(selected);
  selectionRef.current = selected;
  const ownerRef = useRef({ mounted: false });
  useEffect(() => {
    const owner = { mounted: true };
    ownerRef.current = owner;
    return () => { owner.mounted = false; };
  }, []);
  const snapshot = useSyncExternalStore(
    nativeWalletProbe.subscribe, nativeWalletProbe.getSnapshot, () => SERVER_SNAPSHOT,
  );

  function run(method: ProbeMethod) {
    if (!selected || snapshot.pending) return;
    const owner = ownerRef.current;
    const target = selected;
    void nativeWalletProbe.start({
      method, connector: target,
      isCurrent: () => owner.mounted && ownerRef.current === owner &&
        selectionRef.current === target && isEligibleNativeConnector(target, config.connectors),
      isOrdinaryPending: () => isOrdinaryWalletBusy(queryClient, config),
    });
  }

  return (
    <AppShell>
      <section data-native-wallet-probe className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6">
        <div className="min-w-0 rounded-3xl border border-orange-200/20 bg-white/[0.055] p-5 sm:p-8">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-100">Wallet support</p>
          <h1 className="mt-3 text-3xl font-black leading-tight text-white sm:text-5xl">Check a wallet response</h1>
          <p className="mt-4 text-sm leading-7 text-stone-300">
            Use these separate checks when a wallet connection is not finishing. They do not confirm that
            the shop is connected, and they never ask for a signature or send a transaction.
          </p>
          <p className="mt-3 text-sm leading-7 text-orange-100">
            Stay on this page while a check is waiting. Do not reload or start Connect in another page or tab.
            Leaving this page does not cancel the wallet request.
          </p>

          <label className="mt-6 block text-sm font-bold text-stone-100" htmlFor="native-probe-wallet">Browser wallet</label>
          <select
            id="native-probe-wallet"
            className="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-white/20 bg-stone-950 px-3 py-2 text-sm text-white disabled:opacity-50"
            value={selected ? String(candidates.indexOf(selected)) : ''}
            disabled={snapshot.pending}
            onChange={(event) => setChosen(event.target.value === '' ? undefined : candidates[Number(event.target.value)])}
          >
            <option value="">Choose your browser wallet</option>
            {candidates.map((candidate, index) => (
              <option key={candidate.uid} value={String(index)}>
                {candidate.id === 'injected' ? 'Browser wallet' : 'MetaMask'}{candidates.length > 1 ? ` ${index + 1}` : ''}
              </option>
            ))}
          </select>
          {!candidates.length ? <p className="mt-2 text-sm text-stone-300">Open this page in MetaMask or use its installed browser extension.</p> : null}

          <div className="mt-5 grid gap-3 sm:grid-cols-2" aria-label="Individual wallet checks">
            {PROBE_METHODS.filter(({ interactive }) => !interactive).map(({ method, label }) => (
              <button key={method} type="button" onClick={() => run(method)} disabled={!selected || snapshot.pending}
                className="min-h-11 min-w-0 rounded-xl border border-white/20 px-4 py-3 text-sm font-bold text-stone-100 [overflow-wrap:anywhere] hover:border-orange-200 disabled:cursor-not-allowed disabled:opacity-50">
                {label}
              </button>
            ))}
          </div>

          <div className="mt-6 border-t border-white/10 pt-5">
            <h2 className="text-lg font-bold text-white">Checks that may ask for permission</h2>
            <p className="mt-2 text-sm leading-6 text-stone-300">
              These two buttons can open MetaMask’s normal permission prompt for this shop.
              Approve or reject it in MetaMask. No signature or transaction is requested.
            </p>
            {ordinaryBusy ? <p className="mt-2 text-sm text-orange-100">A normal wallet connection is pending. Only the first three checks are available.</p> : null}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {PROBE_METHODS.filter(({ interactive }) => interactive).map(({ method, label }) => (
                <button key={method} type="button" onClick={() => run(method)} disabled={!selected || snapshot.pending || ordinaryBusy}
                  className="min-h-11 min-w-0 rounded-xl border border-orange-200/30 px-4 py-3 text-sm font-bold text-orange-100 [overflow-wrap:anywhere] hover:border-orange-200 disabled:cursor-not-allowed disabled:opacity-50">
                  {label}
                </button>
              ))}
            </div>
          </div>

          <p role="status" aria-live="polite" className="mt-5 rounded-xl bg-black/20 p-3 text-sm leading-6 text-stone-100">
            {statusText(snapshot.current)}
          </p>
          <p className="mt-3 text-xs leading-5 text-stone-400">
            Only response type, item count, timing and a numeric error code are kept in this page’s memory.
            Account addresses, response contents and error messages are not shown or saved.
            Existing wallet activity may continue independently of these checks.
          </p>
          <details className="mt-4 min-w-0 rounded-xl border border-white/10 p-3 text-xs text-stone-300">
            <summary className="min-h-[44px] cursor-pointer font-bold text-stone-100">Technical details</summary>
            {snapshot.current ? (
              <p className="mt-3 [overflow-wrap:anywhere]">
                Current method: <code>{snapshot.current.method}</code>; state: {snapshot.current.state}; elapsed: {snapshot.current.elapsedMs} ms.
              </p>
            ) : <p className="mt-3">No check has started.</p>}
            {snapshot.records.length ? <p className="mt-3">Most recent finished check for each method:</p> : null}
            <ul className="mt-3 grid gap-3">
              {snapshot.records.map((record) => (
                <li key={record.method} className="min-w-0 [overflow-wrap:anywhere]">
                  <code>{record.method}</code>: {record.state}; start: {Math.round(record.startedMs)} ms after document start;
                  {' '}elapsed: {record.elapsedMs} ms; response type: {record.shape ?? 'none'};
                  {' '}item count: {record.count ?? 'not available'}; numeric error code: {record.errorCode ?? 'not available'}.
                </li>
              ))}
            </ul>
          </details>
        </div>
      </section>
    </AppShell>
  );
}
