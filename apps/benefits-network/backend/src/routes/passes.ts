import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validator';
import { challengeRateLimiter, customerPassRateLimiter, sellerRateLimiter } from '../middleware/rateLimiter';
import { SellerAuthError, verifySellerSignature } from '../services/sellerAuth';
import { assertSellerWalletActionAllowed, AuthenticatedRateLimitError } from '../services/authenticatedRateLimiter';
import {
  CustomerPassAuthError,
  bindCustomerPass,
  cancelCustomerPass,
  confirmCustomerPass,
  createCustomerPass,
  getControlledCustomerPass,
  getCustomerPassChallenge,
  getPublicCustomerPass,
  issueCustomerPassChallenge,
} from '../services/customerPassService';
import { prisma } from '../services/sessionService';

const router = Router();
const passIdSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
const walletSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

function privateNoStore(res: Response) {
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.set('Pragma', 'no-cache');
}

function auth(req: Request) {
  return {
    walletAddress: String(req.header('x-ifr-wallet') || ''),
    signature: String(req.header('x-ifr-signature') || ''),
    timestamp: String(req.header('x-ifr-timestamp') || ''),
    nonce: String(req.header('x-ifr-nonce') || ''),
  };
}

function handleError(err: unknown, res: Response, next: (err: unknown) => void) {
  if (err instanceof CustomerPassAuthError || err instanceof SellerAuthError) {
    res.status(401).json({ error: err.message });
    return;
  }
  if (err instanceof AuthenticatedRateLimitError) {
    res.set('Retry-After', String(err.retryAfterSeconds));
    res.status(429).json({ error: err.message });
    return;
  }
  if (err instanceof Error) {
    if (err.message.includes('not found')) return void res.status(404).json({ error: err.message });
    if (err.message.includes('not authorized')) return void res.status(403).json({ error: err.message });
    if (err.message.includes('signature does not match') || err.message.includes('wallet mismatch')) {
      return void res.status(403).json({ error: err.message });
    }
    if (/unavailable|expired|already|not ready|cannot/.test(err.message)) {
      return void res.status(409).json({ error: err.message });
    }
  }
  next(err);
}

router.post('/challenge', challengeRateLimiter, validate(z.object({ walletAddress: walletSchema }).strict()), async (req, res, next) => {
  try {
    privateNoStore(res);
    res.json(await issueCustomerPassChallenge(prisma, req.body.walletAddress));
  } catch (err) { handleError(err, res, next); }
});

router.post('/', customerPassRateLimiter, validate(z.object({
  walletAddress: walletSchema,
  nonce: z.string().regex(/^[a-f0-9]{64}$/),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
}).strict()), async (req, res, next) => {
  try {
    privateNoStore(res);
    res.status(201).json(await createCustomerPass(req.body));
  } catch (err) { handleError(err, res, next); }
});

router.get('/:id', customerPassRateLimiter, async (req, res, next) => {
  try {
    if (!passIdSchema.safeParse(req.params.id).success) return void res.status(404).json({ error: 'Customer pass not found' });
    privateNoStore(res);
    const pass = await getPublicCustomerPass(req.params.id);
    if (!pass) return void res.status(404).json({ error: 'Customer pass not found' });
    res.json(pass);
  } catch (err) { handleError(err, res, next); }
});

router.get('/:id/control', customerPassRateLimiter, async (req, res, next) => {
  try {
    privateNoStore(res);
    res.json(await getControlledCustomerPass(req.params.id, req.header('authorization')));
  } catch (err) { handleError(err, res, next); }
});

router.post('/:id/bind', sellerRateLimiter, validate(z.object({
  businessId: z.string().min(1).max(200),
  benefitRuleId: z.string().min(1).max(200),
}).strict()), async (req, res, next) => {
  try {
    const scope = `${req.params.id}:${req.body.benefitRuleId}`;
    const sellerAuth = auth(req);
    if (!sellerAuth.nonce) throw new SellerAuthError('Seller authorization nonce is required');
    const sellerWallet = verifySellerSignature({
      ...sellerAuth,
      action: 'passes:bind',
      businessId: req.body.businessId,
      scope,
    });
    assertSellerWalletActionAllowed(sellerWallet);
    privateNoStore(res);
    res.status(201).json(await bindCustomerPass({
      passId: req.params.id,
      businessId: req.body.businessId,
      benefitRuleId: req.body.benefitRuleId,
      sellerWallet,
      nonce: sellerAuth.nonce,
      scope,
    }));
  } catch (err) { handleError(err, res, next); }
});

router.post('/:id/challenge', customerPassRateLimiter, async (req, res, next) => {
  try {
    privateNoStore(res);
    res.json({ message: await getCustomerPassChallenge(req.params.id, req.header('authorization')) });
  } catch (err) { handleError(err, res, next); }
});

router.post('/:id/confirm', customerPassRateLimiter, validate(z.object({
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
}).strict()), async (req, res, next) => {
  try {
    privateNoStore(res);
    res.json(await confirmCustomerPass(req.params.id, req.body.signature, req.header('authorization')));
  } catch (err) { handleError(err, res, next); }
});

router.post('/:id/cancel', customerPassRateLimiter, async (req, res, next) => {
  try {
    privateNoStore(res);
    res.json(await cancelCustomerPass(req.params.id, req.header('authorization')));
  } catch (err) { handleError(err, res, next); }
});

export default router;
