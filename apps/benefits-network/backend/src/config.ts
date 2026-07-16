import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  CHAIN_ID: z.coerce.number().int().positive().default(11155111),
  RPC_URL: z.string().url(),
  IFRLOCK_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  ADMIN_SECRET: z.string().min(8),
  DATABASE_URL: z.string().default('file:./dev.db'),
  PORT: z.coerce.number().int().positive().default(3001),
  MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET: z.coerce.number().int().min(1).max(50).default(5),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
