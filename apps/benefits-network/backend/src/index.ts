import express from 'express';
import cors from 'cors';
import { config } from './config';
import { initProvider } from './services/ifrLockService';
import adminRoutes from './routes/admin';
import businessRoutes from './routes/businesses';
import sessionRoutes from './routes/sessions';
import attestRoutes from './routes/attest';

const app = express();

app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3001').split(','),
}));
app.use(express.json({ limit: '10kb' }));

// Mount routes
app.use('/api/admin', adminRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api', attestRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', chainId: config.CHAIN_ID });
});

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
