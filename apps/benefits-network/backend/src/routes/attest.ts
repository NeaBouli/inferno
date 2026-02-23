import { Router } from 'express';
import { z } from 'zod';
import { buildChallengeMessage, attest } from '../services/sessionService';
import { validate } from '../middleware/validator';
import { attestRateLimiter } from '../middleware/rateLimiter';

const router = Router();

const attestSchema = z.object({
  sessionId: z.string().min(1),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
});

// GET /api/sessions/:id/challenge — mounted on sessions router would be cleaner,
// but spec puts it here. We mount this separately in index.ts.
router.get('/sessions/:id/challenge', async (req, res, next) => {
  try {
    const message = await buildChallengeMessage(req.params.id);
    res.json({ message });
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.post('/attest', attestRateLimiter, validate(attestSchema), async (req, res, next) => {
  try {
    const result = await attest(req.body.sessionId, req.body.signature);
    res.json(result);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes('not found')) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err.message.includes('cannot attest') || err.message.includes('expired') || err.message.includes('attempts exceeded')) {
        res.status(409).json({ error: err.message });
        return;
      }
    }
    next(err);
  }
});

export default router;
