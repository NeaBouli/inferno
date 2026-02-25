import { useMemo } from "react";
import { ethers } from "ethers";
import { ADDRESSES } from "../config/addresses";
import {
  InfernoTokenABI,
  GovernanceABI,
  BurnReserveABI,
  BuybackVaultABI,
  LiquidityReserveABI,
  VestingABI,
  IFRLockABI,
  PartnerVaultABI,
  FeeRouterABI,
} from "../config/abis";

const SEPOLIA_RPC = import.meta.env.VITE_SEPOLIA_RPC_URL || "https://rpc.sepolia.org";

function getReadProvider() {
  return new ethers.providers.JsonRpcProvider(SEPOLIA_RPC);
}

export function useContracts(signer) {
  return useMemo(() => {
    const signerOrProvider = signer || getReadProvider();

    return {
      token: new ethers.Contract(ADDRESSES.InfernoToken, InfernoTokenABI, signerOrProvider),
      governance: new ethers.Contract(ADDRESSES.Governance, GovernanceABI, signerOrProvider),
      burnReserve: new ethers.Contract(ADDRESSES.BurnReserve, BurnReserveABI, signerOrProvider),
      buybackVault: new ethers.Contract(ADDRESSES.BuybackVault, BuybackVaultABI, signerOrProvider),
      liquidityReserve: new ethers.Contract(ADDRESSES.LiquidityReserve, LiquidityReserveABI, signerOrProvider),
      vesting: new ethers.Contract(ADDRESSES.Vesting, VestingABI, signerOrProvider),
      ifrLock: new ethers.Contract(ADDRESSES.IFRLock, IFRLockABI, signerOrProvider),
      partnerVault: new ethers.Contract(ADDRESSES.PartnerVault, PartnerVaultABI, signerOrProvider),
      feeRouter: new ethers.Contract(ADDRESSES.FeeRouter, FeeRouterABI, signerOrProvider),
    };
  }, [signer]);
}
