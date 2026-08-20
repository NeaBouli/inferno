'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';

export function useHydratedAccount() {
  const account = useAccount();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  if (hydrated) return account;

  return {
    ...account,
    address: undefined,
    addresses: undefined,
    chain: undefined,
    chainId: undefined,
    connector: undefined,
    isConnected: false,
    isConnecting: false,
    isDisconnected: true,
    isReconnecting: false,
    status: 'disconnected' as const,
  };
}
