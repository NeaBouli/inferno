import { z } from 'zod';
import dotenv from 'dotenv';
import { getRateLimitTopologyIssues } from './services/rateLimitTopology';
import { getAdminSecretPolicyIssue } from './services/adminSecretPolicy';
import { getSellerBusinessLimitConfigIssue } from './services/sellerLimitPolicy';
import { getSellerAuthConfigIssues } from './services/sellerAuthConfigPolicy';
import { getCustomerWalletKeyPolicyIssue } from './services/walletFingerprint';

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
  NODE_ENV: z.string().optional(),
  SELLER_AUTH_DOMAIN: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().optional()
  ),
  CHAIN_ID: z.coerce.number().int().positive().default(11155111),
  RPC_URL: z.string().url(),
  IFR_TOKEN_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  IFRLOCK_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  COMMITMENT_VAULT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  // ifr-benefits-verify/2: optional CommitmentVault V2; when set, its active TIME_ONLY tranches are
  // added to V1's for the commitment source (never added to IFRLock).
  COMMITMENT_VAULT_V2_ADDRESS: optionalAddress,
  PARTNER_VAULT_ADDRESS: optionalAddress,
  BUILDER_REGISTRY_ADDRESS: optionalAddress,
  REWARD_CALLER_ADDRESS: optionalAddress,
  // Lane 4 Model B settlement export; default-off, see services/modelBPolicy.ts.
  MODEL_B_SETTLEMENT_ENABLED: z.string().optional(),
  MODEL_B_PILOT_POLICY_JSON: z.string().optional(),
  ADMIN_SECRET: z.string(),
  // T-231a: server-side HMAC key for customer wallet fingerprints. Never logged. When absent, every
  // path that would store or compare a customer identity refuses with 503 (fail closed).
  CUSTOMER_WALLET_HMAC_KEY: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().optional()
  ),
  DATABASE_URL: z.string().default('file:./dev.db'),
  PORT: z.coerce.number().int().positive().default(3001),
  MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET: z.coerce.number().int().min(1).max(50).default(5),
  MAX_TOTAL_SELLER_BUSINESSES_PER_WALLET: z.coerce.number().int().min(1).max(100).default(25),
  RATE_LIMIT_STORE: z.enum(['memory', 'redis']).default('memory'),
  RATE_LIMIT_REDIS_URL: optionalUrl,
  BACKEND_REPLICA_COUNT: z.coerce.number().int().min(1).max(100).default(1),
}).superRefine((env, context) => {
  for (const issue of getSellerAuthConfigIssues({
    nodeEnv: env.NODE_ENV,
    rawChainId: process.env.CHAIN_ID,
    sellerAuthDomain: env.SELLER_AUTH_DOMAIN,
  })) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [issue.path],
      message: issue.message,
    });
  }
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
  const customerWalletKeyIssue = getCustomerWalletKeyPolicyIssue(env.CUSTOMER_WALLET_HMAC_KEY, env.ADMIN_SECRET);
  if (customerWalletKeyIssue) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CUSTOMER_WALLET_HMAC_KEY'],
      message: customerWalletKeyIssue,
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

export const config = {
  ...parsed.data,
  // Development default only; production refuses to start without an explicit value.
  SELLER_AUTH_DOMAIN: parsed.data.SELLER_AUTH_DOMAIN ?? 'localhost',
};
