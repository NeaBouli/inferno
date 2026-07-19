import type { Config as CDPCoreConfig } from '@coinbase/cdp-core';
import type { Config as CDPReactConfig } from '@coinbase/cdp-react';
import { createCDPEmbeddedWalletConnector } from '@coinbase/cdp-wagmi';
import { QueryClient } from '@tanstack/react-query';
import { http } from 'viem';
import { sepolia } from 'viem/chains';
import { createConfig } from 'wagmi';

const OFFICIAL_ICON_URL = 'https://shop.ifrunit.tech/icons/ifr-token-256-v11.png';

export function createPrototypeConfig(projectId: string) {
  const coreConfig: CDPCoreConfig = {
    projectId,
    disableAnalytics: true,
    ethereum: {
      createOnLogin: 'eoa',
    },
  };

  const reactConfig: CDPReactConfig = {
    ...coreConfig,
    appName: 'IFR Wallet Lab',
    appLogoUrl: OFFICIAL_ICON_URL,
    showCoinbaseFooter: true,
    authMethods: ['email'],
  };

  const embeddedConnector = createCDPEmbeddedWalletConnector({
    cdpConfig: coreConfig,
    providerConfig: {
      chains: [sepolia],
      transports: {
        [sepolia.id]: http(),
      },
      announceProvider: false,
    },
  });

  const wagmiConfig = createConfig({
    chains: [sepolia],
    connectors: [embeddedConnector],
    transports: {
      [sepolia.id]: http(),
    },
  });

  return {
    coreConfig,
    reactConfig,
    wagmiConfig,
    queryClient: new QueryClient(),
  };
}
