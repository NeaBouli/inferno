import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  const token = header.slice(7);
  if (token !== config.ADMIN_SECRET) {
    res.status(403).json({ error: 'Invalid admin secret' });
    return;
  }

  next();
}
