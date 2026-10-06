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
    throw new FeeReadError("fee_error:not_configured", "FEE_ROUTER_ADDRESS not configured");
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
    throw new FeeReadError("fee_error:wrong_chain", `FeeRouter fee read from chain ${chainId}, expected ${pointsSecurityConfig.chainId}`);
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > FEE_ROUTER_FEE_CAP_BPS) {
    throw new FeeReadError("fee_error:out_of_range", `FeeRouter returned an out-of-range protocolFeeBps: ${feeBps}`);
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

/** Fixed log categories for fee-read failures. Nothing else from an error reaches the log. */
export type FeeReadErrorCategory =
  | "rpc_error:timeout"
  | "rpc_error:network"
  | "rpc_error:rate_limited"
  | "rpc_error:bad_response"
  | "fee_error:not_configured"
  | "fee_error:wrong_chain"
  | "fee_error:out_of_range"
  | "rpc_error:unknown";

/** Fee-read failure raised by this module, tagged with its fixed log category. */
export class FeeReadError extends Error {
  constructor(readonly category: FeeReadErrorCategory, message: string) {
    super(message);
    this.name = "FeeReadError";
  }
}

const ERROR_CODE_CATEGORIES: Readonly<Record<string, FeeReadErrorCategory>> = {
  // ethers v6 error codes
  TIMEOUT: "rpc_error:timeout",
  NETWORK_ERROR: "rpc_error:network",
  BAD_DATA: "rpc_error:bad_response",
  CALL_EXCEPTION: "rpc_error:bad_response",
  // Node.js socket / DNS errno codes
  ETIMEDOUT: "rpc_error:timeout",
  ECONNREFUSED: "rpc_error:network",
  ECONNRESET: "rpc_error:network",
  ENOTFOUND: "rpc_error:network",
  EAI_AGAIN: "rpc_error:network",
  EHOSTUNREACH: "rpc_error:network",
  ENETUNREACH: "rpc_error:network",
};

/** JSON-RPC error codes used by providers for request limits. */
const RATE_LIMIT_RPC_CODES = new Set([429, -32005, -32029]);

function numberField(value: unknown, key: string): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "number" ? field : undefined;
}

/**
 * Map a fee-read failure to a constant log category. Only error classes, whitelisted
 * string codes and numeric status codes are inspected; message text, URLs, request
 * data and any other free-form content are never returned. Unknown -> "rpc_error:unknown".
 */
export function categorizeFeeReadError(err: unknown): FeeReadErrorCategory {
  if (err instanceof FeeReadError) return err.category;
  if (typeof err !== "object" || err === null) return "rpc_error:unknown";
  const e = err as { code?: unknown; error?: unknown; response?: unknown };

  const rpcCode = numberField(e.error, "code") ?? (typeof e.code === "number" ? e.code : undefined);
  const httpStatus = numberField(e.response, "statusCode");
  if ((rpcCode !== undefined && RATE_LIMIT_RPC_CODES.has(rpcCode)) || httpStatus === 429) {
    return "rpc_error:rate_limited";
  }
  if (typeof e.code === "string" && Object.prototype.hasOwnProperty.call(ERROR_CODE_CATEGORIES, e.code)) {
    return ERROR_CODE_CATEGORIES[e.code];
  }
  if (e.code === "SERVER_ERROR") return "rpc_error:bad_response";
  return "rpc_error:unknown";
}
