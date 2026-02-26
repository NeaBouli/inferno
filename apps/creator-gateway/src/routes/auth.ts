import { Router } from 'express';
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import { SiweMessage, generateNonce } from 'siwe';
import { CONFIG } from '../config';

const router = Router();

const oauth2Client = new google.auth.OAuth2(
  CONFIG.google.clientId,
  CONFIG.google.clientSecret,
  CONFIG.google.redirectUri
);

// In-memory nonce store with 10-minute TTL
const nonceStore = new Map<string, number>();
const nonceCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [nonce, ts] of nonceStore) {
    if (now - ts > 10 * 60 * 1000) nonceStore.delete(nonce);
  }
}, 60_000);
nonceCleanupInterval.unref();

// Step 1: Google OAuth redirect
router.get('/google', (req, res) => {
  const walletAddress = req.query.wallet as string;
  const url = oauth2Client.generateAuthUrl({
    scope: ['https://www.googleapis.com/auth/youtube.readonly'],
    state: walletAddress || '',
  });
  res.redirect(url);
});

// Step 2: Google OAuth callback
router.get('/google/callback', async (req, res) => {
  const { code, state: walletAddress } = req.query as Record<string, string>;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    const token = jwt.sign(
      {
        walletAddress: walletAddress || undefined,
        youtubeAccessToken: tokens.access_token,
      },
      CONFIG.jwtSecret,
      { expiresIn: `${CONFIG.jwtExpiryHours}h` }
    );
    res.json({ token, expiresIn: `${CONFIG.jwtExpiryHours}h` });
  } catch {
    res.status(500).json({ error: 'OAuth failed' });
  }
});

// SIWE Step 1: Get nonce
router.get('/siwe/nonce', (_req, res) => {
  const nonce = generateNonce();
  nonceStore.set(nonce, Date.now());
  res.json({ nonce });
});

// SIWE Step 2: Verify signature and issue JWT
router.post('/siwe/verify', async (req, res) => {
  const { message, signature } = req.body;

  if (!message || !signature) {
    res.status(400).json({ error: 'message and signature required' });
    return;
  }

  try {
    const siweMessage = new SiweMessage(message);
    const { data } = await siweMessage.verify({ signature });

    // Verify nonce was issued by us
    if (!nonceStore.has(data.nonce)) {
      res.status(400).json({ error: 'Invalid or expired nonce' });
      return;
    }
    nonceStore.delete(data.nonce);

    // Verify chain ID matches
    if (data.chainId !== CONFIG.chainId) {
      res.status(400).json({ error: `Wrong chain. Expected ${CONFIG.chainId}` });
      return;
    }

    const token = jwt.sign(
      { walletAddress: data.address },
      CONFIG.jwtSecret,
      { expiresIn: `${CONFIG.jwtExpiryHours}h` }
    );

    res.json({ token, wallet: data.address, expiresIn: `${CONFIG.jwtExpiryHours}h` });
  } catch {
    res.status(401).json({ error: 'SIWE verification failed' });
  }
});

// Legacy wallet-only auth (kept for backward compat, uses SIWE in production)
router.post('/wallet', (req, res) => {
  const { walletAddress } = req.body;
  if (!walletAddress) {
    res.status(400).json({ error: 'walletAddress required' });
    return;
  }
  const token = jwt.sign(
    { walletAddress },
    CONFIG.jwtSecret,
    { expiresIn: `${CONFIG.jwtExpiryHours}h` }
  );
  res.json({ token });
});

export default router;
