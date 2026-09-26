function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required — refusing to start with an insecure default`);
  }
  return value;
}

// Known network profiles. Defaults resolve as a consistent pair only;
// setting exactly one of CHAIN_ID / IFRLOCK_ADDRESS is a startup error.
const NETWORK_PROFILES = {
  sepolia: {
    chainId: 11155111,
    ifrLockAddress: '0x0Cab0A9440643128540222acC6eF5028736675d3',
  },
} as const;

function resolveNetwork(): { chainId: number; ifrLockAddress: string } {
  const chainIdEnv = process.env.CHAIN_ID;
  const lockEnv = process.env.IFRLOCK_ADDRESS;
  if (chainIdEnv && lockEnv) {
    const chainId = Number(chainIdEnv);
    if (!Number.isInteger(chainId) || chainId <= 0) {
      throw new Error('CHAIN_ID must be a positive integer');
    }
    return { chainId, ifrLockAddress: lockEnv };
  }
  if (chainIdEnv || lockEnv) {
    throw new Error(
      'CHAIN_ID and IFRLOCK_ADDRESS must be configured together (no mixed-network default)'
    );
  }
  return { ...NETWORK_PROFILES.sepolia };
}

const network = resolveNetwork();

export const CONFIG = {
  port: parseInt(process.env.PORT || '3005'),
  // Enables the Secure flag on the OAuth initiator cookie in production.
  isProduction: process.env.NODE_ENV === 'production',
  rpcUrl: process.env.RPC_URL || '',
  ifrLockAddress: network.ifrLockAddress,
  chainId: network.chainId,
  jwtSecret: required('JWT_SECRET'),
  jwtAlgorithm: 'HS256' as const,
  jwtExpiryHours: 24,
  siweDomain: required('SIWE_DOMAIN'),
  siweUri: required('SIWE_URI'),
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3005/auth/google/callback',
  },
  youtubeChannelId: process.env.YOUTUBE_CHANNEL_ID || '',
  minLockIFR: process.env.MIN_LOCK_IFR || '1000',
  decimals: 9,
};
