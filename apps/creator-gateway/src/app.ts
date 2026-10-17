import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { CONFIG } from './config';
import authRouter from './routes/auth';
import accessRouter from './routes/access';

export const app = express();
app.disable('x-powered-by');
// Production has one Traefik hop and no published container port.
if (CONFIG.isProduction) app.set('trust proxy', 1);
app.use(cors({ origin: CONFIG.allowedOrigins }));
app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
// Liveness must remain available when the public request budget is exhausted.
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use(express.json({ limit: '10kb' }));
app.use(rateLimit({ windowMs: 60_000, max: 60 }));
app.use('/auth', authRouter);
app.use('/access', accessRouter);
