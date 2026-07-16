import { Request, Router } from 'express';
import { z } from 'zod';
import { createSession, getSession, prisma, redeem } from '../services/sessionService';
import { normalizeAddress, verifySellerSignature } from '../services/sellerAuth';
import { validate } from '../middleware/validator';
import { sessionRateLimiter } from '../middleware/rateLimiter';

const router = Router();

const createSessionSchema = z.object({
  businessId: z.string().min(1),
  benefitRuleId: z.string().min(1).optional(),
});

function getSellerAuth(req: Request) {
  return {
    walletAddress: String(req.header('x-ifr-wallet') || ''),
    signature: String(req.header('x-ifr-signature') || ''),
    timestamp: String(req.header('x-ifr-timestamp') || ''),
  };
}

async function requireSessionRedeemer(req: Request, sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      business: {
        select: { ownerAddress: true },
      },
    },
  });

  if (!session) throw new Error('Session not found');
  if (!session.business.ownerAddress) {
    throw new Error('Seller-owned business required to redeem');
  }

  const wallet = verifySellerSignature({
    ...getSellerAuth(req),
    action: 'sessions:redeem',
    businessId: sessionId,
  });
  if (normalizeAddress(session.business.ownerAddress) !== wallet) {
    throw new Error('Seller wallet is not the business owner');
  }
}

router.post('/', sessionRateLimiter, validate(createSessionSchema), async (req, res, next) => {
  try {
    const result = await createSession(req.body.businessId, req.body.benefitRuleId);
    res.status(201).json({
      sessionId: result.sessionId,
      expiresAt: result.expiresAt,
      qrUrl: `/r/${result.sessionId}`,
      benefitRuleId: result.benefitRuleId,
      label: result.label,
      category: result.category,
      productName: result.productName,
      discountPercent: result.discountPercent,
      requiredLockIFR: result.requiredLockIFR,
      tierLabel: result.tierLabel,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const session = await getSession(req.params.id);
    res.json({
      status: session.status,
      recoveredAddress: session.recoveredAddress,
      reason: session.reason,
      redeemedAt: session.redeemedAt,
      expiresAt: session.expiresAt,
      businessId: session.businessId,
      benefitRuleId: session.benefit.benefitRuleId,
      benefit: session.benefit,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.post('/:id/redeem', async (req, res, next) => {
  try {
    await requireSessionRedeemer(req, req.params.id);
    const result = await redeem(req.params.id);
    res.json(result);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes('authorization') || err.message.includes('signature')) {
        res.status(401).json({ error: err.message });
        return;
      }
      if (err.message.includes('not the business owner') || err.message.includes('Seller-owned business required')) {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err.message.includes('not found')) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err.message.includes('already redeemed') || err.message.includes('cannot redeem') || err.message.includes('expired')) {
        res.status(409).json({ error: err.message });
        return;
      }
    }
    next(err);
  }
});

export default router;
