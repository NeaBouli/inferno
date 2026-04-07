/**
 * IFR SDK — Web3 Access Control for Builders
 *
 * npm install ifr-sdk
 *
 * import { IFRClient } from "ifr-sdk"
 * const ifr = new IFRClient({ network: "mainnet" })
 * const hasAccess = await ifr.checkAccess({ wallet: "0x...", required: 1000 })
 */

import { ethers } from "ethers";

// ─── Constants ───────────────────────────────────────────────────────

export const MAINNET_ADDRESSES = {
  ifrToken: "0x77e99917Eca8539c62F509ED1193ac36580A6e7B",
  ifrLock: "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb",
  commitmentVault: "0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3",
  lendingVault: "0x974305Ab0EC905172e697271C3d7d385194EB9DF",
  builderRegistry: "0xdfe6636DA47F8949330697e1dC5391267CEf0EE3",
  governance: "0xc43d48E7FDA576C5022d0670B652A622E8caD041",
} as const;

export const RAILWAY_API = "https://ifr-ai-copilot-production.up.railway.app";
const DEFAULT_RPC = "https://ethereum-rpc.publicnode.com";
const IFR_DECIMALS = 9;

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
  required: number;
  checkLocked?: boolean;
}

export interface AccessResult {
  hasAccess: boolean;
  balance: number;
  locked: number;
  total: number;
  required: number;
  tier: number;
  tierName: string;
}

export interface TierResult {
  tier: number;
  tierName: string;
  balance: number;
  locked: number;
}

// ─── Tier Thresholds ─────────────────────────────────────────────────

export const TIER_THRESHOLDS = { TIER1: 500, TIER2: 2000, TIER3: 10000 } as const;
export const TIER_NAMES = ["None", "Basic", "Premium", "Pro"] as const;

export function getTierFromAmount(amount: number): number {
  if (amount >= TIER_THRESHOLDS.TIER3) return 3;
  if (amount >= TIER_THRESHOLDS.TIER2) return 2;
  if (amount >= TIER_THRESHOLDS.TIER1) return 1;
  return 0;
}

export function getTierName(tier: number): string {
  return TIER_NAMES[tier] || "None";
}

// ─── IFRClient ───────────────────────────────────────────────────────

export class IFRClient {
  private provider: ethers.providers.JsonRpcProvider;
  private token: ethers.Contract;
  private lockContract: ethers.Contract;
  private registry: ethers.Contract;
  private apiUrl: string;

  readonly TIER1 = TIER_THRESHOLDS.TIER1;
  readonly TIER2 = TIER_THRESHOLDS.TIER2;
  readonly TIER3 = TIER_THRESHOLDS.TIER3;

  constructor(config: IFRClientConfig = {}) {
    const rpcUrl = config.rpcUrl || DEFAULT_RPC;
    this.apiUrl = config.apiUrl || RAILWAY_API;
    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);

    this.token = new ethers.Contract(MAINNET_ADDRESSES.ifrToken, TOKEN_ABI, this.provider);
    this.lockContract = new ethers.Contract(MAINNET_ADDRESSES.ifrLock, LOCK_ABI, this.provider);
    this.registry = new ethers.Contract(MAINNET_ADDRESSES.builderRegistry, BUILDER_REGISTRY_ABI, this.provider);
  }

  /** Check if wallet has sufficient IFR (balance + locked) */
  async checkAccess(params: AccessCheckParams): Promise<AccessResult> {
    const { wallet, required, checkLocked = true } = params;
    if (!ethers.utils.isAddress(wallet)) throw new Error("Invalid wallet address");

    const [balanceRaw, lockedRaw] = await Promise.all([
      this.token.balanceOf(wallet),
      checkLocked
        ? this.lockContract.lockedBalance(wallet).catch(() => ethers.BigNumber.from(0))
        : Promise.resolve(ethers.BigNumber.from(0)),
    ]);

    const balance = parseFloat(ethers.utils.formatUnits(balanceRaw, IFR_DECIMALS));
    const locked = parseFloat(ethers.utils.formatUnits(lockedRaw, IFR_DECIMALS));
    const total = balance + locked;
    const tier = getTierFromAmount(total);

    return { hasAccess: total >= required, balance, locked, total, required, tier, tierName: getTierName(tier) };
  }

  /** Get user tier (0=none, 1=basic, 2=premium, 3=pro) */
  async getTier(wallet: string): Promise<TierResult> {
    if (!ethers.utils.isAddress(wallet)) throw new Error("Invalid wallet address");

    const [balanceRaw, lockedRaw] = await Promise.all([
      this.token.balanceOf(wallet),
      this.lockContract.lockedBalance(wallet).catch(() => ethers.BigNumber.from(0)),
    ]);

    const balance = parseFloat(ethers.utils.formatUnits(balanceRaw, IFR_DECIMALS));
    const locked = parseFloat(ethers.utils.formatUnits(lockedRaw, IFR_DECIMALS));
    const tier = getTierFromAmount(balance + locked);

    return { tier, tierName: getTierName(tier), balance, locked };
  }

  /** Get IFR wallet balance */
  async getBalance(wallet: string): Promise<number> {
    if (!ethers.utils.isAddress(wallet)) throw new Error("Invalid wallet address");
    const raw = await this.token.balanceOf(wallet);
    return parseFloat(ethers.utils.formatUnits(raw, IFR_DECIMALS));
  }

  /** Get locked IFR balance */
  async getLockedBalance(wallet: string): Promise<number> {
    if (!ethers.utils.isAddress(wallet)) throw new Error("Invalid wallet address");
    try {
      const raw = await this.lockContract.lockedBalance(wallet);
      return parseFloat(ethers.utils.formatUnits(raw, IFR_DECIMALS));
    } catch {
      return 0;
    }
  }

  /** Check if address is a registered builder */
  async isBuilder(address: string): Promise<boolean> {
    if (!ethers.utils.isAddress(address)) throw new Error("Invalid address");
    try {
      return await this.registry.isBuilder(address);
    } catch {
      return false;
    }
  }

  /** Get total IFR supply */
  async getTotalSupply(): Promise<number> {
    const raw = await this.token.totalSupply();
    return parseFloat(ethers.utils.formatUnits(raw, IFR_DECIMALS));
  }

  /** REST API check — no ethers dependency needed on caller side */
  static async apiCheck(params: {
    wallet: string;
    required?: number;
    apiUrl?: string;
  }): Promise<{ hasAccess: boolean; balance: string; tier: number; tierName: string }> {
    const url = params.apiUrl || RAILWAY_API;
    const resp = await fetch(
      `${url}/api/ifr/check?wallet=${params.wallet}&required=${params.required || 1000}`
    );
    if (!resp.ok) throw new Error(`API error: ${resp.status}`);
    return resp.json() as any;
  }
}

export default IFRClient;
