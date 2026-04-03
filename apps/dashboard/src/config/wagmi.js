import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia, mainnet } from 'wagmi/chains';
import { SEPOLIA_CHAIN_ID, MAINNET_CHAIN_ID } from './addresses';

const chainId = Number(import.meta.env.VITE_CHAIN_ID || SEPOLIA_CHAIN_ID);

export const wagmiConfig = getDefaultConfig({
  appName: 'Inferno Dashboard',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'inferno-dashboard',
  chains: chainId === MAINNET_CHAIN_ID ? [mainnet] : [sepolia],
});
