import { http, createConfig } from 'wagmi';
import { sepolia, mainnet } from 'wagmi/chains';

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 11155111);

export const wagmiConfig =
  chainId === 1
    ? createConfig({
        chains: [mainnet],
        transports: { [mainnet.id]: http() },
      })
    : createConfig({
        chains: [sepolia],
        transports: { [sepolia.id]: http() },
      });
