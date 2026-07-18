import express from 'express';
import cors from 'cors';
import { config } from './config';
import { initProvider } from './services/ifrLockService';
import adminRoutes from './routes/admin';
import businessRoutes from './routes/businesses';
import sessionRoutes from './routes/sessions';
import attestRoutes from './routes/attest';
import sellerRoutes from './routes/seller';
import { prisma } from './services/sessionService';

const app = express();

// Production traffic crosses Traefik and the Next.js frontend on private Docker networks.
// Trust only private/loopback proxy hops so req.ip resolves to the first public client hop.
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);

app.use(cors({
  origin: (
    process.env.ALLOWED_ORIGINS ||
    'http://localhost:3000,http://localhost:3001,https://shop.ifrunit.tech,https://web3.ifrunit.tech,https://ifrunit.tech'
  ).split(','),
}));
app.use(express.json({ limit: '10kb' }));

// Mount routes
app.use('/api/admin', adminRoutes);
app.use('/api/seller', sellerRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api', attestRoutes);

// Health check
const healthPayload = (_req: express.Request, res: express.Response) => {
  res.json({ status: 'ok', chainId: config.CHAIN_ID });
};

app.get('/health', healthPayload);
app.get('/api/health', healthPayload);

const readyPayload = async (_req: express.Request, res: express.Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', chainId: config.CHAIN_ID, database: 'ok' });
  } catch {
    res.status(503).json({ status: 'not_ready', chainId: config.CHAIN_ID, database: 'error' });
  }
};

app.get('/ready', readyPayload);
app.get('/api/ready', readyPayload);

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Init on-chain provider and start server
initProvider();
const server = app.listen(config.PORT, () => {
  console.log(`IFR Benefits Network backend running on port ${config.PORT}`);
  console.log(`Chain ID: ${config.CHAIN_ID}`);
});

export { app, server };
