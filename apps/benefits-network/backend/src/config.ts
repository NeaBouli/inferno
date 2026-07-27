import { z } from 'zod';
import dotenv from 'dotenv';
import { getRateLimitTopologyIssues } from './services/rateLimitTopology';
import { getAdminSecretPolicyIssue } from './services/adminSecretPolicy';
import { getSellerBusinessLimitConfigIssue } from './services/sellerLimitPolicy';

dotenv.config();

const optionalAddress = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()
);

const optionalUrl = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().url().optional()
);

const envSchema = z.object({
  CHAIN_ID: z.coerce.number().int().positive().default(11155111),
  RPC_URL: z.string().url(),
  IFR_TOKEN_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  IFRLOCK_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  COMMITMENT_VAULT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  PARTNER_VAULT_ADDRESS: optionalAddress,
  BUILDER_REGISTRY_ADDRESS: optionalAddress,
  REWARD_CALLER_ADDRESS: optionalAddress,
  ADMIN_SECRET: z.string(),
  DATABASE_URL: z.string().default('file:./dev.db'),
  PORT: z.coerce.number().int().positive().default(3001),
  MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET: z.coerce.number().int().min(1).max(50).default(5),
  MAX_TOTAL_SELLER_BUSINESSES_PER_WALLET: z.coerce.number().int().min(1).max(100).default(25),
  RATE_LIMIT_STORE: z.enum(['memory', 'redis']).default('memory'),
  RATE_LIMIT_REDIS_URL: optionalUrl,
  BACKEND_REPLICA_COUNT: z.coerce.number().int().min(1).max(100).default(1),
}).superRefine((env, context) => {
  const sellerBusinessLimitIssue = getSellerBusinessLimitConfigIssue(
    env.MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET,
    env.MAX_TOTAL_SELLER_BUSINESSES_PER_WALLET
  );
  if (sellerBusinessLimitIssue) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MAX_TOTAL_SELLER_BUSINESSES_PER_WALLET'],
      message: sellerBusinessLimitIssue,
    });
  }
  const adminSecretIssue = getAdminSecretPolicyIssue(env.ADMIN_SECRET);
  if (adminSecretIssue) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ADMIN_SECRET'],
      message: adminSecretIssue,
    });
  }
  for (const issue of getRateLimitTopologyIssues({
    store: env.RATE_LIMIT_STORE,
    redisUrl: env.RATE_LIMIT_REDIS_URL,
    replicaCount: env.BACKEND_REPLICA_COUNT,
    databaseUrl: env.DATABASE_URL,
  })) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [issue.path],
      message: issue.message,
    });
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
