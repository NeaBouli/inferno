import { NextFunction, Request, Response, Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../services/sessionService';
import { buildSellerAuthMessage, normalizeAddress, verifySellerSignature } from '../services/sellerAuth';
import { assertSellerBusinessLimit } from '../services/sellerLimits';
import { resolveCheckoutActor } from '../services/sellerAccess';
import { sellerRateLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validator';

const router = Router();
const MAX_ACTIVE_CHECKOUT_OPERATORS = 10;

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
  productId: z.string().min(1).nullable().optional(),
  label: z.string().min(1).max(80),
  category: z.string().min(1).max(80),
  productName: z.string().min(1).max(160),
  discountPercent: z.number().int().min(0).max(100),
  requiredLockIFR: z.number().int().positive(),
  ttlSeconds: z.number().int().min(10).max(3600).optional(),
  active: z.boolean().optional(),
});

const updateBenefitRuleSchema = createBenefitRuleSchema.partial();

const createProductSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().optional(),
});

const updateProductSchema = createProductSchema.partial();

const createCheckoutOperatorSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  label: z.string().trim().min(1).max(80).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

type SessionStatusCounts = Record<'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'REDEEMED', number>;
type BenefitRuleWriteInput = {
  productId?: string | null;
  label?: string;
  category?: string;
  productName?: string;
  discountPercent?: number;
  requiredLockIFR?: number;
  ttlSeconds?: number;
  active?: boolean;
};

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
    if (err.message.includes('not the business owner') || err.message.includes('not authorized for checkout')) {
      res.status(403).json({ error: err.message });
      return;
    }
    if (err.message.includes('not found')) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err.message.includes('profile limit reached') || err.message.includes('operator limit reached')) {
      res.status(429).json({ error: err.message });
      return;
    }
    if (
      err.message.includes('must be in the future') ||
      err.message.includes('already the business owner') ||
      err.message.includes('cannot be reactivated')
    ) {
      res.status(400).json({ error: err.message });
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

async function withProductSnapshot(
  businessId: string,
  input: BenefitRuleWriteInput,
  existingProductId?: string | null,
  tx?: Prisma.TransactionClient
) {
  const db = tx ?? prisma;
  const requestedProductId = input.productId;
  const productId = requestedProductId === undefined ? existingProductId : requestedProductId;
  const snapshotTouched = requestedProductId !== undefined || (
    Boolean(productId) && (input.productName !== undefined || input.category !== undefined)
  );
  if (!productId || !snapshotTouched) return input;

  const product = await db.product.findFirst({
    where: { id: String(productId), businessId, active: true },
    select: { id: true, name: true, category: true },
  });
  if (!product) throw new Error('Active product not found for this business');
  return {
    ...input,
    productId: product.id,
    productName: product.name,
    category: product.category,
  };
}

async function lockActiveProduct(
  tx: Prisma.TransactionClient,
  productId: string,
  businessId: string
) {
  const lockedProducts = await tx.$executeRaw`
    UPDATE "Product"
    SET "active" = "active"
    WHERE "id" = ${productId}
      AND "businessId" = ${businessId}
      AND "active" = 1
  `;
  if (lockedProducts !== 1) throw new Error('Active product not found for this business');
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
          select: { benefitRules: true, products: true },
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
        productsCount: business._count.products,
        verifyUrl: `/b/${business.id}`,
        qrUrl: `/b/${business.id}`,
      })),
    });
  } catch (err) {
    handleSellerError(err, res, next);
  }
});

router.get('/businesses/:id/operator-status', sellerRateLimiter, async (req, res, next) => {
  try {
    const wallet = requireSellerAuth(req, 'operators:status', req.params.id);
    const actor = await resolveCheckoutActor(req.params.id, wallet);
    if (!actor) throw new Error('Seller wallet is not authorized for checkout');
    res.json({ authorized: true, ...actor });
  } catch (err) {
    handleSellerError(err, res, next);
  }
});

router.get('/businesses/:id/operators', sellerRateLimiter, async (req, res, next) => {
  try {
    await requireBusinessOwner(req, 'operators:list', req.params.id);
    const operators = await prisma.checkoutOperator.findMany({
      where: { businessId: req.params.id },
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
    });
    res.json({ operators });
  } catch (err) {
    handleSellerError(err, res, next);
  }
});

router.post(
  '/businesses/:id/operators',
  sellerRateLimiter,
  validate(createCheckoutOperatorSchema),
  async (req, res, next) => {
    try {
      const authorizationTimestamp = Number(getSellerAuth(req).timestamp);
      const ownerWallet = await requireBusinessOwner(req, 'operators:create', req.params.id);
      const walletAddress = normalizeAddress(req.body.walletAddress);
      if (walletAddress === ownerWallet) {
        throw new Error('The business owner is already authorized for checkout');
      }

      const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
      if (expiresAt && expiresAt <= new Date()) {
        throw new Error('Checkout operator expiry must be in the future');
      }

      const now = new Date();
      const { operator, existed } = await prisma.$transaction(async (tx) => {
        const existing = await tx.checkoutOperator.findUnique({
          where: { businessId_walletAddress: { businessId: req.params.id, walletAddress } },
          select: { active: true, expiresAt: true, updatedAt: true },
        });
        if (existing && authorizationTimestamp <= existing.updatedAt.getTime()) {
          throw new Error('Seller authorization predates the latest checkout operator change');
        }

        const alreadyConsumesSlot = Boolean(
          existing?.active && (!existing.expiresAt || existing.expiresAt > now)
        );
        if (!alreadyConsumesSlot) {
          const activeCount = await tx.checkoutOperator.count({
            where: {
              businessId: req.params.id,
              active: true,
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
          });
          if (activeCount >= MAX_ACTIVE_CHECKOUT_OPERATORS) {
            throw new Error(`Checkout operator limit reached: ${MAX_ACTIVE_CHECKOUT_OPERATORS}`);
          }
        }

        const saved = await tx.checkoutOperator.upsert({
          where: { businessId_walletAddress: { businessId: req.params.id, walletAddress } },
          update: { active: true, label: req.body.label ?? null, expiresAt },
          create: {
            businessId: req.params.id,
            walletAddress,
            label: req.body.label ?? null,
            expiresAt,
          },
        });
        return { operator: saved, existed: Boolean(existing) };
      });
      res.status(existed ? 200 : 201).json(operator);
    } catch (err) {
      handleSellerError(err, res, next);
    }
  }
);

router.delete('/operators/:id', sellerRateLimiter, async (req, res, next) => {
  try {
    const authorizationTimestamp = Number(getSellerAuth(req).timestamp);
    const operator = await prisma.checkoutOperator.findUnique({
      where: { id: req.params.id },
      select: { id: true, businessId: true, updatedAt: true },
    });
    if (!operator) throw new Error('Checkout operator not found');
    await requireBusinessOwner(req, 'operators:delete', operator.businessId);
    if (authorizationTimestamp <= operator.updatedAt.getTime()) {
      throw new Error('Seller authorization predates the latest checkout operator change');
    }
    await prisma.checkoutOperator.update({
      where: { id: operator.id },
      data: { active: false },
    });
    res.status(204).send();
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

router.get('/businesses/:id/products', sellerRateLimiter, async (req, res, next) => {
  try {
    await requireBusinessOwner(req, 'products:list', req.params.id);
    const products = await prisma.product.findMany({
      where: { businessId: req.params.id },
      orderBy: [{ active: 'desc' }, { category: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { benefitRules: true } } },
    });
    res.json({ products });
  } catch (err) {
    handleSellerError(err, res, next);
  }
});

router.post(
  '/businesses/:id/products',
  sellerRateLimiter,
  validate(createProductSchema),
  async (req, res, next) => {
    try {
      await requireBusinessOwner(req, 'products:create', req.params.id);
      const product = await prisma.product.create({
        data: {
          businessId: req.params.id,
          name: req.body.name,
          category: req.body.category,
          description: req.body.description ?? null,
          active: req.body.active ?? true,
        },
        include: { _count: { select: { benefitRules: true } } },
      });
      res.status(201).json(product);
    } catch (err) {
      handleSellerError(err, res, next);
    }
  }
);

router.patch('/products/:id', sellerRateLimiter, validate(updateProductSchema), async (req, res, next) => {
  try {
    const existing = await prisma.product.findUnique({
      where: { id: req.params.id },
      select: { id: true, businessId: true, active: true },
    });
    if (!existing) throw new Error('Product not found');
    await requireBusinessOwner(req, 'products:update', existing.businessId);
    const data = {
      ...req.body,
      description: req.body.description === undefined ? undefined : req.body.description,
    };
    const product = await prisma.$transaction(async (tx) => {
      const lockedProducts = await tx.$executeRaw`
        UPDATE "Product"
        SET "active" = "active"
        WHERE "id" = ${existing.id} AND "active" = 1
      `;
      if (lockedProducts !== 1) {
        throw new Error('Archived products cannot be reactivated or edited; create a new catalog item');
      }
      if (req.body.active === false) {
        await tx.benefitRule.updateMany({
          where: { productId: existing.id, active: true },
          data: { active: false },
        });
      }
      return tx.product.update({
        where: { id: existing.id },
        data,
        include: { _count: { select: { benefitRules: true } } },
      });
    });
    res.json(product);
  } catch (err) {
    handleSellerError(err, res, next);
  }
});

router.delete('/products/:id', sellerRateLimiter, async (req, res, next) => {
  try {
    const existing = await prisma.product.findUnique({
      where: { id: req.params.id },
      select: { id: true, businessId: true },
    });
    if (!existing) throw new Error('Product not found');
    await requireBusinessOwner(req, 'products:delete', existing.businessId);
    await prisma.$transaction([
      prisma.benefitRule.updateMany({
        where: { productId: existing.id, active: true },
        data: { active: false },
      }),
      prisma.product.update({ where: { id: existing.id }, data: { active: false } }),
    ]);
    res.status(204).send();
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
          benefitSnapshotVersion: true,
          benefitLabel: true,
          benefitCategory: true,
          benefitProductName: true,
          benefitDiscountPercent: true,
          benefitRequiredLockIFR: true,
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
        label: session.benefitSnapshotVersion === 1
          ? session.benefitLabel
          : session.benefitRule?.label ?? session.business.tierLabel,
        category: session.benefitSnapshotVersion === 1
          ? session.benefitCategory
          : session.benefitRule?.category ?? null,
        productName: session.benefitSnapshotVersion === 1
          ? session.benefitProductName
          : session.benefitRule?.productName ?? null,
        discountPercent: session.benefitSnapshotVersion === 1 && session.benefitDiscountPercent !== null
          ? session.benefitDiscountPercent
          : session.benefitRule?.discountPercent ?? session.business.discountPercent,
        requiredLockIFR: session.benefitSnapshotVersion === 1 && session.benefitRequiredLockIFR !== null
          ? session.benefitRequiredLockIFR
          : session.benefitRule?.requiredLockIFR ?? session.business.requiredLockIFR,
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
      prisma.product.updateMany({
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
      const rule = await prisma.$transaction(async (tx) => {
        if (req.body.productId && req.body.active !== false) {
          await lockActiveProduct(tx, req.body.productId, req.params.id);
        }
        const data = await withProductSnapshot(req.params.id, req.body, undefined, tx);
        return tx.benefitRule.create({
          data: {
            businessId: req.params.id,
            productId: data.productId ?? null,
            label: req.body.label,
            category: data.category ?? req.body.category,
            productName: data.productName ?? req.body.productName,
            discountPercent: req.body.discountPercent,
            requiredLockIFR: req.body.requiredLockIFR,
            ttlSeconds: req.body.ttlSeconds,
            active: req.body.active,
          },
        });
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
      select: { id: true, businessId: true, productId: true },
    });
    if (!existing) {
      res.status(404).json({ error: 'Benefit rule not found' });
      return;
    }

    await requireBusinessOwner(req, 'rules:update', existing.businessId);
    const targetProductId = req.body.productId === undefined ? existing.productId : req.body.productId;
    const rule = await prisma.$transaction(async (tx) => {
      if (req.body.active === true && targetProductId) {
        await lockActiveProduct(tx, targetProductId, existing.businessId);
      }
      const data = await withProductSnapshot(existing.businessId, req.body, existing.productId, tx);
      return tx.benefitRule.update({
        where: { id: req.params.id },
        data,
      });
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
    await prisma.benefitRule.update({
      where: { id: req.params.id },
      data: { active: false },
    });
    res.status(204).send();
  } catch (err) {
    handleSellerError(err, res, next);
  }
});

export default router;
