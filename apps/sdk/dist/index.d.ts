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
import { type BigNumberish } from "ethers";
export * from "./benefits";
export declare const MAINNET_ADDRESSES: {
    readonly ifrToken: "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
    readonly ifrLock: "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb";
    /** CommitmentVault V1: price tranches never unlock (CV-01); existing time tranches unlockable. Do not create new locks here. */
    readonly commitmentVault: "0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3";
    /** CommitmentVault V2: TIME_ONLY; new locks after Governance proposal #17 (fee exemption) executes. */
    readonly commitmentVaultV2: "0x8efae0C85ad6d44C731cAEDA1cBC275904Fc7c8F";
    /** LendingVault V1: retired, borrowing permanently disabled. */
    readonly lendingVault: "0x974305Ab0EC905172e697271C3d7d385194EB9DF";
    readonly builderRegistry: "0xdfe6636DA47F8949330697e1dC5391267CEf0EE3";
    readonly governance: "0xc43d48E7FDA576C5022d0670B652A622E8caD041";
};
export declare const IFR_API = "https://copilot-api.ifrunit.tech";
/** @deprecated Use IFR_API. */
export declare const RAILWAY_API = "https://copilot-api.ifrunit.tech";
export declare const IFR_DECIMALS = 9;
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
export interface BenefitTier {
    /** Stable key, e.g. "bronze". */
    key: string;
    /** Display name, e.g. "Bronze". */
    name: string;
    /** Minimum IFR locked in IFRLock, decimal string with at most 9 decimals. */
    minLocked: string;
}
export declare const DEFAULT_TIERS: readonly BenefitTier[];
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
export declare function validateTiers(tiers: readonly BenefitTier[]): bigint[];
/** Highest tier reached by an exact locked amount (9-decimal base units); no rounding. */
export declare function getBenefitTierFromRaw(lockedRaw: BigNumberish, tiers?: readonly BenefitTier[]): BenefitTierResult;
/**
 * Thrown when an on-chain read fails. The SDK never turns a failed read into 0 or false,
 * so a caller cannot mistake an RPC outage for "no IFR locked" or "not a builder".
 */
export declare class IFRReadError extends Error {
    readonly read: string;
    constructor(read: string, cause: unknown);
}
/**
 * @deprecated Legacy hold+lock access tiers (wallet balance + locked, 500 / 2,000 / 10,000).
 * Not the project's benefit preset. Use `DEFAULT_TIERS` with `getBenefitTierFromRaw`. Removed in 1.0.
 */
export declare const TIER_THRESHOLDS: {
    readonly TIER1: 500;
    readonly TIER2: 2000;
    readonly TIER3: 10000;
};
/** @deprecated Legacy access tier names; use `DEFAULT_TIERS`. Removed in 1.0. */
export declare const TIER_NAMES: readonly ["None", "Basic", "Premium", "Pro"];
/** @deprecated Legacy hold+lock access tier; use `getBenefitTierFromRaw`. Removed in 1.0. */
export declare function getTierFromAmount(amount: number): number;
/** @deprecated Legacy access tier name; use `getBenefitTierFromRaw(...).name`. Removed in 1.0. */
export declare function getTierName(tier: number): string;
export declare function parseIFRAmount(value: string | number): bigint;
/** @deprecated Legacy hold+lock access tier; use `getBenefitTierFromRaw`. Removed in 1.0. */
export declare function getTierFromRaw(amount: BigNumberish): number;
export declare function evaluateAccessRaw(balanceRaw: BigNumberish, lockedRaw: BigNumberish, requiredRaw: BigNumberish): {
    hasAccess: boolean;
    total: bigint;
    tier: number;
    tierName: string;
};
export declare class IFRClient {
    private provider;
    private token;
    private lockContract;
    private registry;
    private apiUrl;
    readonly TIER1: 500;
    readonly TIER2: 2000;
    readonly TIER3: 10000;
    constructor(config?: IFRClientConfig);
    /** Check if wallet has sufficient IFR (balance + locked) */
    checkAccess(params: AccessCheckParams): Promise<AccessResult>;
    /**
     * Benefit tier from IFR locked in IFRLock only (default preset Bronze/Silver/Gold/Platinum, or your
     * own `tiers`). Fails closed: a failed IFRLock read throws instead of reporting 0.
     */
    getBenefitTier(wallet: string, tiers?: readonly BenefitTier[]): Promise<BenefitTierResult>;
    /**
     * @deprecated Legacy hold+lock access tier (0=none, 1=basic, 2=premium, 3=pro; balance + locked,
     * 500 / 2,000 / 10,000). Use `getBenefitTier`. Removed in 1.0.
     */
    getTier(wallet: string): Promise<TierResult>;
    /** Get IFR wallet balance */
    getBalance(wallet: string): Promise<number>;
    /** Get locked IFR balance */
    getLockedBalance(wallet: string): Promise<number>;
    /** Check if address is a registered builder */
    isBuilder(address: string): Promise<boolean>;
    /** Get total IFR supply */
    getTotalSupply(): Promise<number>;
    /** REST API check — no ethers dependency needed on caller side */
    static apiCheck(params: {
        wallet: string;
        required?: string | number;
        apiUrl?: string;
    }): Promise<{
        hasAccess: boolean;
        balance: string;
        tier: number;
        tierName: string;
    }>;
}
export default IFRClient;
