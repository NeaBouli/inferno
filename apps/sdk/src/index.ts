/**
 * IFR SDK — Web3 Access Control for Builders
 *
 * Repository package: build and pack apps/sdk, then consume the locked tarball
 *
 * import { IFRClient } from "ifr-sdk"
 * const ifr = new IFRClient({ network: "mainnet" })
 * const access = await ifr.checkAccess({ wallet: "0x...", required: 1000 })
 * if (access.hasAccess) enableAccess()
 */

import {
  Contract,
  JsonRpcProvider,
  type BigNumberish,
  formatUnits,
  getBigInt,
  isAddress,
  parseUnits,
} from "ethers";
export * from "./benefits";

// ─── Constants ───────────────────────────────────────────────────────

export const MAINNET_ADDRESSES = {
  ifrToken: "0x77e99917Eca8539c62F509ED1193ac36580A6e7B",
  ifrLock: "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb",
  /** CommitmentVault V1: price tranches never unlock (CV-01); existing time tranches unlockable. Do not create new locks here. */
  commitmentVault: "0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3",
  /** CommitmentVault V2: TIME_ONLY; new locks after Governance proposal #17 (fee exemption) executes. */
  commitmentVaultV2: "0x8efae0C85ad6d44C731cAEDA1cBC275904Fc7c8F",
  /** LendingVault V1: retired, borrowing permanently disabled. */
  lendingVault: "0x974305Ab0EC905172e697271C3d7d385194EB9DF",
  builderRegistry: "0xdfe6636DA47F8949330697e1dC5391267CEf0EE3",
  governance: "0xc43d48E7FDA576C5022d0670B652A622E8caD041",
} as const;

export const IFR_API = "https://copilot-api.ifrunit.tech";
/** @deprecated Use IFR_API. */
export const RAILWAY_API = IFR_API;
const DEFAULT_RPC = "https://ethereum-rpc.publicnode.com";
export const IFR_DECIMALS = 9;

const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
];

const LOCK_ABI = [
  "function lockedBalance(address) view returns (uint256)",
  "function isLocked(address, uint256) view returns (bool)",
];

const BUILDER_REGISTRY_ABI = [
  "function isBuilder(address) view returns (bool)",
  "function getBuilderCount() view returns (uint256)",
];

// ─── Types ───────────────────────────────────────────────────────────

export interface IFRClientConfig {
  network?: "mainnet" | "sepolia";
  rpcUrl?: string;
  apiUrl?: string;
}

export interface AccessCheckParams {
  wallet: string;
  required: string | number;
  checkLocked?: boolean;
}

export interface AccessResult {
  hasAccess: boolean;
  balance: number;
  locked: number;
  total: number;
  required: number;
  balanceRaw: string;
  lockedRaw: string;
  totalRaw: string;
  requiredRaw: string;
  tier: number;
  tierName: string;
}

export interface TierResult {
  tier: number;
  tierName: string;
  balance: number;
  locked: number;
  balanceRaw: string;
  lockedRaw: string;
  totalRaw: string;
}

// ─── Benefit tiers (default preset) ──────────────────────────────────
//
// The project's default preset counts ONLY IFR locked in IFRLock and matches the Benefits network:
// Bronze 1,000 / Silver 2,500 / Gold 5,000 / Platinum 10,000. It is a default and a label set, not a
// rule partners must follow: in the Benefits network every partner sets its own thresholds,
// held-IFR minimums, lock sources and discounts per benefit. Pass your own tiers to
// `getBenefitTierFromRaw` / `IFRClient.getBenefitTier` to use a different model.

export interface BenefitTier {
  /** Stable key, e.g. "bronze". */
  key: string;
  /** Display name, e.g. "Bronze". */
  name: string;
  /** Minimum IFR locked in IFRLock, decimal string with at most 9 decimals. */
  minLocked: string;
}

export const DEFAULT_TIERS: readonly BenefitTier[] = Object.freeze([
  Object.freeze({ key: "bronze", name: "Bronze", minLocked: "1000" }),
  Object.freeze({ key: "silver", name: "Silver", minLocked: "2500" }),
  Object.freeze({ key: "gold", name: "Gold", minLocked: "5000" }),
  Object.freeze({ key: "platinum", name: "Platinum", minLocked: "10000" }),
]);

export interface BenefitTierResult {
  /** 0 = below the first tier, 1..n = index of the highest tier reached (1-based). */
  level: number;
  /** Tier key, or null below the first tier. */
  key: string | null;
  /** Tier name, or "None" below the first tier. */
  name: string;
  lockedRaw: string;
}

/** Validates a tier list: non-empty, unique keys, strictly ascending exact 9-decimal thresholds. */
export function validateTiers(tiers: readonly BenefitTier[]): bigint[] {
  if (!Array.isArray(tiers) || tiers.length === 0) throw new Error("tiers must be a non-empty array");
  const keys = new Set<string>();
  let previous = -1n;
  return tiers.map((tier) => {
    if (!tier || typeof tier.key !== "string" || !tier.key || typeof tier.name !== "string" || !tier.name) {
      throw new Error("each tier needs a non-empty key and name");
    }
    if (keys.has(tier.key)) throw new Error(`duplicate tier key: ${tier.key}`);
    keys.add(tier.key);
    const min = parseIFRAmount(tier.minLocked);
    if (min <= previous) throw new Error("tier thresholds must be strictly ascending");
    previous = min;
    return min;
  });
}

/** Highest tier reached by an exact locked amount (9-decimal base units); no rounding. */
export function getBenefitTierFromRaw(
  lockedRaw: BigNumberish,
  tiers: readonly BenefitTier[] = DEFAULT_TIERS
): BenefitTierResult {
  const locked = getBigInt(lockedRaw);
  if (locked < 0n) throw new Error("IFR raw amounts must be non-negative");
  const mins = validateTiers(tiers);
  let level = 0;
  for (let i = 0; i < mins.length; i++) if (locked >= mins[i]) level = i + 1;
  const tier = level ? tiers[level - 1] : null;
  return { level, key: tier ? tier.key : null, name: tier ? tier.name : "None", lockedRaw: locked.toString() };
}

// ─── Read errors ─────────────────────────────────────────────────────

/**
 * Thrown when an on-chain read fails. The SDK never turns a failed read into 0 or false,
 * so a caller cannot mistake an RPC outage for "no IFR locked" or "not a builder".
 */
export class IFRReadError extends Error {
  readonly read: string;
  constructor(read: string, cause: unknown) {
    super(`IFR read failed: ${read}${cause instanceof Error && cause.message ? ` (${cause.message})` : ""}`);
    this.name = "IFRReadError";
    this.read = read;
    (this as { cause?: unknown }).cause = cause;
  }
}

async function readOrThrow<T>(read: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new IFRReadError(read, error);
  }
}

// ─── Legacy access tiers (deprecated) ────────────────────────────────

/**
 * @deprecated Legacy hold+lock access tiers (wallet balance + locked, 500 / 2,000 / 10,000).
 * Not the project's benefit preset. Use `DEFAULT_TIERS` with `getBenefitTierFromRaw`. Removed in 1.0.
 */
export const TIER_THRESHOLDS = { TIER1: 500, TIER2: 2000, TIER3: 10000 } as const;
/** @deprecated Legacy access tier names; use `DEFAULT_TIERS`. Removed in 1.0. */
export const TIER_NAMES = ["None", "Basic", "Premium", "Pro"] as const;

/** @deprecated Legacy hold+lock access tier; use `getBenefitTierFromRaw`. Removed in 1.0. */
export function getTierFromAmount(amount: number): number {
  if (amount >= TIER_THRESHOLDS.TIER3) return 3;
  if (amount >= TIER_THRESHOLDS.TIER2) return 2;
  if (amount >= TIER_THRESHOLDS.TIER1) return 1;
  return 0;
}

/** @deprecated Legacy access tier name; use `getBenefitTierFromRaw(...).name`. Removed in 1.0. */
export function getTierName(tier: number): string {
  return TIER_NAMES[tier] || "None";
}

export function parseIFRAmount(value: string | number): bigint {
  const normalized = String(value);
  if (!/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(normalized)) {
    throw new Error("IFR amount must be a non-negative decimal with at most 9 decimal places");
  }
  return parseUnits(normalized, IFR_DECIMALS);
}

/** @deprecated Legacy hold+lock access tier; use `getBenefitTierFromRaw`. Removed in 1.0. */
export function getTierFromRaw(amount: BigNumberish): number {
  const raw = getBigInt(amount);
  if (raw >= parseIFRAmount(TIER_THRESHOLDS.TIER3)) return 3;
  if (raw >= parseIFRAmount(TIER_THRESHOLDS.TIER2)) return 2;
  if (raw >= parseIFRAmount(TIER_THRESHOLDS.TIER1)) return 1;
  return 0;
}

export function evaluateAccessRaw(
  balanceRaw: BigNumberish,
  lockedRaw: BigNumberish,
  requiredRaw: BigNumberish
) {
  const balance = getBigInt(balanceRaw);
  const locked = getBigInt(lockedRaw);
  const required = getBigInt(requiredRaw);
  if (balance < 0n || locked < 0n || required < 0n) {
    throw new Error("IFR raw amounts must be non-negative");
  }
  const total = balance + locked;
  const tier = getTierFromRaw(total);
  return { hasAccess: total >= required, total, tier, tierName: getTierName(tier) };
}

// ─── IFRClient ───────────────────────────────────────────────────────

export class IFRClient {
  private provider: JsonRpcProvider;
  private token: Contract;
  private lockContract: Contract;
  private registry: Contract;
  private apiUrl: string;

  readonly TIER1 = TIER_THRESHOLDS.TIER1;
  readonly TIER2 = TIER_THRESHOLDS.TIER2;
  readonly TIER3 = TIER_THRESHOLDS.TIER3;

  constructor(config: IFRClientConfig = {}) {
    if (config.network && config.network !== "mainnet") {
      throw new Error("Sepolia addresses are not configured; IFRClient currently supports Mainnet only");
    }
    const rpcUrl = config.rpcUrl || DEFAULT_RPC;
    this.apiUrl = config.apiUrl || IFR_API;
    this.provider = new JsonRpcProvider(rpcUrl);

    this.token = new Contract(MAINNET_ADDRESSES.ifrToken, TOKEN_ABI, this.provider);
    this.lockContract = new Contract(MAINNET_ADDRESSES.ifrLock, LOCK_ABI, this.provider);
    this.registry = new Contract(MAINNET_ADDRESSES.builderRegistry, BUILDER_REGISTRY_ABI, this.provider);
  }

  /** Check if wallet has sufficient IFR (balance + locked) */
  async checkAccess(params: AccessCheckParams): Promise<AccessResult> {
    const { wallet, required, checkLocked = true } = params;
    if (!isAddress(wallet)) throw new Error("Invalid wallet address");
    const requiredRaw = parseIFRAmount(required);

    const [balanceRaw, lockedRaw] = await Promise.all([
      this.token.balanceOf(wallet),
      checkLocked
        ? readOrThrow("IFRLock.lockedBalance", () => this.lockContract.lockedBalance(wallet))
        : Promise.resolve(0n),
    ]);

    const evaluated = evaluateAccessRaw(balanceRaw, lockedRaw, requiredRaw);
    const balance = Number(formatUnits(balanceRaw, IFR_DECIMALS));
    const locked = Number(formatUnits(lockedRaw, IFR_DECIMALS));
    const total = Number(formatUnits(evaluated.total, IFR_DECIMALS));
    const requiredFormatted = Number(formatUnits(requiredRaw, IFR_DECIMALS));

    return {
      hasAccess: evaluated.hasAccess,
      balance,
      locked,
      total,
      required: requiredFormatted,
      tier: evaluated.tier,
      tierName: evaluated.tierName,
      balanceRaw: balanceRaw.toString(),
      lockedRaw: lockedRaw.toString(),
      totalRaw: evaluated.total.toString(),
      requiredRaw: requiredRaw.toString(),
    };
  }

  /**
   * Benefit tier from IFR locked in IFRLock only (default preset Bronze/Silver/Gold/Platinum, or your
   * own `tiers`). Fails closed: a failed IFRLock read throws instead of reporting 0.
   */
  async getBenefitTier(wallet: string, tiers: readonly BenefitTier[] = DEFAULT_TIERS): Promise<BenefitTierResult> {
    if (!isAddress(wallet)) throw new Error("Invalid wallet address");
    validateTiers(tiers);
    const lockedRaw = await this.lockContract.lockedBalance(wallet);
    return getBenefitTierFromRaw(lockedRaw, tiers);
  }

  /**
   * @deprecated Legacy hold+lock access tier (0=none, 1=basic, 2=premium, 3=pro; balance + locked,
   * 500 / 2,000 / 10,000). Use `getBenefitTier`. Removed in 1.0.
   */
  async getTier(wallet: string): Promise<TierResult> {
    if (!isAddress(wallet)) throw new Error("Invalid wallet address");

    const [balanceRaw, lockedRaw] = await Promise.all([
      this.token.balanceOf(wallet),
      readOrThrow("IFRLock.lockedBalance", () => this.lockContract.lockedBalance(wallet)),
    ]);

    const balance = Number(formatUnits(balanceRaw, IFR_DECIMALS));
    const locked = Number(formatUnits(lockedRaw, IFR_DECIMALS));
    const totalRaw = getBigInt(balanceRaw) + getBigInt(lockedRaw);
    const tier = getTierFromRaw(totalRaw);

    return {
      tier,
      tierName: getTierName(tier),
      balance,
      locked,
      balanceRaw: balanceRaw.toString(),
      lockedRaw: lockedRaw.toString(),
      totalRaw: totalRaw.toString(),
    };
  }

  /** Get IFR wallet balance */
  async getBalance(wallet: string): Promise<number> {
    if (!isAddress(wallet)) throw new Error("Invalid wallet address");
    const raw = await this.token.balanceOf(wallet);
    return Number(formatUnits(raw, IFR_DECIMALS));
  }

  /** Get locked IFR balance */
  async getLockedBalance(wallet: string): Promise<number> {
    if (!isAddress(wallet)) throw new Error("Invalid wallet address");
    const raw = await readOrThrow("IFRLock.lockedBalance", () => this.lockContract.lockedBalance(wallet));
    return Number(formatUnits(raw, IFR_DECIMALS));
  }

  /** Check if address is a registered builder */
  async isBuilder(address: string): Promise<boolean> {
    if (!isAddress(address)) throw new Error("Invalid address");
    return readOrThrow("BuilderRegistry.isBuilder", () => this.registry.isBuilder(address));
  }

  /** Get total IFR supply */
  async getTotalSupply(): Promise<number> {
    const raw = await this.token.totalSupply();
    return Number(formatUnits(raw, IFR_DECIMALS));
  }

  /** REST API check — no ethers dependency needed on caller side */
  static async apiCheck(params: {
    wallet: string;
    required?: string | number;
    apiUrl?: string;
  }): Promise<{ hasAccess: boolean; balance: string; tier: number; tierName: string }> {
    if (!isAddress(params.wallet)) throw new Error("Invalid wallet address");
    const required = params.required ?? 1000;
    parseIFRAmount(required);
    const url = new URL("/api/ifr/check", params.apiUrl || IFR_API);
    url.search = new URLSearchParams({ wallet: params.wallet, required: String(required) }).toString();
    const resp = await fetch(url.toString());
    if (!resp.ok) throw new Error(`API error: ${resp.status}`);
    return resp.json() as any;
  }
}

export default IFRClient;
