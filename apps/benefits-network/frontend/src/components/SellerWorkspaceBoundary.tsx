'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

const RETRY_STORAGE_KEY = 'ifr.shop.sellerWorkspaceRetryAt';
const REFRESH_QUERY_KEY = '_app_refresh';
const RETRY_WINDOW_MS = 60_000;

function reloadSellerWorkspace() {
  const url = new URL(window.location.href);
  url.searchParams.set(REFRESH_QUERY_KEY, String(Date.now()));
  window.location.replace(`${url.pathname}${url.search}${url.hash}`);
}

function isRecoverableLoadError(error: Error) {
  return /chunk|seller workspace download timed out|failed to fetch dynamically imported module/i.test(
    error.message
  );
}

export function markSellerWorkspaceReady() {
  try {
    window.sessionStorage.removeItem(RETRY_STORAGE_KEY);
  } catch {
    // Recovery still works when browser storage is unavailable.
  }

  const url = new URL(window.location.href);
  if (!url.searchParams.has(REFRESH_QUERY_KEY)) return;
  url.searchParams.delete(REFRESH_QUERY_KEY);
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`
  );
}

interface SellerWorkspaceBoundaryProps {
  children: ReactNode;
}

interface SellerWorkspaceBoundaryState {
  error: Error | null;
  refreshing: boolean;
}

export class SellerWorkspaceBoundary extends Component<
  SellerWorkspaceBoundaryProps,
  SellerWorkspaceBoundaryState
> {
  state: SellerWorkspaceBoundaryState = {
    error: null,
    refreshing: false,
  };

  static getDerivedStateFromError(error: Error): SellerWorkspaceBoundaryState {
    return { error, refreshing: false };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    if (!isRecoverableLoadError(error) || !window.navigator.onLine) return;

    let previousRetry = 0;
    try {
      previousRetry = Number(window.sessionStorage.getItem(RETRY_STORAGE_KEY) || 0);
    } catch {
      // A single reload remains safe without a persisted retry marker.
    }

    const now = Date.now();
    if (previousRetry && now - previousRetry < RETRY_WINDOW_MS) return;

    try {
      window.sessionStorage.setItem(RETRY_STORAGE_KEY, String(now));
    } catch {
      // The URL marker prevents an invisible reload loop when storage is unavailable.
      if (new URL(window.location.href).searchParams.has(REFRESH_QUERY_KEY)) return;
    }

    this.setState({ refreshing: true });
    window.setTimeout(reloadSellerWorkspace, 0);
  }

  private retry = () => {
    try {
      window.sessionStorage.removeItem(RETRY_STORAGE_KEY);
    } catch {
      // Reloading remains available without browser storage.
    }
    reloadSellerWorkspace();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <section
        role={this.state.refreshing ? 'status' : 'alert'}
        aria-label="Seller workspace recovery"
        className="min-h-[28rem] rounded-[2rem] border border-orange-200/25 bg-white/[0.07] p-5 shadow-2xl shadow-black/25"
      >
        <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200">
          Seller workspace
        </p>
        <h2 className="mt-2 text-2xl font-black text-white">
          {this.state.refreshing ? 'Refreshing seller tools...' : 'Seller tools need a reload'}
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-stone-200">
          {window.navigator.onLine
            ? 'The seller workspace did not finish downloading. Reload it without losing your selected role.'
            : 'The seller workspace is not available offline yet. Reconnect, then reload the tools.'}
        </p>
        {!this.state.refreshing ? (
          <button
            type="button"
            onClick={this.retry}
            className="mt-6 rounded-full bg-orange-300 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-orange-950/30 transition hover:-translate-y-0.5 hover:bg-orange-200"
          >
            Reload seller tools
          </button>
        ) : (
          <span
            aria-hidden="true"
            className="mt-6 block h-1.5 w-24 animate-pulse rounded-full bg-orange-300 shadow-lg shadow-orange-900/40"
          />
        )}
      </section>
    );
  }
}
