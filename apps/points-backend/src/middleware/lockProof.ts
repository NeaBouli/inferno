import { Response, NextFunction } from "express";
import { ethers } from "ethers";
import { AuthRequest } from "./auth";

const RPC_URL = process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org";
const IFR_LOCK_ADDRESS = process.env.IFR_LOCK_ADDRESS || "0x0Cab0A9440643128540222acC6eF5028736675d3";

const IFR_LOCK_ABI = [
  "function isLocked(address wallet, uint256 minAmount) view returns (bool)",
  "function lockedBalance(address wallet) view returns (uint256)",
];

const MIN_LOCK_AMOUNT = ethers.utils.parseUnits("1000", 9); // Bronze tier minimum

// Cache lock status to avoid excessive RPC calls (5 min TTL)
const lockCache = new Map<string, { locked: boolean; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Middleware: require authenticated wallet to have active IFR lock (Bronze+).
 * Used on sensitive endpoints like voucher redemption to prevent Sybil attacks.
 */
export async function requireLockProof(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const wallet = req.wallet;
  if (!wallet) {
    res.status(401).json({ error: "Authorization required" });
    return;
  }

  // Check cache first
  const cached = lockCache.get(wallet);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    if (!cached.locked) {
      res.status(403).json({ error: "Active IFR lock required (min 1,000 IFR)" });
      return;
    }
    next();
    return;
  }

  try {
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const lockContract = new ethers.Contract(IFR_LOCK_ADDRESS, IFR_LOCK_ABI, provider);
    const isLocked: boolean = await lockContract.isLocked(wallet, MIN_LOCK_AMOUNT);

    lockCache.set(wallet, { locked: isLocked, ts: Date.now() });

    if (!isLocked) {
      res.status(403).json({ error: "Active IFR lock required (min 1,000 IFR)" });
      return;
    }

    next();
  } catch (err) {
    console.error("[lockProof] RPC check failed:", err);
    // Fail-open would be insecure — fail-closed
    res.status(503).json({ error: "Lock verification temporarily unavailable" });
  }
}
