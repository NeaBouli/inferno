import { Router } from 'express';
import { z } from 'zod';
import { createSession, getSession, redeem } from '../services/sessionService';
import { validate } from '../middleware/validator';
import { sessionRateLimiter } from '../middleware/rateLimiter';

const router = Router();

const createSessionSchema = z.object({
  businessId: z.string().min(1),
});

router.post('/', sessionRateLimiter, validate(createSessionSchema), async (req, res, next) => {
  try {
    const result = await createSession(req.body.businessId);
    res.status(201).json({
      sessionId: result.sessionId,
      expiresAt: result.expiresAt,
      qrUrl: `/r/${result.sessionId}`,
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
    const result = await redeem(req.params.id);
    res.json(result);
  } catch (err) {
    if (err instanceof Error) {
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
