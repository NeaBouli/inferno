import { Request, Router } from 'express';
import { google } from 'googleapis';
import jwt from 'jsonwebtoken';
import { SiweMessage } from 'siwe';
import { CONFIG } from '../config';
import { AuthPayload } from '../middleware/auth';
import {
  claimOAuthState,
  claimSiweNonce,
  createOAuthState,
  createSiweNonce,
  createYouTubeSession,
  OAUTH_STATE_TTL_MS,
} from '../services/session-store';

const router = Router();

// Initiator cookie binding the OAuth state to this browser session. It carries
// only a random verifier — never provider tokens or wallet authority.
const OAUTH_COOKIE = 'cg_oauth';

const oauth2Client = new google.auth.OAuth2(
  CONFIG.google.clientId,
  CONFIG.google.clientSecret,
  CONFIG.google.redirectUri
);

function issueJwt(payload: { walletAddress?: string; sid?: string }): string {
  return jwt.sign(payload, CONFIG.jwtSecret, {
    algorithm: CONFIG.jwtAlgorithm,
    expiresIn: `${CONFIG.jwtExpiryHours}h`,
  });
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    // The verifier is base64url, so no decoding is needed or wanted.
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

// A query/body wallet is untrusted input: it never enters OAuth state or JWTs.
function hasUntrustedWalletInput(req: Request): boolean {
  return req.query.wallet !== undefined || req.body?.wallet !== undefined;
}

const UNTRUSTED_WALLET_ERROR =
  'wallet must be proven with a SIWE bearer token, not query/body input';

// Step 1: Google OAuth redirect. A wallet is linked only from a verified
// canonical SIWE bearer JWT; without one the Google JWT carries no wallet.
router.get('/google', (req, res) => {
  if (hasUntrustedWalletInput(req)) {
    res.status(400).json({ error: UNTRUSTED_WALLET_ERROR });
    return;
  }
  let walletAddress: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader !== undefined) {
    try {
      const payload = jwt.verify(authHeader.replace('Bearer ', ''), CONFIG.jwtSecret, {
        algorithms: [CONFIG.jwtAlgorithm],
      }) as AuthPayload;
      walletAddress =
        typeof payload.walletAddress === 'string' ? payload.walletAddress : undefined;
    } catch {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }
  }
  const { state, verifier } = createOAuthState(walletAddress);
  res.cookie(OAUTH_COOKIE, verifier, {
    httpOnly: true,
    // The callback is a top-level cross-site navigation back from Google.
    sameSite: 'lax',
    secure: CONFIG.isProduction,
    path: '/auth',
    maxAge: OAUTH_STATE_TTL_MS,
  });
  const url = oauth2Client.generateAuthUrl({
    scope: ['https://www.googleapis.com/auth/youtube.readonly'],
    state,
  });
  res.redirect(url);
});

// Step 2: Google OAuth callback. The state is single-use and valid only with
// the matching initiator cookie — replay, cross-session use and expiry fail.
router.get('/google/callback', async (req, res) => {
  if (hasUntrustedWalletInput(req)) {
    res.status(400).json({ error: UNTRUSTED_WALLET_ERROR });
    return;
  }
  const { code, state } = req.query as Record<string, string>;
  if (!code || !state) {
    res.status(400).json({ error: 'code and state required' });
    return;
  }
  const verifier = readCookie(req, OAUTH_COOKIE);
  if (!verifier) {
    res.status(400).json({ error: 'Missing OAuth session cookie' });
    return;
  }
  const oauthState = claimOAuthState(state, verifier);
  if (!oauthState) {
    res.status(400).json({ error: 'Invalid or expired OAuth state' });
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.access_token) {
      res.status(502).json({ error: 'OAuth failed' });
      return;
    }
    // Provider tokens stay server-side; the client JWT carries only minimal claims.
    const sid = createYouTubeSession({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? undefined,
    });
    const token = issueJwt({ walletAddress: oauthState.walletAddress, sid });
    res.json({ token, expiresIn: `${CONFIG.jwtExpiryHours}h` });
  } catch {
    res.status(500).json({ error: 'OAuth failed' });
  }
});

// SIWE Step 1: Get nonce
router.get('/siwe/nonce', (_req, res) => {
  res.json({ nonce: createSiweNonce() });
});

// SIWE Step 2: Verify signature and issue JWT.
// The message must bind our exact domain, URI, chain ID, nonce and time window.
router.post('/siwe/verify', async (req, res) => {
  const { message, signature } = req.body;

  if (!message || !signature) {
    res.status(400).json({ error: 'message and signature required' });
    return;
  }

  try {
    const siweMessage = new SiweMessage(message);
    const { data } = await siweMessage.verify({
      signature,
      domain: CONFIG.siweDomain,
      time: new Date().toISOString(),
    });

    if (data.uri !== CONFIG.siweUri) {
      res.status(401).json({ error: 'SIWE verification failed' });
      return;
    }

    // Single-use nonce issued by us; burned even on downstream rejection
    if (!claimSiweNonce(data.nonce)) {
      res.status(400).json({ error: 'Invalid or expired nonce' });
      return;
    }

    if (data.chainId !== CONFIG.chainId) {
      res.status(400).json({ error: `Wrong chain. Expected ${CONFIG.chainId}` });
      return;
    }

    const token = issueJwt({ walletAddress: data.address });
    res.json({ token, wallet: data.address, expiresIn: `${CONFIG.jwtExpiryHours}h` });
  } catch {
    res.status(401).json({ error: 'SIWE verification failed' });
  }
});

export default router;
