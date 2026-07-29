import { useMemo } from "react";
import { Contract, JsonRpcProvider } from "ethers";
import {
  ADDRESSES,
  InfernoTokenABI,
  IFRLockABI,
  PartnerVaultABI,
  GovernanceABI,
  FeeRouterABI,
} from "../config";

const RPC_URL =
  import.meta.env.VITE_SEPOLIA_RPC_URL ||
  "https://eth-sepolia.g.alchemy.com/v2/demo";

function getProvider() {
  return new JsonRpcProvider(RPC_URL);
}

export interface Contracts {
  provider: JsonRpcProvider;
  token: Contract;
  ifrLock: Contract;
  partnerVault: Contract;
  governance: Contract;
  feeRouter: Contract;
}

export function useContracts(): Contracts {
  return useMemo(() => {
    const provider = getProvider();
    return {
      provider,
      token: new Contract(ADDRESSES.InfernoToken, InfernoTokenABI, provider),
      ifrLock: new Contract(ADDRESSES.IFRLock, IFRLockABI, provider),
      partnerVault: new Contract(ADDRESSES.PartnerVault, PartnerVaultABI, provider),
      governance: new Contract(ADDRESSES.Governance, GovernanceABI, provider),
      feeRouter: new Contract(ADDRESSES.FeeRouter, FeeRouterABI, provider),
    };
  }, []);
}
