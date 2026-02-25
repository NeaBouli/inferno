import { Router, Response } from "express";
import { prisma } from "../db";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { POINTS_CONFIG } from "../config/points";

const router = Router();

/** POST /points/event — record a points event */
router.post("/event", requireAuth, async (req: AuthRequest, res: Response) => {
  const wallet = req.wallet!;
  const { type, proofRef } = req.body;

  // Validate event type
  const config = POINTS_CONFIG.events[type];
  if (!config) {
    res.status(400).json({ error: `Invalid event type: ${type}` });
    return;
  }

  // Check daily limit
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const todayCount = await prisma.pointEvent.count({
    where: {
      wallet: { address: wallet },
      type,
      createdAt: { gte: startOfDay },
    },
  });

  if (todayCount >= config.dailyLimit) {
    res.status(429).json({ error: `Daily limit reached for ${type}` });
    return;
  }

  // Record event and update total
  const walletRecord = await prisma.wallet.findUnique({ where: { address: wallet } });
  if (!walletRecord) {
    res.status(404).json({ error: "Wallet not found" });
    return;
  }

  const [event] = await prisma.$transaction([
    prisma.pointEvent.create({
      data: {
        walletId: walletRecord.id,
        type,
        points: config.points,
        proofRef: proofRef || null,
      },
    }),
    prisma.wallet.update({
      where: { address: wallet },
      data: { pointsTotal: { increment: config.points } },
    }),
  ]);

  const updated = await prisma.wallet.findUnique({ where: { address: wallet } });

  res.json({
    points: event.points,
    total: updated!.pointsTotal,
  });
});

/** GET /points/balance — get wallet balance + events */
router.get("/balance", requireAuth, async (req: AuthRequest, res: Response) => {
  const wallet = req.wallet!;

  const walletRecord = await prisma.wallet.findUnique({
    where: { address: wallet },
    include: { events: { orderBy: { createdAt: "desc" }, take: 50 } },
  });

  if (!walletRecord) {
    res.status(404).json({ error: "Wallet not found" });
    return;
  }

  res.json({
    wallet: walletRecord.address,
    total: walletRecord.pointsTotal,
    events: walletRecord.events.map((e) => ({
      type: e.type,
      points: e.points,
      proofRef: e.proofRef,
      createdAt: e.createdAt,
    })),
    voucherEligible: walletRecord.pointsTotal >= POINTS_CONFIG.voucher.threshold,
  });
});

export default router;
