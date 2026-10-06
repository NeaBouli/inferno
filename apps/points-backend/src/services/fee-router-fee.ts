import { ethers } from "ethers";
import { pointsSecurityConfig } from "../config/security.js";
import { FEE_ROUTER_FEE_CAP_BPS } from "./voucher-eip712.js";
import { FEE_ROUTER_ADDRESS } from "./voucher-signer.js";

const FEE_ROUTER_ABI = ["function protocolFeeBps() view returns (uint16)"];

export interface ProtocolFeeReading {
  chainId: bigint;
  feeBps: number;
}

export type ProtocolFeeReader = () => Promise<ProtocolFeeReading>;

async function readProtocolFeeFromChain(): Promise<ProtocolFeeReading> {
  if (FEE_ROUTER_ADDRESS === ethers.ZeroAddress) {
    throw new Error("FEE_ROUTER_ADDRESS not configured");
  }
  const provider = new ethers.JsonRpcProvider(
    pointsSecurityConfig.rpcUrl,
    pointsSecurityConfig.chainId,
    { staticNetwork: true },
  );
  try {
    const router = new ethers.Contract(FEE_ROUTER_ADDRESS, FEE_ROUTER_ABI, provider);
    // staticNetwork skips chain detection, so confirm the RPC chain with each read.
    const [chainIdHex, feeBps] = await Promise.all([
      provider.send("eth_chainId", []) as Promise<string>,
      router.protocolFeeBps() as Promise<bigint>,
    ]);
    return { chainId: BigInt(chainIdHex), feeBps: Number(feeBps) };
  } finally {
    provider.destroy();
  }
}

let reader: ProtocolFeeReader = readProtocolFeeFromChain;
// Only concurrent callers share a pending read; nothing is reused once it settles.
let inFlight: Promise<number> | null = null;

/** Test hook: replace the chain reader (omit to restore it). */
export function setProtocolFeeReader(next?: ProtocolFeeReader): void {
  reader = next ?? readProtocolFeeFromChain;
  inFlight = null;
}

async function readValidatedFee(): Promise<number> {
  const { chainId, feeBps } = await reader();
  if (chainId !== BigInt(pointsSecurityConfig.chainId)) {
    throw new Error(`FeeRouter fee read from chain ${chainId}, expected ${pointsSecurityConfig.chainId}`);
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > FEE_ROUTER_FEE_CAP_BPS) {
    throw new Error(`FeeRouter returned an out-of-range protocolFeeBps: ${feeBps}`);
  }
  return feeBps;
}

/** Fresh FeeRouterV1.protocolFeeBps from the chain-pinned RPC for every issuance. Throws when unreadable. */
export function getProtocolFeeBps(): Promise<number> {
  if (inFlight) return inFlight;
  const read = readValidatedFee().finally(() => {
    if (inFlight === read) inFlight = null;
  });
  inFlight = read;
  return read;
}
