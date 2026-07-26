import { createConfig, http } from 'wagmi';
import { sepolia, mainnet } from 'wagmi/chains';
import { coinbaseWallet } from 'wagmi/connectors/coinbaseWallet';
import { injected } from 'wagmi/connectors/injected';
import { walletConnect } from 'wagmi/connectors/walletConnect';
import { normalizeWalletConnectProjectId } from '@/lib/walletConnectProjectId.mjs';

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 1);
const chains = chainId === 1 ? [mainnet] as const : [sepolia] as const;
const walletConnectProjectId = normalizeWalletConnectProjectId(
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
);

export const hasWalletConnectProjectId = Boolean(walletConnectProjectId);

const connectors = [
  injected(),
  injected({ target: 'phantom' }),
  coinbaseWallet({ appName: 'IFR Benefits Network' }),
  ...(hasWalletConnectProjectId
    ? [walletConnect({
        projectId: walletConnectProjectId,
        showQrModal: true,
        metadata: {
          name: 'IFR Benefits Network',
          description: 'Verify locked IFR and redeem partner benefits.',
          url: 'https://shop.ifrunit.tech',
          icons: ['https://shop.ifrunit.tech/icons/ifr-token-256-v11.png'],
        },
      })]
    : []),
];

export const wagmiConfig = createConfig({
  chains,
  connectors,
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
});
