import { Router, Response } from "express";
import { ethers } from "ethers";
import { prisma } from "../db";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { POINTS_CONFIG } from "../config/points";
import { signVoucher } from "../services/voucher-signer";
import { voucherWalletLimit } from "../middleware/rate-limit";

const router = Router();

/** POST /voucher/issue — issue a signed EIP-712 voucher */
router.post("/issue", requireAuth, async (req: AuthRequest, res: Response) => {
  const wallet = req.wallet!;

  const walletRecord = await prisma.wallet.findUnique({ where: { address: wallet } });
  if (!walletRecord) {
    res.status(404).json({ error: "Wallet not found" });
    return;
  }

  // Check threshold
  if (walletRecord.pointsTotal < POINTS_CONFIG.voucher.threshold) {
    res.status(400).json({
      error: `Need ${POINTS_CONFIG.voucher.threshold} points, have ${walletRecord.pointsTotal}`,
    });
    return;
  }

  // Check per-wallet daily limit
  if (!voucherWalletLimit(wallet)) {
    res.status(429).json({ error: "Voucher already issued today. Try again tomorrow." });
    return;
  }

  // Check global daily issuance cap
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const todayVouchers = await prisma.voucher.count({
    where: { createdAt: { gte: startOfDay } },
  });

  if (todayVouchers >= POINTS_CONFIG.voucher.dailyIssuanceCap) {
    res.status(429).json({ error: "Daily voucher issuance cap reached." });
    return;
  }

  // Generate voucher
  const nonce = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toString();
  const expiresAt = new Date(Date.now() + POINTS_CONFIG.voucher.expiryDays * 86400_000);

  const voucherData = {
    user: ethers.utils.getAddress(wallet),
    discountBps: POINTS_CONFIG.voucher.discountBps,
    maxUses: 1,
    expiry: Math.floor(expiresAt.getTime() / 1000),
    nonce,
  };

  try {
    const signature = await signVoucher(voucherData);

    await prisma.voucher.create({
      data: {
        walletId: walletRecord.id,
        nonce,
        discountBps: voucherData.discountBps,
        maxUses: voucherData.maxUses,
        expiresAt,
      },
    });

    res.json({ voucher: voucherData, signature });
  } catch (err) {
    console.error("Voucher signing error:", err);
    res.status(500).json({ error: "Failed to issue voucher" });
  }
});

export default router;
