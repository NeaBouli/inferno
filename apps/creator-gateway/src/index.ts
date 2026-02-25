import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import 'dotenv/config';
import { CONFIG } from './config';
import authRouter from './routes/auth';
import accessRouter from './routes/access';

const app = express();

app.use(cors());
app.use(express.json());
app.use(rateLimit({ windowMs: 60_000, max: 60 }));

app.use('/auth', authRouter);
app.use('/access', accessRouter);

app.get('/health', (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.listen(CONFIG.port, () =>
  console.log(`IFR Creator Gateway on :${CONFIG.port}`)
);
