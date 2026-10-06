import { Response, Router } from 'express';
import { z } from 'zod';
import {
  CustomerLimitNotHostedError,
  CustomerProofInputError,
  CustomerProofMismatchError,
  buildChallengeMessage,
  attest,
} from '../services/sessionService';
import { validate } from '../middleware/validator';
import { attestRateLimiter, challengeRateLimiter } from '../middleware/rateLimiter';

const router = Router();

// Owner decision B (T-231b): the full wallet travels in the request only and is never stored.
const attestSchema = z.object({
  sessionId: z.string().min(1),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
}).strict();

function privateNoStore(res: Response) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
}

/** Shared mapping for customer checkout-proof errors (also used by customer passes). */
export function customerProofErrorStatus(err: unknown): number | null {
  if (err instanceof CustomerProofInputError) return 400;
  if (err instanceof CustomerProofMismatchError) return 403;
  if (err instanceof CustomerLimitNotHostedError) return 409;
  if (!(err instanceof Error)) return null;
  if (err.message.includes('Customer pass confirmation required')) return 403;
  if (err.message.includes('not found')) return 404;
  if (
    err.message.includes('cannot attest') ||
    err.message.includes('expired') ||
    err.message.includes('attempts exceeded') ||
    err.message.includes('already redeemed') ||
    err.message.includes('no longer authorized') ||
    err.message.includes('no longer active')
  ) return 409;
  if (err.message.includes('On-chain verification failed')) return 503;
  return null;
}

const challengeSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
}).strict();

// POST /api/sessions/:id/challenge { walletAddress } — the server derives the exact proof text for
// the claimed wallet; nothing is stored. POST keeps the address out of URLs and access logs.
router.post('/sessions/:id/challenge', challengeRateLimiter, validate(challengeSchema), async (req, res, next) => {
  privateNoStore(res);
  try {
    const message = await buildChallengeMessage(req.params.id, req.body.walletAddress);
    res.json({ message });
  } catch (err) {
    const status = customerProofErrorStatus(err);
    if (status && err instanceof Error) {
      res.status(status).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.get('/sessions/:id/challenge', challengeRateLimiter, (_req, res) => {
  privateNoStore(res);
  res.status(410).json({
    error: 'Request the checkout proof with POST and { walletAddress } in the JSON body.',
  });
});

router.post('/attest', attestRateLimiter, validate(attestSchema), async (req, res, next) => {
  privateNoStore(res);
  try {
    const result = await attest(req.body.sessionId, req.body.walletAddress, req.body.signature);
    res.json(result);
  } catch (err) {
    const status = customerProofErrorStatus(err);
    if (status && err instanceof Error) {
      res.status(status).json({ error: err.message });
      return;
    }
    next(err);
  }
});

export default router;
