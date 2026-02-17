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
} from "../config/abis";

const SEPOLIA_RPC = "https://rpc.sepolia.org";

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
    };
  }, [signer]);
}
