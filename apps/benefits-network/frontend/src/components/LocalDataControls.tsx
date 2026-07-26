'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_PREFIX = 'ifr.shop.';
const CACHE_PREFIX = 'ifr-benefits-';

type LocalDataSnapshot = {
  localKeys: string[];
  sessionKeys: string[];
  cacheNames: string[];
  cachesSupported: boolean;
  storageReadable: boolean;
};

function matchingStorageKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && key.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  return keys.sort();
}

async function readSnapshot(): Promise<LocalDataSnapshot> {
  let localKeys: string[] = [];
  let sessionKeys: string[] = [];
  let storageReadable = true;
  try {
    localKeys = matchingStorageKeys(window.localStorage);
    sessionKeys = matchingStorageKeys(window.sessionStorage);
  } catch {
    storageReadable = false;
  }
  const cachesSupported = typeof window.caches !== 'undefined';
  let cacheNames: string[] = [];
  if (cachesSupported) {
    try {
      const names = await window.caches.keys();
      cacheNames = names.filter((name) => name.startsWith(CACHE_PREFIX)).sort();
    } catch {
      cacheNames = [];
    }
  }
  return { localKeys, sessionKeys, cacheNames, cachesSupported, storageReadable };
}

export function LocalDataControls() {
  const [snapshot, setSnapshot] = useState<LocalDataSnapshot | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [status, setStatus] = useState('Reading this browser\'s IFR Benefits data...');
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const clearButtonRef = useRef<HTMLButtonElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const [returnFocus, setReturnFocus] = useState(false);

  const refresh = useCallback(async () => {
    const next = await readSnapshot();
    setSnapshot(next);
    if (!next.storageReadable) {
      setStatus('This browser blocked access to local storage, so keys cannot be listed.');
      return;
    }
    const totalKeys = next.localKeys.length + next.sessionKeys.length;
    setStatus(
      `Found ${totalKeys} ifr.shop.* storage ${totalKeys === 1 ? 'key' : 'keys'} and ${next.cacheNames.length} ifr-benefits-* ${next.cacheNames.length === 1 ? 'cache' : 'caches'} in this browser.`,
    );
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (confirmOpen) confirmButtonRef.current?.focus();
  }, [confirmOpen]);

  useEffect(() => {
    if (!confirmOpen && returnFocus) {
      clearButtonRef.current?.focus();
      setReturnFocus(false);
    }
  }, [confirmOpen, returnFocus]);

  const clearLocalData = useCallback(async () => {
    if (!snapshot) return;
    setClearing(true);
    const currentSnapshot = await readSnapshot();
    let removedKeys = 0;
    let removedCaches = 0;
    let failedItems = 0;
    for (const key of currentSnapshot.localKeys) {
      try {
        window.localStorage.removeItem(key);
        removedKeys += 1;
      } catch {
        failedItems += 1;
      }
    }
    for (const key of currentSnapshot.sessionKeys) {
      try {
        window.sessionStorage.removeItem(key);
        removedKeys += 1;
      } catch {
        failedItems += 1;
      }
    }
    if (currentSnapshot.cachesSupported) {
      for (const name of currentSnapshot.cacheNames) {
        try {
          if (await window.caches.delete(name)) {
            removedCaches += 1;
          } else {
            failedItems += 1;
          }
        } catch {
          failedItems += 1;
        }
      }
    }
    setConfirmOpen(false);
    setClearing(false);
    await refresh();
    setStatus(
      `Cleared ${removedKeys} ifr.shop.* storage ${removedKeys === 1 ? 'key' : 'keys'} and ${removedCaches} ifr-benefits-* ${removedCaches === 1 ? 'cache' : 'caches'} from this browser.${failedItems ? ` ${failedItems} ${failedItems === 1 ? 'item could' : 'items could'} not be cleared.` : ''} Backend records and on-chain data are unchanged. The static app cache can be created again when the app loads assets.`,
    );
    statusRef.current?.focus();
  }, [snapshot, refresh]);

  const totalKeys = snapshot ? snapshot.localKeys.length + snapshot.sessionKeys.length : 0;
  const totalCaches = snapshot ? snapshot.cacheNames.length : 0;
  const nothingToClear = snapshot !== null && totalKeys === 0 && totalCaches === 0;

  return (
    <div className="rounded-[2rem] border border-white/10 bg-black/20 p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <p className="text-3xl font-black text-white">{snapshot ? snapshot.localKeys.length : '-'}</p>
          <p className="mt-1 text-xs font-black uppercase tracking-[0.16em] text-stone-400">localStorage keys</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <p className="text-3xl font-black text-white">{snapshot ? snapshot.sessionKeys.length : '-'}</p>
          <p className="mt-1 text-xs font-black uppercase tracking-[0.16em] text-stone-400">sessionStorage keys</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <p className="text-3xl font-black text-white">{snapshot ? totalCaches : '-'}</p>
          <p className="mt-1 text-xs font-black uppercase tracking-[0.16em] text-stone-400">app shell caches</p>
        </div>
      </div>

      <p ref={statusRef} role="status" aria-live="polite" tabIndex={-1} className="mt-4 text-sm leading-6 text-stone-300">
        {status}
      </p>

      {snapshot && (snapshot.localKeys.length > 0 || snapshot.sessionKeys.length > 0) && (
        <ul className="mt-4 grid gap-2" aria-label="ifr.shop.* keys stored in this browser">
          {snapshot.localKeys.map((key) => (
            <li key={`local-${key}`} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-xs break-all text-stone-300">
              {key} <span className="text-stone-500">(localStorage)</span>
            </li>
          ))}
          {snapshot.sessionKeys.map((key) => (
            <li key={`session-${key}`} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-xs break-all text-stone-300">
              {key} <span className="text-stone-500">(sessionStorage, this tab)</span>
            </li>
          ))}
        </ul>
      )}

      {snapshot && snapshot.cacheNames.length > 0 && (
        <ul className="mt-2 grid gap-2" aria-label="ifr-benefits-* caches stored in this browser">
          {snapshot.cacheNames.map((name) => (
            <li key={`cache-${name}`} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-xs break-all text-stone-300">
              {name} <span className="text-stone-500">(CacheStorage)</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5">
        {!confirmOpen ? (
          <button
            ref={clearButtonRef}
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={!snapshot || nothingToClear}
            aria-expanded={confirmOpen}
            aria-controls="local-data-confirmation"
            className="rounded-full border border-orange-200/40 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-orange-100 transition hover:border-orange-200/80 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear local IFR data
          </button>
        ) : (
          <div
            id="local-data-confirmation"
            role="region"
            aria-labelledby="local-data-confirm-title"
            aria-describedby="local-data-confirm-body"
            className="rounded-2xl border border-orange-200/30 bg-orange-200/[0.06] p-4"
          >
            <p id="local-data-confirm-title" className="text-sm font-black uppercase tracking-[0.16em] text-orange-100">
              Confirm clearing
            </p>
            <p id="local-data-confirm-body" className="mt-2 text-sm leading-6 text-stone-300">
              This removes the {totalKeys} ifr.shop.* {totalKeys === 1 ? 'key' : 'keys'} and {totalCaches} ifr-benefits-* {totalCaches === 1 ? 'cache' : 'caches'} listed above from this browser only. If an active customer pass control token is stored in this tab, the pass can no longer be confirmed or cancelled from here and a new pass must be created. This does not change backend records or on-chain data, does not touch wallet-provider storage or any other site&apos;s data, and does not disconnect your wallet.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                ref={confirmButtonRef}
                type="button"
                onClick={() => void clearLocalData()}
                disabled={clearing}
                className="rounded-full bg-orange-300 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-stone-950 shadow-xl shadow-orange-950/40 transition hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {clearing ? 'Clearing...' : 'Yes, clear local data'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setReturnFocus(true);
                  setConfirmOpen(false);
                }}
                disabled={clearing}
                className="rounded-full border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-stone-100 transition hover:border-orange-200/60 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
