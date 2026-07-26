import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '../config';

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const unauthorized = () => {
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.status(401).json({ error: 'Unauthorized' });
  };
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    unauthorized();
    return;
  }

  const token = header.slice(7);
  const secret = config.ADMIN_SECRET;

  // Constant-time comparison to prevent timing attacks
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(secret);
  if (tokenBuf.length !== secretBuf.length || !timingSafeEqual(tokenBuf, secretBuf)) {
    unauthorized();
    return;
  }

  next();
}
