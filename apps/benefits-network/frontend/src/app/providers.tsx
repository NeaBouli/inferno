'use client';

import { ReactNode, useEffect } from 'react';
import { WagmiProvider } from 'wagmi';
import { reconnect, watchConnectors } from 'wagmi/actions';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from '@/lib/wagmi';
import { startInjectedSessionRestoration } from '@/lib/injectedSessionRestoration.mjs';

const queryClient = new QueryClient();

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => startInjectedSessionRestoration(wagmiConfig, {
    reconnect, watchConnectors, browser: window,
  }), []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
