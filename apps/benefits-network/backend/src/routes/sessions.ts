import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { createAuthorizedSession, getSession, prisma, redeem } from '../services/sessionService';
import { SellerAuthError, verifySellerSignature } from '../services/sellerAuth';
import { resolveCheckoutActor } from '../services/sellerAccess';
import { validate } from '../middleware/validator';
import { sessionRateLimiter } from '../middleware/rateLimiter';
import {
  AuthenticatedRateLimitError,
  assertSellerWalletActionAllowed,
} from '../services/authenticatedRateLimiter';
import { consumeSellerAuthorizationChallenge } from '../services/sellerAuthorizationChallenge';

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

async function requireSessionRedeemer(req: Request, sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      businessId: true,
      business: {
        select: { ownerAddress: true },
      },
    },
  });

  if (!session) throw new Error('Session not found');
  if (!session.business.ownerAddress) {
    throw new Error('Seller-owned business required to redeem');
  }

  const auth = getSellerAuth(req);
  if (!auth.nonce) throw new SellerAuthError('Seller authorization nonce is required');
  const wallet = verifySellerSignature({
    ...auth,
    action: 'sessions:redeem',
    businessId: sessionId,
    scope: sessionId,
  });
  assertSellerWalletActionAllowed(wallet);
  await consumeSellerAuthorizationChallenge(prisma, {
    nonce: auth.nonce,
    walletAddress: wallet,
    action: 'sessions:redeem',
    businessId: sessionId,
    scope: sessionId,
  });
  const actor = await resolveCheckoutActor(session.businessId, wallet);
  if (!actor) throw new Error('Seller wallet is not authorized for checkout');
  return actor;
}

function requireSessionCreator(req: Request, businessId: string, scope: string) {
  const auth = getSellerAuth(req);
  if (!auth.nonce) throw new SellerAuthError('Seller authorization nonce is required');
  const wallet = verifySellerSignature({
    ...auth,
    action: 'sessions:create',
    businessId,
    scope,
  });
  assertSellerWalletActionAllowed(wallet);
  return { walletAddress: wallet, nonce: auth.nonce, scope };
}

function handleSessionAuthError(err: unknown, res: Response) {
  if (err instanceof AuthenticatedRateLimitError) {
    res.set('Retry-After', String(err.retryAfterSeconds));
    res.status(429).json({ error: err.message });
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
    const creatorAuthorization = requireSessionCreator(req, req.body.businessId, scope);
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
      discountPercent: result.discountPercent,
      requiredLockIFR: result.requiredLockIFR,
      dailyRedemptionLimit: result.dailyRedemptionLimit,
      monthlyRedemptionLimit: result.monthlyRedemptionLimit,
      tierLabel: result.tierLabel,
      createdBy: { authorized: true, ...result.createdBy },
    });
  } catch (err) {
    if (handleSessionAuthError(err, res)) return;
    if (err instanceof Error && err.message.includes('not found')) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
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

router.post('/:id/redeem', async (req, res, next) => {
  try {
    const actor = await requireSessionRedeemer(req, req.params.id);
    const result = await redeem(req.params.id, actor);
    res.json(result);
  } catch (err) {
    if (handleSessionAuthError(err, res)) return;
    if (err instanceof Error) {
      if (err.message.includes('not found')) {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err.message.includes('redemption limit reached')) {
        res.status(429).json({ error: err.message });
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
