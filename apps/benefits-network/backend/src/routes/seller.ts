import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { prisma } from '../services/sessionService';
import { buildSellerAuthMessage, normalizeAddress, verifySellerSignature } from '../services/sellerAuth';
import { assertSellerBusinessLimit } from '../services/sellerLimits';
import { sellerRateLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validator';

const router = Router();

const createBusinessSchema = z.object({
  name: z.string().min(1).max(200),
  discountPercent: z.number().int().min(0).max(100),
  requiredLockIFR: z.number().int().positive(),
  ttlSeconds: z.number().int().min(10).max(3600).optional(),
  tierLabel: z.string().max(50).optional(),
  ownerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  signature: z.string().min(1),
  timestamp: z.string().min(1),
});

const createBenefitRuleSchema = z.object({
  label: z.string().min(1).max(80),
  category: z.string().min(1).max(80),
  productName: z.string().min(1).max(160),
  discountPercent: z.number().int().min(0).max(100),
  requiredLockIFR: z.number().int().positive(),
  ttlSeconds: z.number().int().min(10).max(3600).optional(),
  active: z.boolean().optional(),
});

const updateBenefitRuleSchema = createBenefitRuleSchema.partial();

type SessionStatusCounts = Record<'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'REDEEMED', number>;

function sessionStatusCounts(groups: Array<{ status: string; _count: { _all: number } }>): SessionStatusCounts {
  const counts: SessionStatusCounts = {
    PENDING: 0,
    APPROVED: 0,
    REJECTED: 0,
    EXPIRED: 0,
    REDEEMED: 0,
  };

  for (const group of groups) {
    if (group.status in counts) {
      counts[group.status as keyof SessionStatusCounts] = group._count._all;
    }
  }

  return counts;
}

function sellerActivityMetrics(
  allTimeGroups: Array<{ status: string; _count: { _all: number } }>,
  todayGroups: Array<{ status: string; _count: { _all: number } }>,
  todayStartedAt: Date,
  todayRedemptions: number,
  openChecks: number
) {
  const allTime = sessionStatusCounts(allTimeGroups);
  const today = sessionStatusCounts(todayGroups);
  const allTimeChecks = Object.values(allTime).reduce((sum, count) => sum + count, 0);
  const todayChecks = Object.values(today).reduce((sum, count) => sum + count, 0);
  const completedVerifications = allTime.APPROVED + allTime.REDEEMED + allTime.REJECTED;
  const successfulVerifications = allTime.APPROVED + allTime.REDEEMED;

  return {
    generatedAt: new Date().toISOString(),
    todayStartedAt: todayStartedAt.toISOString(),
    today: {
      checks: todayChecks,
      approved: today.APPROVED + today.REDEEMED,
      redeemed: todayRedemptions,
      rejected: today.REJECTED,
    },
    allTime: {
      checks: allTimeChecks,
      approved: successfulVerifications,
      redeemed: allTime.REDEEMED,
      rejected: allTime.REJECTED,
    },
    openChecks,
    approvalRatePercent: completedVerifications > 0
      ? Math.round((successfulVerifications / completedVerifications) * 100)
      : null,
  };
}

function getSellerAuth(req: Request) {
  return {
    walletAddress: String(req.header('x-ifr-wallet') || req.body?.ownerAddress || ''),
    signature: String(req.header('x-ifr-signature') || req.body?.signature || ''),
    timestamp: String(req.header('x-ifr-timestamp') || req.body?.timestamp || ''),
  };
}

function requireSellerAuth(req: Request, action: string, businessId: string) {
  const auth = getSellerAuth(req);
  return verifySellerSignature({ ...auth, action, businessId });
}

function handleSellerError(err: unknown, res: Response, next: NextFunction) {
  if (err instanceof Error) {
    if (err.message.includes('authorization') || err.message.includes('signature')) {
      res.status(401).json({ error: err.message });
      return;
    }
    if (err.message.includes('not the business owner')) {
      res.status(403).json({ error: err.message });
      return;
    }
    if (err.message.includes('not found')) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err.message.includes('profile limit reached')) {
      res.status(429).json({ error: err.message });
      return;
    }
  }
  next(err);
}

async function requireBusinessOwner(req: Request, action: string, businessId: string) {
  const wallet = requireSellerAuth(req, action, businessId);
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, ownerAddress: true, active: true },
  });

  if (!business || !business.ownerAddress || !business.active) {
    throw new Error('Seller-owned business not found');
  }

  if (normalizeAddress(business.ownerAddress) !== wallet) {
    throw new Error('Seller wallet is not the business owner');
  }

  return wallet;
}

router.get('/auth-message', (req, res) => {
  const action = String(req.query.action || 'business:create');
  const businessId = String(req.query.businessId || 'new');
  const timestamp = String(Date.now());
  res.json({
    action,
    businessId,
    timestamp,
    issuedAt: new Date(Number(timestamp)).toISOString(),
    expiresAt: new Date(Number(timestamp) + 10 * 60 * 1000).toISOString(),
    message: buildSellerAuthMessage(action, businessId, timestamp),
  });
});

router.post('/businesses', sellerRateLimiter, validate(createBusinessSchema), async (req, res, next) => {
  try {
    const ownerAddress = verifySellerSignature({
      walletAddress: req.body.ownerAddress,
      signature: req.body.signature,
      timestamp: req.body.timestamp,
      action: 'business:create',
      businessId: 'new',
    });

    await assertSellerBusinessLimit(ownerAddress);

    const business = await prisma.business.create({
      data: {
        name: req.body.name,
        ownerAddress,
        discountPercent: req.body.discountPercent,
        requiredLockIFR: req.body.requiredLockIFR,
        ttlSeconds: req.body.ttlSeconds,
        tierLabel: req.body.tierLabel,
      },
    });

    res.status(201).json({
      id: business.id,
      ownerAddress: business.ownerAddress,
      verifyUrl: `/b/${business.id}`,
      qrUrl: `/b/${business.id}`,
    });
  } catch (err) {
    handleSellerError(err, res, next);
  }
});

router.get('/businesses', sellerRateLimiter, async (req, res, next) => {
  try {
    const wallet = requireSellerAuth(req, 'business:list', 'seller');
    const businesses = await prisma.business.findMany({
      where: { ownerAddress: wallet, active: true },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        ownerAddress: true,
        discountPercent: true,
        requiredLockIFR: true,
        tierLabel: true,
        createdAt: true,
        _count: {
          select: { benefitRules: true },
        },
      },
    });

    res.json({
      businesses: businesses.map((business) => ({
        id: business.id,
        name: business.name,
        ownerAddress: business.ownerAddress,
        discountPercent: business.discountPercent,
        requiredLockIFR: business.requiredLockIFR,
        tierLabel: business.tierLabel,
        createdAt: business.createdAt,
        rulesCount: business._count.benefitRules,
        verifyUrl: `/b/${business.id}`,
        qrUrl: `/b/${business.id}`,
      })),
    });
  } catch (err) {
    handleSellerError(err, res, next);
  }
});

router.get('/businesses/:id/rules', sellerRateLimiter, async (req, res, next) => {
  try {
    await requireBusinessOwner(req, 'rules:list', req.params.id);
    const rules = await prisma.benefitRule.findMany({
      where: { businessId: req.params.id },
      orderBy: [{ active: 'desc' }, { requiredLockIFR: 'asc' }, { createdAt: 'asc' }],
    });
    res.json({ rules });
  } catch (err) {
    handleSellerError(err, res, next);
  }
});

router.get('/businesses/:id/sessions', sellerRateLimiter, async (req, res, next) => {
  try {
    await requireBusinessOwner(req, 'sessions:list', req.params.id);
    const requestedLimit = Number(req.query.limit || 10);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 10, 1), 50);
    const todayStartedAt = new Date();
    todayStartedAt.setUTCHours(0, 0, 0, 0);
    const now = new Date();
    const [sessions, allTimeGroups, todayGroups, todayRedemptions, openChecks] = await Promise.all([
      prisma.session.findMany({
        where: { businessId: req.params.id },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          status: true,
          recoveredAddress: true,
          lockAmountRaw: true,
          reason: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
          redeemedAt: true,
          attestAttempts: true,
          benefitRule: {
            select: {
              id: true,
              label: true,
              category: true,
              productName: true,
              discountPercent: true,
              requiredLockIFR: true,
            },
          },
          business: {
            select: {
              tierLabel: true,
              discountPercent: true,
              requiredLockIFR: true,
            },
          },
        },
      }),
      prisma.session.groupBy({
        by: ['status'],
        where: { businessId: req.params.id },
        _count: { _all: true },
      }),
      prisma.session.groupBy({
        by: ['status'],
        where: { businessId: req.params.id, createdAt: { gte: todayStartedAt } },
        _count: { _all: true },
      }),
      prisma.session.count({
        where: { businessId: req.params.id, redeemedAt: { gte: todayStartedAt } },
      }),
      prisma.session.count({
        where: {
          businessId: req.params.id,
          status: { in: ['PENDING', 'APPROVED'] },
          expiresAt: { gt: now },
        },
      }),
    ]);

    res.json({
      metrics: sellerActivityMetrics(
        allTimeGroups,
        todayGroups,
        todayStartedAt,
        todayRedemptions,
        openChecks
      ),
      sessions: sessions.map((session) => ({
        id: session.id,
        status: session.status,
        recoveredAddress: session.recoveredAddress,
        lockAmountRaw: session.lockAmountRaw,
        reason: session.reason,
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        redeemedAt: session.redeemedAt,
        attestAttempts: session.attestAttempts,
        benefitRuleId: session.benefitRule?.id ?? null,
        label: session.benefitRule?.label ?? session.business.tierLabel,
        category: session.benefitRule?.category ?? null,
        productName: session.benefitRule?.productName ?? null,
        discountPercent: session.benefitRule?.discountPercent ?? session.business.discountPercent,
        requiredLockIFR: session.benefitRule?.requiredLockIFR ?? session.business.requiredLockIFR,
      })),
    });
  } catch (err) {
    handleSellerError(err, res, next);
  }
});

router.delete('/businesses/:id', sellerRateLimiter, async (req, res, next) => {
  try {
    await requireBusinessOwner(req, 'business:delete', req.params.id);
    await prisma.$transaction([
      prisma.benefitRule.updateMany({
        where: { businessId: req.params.id, active: true },
        data: { active: false },
      }),
      prisma.business.update({
        where: { id: req.params.id },
        data: { active: false },
      }),
    ]);
    res.status(204).send();
  } catch (err) {
    handleSellerError(err, res, next);
  }
});

router.post(
  '/businesses/:id/rules',
  sellerRateLimiter,
  validate(createBenefitRuleSchema),
  async (req, res, next) => {
    try {
      await requireBusinessOwner(req, 'rules:create', req.params.id);
      const rule = await prisma.benefitRule.create({
        data: { ...req.body, businessId: req.params.id },
      });
      res.status(201).json(rule);
    } catch (err) {
      handleSellerError(err, res, next);
    }
  }
);

router.patch('/rules/:id', sellerRateLimiter, validate(updateBenefitRuleSchema), async (req, res, next) => {
  try {
    const existing = await prisma.benefitRule.findUnique({
      where: { id: req.params.id },
      select: { id: true, businessId: true },
    });
    if (!existing) {
      res.status(404).json({ error: 'Benefit rule not found' });
      return;
    }

    await requireBusinessOwner(req, 'rules:update', existing.businessId);
    const rule = await prisma.benefitRule.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(rule);
  } catch (err) {
    handleSellerError(err, res, next);
  }
});

router.delete('/rules/:id', sellerRateLimiter, async (req, res, next) => {
  try {
    const existing = await prisma.benefitRule.findUnique({
      where: { id: req.params.id },
      select: { id: true, businessId: true },
    });
    if (!existing) {
      res.status(404).json({ error: 'Benefit rule not found' });
      return;
    }

    await requireBusinessOwner(req, 'rules:delete', existing.businessId);
    await prisma.benefitRule.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    handleSellerError(err, res, next);
  }
});

export default router;
