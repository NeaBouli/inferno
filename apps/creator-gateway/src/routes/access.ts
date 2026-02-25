import { Router } from 'express';
import { authMiddleware, AuthPayload } from '../middleware/auth';
import { checkEntitlement, DEFAULT_ENTITLEMENT } from '../services/entitlement';

const router = Router();

// Check access for authenticated user
router.get('/check', authMiddleware, async (req, res) => {
  const auth = (req as any).auth as AuthPayload;
  const result = await checkEntitlement(
    auth.walletAddress,
    auth.youtubeAccessToken,
    DEFAULT_ENTITLEMENT
  );
  res.json({
    granted: result.granted,
    reasons: result.reasons,
    walletAddress: auth.walletAddress,
    hasYouTubeAuth: !!auth.youtubeAccessToken,
  });
});

export default router;
