import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validator';
import {
  challengeRateLimiter,
  customerPassRateLimiter,
  customerPassReadIpRateLimiter,
  customerPassReadRateLimiter,
  sellerRateLimiter,
} from '../middleware/rateLimiter';
import { config } from '../config';
import { SellerAuthError, resolveSellerAuthContext, verifySellerSignature } from '../services/sellerAuth';
import { assertSellerWalletActionAllowed, AuthenticatedRateLimitError } from '../services/authenticatedRateLimiter';
import { RateLimitStoreUnavailableError } from '../services/rateLimitInfrastructure';
import {
  CustomerPassAuthError,
  bindCustomerPass,
  cancelCustomerPass,
  confirmCustomerPass,
  createCustomerPass,
  getControlledCustomerPass,
  getCustomerPassChallenge,
  getPublicCustomerPass,
} from '../services/customerPassService';
import { CustomerLimitNotHostedError } from '../services/sessionService';
import { customerProofErrorStatus } from './attest';

const router = Router();
const passIdSchema = z.string().regex(/^[A-Za-z0-9_-]{32}$/);

function privateNoStore(res: Response) {
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.set('Pragma', 'no-cache');
}

function requirePassId(req: Request, res: Response, next: NextFunction) {
  if (!passIdSchema.safeParse(req.params.id).success) {
    res.status(404).json({ error: 'Customer pass not found' });
    return;
  }
  next();
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
  if (err instanceof RateLimitStoreUnavailableError) {
    res.status(503).json({ error: err.message });
    return;
  }
  if (err instanceof CustomerLimitNotHostedError) {
    res.status(409).json({ error: err.message });
    return;
  }
  const proofStatus = customerProofErrorStatus(err);
  if (proofStatus && proofStatus !== 404 && err instanceof Error) {
    res.status(proofStatus).json({ error: err.message });
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

// Owner decision B (T-231b): pass creation no longer takes or stores a wallet.
router.post('/challenge', challengeRateLimiter, (_req, res) => {
  privateNoStore(res);
  res.status(410).json({
    error: 'Customer pass wallet challenges were removed; create a pass without a wallet (POST /api/passes).',
  });
});

router.post('/', customerPassRateLimiter, validate(z.object({}).strict()), async (_req, res, next) => {
  try {
    privateNoStore(res);
    res.status(201).json(await createCustomerPass());
  } catch (err) { handleError(err, res, next); }
});

router.get('/:id', customerPassRateLimiter, requirePassId, async (req, res, next) => {
  try {
    privateNoStore(res);
    const pass = await getPublicCustomerPass(req.params.id);
    if (!pass) return void res.status(404).json({ error: 'Customer pass not found' });
    res.json(pass);
  } catch (err) { handleError(err, res, next); }
});

router.get(
  '/:id/control',
  customerPassReadIpRateLimiter,
  requirePassId,
  customerPassReadRateLimiter,
  async (req, res, next) => {
    try {
      privateNoStore(res);
      res.json(await getControlledCustomerPass(req.params.id, req.header('authorization')));
    } catch (err) { handleError(err, res, next); }
  }
);

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
      context: resolveSellerAuthContext(config),
      action: 'passes:bind',
      businessId: req.body.businessId,
      scope,
    });
    await assertSellerWalletActionAllowed(sellerWallet);
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

// Owner decision B (T-231b): the full wallet is supplied per request and never stored.
const walletSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

router.post('/:id/challenge', customerPassRateLimiter, validate(z.object({
  walletAddress: walletSchema,
}).strict()), async (req, res, next) => {
  try {
    privateNoStore(res);
    res.json({
      message: await getCustomerPassChallenge(req.params.id, req.body.walletAddress, req.header('authorization')),
    });
  } catch (err) { handleError(err, res, next); }
});

router.post('/:id/confirm', customerPassRateLimiter, validate(z.object({
  walletAddress: walletSchema,
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
}).strict()), async (req, res, next) => {
  try {
    privateNoStore(res);
    res.json(await confirmCustomerPass(
      req.params.id,
      req.body.walletAddress,
      req.body.signature,
      req.header('authorization')
    ));
  } catch (err) { handleError(err, res, next); }
});

router.post('/:id/cancel', customerPassRateLimiter, async (req, res, next) => {
  try {
    privateNoStore(res);
    res.json(await cancelCustomerPass(req.params.id, req.header('authorization')));
  } catch (err) { handleError(err, res, next); }
});

export default router;
