import { useEffect, useState } from 'react';
import { useConnectorClient } from 'wagmi';
import { ethers } from 'ethers';

async function clientToSigner(client) {
  const { account, chain, transport } = client;
  const network = {
    chainId: chain.id,
    name: chain.name,
    ensAddress: chain.contracts?.ensRegistry?.address,
  };
  const provider = new ethers.BrowserProvider(transport, network);
  return provider.getSigner(account.address);
}

export function useEthersSigner({ chainId } = {}) {
  const { data: client } = useConnectorClient({ chainId });
  const [signer, setSigner] = useState();

  useEffect(() => {
    let cancelled = false;
    if (!client) {
      setSigner(undefined);
      return;
    }
    clientToSigner(client).then((nextSigner) => {
      if (!cancelled) setSigner(nextSigner);
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  return signer;
}
