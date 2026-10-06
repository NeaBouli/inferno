import { Response, Router } from 'express';
import { challengeRateLimiter, customerHistoryRateLimiter } from '../middleware/rateLimiter';

/**
 * Owner decision B (T-231b): the backend keeps no customer-linked history. Customer history lives
 * only on the customer's device (signed checkout-proof receipts). These endpoints stay as explicit
 * 410 responses so old clients fail clearly instead of silently.
 */
const router = Router();

const GONE = {
  error: 'Customer history is no longer stored by the server. Your checkout receipts are kept on your own device.',
  storage: 'device-local',
} as const;

function gone(_req: unknown, res: Response) {
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.set('Pragma', 'no-cache');
  res.status(410).json(GONE);
}

router.post('/challenge', challengeRateLimiter, gone);
router.post('/authorize', customerHistoryRateLimiter, gone);
router.get('/', customerHistoryRateLimiter, gone);

export default router;
