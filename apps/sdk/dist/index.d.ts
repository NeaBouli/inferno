/**
 * IFR SDK — Web3 Access Control for Builders
 *
 * Repository package: npm install --install-links ./apps/sdk (npm registry release pending)
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
    readonly commitmentVault: "0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3";
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
export declare const TIER_THRESHOLDS: {
    readonly TIER1: 500;
    readonly TIER2: 2000;
    readonly TIER3: 10000;
};
export declare const TIER_NAMES: readonly ["None", "Basic", "Premium", "Pro"];
export declare function getTierFromAmount(amount: number): number;
export declare function getTierName(tier: number): string;
export declare function parseIFRAmount(value: string | number): bigint;
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
    /** Get user tier (0=none, 1=basic, 2=premium, 3=pro) */
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
