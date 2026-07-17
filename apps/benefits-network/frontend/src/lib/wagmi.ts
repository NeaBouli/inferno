import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { createConfig, http } from 'wagmi';
import { sepolia, mainnet } from 'wagmi/chains';
import { coinbaseWallet, injected, metaMask } from 'wagmi/connectors';

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 1);
const chains = chainId === 1 ? [mainnet] as const : [sepolia] as const;

export const hasWalletConnectProjectId = Boolean(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID);

export const wagmiConfig = hasWalletConnectProjectId
  ? getDefaultConfig({
      appName: 'IFR Benefits Network',
      projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID as string,
      chains,
    })
  : createConfig({
      chains,
      connectors: [
        injected(),
        metaMask(),
        coinbaseWallet({ appName: 'IFR Benefits Network' }),
      ],
      transports: {
        [mainnet.id]: http(),
        [sepolia.id]: http(),
      },
    });
