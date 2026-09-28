import { Router } from 'express';
import { authMiddleware, AuthPayload } from '../middleware/auth';
import { checkEntitlement, DEFAULT_ENTITLEMENT } from '../services/entitlement';
import { getYouTubeSession } from '../services/session-store';

const router = Router();

// Check access for authenticated user
router.get('/check', authMiddleware, async (req, res) => {
  const auth = (req as any).auth as AuthPayload;
  const session = getYouTubeSession(auth.sid);
  const result = await checkEntitlement(
    auth.walletAddress,
    session?.accessToken,
    DEFAULT_ENTITLEMENT
  );
  res.json({
    granted: result.granted,
    reasons: result.reasons,
    walletAddress: auth.walletAddress,
    hasYouTubeAuth: !!session,
  });
});

export default router;
