"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IFRClient = exports.TIER_NAMES = exports.TIER_THRESHOLDS = exports.IFR_DECIMALS = exports.RAILWAY_API = exports.IFR_API = exports.MAINNET_ADDRESSES = void 0;
exports.getTierFromAmount = getTierFromAmount;
exports.getTierName = getTierName;
exports.parseIFRAmount = parseIFRAmount;
exports.getTierFromRaw = getTierFromRaw;
exports.evaluateAccessRaw = evaluateAccessRaw;
const ethers_1 = require("ethers");
__exportStar(require("./benefits"), exports);
// ─── Constants ───────────────────────────────────────────────────────
exports.MAINNET_ADDRESSES = {
    ifrToken: "0x77e99917Eca8539c62F509ED1193ac36580A6e7B",
    ifrLock: "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb",
    commitmentVault: "0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3",
    lendingVault: "0x974305Ab0EC905172e697271C3d7d385194EB9DF",
    builderRegistry: "0xdfe6636DA47F8949330697e1dC5391267CEf0EE3",
    governance: "0xc43d48E7FDA576C5022d0670B652A622E8caD041",
};
exports.IFR_API = "https://copilot-api.ifrunit.tech";
/** @deprecated Use IFR_API. */
exports.RAILWAY_API = exports.IFR_API;
const DEFAULT_RPC = "https://ethereum-rpc.publicnode.com";
exports.IFR_DECIMALS = 9;
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
// ─── Tier Thresholds ─────────────────────────────────────────────────
exports.TIER_THRESHOLDS = { TIER1: 500, TIER2: 2000, TIER3: 10000 };
exports.TIER_NAMES = ["None", "Basic", "Premium", "Pro"];
function getTierFromAmount(amount) {
    if (amount >= exports.TIER_THRESHOLDS.TIER3)
        return 3;
    if (amount >= exports.TIER_THRESHOLDS.TIER2)
        return 2;
    if (amount >= exports.TIER_THRESHOLDS.TIER1)
        return 1;
    return 0;
}
function getTierName(tier) {
    return exports.TIER_NAMES[tier] || "None";
}
function parseIFRAmount(value) {
    const normalized = String(value);
    if (!/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(normalized)) {
        throw new Error("IFR amount must be a non-negative decimal with at most 9 decimal places");
    }
    return (0, ethers_1.parseUnits)(normalized, exports.IFR_DECIMALS);
}
function getTierFromRaw(amount) {
    const raw = (0, ethers_1.getBigInt)(amount);
    if (raw >= parseIFRAmount(exports.TIER_THRESHOLDS.TIER3))
        return 3;
    if (raw >= parseIFRAmount(exports.TIER_THRESHOLDS.TIER2))
        return 2;
    if (raw >= parseIFRAmount(exports.TIER_THRESHOLDS.TIER1))
        return 1;
    return 0;
}
function evaluateAccessRaw(balanceRaw, lockedRaw, requiredRaw) {
    const balance = (0, ethers_1.getBigInt)(balanceRaw);
    const locked = (0, ethers_1.getBigInt)(lockedRaw);
    const required = (0, ethers_1.getBigInt)(requiredRaw);
    if (balance < 0n || locked < 0n || required < 0n) {
        throw new Error("IFR raw amounts must be non-negative");
    }
    const total = balance + locked;
    const tier = getTierFromRaw(total);
    return { hasAccess: total >= required, total, tier, tierName: getTierName(tier) };
}
// ─── IFRClient ───────────────────────────────────────────────────────
class IFRClient {
    constructor(config = {}) {
        this.TIER1 = exports.TIER_THRESHOLDS.TIER1;
        this.TIER2 = exports.TIER_THRESHOLDS.TIER2;
        this.TIER3 = exports.TIER_THRESHOLDS.TIER3;
        if (config.network && config.network !== "mainnet") {
            throw new Error("Sepolia addresses are not configured; IFRClient currently supports Mainnet only");
        }
        const rpcUrl = config.rpcUrl || DEFAULT_RPC;
        this.apiUrl = config.apiUrl || exports.IFR_API;
        this.provider = new ethers_1.JsonRpcProvider(rpcUrl);
        this.token = new ethers_1.Contract(exports.MAINNET_ADDRESSES.ifrToken, TOKEN_ABI, this.provider);
        this.lockContract = new ethers_1.Contract(exports.MAINNET_ADDRESSES.ifrLock, LOCK_ABI, this.provider);
        this.registry = new ethers_1.Contract(exports.MAINNET_ADDRESSES.builderRegistry, BUILDER_REGISTRY_ABI, this.provider);
    }
    /** Check if wallet has sufficient IFR (balance + locked) */
    async checkAccess(params) {
        const { wallet, required, checkLocked = true } = params;
        if (!(0, ethers_1.isAddress)(wallet))
            throw new Error("Invalid wallet address");
        const requiredRaw = parseIFRAmount(required);
        const [balanceRaw, lockedRaw] = await Promise.all([
            this.token.balanceOf(wallet),
            checkLocked
                ? this.lockContract.lockedBalance(wallet).catch(() => 0n)
                : Promise.resolve(0n),
        ]);
        const evaluated = evaluateAccessRaw(balanceRaw, lockedRaw, requiredRaw);
        const balance = Number((0, ethers_1.formatUnits)(balanceRaw, exports.IFR_DECIMALS));
        const locked = Number((0, ethers_1.formatUnits)(lockedRaw, exports.IFR_DECIMALS));
        const total = Number((0, ethers_1.formatUnits)(evaluated.total, exports.IFR_DECIMALS));
        const requiredFormatted = Number((0, ethers_1.formatUnits)(requiredRaw, exports.IFR_DECIMALS));
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
    /** Get user tier (0=none, 1=basic, 2=premium, 3=pro) */
    async getTier(wallet) {
        if (!(0, ethers_1.isAddress)(wallet))
            throw new Error("Invalid wallet address");
        const [balanceRaw, lockedRaw] = await Promise.all([
            this.token.balanceOf(wallet),
            this.lockContract.lockedBalance(wallet).catch(() => 0n),
        ]);
        const balance = Number((0, ethers_1.formatUnits)(balanceRaw, exports.IFR_DECIMALS));
        const locked = Number((0, ethers_1.formatUnits)(lockedRaw, exports.IFR_DECIMALS));
        const totalRaw = (0, ethers_1.getBigInt)(balanceRaw) + (0, ethers_1.getBigInt)(lockedRaw);
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
    async getBalance(wallet) {
        if (!(0, ethers_1.isAddress)(wallet))
            throw new Error("Invalid wallet address");
        const raw = await this.token.balanceOf(wallet);
        return Number((0, ethers_1.formatUnits)(raw, exports.IFR_DECIMALS));
    }
    /** Get locked IFR balance */
    async getLockedBalance(wallet) {
        if (!(0, ethers_1.isAddress)(wallet))
            throw new Error("Invalid wallet address");
        try {
            const raw = await this.lockContract.lockedBalance(wallet);
            return Number((0, ethers_1.formatUnits)(raw, exports.IFR_DECIMALS));
        }
        catch {
            return 0;
        }
    }
    /** Check if address is a registered builder */
    async isBuilder(address) {
        if (!(0, ethers_1.isAddress)(address))
            throw new Error("Invalid address");
        try {
            return await this.registry.isBuilder(address);
        }
        catch {
            return false;
        }
    }
    /** Get total IFR supply */
    async getTotalSupply() {
        const raw = await this.token.totalSupply();
        return Number((0, ethers_1.formatUnits)(raw, exports.IFR_DECIMALS));
    }
    /** REST API check — no ethers dependency needed on caller side */
    static async apiCheck(params) {
        if (!(0, ethers_1.isAddress)(params.wallet))
            throw new Error("Invalid wallet address");
        const required = params.required ?? 1000;
        parseIFRAmount(required);
        const url = new URL("/api/ifr/check", params.apiUrl || exports.IFR_API);
        url.search = new URLSearchParams({ wallet: params.wallet, required: String(required) }).toString();
        const resp = await fetch(url.toString());
        if (!resp.ok)
            throw new Error(`API error: ${resp.status}`);
        return resp.json();
    }
}
exports.IFRClient = IFRClient;
exports.default = IFRClient;
