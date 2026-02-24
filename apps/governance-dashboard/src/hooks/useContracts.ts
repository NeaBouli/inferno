import { useMemo } from "react";
import { ethers } from "ethers";
import {
  ADDRESSES,
  InfernoTokenABI,
  IFRLockABI,
  PartnerVaultABI,
  GovernanceABI,
} from "../config";

const RPC_URL =
  import.meta.env.VITE_SEPOLIA_RPC_URL ||
  "https://eth-sepolia.g.alchemy.com/v2/demo";

function getProvider() {
  return new ethers.providers.JsonRpcProvider(RPC_URL);
}

export interface Contracts {
  provider: ethers.providers.JsonRpcProvider;
  token: ethers.Contract;
  ifrLock: ethers.Contract;
  partnerVault: ethers.Contract;
  governance: ethers.Contract;
}

export function useContracts(): Contracts {
  return useMemo(() => {
    const provider = getProvider();
    return {
      provider,
      token: new ethers.Contract(ADDRESSES.InfernoToken, InfernoTokenABI, provider),
      ifrLock: new ethers.Contract(ADDRESSES.IFRLock, IFRLockABI, provider),
      partnerVault: new ethers.Contract(ADDRESSES.PartnerVault, PartnerVaultABI, provider),
      governance: new ethers.Contract(ADDRESSES.Governance, GovernanceABI, provider),
    };
  }, []);
}
