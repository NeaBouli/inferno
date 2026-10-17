import { isAddress, parseUnits, ZeroAddress } from 'ethers';

const isProduction = process.env.NODE_ENV === 'production';

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`${name} is required — refusing to start with an insecure default`);
  }
  return value;
}

// Error messages name fields only: URLs and credentials can contain secrets.
function url(name: string, value: string): URL {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname.includes('*') || parsed.username || parsed.password ||
        parsed.hash || value !== value.trim() ||
        (isProduction && (parsed.protocol !== 'https:' ||
          ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)))) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) URL (HTTPS in production), without userinfo or fragment`);
  }
}

function setting(name: string, fallback = ''): string {
  return isProduction ? required(name) : (process.env[name] ?? fallback);
}

const jwtSecret = required('JWT_SECRET');
if (Buffer.byteLength(jwtSecret.trim(), 'utf8') < 32) {
  throw new Error('JWT_SECRET must contain at least 32 bytes');
}
const port = process.env.PORT ?? '3005';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
const siweDomain = required('SIWE_DOMAIN');
const siweUri = required('SIWE_URI');
if (isProduction && url('SIWE_URI', siweUri).host !== siweDomain) {
  throw new Error('SIWE_DOMAIN must exactly match the SIWE_URI host (including any port)');
}
const rpcUrl = setting('RPC_URL');
if (rpcUrl) url('RPC_URL', rpcUrl);
const allowedOrigins = setting('ALLOWED_ORIGINS', 'http://localhost:3005').split(',').map((v) => v.trim());
for (const origin of allowedOrigins) {
  if (url('ALLOWED_ORIGINS', origin).origin !== origin) {
    throw new Error('ALLOWED_ORIGINS must contain only exact origins, without paths or wildcards');
  }
}
const googleRedirectUri = setting('GOOGLE_REDIRECT_URI', 'http://localhost:3005/auth/google/callback');
const redirect = url('GOOGLE_REDIRECT_URI', googleRedirectUri);
if (redirect.pathname !== '/auth/google/callback' || redirect.search) {
  throw new Error('GOOGLE_REDIRECT_URI must use /auth/google/callback without a query');
}
const minLockIFR = process.env.MIN_LOCK_IFR ?? '1000';
try {
  if (!/^\d+(\.\d{1,9})?$/.test(minLockIFR) || parseUnits(minLockIFR, 9) <= 0n) throw new Error();
} catch {
  throw new Error('MIN_LOCK_IFR must be a positive decimal with at most 9 fractional digits');
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
  if (isProduction) {
    required('CHAIN_ID');
    required('IFRLOCK_ADDRESS');
  }
  const chainIdEnv = process.env.CHAIN_ID;
  const lockEnv = process.env.IFRLOCK_ADDRESS;
  if (chainIdEnv && lockEnv) {
    const chainId = Number(chainIdEnv);
    if (!/^[1-9]\d*$/.test(chainIdEnv) || !Number.isSafeInteger(chainId)) {
      throw new Error('CHAIN_ID must be a positive integer');
    }
    if (isProduction && chainId !== 1) throw new Error('CHAIN_ID must be 1 in production');
    if (!isAddress(lockEnv) || lockEnv.toLowerCase() === ZeroAddress) {
      throw new Error('IFRLOCK_ADDRESS must be a valid nonzero EVM address');
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
  port: Number(port),
  // Enables the Secure flag on the OAuth initiator cookie in production.
  isProduction,
  allowedOrigins,
  rpcUrl,
  ifrLockAddress: network.ifrLockAddress,
  chainId: network.chainId,
  jwtSecret,
  jwtAlgorithm: 'HS256' as const,
  jwtExpiryHours: 24,
  siweDomain,
  siweUri,
  google: {
    clientId: setting('GOOGLE_CLIENT_ID'),
    clientSecret: setting('GOOGLE_CLIENT_SECRET'),
    redirectUri: googleRedirectUri,
  },
  youtubeChannelId: setting('YOUTUBE_CHANNEL_ID'),
  minLockIFR,
  decimals: 9,
};
