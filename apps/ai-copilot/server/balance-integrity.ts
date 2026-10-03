// No silent zeros (T-212b-data-integrity): a failed on-chain read is reported as unavailable,
// never as "0", and responses with any unavailable value are never cached as if they were live.
import { formatUnits, getAddress, isAddress } from "ethers";
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

/**
 * Builds the /api/ifr/balances response. `incomplete` is true when any balance or the IFRLock unlocked
 * total could not be read; callers must not cache an incomplete response.
 */
export function finalizeBalances(results: Record<string, BalanceEntry>, unlockedTotal: bigint | null) {
  const lock = results.IFRLock;
  const missing = Object.entries(results).filter(([, entry]) => isUnavailable(entry)).map(([label]) => label);
  const incomplete = missing.length > 0 || unlockedTotal === null;
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
