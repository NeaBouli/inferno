import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { CustomerLimitNotHostedError, createAuthorizedSession, getSession } from '../services/sessionService';
import { config } from '../config';
import { SellerAuthError, resolveSellerAuthContext, verifySellerSignature } from '../services/sellerAuth';
import { validate } from '../middleware/validator';
import { redeemRateLimiter, sessionRateLimiter, sessionStatusRateLimiter } from '../middleware/rateLimiter';
import {
  AuthenticatedRateLimitError,
  assertSellerWalletActionAllowed,
} from '../services/authenticatedRateLimiter';
import { RateLimitStoreUnavailableError } from '../services/rateLimitInfrastructure';

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
    nonce: String(req.header('x-ifr-nonce') || ''),
  };
}

async function requireSessionCreator(req: Request, businessId: string, scope: string) {
  const auth = getSellerAuth(req);
  if (!auth.nonce) throw new SellerAuthError('Seller authorization nonce is required');
  const wallet = verifySellerSignature({
    ...auth,
    context: resolveSellerAuthContext(config),
    action: 'sessions:create',
    businessId,
    scope,
  });
  await assertSellerWalletActionAllowed(wallet);
  return { walletAddress: wallet, nonce: auth.nonce, scope };
}

function handleSessionAuthError(err: unknown, res: Response) {
  if (err instanceof AuthenticatedRateLimitError) {
    res.set('Retry-After', String(err.retryAfterSeconds));
    res.status(429).json({ error: err.message });
    return true;
  }
  if (err instanceof RateLimitStoreUnavailableError) {
    res.status(503).json({ error: err.message });
    return true;
  }
  if (err instanceof SellerAuthError) {
    res.status(401).json({ error: err.message });
    return true;
  }
  if (err instanceof Error) {
    if (err.message.includes('authorization challenge')) {
      res.status(401).json({ error: err.message });
      return true;
    }
    if (err.message.includes('authorized for checkout') || err.message.includes('Seller-owned business required')) {
      res.status(403).json({ error: err.message });
      return true;
    }
  }
  return false;
}

function publicSessionReason(status: string) {
  if (status === 'EXPIRED') return 'Session expired.';
  if (status === 'REJECTED') {
    return 'Verification was not approved. The customer can review details on their device.';
  }
  return null;
}

router.post('/', sessionRateLimiter, validate(createSessionSchema), async (req, res, next) => {
  try {
    const scope = req.body.benefitRuleId || 'default';
    const creatorAuthorization = await requireSessionCreator(req, req.body.businessId, scope);
    const result = await createAuthorizedSession(
      req.body.businessId,
      req.body.benefitRuleId,
      creatorAuthorization
    );
    if (!result.createdBy) throw new Error('Authorized session creator was not recorded');
    res.status(201).json({
      sessionId: result.sessionId,
      expiresAt: result.expiresAt,
      qrUrl: `/r/${result.sessionId}`,
      benefitRuleId: result.benefitRuleId,
      label: result.label,
      category: result.category,
      productName: result.productName,
      basePriceMinor: result.basePriceMinor,
      currency: result.currency,
      discountPercent: result.discountPercent,
      requiredLockIFR: result.requiredLockIFR,
      minIFRHeld: result.minIFRHeld,
      lockSource: result.lockSource,
      dailyRedemptionLimit: result.dailyRedemptionLimit,
      monthlyRedemptionLimit: result.monthlyRedemptionLimit,
      tierLabel: result.tierLabel,
      createdBy: { authorized: true, ...result.createdBy },
    });
  } catch (err) {
    if (handleSessionAuthError(err, res)) return;
    if (err instanceof CustomerLimitNotHostedError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof Error && err.message.includes('not found')) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.get('/:id', sessionStatusRateLimiter, async (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  try {
    const session = await getSession(req.params.id);
    res.json({
      status: session.status,
      reason: publicSessionReason(session.status),
      redeemedAt: session.redeemedAt,
      expiresAt: session.expiresAt,
      attestAttempts: session.attestAttempts,
      businessId: session.businessId,
      benefitRuleId: session.benefit.benefitRuleId,
      benefit: session.benefit,
      presentation: session.customerPassId ? 'CUSTOMER_PASS' : 'SELLER_QR',
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// Owner decision B (T-231b): redemption completes atomically inside the customer's checkout proof
// (fresh eligibility needs the wallet, which exists only in that request). The seller's
// confirmation is the authenticated sessions:create / passes:bind that opened the checkout.
router.post('/:id/redeem', redeemRateLimiter, (_req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.status(410).json({
    error: 'Separate seller redemption was removed: the checkout is redeemed atomically when the customer proof is accepted. Poll GET /api/sessions/:id for REDEEMED.',
  });
});

export default router;
