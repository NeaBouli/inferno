import { Request, Response, NextFunction } from "express";
import * as jose from "jose";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "dev-secret");

export interface AuthRequest extends Request {
  wallet?: string;
}

export async function createToken(wallet: string): Promise<string> {
  return new jose.SignJWT({ wallet })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(JWT_SECRET);
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authorization required" });
    return;
  }

  try {
    const token = header.slice(7);
    const { payload } = await jose.jwtVerify(token, JWT_SECRET);
    req.wallet = payload.wallet as string;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
