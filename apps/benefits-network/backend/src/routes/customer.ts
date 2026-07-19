import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validator';
import { challengeRateLimiter, customerHistoryRateLimiter } from '../middleware/rateLimiter';
import { prisma } from '../services/sessionService';
import {
  CustomerHistoryAuthError,
  authorizeCustomerHistory,
  issueCustomerHistoryChallenge,
  requireCustomerHistoryAccess,
} from '../services/customerHistoryAuth';

const router = Router();

const challengeSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
}).strict();

const authorizeSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  nonce: z.string().regex(/^[a-f0-9]{64}$/),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
}).strict();

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().trim().min(1).max(64).optional(),
  snapshot: z.string().datetime({ offset: true }).optional(),
}).refine(
  (value) => Boolean(value.cursor) === Boolean(value.snapshot),
  'Cursor and snapshot must be provided together'
);

function setPrivateNoStore(res: Response) {
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.set('Pragma', 'no-cache');
}

function handleCustomerHistoryError(err: unknown, res: Response, next: NextFunction) {
  if (err instanceof CustomerHistoryAuthError) {
    res.status(401).json({ error: err.message });
    return;
  }
  next(err);
}

router.post('/challenge', challengeRateLimiter, validate(challengeSchema), async (req, res, next) => {
  try {
    setPrivateNoStore(res);
    res.json(await issueCustomerHistoryChallenge(prisma, req.body.walletAddress));
  } catch (err) {
    handleCustomerHistoryError(err, res, next);
  }
});

router.post('/authorize', customerHistoryRateLimiter, validate(authorizeSchema), async (req, res, next) => {
  try {
    setPrivateNoStore(res);
    res.json(await authorizeCustomerHistory(prisma, req.body));
  } catch (err) {
    handleCustomerHistoryError(err, res, next);
  }
});

router.get('/', customerHistoryRateLimiter, async (req, res, next) => {
  try {
    const parsed = historyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid customer history pagination' });
      return;
    }
    const wallet = await requireCustomerHistoryAccess(prisma, req.header('authorization'));
    const now = new Date();
    const snapshot = parsed.data.snapshot ? new Date(parsed.data.snapshot) : now;
    if (snapshot > now) {
      res.status(400).json({ error: 'Invalid customer history snapshot' });
      return;
    }
    const cursor = parsed.data.cursor
      ? await prisma.session.findFirst({
          where: {
            id: parsed.data.cursor,
            recoveredAddress: wallet,
            createdAt: { lte: snapshot },
          },
          select: { id: true },
        })
      : null;
    if (parsed.data.cursor && !cursor) {
      res.status(400).json({ error: 'Invalid customer history cursor' });
      return;
    }

    const rows = await prisma.session.findMany({
      where: { recoveredAddress: wallet, createdAt: { lte: snapshot } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
      take: parsed.data.limit + 1,
      select: {
        id: true,
        status: true,
        reason: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        redeemedAt: true,
        benefitRuleId: true,
        benefitLabel: true,
        benefitCategory: true,
        benefitProductName: true,
        benefitDiscountPercent: true,
        benefitRequiredLockIFR: true,
        benefitDailyRedemptionLimit: true,
        benefitMonthlyRedemptionLimit: true,
        business: { select: { id: true, name: true } },
      },
    });
    const hasMore = rows.length > parsed.data.limit;
    const sessions = rows.slice(0, parsed.data.limit).map((session) => ({
      id: session.id,
      status: session.status,
      reason: session.reason,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      redeemedAt: session.redeemedAt,
      seller: session.business,
      benefit: {
        benefitRuleId: session.benefitRuleId,
        label: session.benefitLabel,
        category: session.benefitCategory,
        productName: session.benefitProductName,
        discountPercent: session.benefitDiscountPercent ?? 0,
        requiredLockIFR: session.benefitRequiredLockIFR ?? 0,
        dailyRedemptionLimit: session.benefitDailyRedemptionLimit ?? 0,
        monthlyRedemptionLimit: session.benefitMonthlyRedemptionLimit ?? 0,
      },
    }));

    setPrivateNoStore(res);
    res.json({
      sessions,
      pagination: {
        limit: parsed.data.limit,
        hasMore,
        nextCursor: hasMore ? sessions.at(-1)?.id ?? null : null,
        snapshot: snapshot.toISOString(),
      },
    });
  } catch (err) {
    handleCustomerHistoryError(err, res, next);
  }
});

export default router;
