import { Router, Response } from "express";
import { ethers } from "ethers";
import { prisma } from "../db.js";
import { AuthRequest, requireAuth } from "../middleware/auth.js";
import { POINTS_CONFIG } from "../config/points.js";
import { signVoucher } from "../services/voucher-signer.js";
import { requireLockProof } from "../middleware/lockProof.js";

const router = Router();

class VoucherIssueError extends Error {
  constructor(
    readonly status: number,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
  }
}

/** POST /voucher/issue — issue a signed EIP-712 voucher (requires auth + lock proof) */
router.post("/issue", requireAuth, requireLockProof, async (req: AuthRequest, res: Response) => {
  const wallet = req.wallet!;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const walletWindowStart = new Date(Date.now() - 86400_000);
  const nonce = ethers.toBigInt(ethers.randomBytes(32)).toString();
  const expiresAt = new Date(Date.now() + POINTS_CONFIG.voucher.expiryDays * 86400_000);

  const voucherData = {
    user: ethers.getAddress(wallet),
    discountBps: POINTS_CONFIG.voucher.discountBps,
    maxUses: 1,
    expiry: Math.floor(expiresAt.getTime() / 1000),
    nonce,
  };

  try {
    const signature = await prisma.$transaction(async (tx) => {
      const walletRecord = await tx.wallet.findUnique({ where: { address: wallet } });
      if (!walletRecord) throw new VoucherIssueError(404, "Wallet not found");

      const walletVouchersToday = await tx.voucher.count({
        where: { walletId: walletRecord.id, createdAt: { gte: walletWindowStart } },
      });
      if (walletVouchersToday > 0) {
        throw new VoucherIssueError(429, "Voucher already issued today. Try again tomorrow.");
      }

      const todayVouchers = await tx.voucher.count({
        where: { createdAt: { gte: startOfDay } },
      });
      if (todayVouchers >= POINTS_CONFIG.voucher.dailyIssuanceCap) {
        throw new VoucherIssueError(429, "Daily voucher issuance cap reached.");
      }

      const debit = await tx.wallet.updateMany({
        where: {
          id: walletRecord.id,
          pointsTotal: { gte: POINTS_CONFIG.voucher.threshold },
        },
        data: { pointsTotal: { decrement: POINTS_CONFIG.voucher.threshold } },
      });
      if (debit.count !== 1) {
        throw new VoucherIssueError(
          400,
          `Need ${POINTS_CONFIG.voucher.threshold} available points for a voucher`,
        );
      }

      const voucherSignature = await signVoucher(voucherData);
      await tx.pointEvent.create({
        data: {
          walletId: walletRecord.id,
          type: "voucher_redemption",
          points: -POINTS_CONFIG.voucher.threshold,
          proofRef: nonce,
        },
      });
      await tx.voucher.create({
        data: {
          walletId: walletRecord.id,
          nonce,
          discountBps: voucherData.discountBps,
          maxUses: voucherData.maxUses,
          expiresAt,
        },
      });
      return voucherSignature;
    });

    console.log(`[VOUCHER] wallet=${wallet} issued=true discount=${voucherData.discountBps}bps nonce=${nonce.slice(0, 8)}...`);
    res.json({ voucher: voucherData, signature });
  } catch (err) {
    if (err instanceof VoucherIssueError) {
      res.status(err.status).json({ error: err.publicMessage });
      return;
    }
    console.error(`[VOUCHER] wallet=${wallet} issued=false error=${err}`);
    res.status(500).json({ error: "Failed to issue voucher" });
  }
});

/** GET /voucher/validate/:nonce — check voucher status */
router.get("/validate/:nonce", async (req, res: Response) => {
  const { nonce } = req.params;

  const voucher = await prisma.voucher.findFirst({
    where: { nonce },
  });

  if (!voucher) {
    res.status(404).json({ valid: false, reason: "Voucher not found" });
    return;
  }

  const now = new Date();
  if (voucher.expiresAt < now) {
    res.json({ valid: false, reason: "Voucher expired", nonce });
    return;
  }

  if (voucher.usedCount >= voucher.maxUses) {
    res.json({ valid: false, reason: "Voucher already used", nonce });
    return;
  }

  res.json({
    valid: true,
    nonce,
    discountBps: voucher.discountBps,
    maxUses: voucher.maxUses,
    usedCount: voucher.usedCount,
    expiresAt: voucher.expiresAt.toISOString(),
  });
});

export default router;
