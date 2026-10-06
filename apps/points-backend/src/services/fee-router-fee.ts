import { ethers } from "ethers";
import { pointsSecurityConfig } from "../config/security.js";
import { FEE_ROUTER_FEE_CAP_BPS } from "./voucher-eip712.js";
import { FEE_ROUTER_ADDRESS } from "./voucher-signer.js";

const FEE_ROUTER_ABI = ["function protocolFeeBps() view returns (uint16)"];

/** Successful reads are reused briefly; failures are never cached. */
export const PROTOCOL_FEE_CACHE_TTL_MS = 60_000;

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
let cached: { feeBps: number; readAt: number } | null = null;

/** Test hook: replace the chain reader (omit to restore it) and clear the cache. */
export function setProtocolFeeReader(next?: ProtocolFeeReader): void {
  reader = next ?? readProtocolFeeFromChain;
  cached = null;
}

/** Current FeeRouterV1.protocolFeeBps from the chain-pinned RPC. Throws when unreadable. */
export async function getProtocolFeeBps(now: number = Date.now()): Promise<number> {
  if (cached && now - cached.readAt < PROTOCOL_FEE_CACHE_TTL_MS) return cached.feeBps;
  const { chainId, feeBps } = await reader();
  if (chainId !== BigInt(pointsSecurityConfig.chainId)) {
    throw new Error(`FeeRouter fee read from chain ${chainId}, expected ${pointsSecurityConfig.chainId}`);
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > FEE_ROUTER_FEE_CAP_BPS) {
    throw new Error(`FeeRouter returned an out-of-range protocolFeeBps: ${feeBps}`);
  }
  cached = { feeBps, readAt: now };
  return feeBps;
}
