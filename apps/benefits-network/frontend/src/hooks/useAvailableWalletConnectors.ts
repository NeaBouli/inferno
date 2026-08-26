import { useEffect, useRef, useState } from 'react';
import { listAvailableWalletConnectors } from '@/lib/walletConnectorSelection.mjs';

type WalletConnectorCandidate = {
  uid?: string;
  id: string;
  name: string;
  type?: string;
  getProvider?: () => Promise<unknown>;
};

export function useAvailableWalletConnectors<T extends WalletConnectorCandidate>(connectors: readonly T[]) {
  const [availableConnectors, setAvailableConnectors] = useState<T[]>([]);
  const [resolved, setResolved] = useState(false);
  const connectorsRef = useRef(connectors);
  connectorsRef.current = connectors;
  const connectorKey = connectors
    .map(({ uid, id, name, type }) => `${uid ?? ''}:${id}:${type ?? ''}:${name}`)
    .join('|');

  useEffect(() => {
    let active = true;
    const connectorSnapshot = connectorsRef.current;
    setAvailableConnectors([]);
    setResolved(false);
    listAvailableWalletConnectors(connectorSnapshot).then((nextConnectors) => {
      if (!active) return;
      setAvailableConnectors(nextConnectors as T[]);
      setResolved(true);
    });
    return () => { active = false; };
  }, [connectorKey]);

  return { availableConnectors, resolved };
}
