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

/**
 * Log-safe description of a fee-read failure: an error code and a short reason with
 * URLs, addresses, hex data and request params removed. Never log the raw RPC error.
 */
export function describeFeeReadError(err: unknown): { code: string; reason: string } {
  const e = (typeof err === "object" && err !== null ? err : {}) as { code?: unknown; shortMessage?: unknown; message?: unknown };
  const code = typeof e.code === "string" && /^[A-Z_]{1,40}$/.test(e.code) ? e.code : "FEE_READ_FAILED";
  const raw = typeof e.shortMessage === "string" ? e.shortMessage : typeof e.message === "string" ? e.message : "";
  const reason = raw
    .split("\n")[0]
    .split("(")[0]
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, "[url]")
    .replace(/0x[0-9a-fA-F]+/g, "[hex]")
    .replace(/[^A-Za-z0-9 _.,:[\]-]/g, "")
    .trim()
    .slice(0, 80);
  return { code, reason: reason || "unavailable" };
}
