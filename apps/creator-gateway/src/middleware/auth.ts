import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { CONFIG } from '../config';

export interface AuthPayload {
  walletAddress?: string;
  youtubeAccessToken?: string;
  iat: number;
  exp: number;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const payload = jwt.verify(token, CONFIG.jwtSecret) as AuthPayload;
    (req as any).auth = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
