import { Router, Request, Response } from "express";
import { SiweMessage, generateNonce } from "siwe";
import { prisma } from "../db.js";
import { createToken } from "../middleware/auth.js";
import { siweVerifyLimit } from "../middleware/rate-limit.js";
import { isAllowedSiweContext, pointsSecurityConfig } from "../config/security.js";

const router = Router();

// In-memory nonce store (keyed by nonce value, expires after 5 min)
const nonceStore = new Map<string, number>();

// Cleanup expired nonces every minute
setInterval(() => {
  const now = Date.now();
  for (const [nonce, expiresAt] of nonceStore) {
    if (expiresAt <= now) nonceStore.delete(nonce);
  }
}, 60_000).unref();

/** POST /auth/siwe/nonce — generate a nonce for SIWE */
router.post("/siwe/nonce", (_req: Request, res: Response) => {
  const nonce = generateNonce();
  nonceStore.set(nonce, Date.now() + 5 * 60 * 1000); // 5 min expiry
  res.json({ nonce });
});

/** POST /auth/siwe/verify — verify SIWE message + signature, return JWT */
router.post("/siwe/verify", siweVerifyLimit, async (req: Request, res: Response) => {
  const { message, signature } = req.body;

  if (!message || !signature) {
    res.status(400).json({ error: "message and signature required" });
    return;
  }

  try {
    const siweMessage = new SiweMessage(message);
    const nonce = siweMessage.nonce;
    const expiresAt = nonceStore.get(nonce);
    if (!expiresAt || expiresAt <= Date.now()) {
      nonceStore.delete(nonce);
      res.status(401).json({ error: "Invalid or expired nonce" });
      return;
    }

    if (!isAllowedSiweContext(
      siweMessage.domain,
      siweMessage.uri,
      siweMessage.chainId,
      pointsSecurityConfig,
    )) {
      nonceStore.delete(nonce);
      res.status(401).json({ error: "SIWE context is not allowed" });
      return;
    }

    // Consume before asynchronous verification so concurrent replays cannot share a nonce.
    nonceStore.delete(nonce);

    const result = await siweMessage.verify({
      signature,
      domain: siweMessage.domain,
      nonce,
    });

    if (!result.success) {
      res.status(401).json({ error: "Invalid SIWE signature" });
      return;
    }

    const address = siweMessage.address.toLowerCase();

    // Upsert wallet
    await prisma.wallet.upsert({
      where: { address },
      update: {},
      create: { address },
    });

    const token = await createToken(address);
    res.json({ token, wallet: address });
  } catch (err) {
    console.error("SIWE verify error:", err);
    res.status(400).json({ error: "Failed to verify SIWE message" });
  }
});

export default router;
