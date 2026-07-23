import { useEffect, useState } from 'react';
import { listAvailableWalletConnectors } from '@/lib/walletConnectorSelection.mjs';

type WalletConnectorCandidate = {
  id: string;
  name: string;
  type?: string;
  getProvider?: () => Promise<unknown>;
};

export function useAvailableWalletConnectors<T extends WalletConnectorCandidate>(connectors: readonly T[]) {
  const [availableConnectors, setAvailableConnectors] = useState<T[]>([]);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let active = true;
    setAvailableConnectors([]);
    setResolved(false);
    listAvailableWalletConnectors(connectors).then((nextConnectors) => {
      if (!active) return;
      setAvailableConnectors(nextConnectors as T[]);
      setResolved(true);
    });
    return () => { active = false; };
  }, [connectors]);

  return { availableConnectors, resolved };
}
