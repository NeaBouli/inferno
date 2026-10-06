import { Request, Response, NextFunction } from "express";
import { categorizeCaptchaError } from "../services/request-error-log.js";

const CAPTCHA_SECRET = process.env.CAPTCHA_SECRET || "";
const CAPTCHA_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Middleware: verify Cloudflare Turnstile captcha token.
 * Expects `captchaToken` in request body.
 * If CAPTCHA_SECRET is not configured, middleware is bypassed (dev mode).
 */
export async function requireCaptcha(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Skip in dev/test when no secret configured
  if (!CAPTCHA_SECRET) {
    next();
    return;
  }

  const token = req.body?.captchaToken;
  if (!token) {
    res.status(400).json({ error: "Captcha token required" });
    return;
  }

  try {
    const response = await fetch(CAPTCHA_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: CAPTCHA_SECRET,
        response: token,
      }),
    });

    const data = await response.json() as { success: boolean };

    if (!data.success) {
      res.status(403).json({ error: "Captcha verification failed" });
      return;
    }

    next();
  } catch (err) {
    // Constant category only: the raw error may carry the token, secret or response body.
    console.error(`[CAPTCHA] verify_failed category=${categorizeCaptchaError(err)}`);
    res.status(503).json({ error: "Captcha service unavailable" });
  }
}
