// No silent zeros (T-212b-data-integrity): a failed on-chain read is reported as unavailable,
// never as "0", and responses with any unavailable value are never cached as if they were live.
import { formatUnits, getAddress, id, isAddress } from "ethers";
import { IFR_DECIMALS } from "../src/context/copilot-policy.js";

export type BalanceEntry =
  | { raw: string; formatted: number }
  | { raw: null; formatted: null; error: "unavailable" };

export function balanceEntry(raw: bigint): BalanceEntry {
  return { raw: raw.toString(), formatted: parseFloat(formatUnits(raw, IFR_DECIMALS)) };
}

export function unavailableEntry(): BalanceEntry {
  return { raw: null, formatted: null, error: "unavailable" };
}

/** A token balance as returned by the explorer API; anything but a decimal string is unavailable. */
export function explorerBalanceEntry(data: { status?: string; result?: unknown } | null | undefined): BalanceEntry {
  if (data && data.status === "1" && typeof data.result === "string" && /^\d+$/.test(data.result)) {
    return balanceEntry(BigInt(data.result));
  }
  return unavailableEntry();
}

export function isUnavailable(entry: BalanceEntry | undefined): boolean {
  return !entry || entry.raw === null;
}

/** topic0 of IFRLock `event Unlocked(address indexed user, uint256 amount)`. */
export const IFRLOCK_UNLOCKED_TOPIC = id("Unlocked(address,uint256)");

/**
 * Sums the amounts of an explorer getLogs reply for IFRLock Unlocked events (T-262 D1).
 * A well-formed empty reply (status "0", message "No records found", result []) means zero unlocks and is 0n.
 * Anything else that is not status "1" with an array of hex `data` fields throws, so rate limits, other
 * NOTOK replies and malformed logs stay unavailable instead of turning into a fake 0.
 */
export function sumUnlockedLogs(data: unknown): bigint {
  if (!data || typeof data !== "object") throw new Error("Unlocked events unavailable");
  const { status, message, result } = data as { status?: unknown; message?: unknown; result?: unknown };
  if (status === "0" && Array.isArray(result) && result.length === 0
      && typeof message === "string" && /^no records found$/i.test(message.trim())) {
    return 0n;
  }
  if (status !== "1" || !Array.isArray(result)) throw new Error("Unlocked events unavailable");
  let total = 0n;
  for (const log of result) {
    const hex = log && typeof log === "object" ? (log as { data?: unknown }).data : undefined;
    // One non-indexed uint256: ABI-encoded data is exactly one 32-byte word.
    if (typeof hex !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error("Unlocked event data malformed");
    total += BigInt(hex);
  }
  return total;
}

/** Label used in `unavailable` when the IFRLock unlocked total could not be read. */
export const IFRLOCK_UNLOCKED_LABEL = "IFRLock.unlocked";

/**
 * Builds the /api/ifr/balances response. `incomplete` is true when any balance or the IFRLock unlocked
 * total could not be read, and `unavailable` then names each failed source; callers must not cache it.
 */
export function finalizeBalances(results: Record<string, BalanceEntry>, unlockedTotal: bigint | null) {
  const lock = results.IFRLock;
  const missing = Object.entries(results).filter(([, entry]) => isUnavailable(entry)).map(([label]) => label);
  // Every incomplete response names its failed source; `incomplete` with an empty list is never returned.
  if (unlockedTotal === null) missing.push(IFRLOCK_UNLOCKED_LABEL);
  const incomplete = missing.length > 0;
  return {
    balances: results,
    ifrLock: {
      lockedRaw: lock && lock.raw !== null ? lock.raw : null,
      lockedFormatted: lock && lock.formatted !== null ? lock.formatted : null,
      unlockedRaw: unlockedTotal === null ? null : unlockedTotal.toString(),
      unlockedFormatted: unlockedTotal === null ? null : parseFloat(formatUnits(unlockedTotal, IFR_DECIMALS)),
    },
    incomplete,
    unavailable: missing,
    timestamp: new Date().toISOString(),
    fetchedAt: Date.now(),
    source: "live" as const,
  };
}

/** Token supply/balance figures from the explorer must be decimal base-unit strings. */
export function requireBaseUnits(value: unknown, what: string): string {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  throw new Error(`${what} unavailable`);
}

/** Returns the checksummed address, or null for anything that is not a valid Ethereum address. */
export function parseAddressParam(input: unknown): string | null {
  if (typeof input !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(input)) return null;
  // Mixed-case input must carry a valid EIP-55 checksum; all-lower/all-upper hex is accepted.
  if (!isAddress(input)) return null;
  return getAddress(input);
}

/**
 * Permanently lost IFR (not burned; still counted in totalSupply): only the CV-01 CommitmentVault V1
 * price tranches that can never unlock. The IFR held by FeeRouterV1 was recovered to the Treasury Safe
 * in CWA-02 and is not permanently lost; it is not part of this figure (current balances of protocol
 * addresses, including FeeRouterV1, are reported separately by /api/ifr/balances).
 */
export const CV01_LOST_RAW = 26418467994338353n; // 26,418,467.994338353 IFR (9 decimals)

/**
 * Lost/remaining split of /api/ifr/supply. `liveSupplyRaw` is totalSupply minus the permanently lost
 * CV-01 tranches only. It is NOT a circulating, liquid or spendable figure: it still includes locked,
 * vested and Treasury-held IFR (among them the recovered, unallocated Treasury IFR). The field name and
 * the always-null `permanentlyLostError` are kept for response-shape compatibility.
 */
export type LostSupply = {
  permanentlyLostRaw: string; permanentlyLost: number;
  liveSupplyRaw: string; liveSupply: number;
  permanentlyLostBreakdown: { cv01Raw: string };
  permanentlyLostError: null;
};

/** Exact base-unit arithmetic from totalSupply alone; no other on-chain read can alter the lost figure. */
export function lostSupply(totalSupplyRaw: string): LostSupply {
  const lost = CV01_LOST_RAW;
  const live = BigInt(requireBaseUnits(totalSupplyRaw, "totalSupply")) - lost;
  return {
    permanentlyLostRaw: lost.toString(),
    permanentlyLost: parseFloat(formatUnits(lost, IFR_DECIMALS)),
    liveSupplyRaw: live.toString(),
    liveSupply: parseFloat(formatUnits(live, IFR_DECIMALS)),
    permanentlyLostBreakdown: { cv01Raw: CV01_LOST_RAW.toString() },
    permanentlyLostError: null,
  };
}
