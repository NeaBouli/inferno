import { Router } from 'express';
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import { CONFIG } from '../config';

const router = Router();

const oauth2Client = new google.auth.OAuth2(
  CONFIG.google.clientId,
  CONFIG.google.clientSecret,
  CONFIG.google.redirectUri
);

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

// Wallet-only auth (no YouTube)
router.post('/wallet', (req, res) => {
  const { walletAddress } = req.body;
  if (!walletAddress) return res.status(400).json({ error: 'walletAddress required' });
  // Note: In production, verify SIWE signature here
  const token = jwt.sign(
    { walletAddress },
    CONFIG.jwtSecret,
    { expiresIn: `${CONFIG.jwtExpiryHours}h` }
  );
  res.json({ token });
});

export default router;
