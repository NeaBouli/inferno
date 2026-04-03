import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia, mainnet } from 'wagmi/chains';

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 11155111);

export const wagmiConfig = getDefaultConfig({
  appName: 'IFR Benefits Network',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'inferno-benefits',
  chains: chainId === 1 ? [mainnet] : [sepolia],
});
