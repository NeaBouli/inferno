import { ethers } from "ethers";

export const MAINNET_CHAIN_ID = 1;
export const MAINNET_IFR_LOCK_ADDRESS = "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb";

export interface PointsSecurityConfig {
  chainId: number;
  rpcUrl: string;
  ifrLockAddress: string;
  siweAllowedOrigins: ReadonlySet<string>;
  isProduction: boolean;
  isTest: boolean;
}

interface LockProofRpcState {
  chainId: bigint;
  contractCode: string;
}

type LockProofRpcProbe = (config: PointsSecurityConfig) => Promise<LockProofRpcState>;

function requiredValue(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  testFallback: string,
): string {
  const value = env[name]?.trim();
  if (value) return value;
  if (env.NODE_ENV === "test") return testFallback;
  throw new Error(`[security] ${name} is required`);
}

function parseChainId(value: string): number {
  const chainId = Number(value);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("[security] CHAIN_ID must be a positive safe integer");
  }
  return chainId;
}

function parseRpcUrl(value: string, requireSecure: boolean): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("[security] RPC_URL must use http or https");
  }
  const isLoopback = url.hostname === "localhost"
    || url.hostname === "127.0.0.1"
    || url.hostname === "[::1]";
  if (requireSecure && url.protocol !== "https:" && !isLoopback) {
    throw new Error("[security] production RPC_URL must use https or loopback http");
  }
  return url.toString();
}

function parseSiweOrigins(value: string, requireHttps: boolean): ReadonlySet<string> {
  const origins = value
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .map((candidate) => {
      const url = new URL(candidate);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("[security] SIWE_ALLOWED_ORIGINS entries must use http or https");
      }
      if (requireHttps && url.protocol !== "https:") {
        throw new Error("[security] production SIWE_ALLOWED_ORIGINS entries must use https");
      }
      if (url.pathname !== "/" || url.search || url.hash) {
        throw new Error("[security] SIWE_ALLOWED_ORIGINS entries must be origins without paths");
      }
      return url.origin;
    });

  if (origins.length === 0) {
    throw new Error("[security] SIWE_ALLOWED_ORIGINS must contain at least one origin");
  }
  return new Set(origins);
}

export function loadPointsSecurityConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): PointsSecurityConfig {
  const isTest = env.NODE_ENV === "test";
  // Treat an omitted or misspelled mode as production-safe. Only the explicit
  // development and test modes may use a non-mainnet configuration.
  const isProduction = !isTest && env.NODE_ENV !== "development";
  const chainId = parseChainId(requiredValue(env, "CHAIN_ID", "11155111"));
  const rpcUrl = parseRpcUrl(
    requiredValue(env, "RPC_URL", "http://127.0.0.1:8545"),
    isProduction,
  );
  const ifrLockAddress = ethers.getAddress(
    requiredValue(env, "IFR_LOCK_ADDRESS", "0x0000000000000000000000000000000000000001"),
  );
  const siweAllowedOrigins = parseSiweOrigins(
    requiredValue(env, "SIWE_ALLOWED_ORIGINS", "http://localhost:3004"),
    isProduction,
  );

  if (isProduction && chainId !== MAINNET_CHAIN_ID) {
    throw new Error(`[security] production CHAIN_ID must be ${MAINNET_CHAIN_ID}`);
  }
  if (isProduction && ifrLockAddress !== MAINNET_IFR_LOCK_ADDRESS) {
    throw new Error("[security] production IFR_LOCK_ADDRESS must be the canonical mainnet contract");
  }

  return { chainId, rpcUrl, ifrLockAddress, siweAllowedOrigins, isProduction, isTest };
}

export const pointsSecurityConfig = loadPointsSecurityConfig();

export function canSkipLockProof(
  config: PointsSecurityConfig = pointsSecurityConfig,
  skipValue: string | undefined = process.env.SKIP_LOCK_PROOF,
): boolean {
  return skipValue === "true" && !config.isProduction;
}

async function probeLockProofRpc(config: PointsSecurityConfig): Promise<LockProofRpcState> {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  try {
    const [network, contractCode] = await Promise.all([
      provider.getNetwork(),
      provider.getCode(config.ifrLockAddress),
    ]);
    return { chainId: network.chainId, contractCode };
  } finally {
    provider.destroy();
  }
}

export async function verifyLockProofRuntime(
  config: PointsSecurityConfig = pointsSecurityConfig,
  probe: LockProofRpcProbe = probeLockProofRpc,
): Promise<void> {
  if (config.isTest) return;

  const state = await probe(config);
  if (state.chainId !== BigInt(config.chainId)) {
    throw new Error(
      `[security] RPC chain mismatch: expected ${config.chainId}, received ${state.chainId.toString()}`,
    );
  }
  if (state.contractCode === "0x") {
    throw new Error("[security] IFR_LOCK_ADDRESS has no contract code on the configured RPC");
  }
}

export function isAllowedSiweContext(
  domain: string,
  uri: string,
  chainId: number,
  config: PointsSecurityConfig = pointsSecurityConfig,
): boolean {
  let uriOrigin: string;
  let uriHost: string;
  try {
    const parsedUri = new URL(uri);
    uriOrigin = parsedUri.origin;
    uriHost = parsedUri.host;
  } catch {
    return false;
  }

  return chainId === config.chainId
    && domain === uriHost
    && config.siweAllowedOrigins.has(uriOrigin);
}
