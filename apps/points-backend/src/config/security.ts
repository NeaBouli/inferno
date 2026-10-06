import { ethers } from "ethers";

export const MAINNET_CHAIN_ID = 1;
export const MAINNET_IFR_LOCK_ADDRESS = "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb";
/** Canonical FeeRouterV1 on Ethereum mainnet: EIP-712 verifyingContract and voucher fee source. */
export const MAINNET_FEE_ROUTER_ADDRESS = "0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a";
export const FEE_ROUTER_EIP712_NAME = "InfernoFeeRouter";
export const FEE_ROUTER_EIP712_VERSION = "1";

export interface PointsSecurityConfig {
  chainId: number;
  rpcUrl: string;
  ifrLockAddress: string;
  feeRouterAddress: string;
  siweAllowedOrigins: ReadonlySet<string>;
  isProduction: boolean;
  isTest: boolean;
}

export interface FeeRouterDomainState {
  name: string;
  version: string;
  chainId: bigint;
  verifyingContract: string;
}

interface LockProofRpcState {
  chainId: bigint;
  contractCode: string;
  feeRouterCode: string;
  /** eip712Domain() of the FeeRouter; null when it cannot be read. */
  feeRouterDomain: FeeRouterDomainState | null;
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

  // Non-production may omit the router (voucher issuance then fails closed on the fee read).
  const feeRouterValue = env.FEE_ROUTER_ADDRESS?.trim();
  if (!feeRouterValue && isProduction) {
    throw new Error("FEE_ROUTER_ADDRESS is required in production-safe mode");
  }
  const feeRouterAddress = feeRouterValue ? ethers.getAddress(feeRouterValue.toLowerCase()) : ethers.ZeroAddress;
  if (chainId === MAINNET_CHAIN_ID && feeRouterAddress !== MAINNET_FEE_ROUTER_ADDRESS) {
    throw new Error("[security] CHAIN_ID 1 requires FEE_ROUTER_ADDRESS to be the canonical mainnet FeeRouterV1");
  }

  return { chainId, rpcUrl, ifrLockAddress, feeRouterAddress, siweAllowedOrigins, isProduction, isTest };
}

export const pointsSecurityConfig = loadPointsSecurityConfig();

export function canSkipLockProof(
  config: PointsSecurityConfig = pointsSecurityConfig,
  skipValue: string | undefined = process.env.SKIP_LOCK_PROOF,
): boolean {
  return skipValue === "true" && !config.isProduction;
}

const FEE_ROUTER_DOMAIN_ABI = [
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
];

async function probeLockProofRpc(config: PointsSecurityConfig): Promise<LockProofRpcState> {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  try {
    const router = new ethers.Contract(config.feeRouterAddress, FEE_ROUTER_DOMAIN_ABI, provider);
    const [network, contractCode, feeRouterCode, feeRouterDomain] = await Promise.all([
      provider.getNetwork(),
      provider.getCode(config.ifrLockAddress),
      provider.getCode(config.feeRouterAddress),
      (router.eip712Domain() as Promise<[string, string, string, bigint, string]>).then(
        ([, name, version, chainId, verifyingContract]) => ({ name, version, chainId, verifyingContract }),
        () => null,
      ),
    ]);
    return { chainId: network.chainId, contractCode, feeRouterCode, feeRouterDomain };
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
  // Development without a router skips the binding; voucher issuance then fails closed.
  if (config.feeRouterAddress === ethers.ZeroAddress && !config.isProduction) return;
  if (state.feeRouterCode === "0x") {
    throw new Error("[security] FEE_ROUTER_ADDRESS has no contract code on the configured RPC");
  }
  const domain = state.feeRouterDomain;
  if (
    !domain
    || domain.name !== FEE_ROUTER_EIP712_NAME
    || domain.version !== FEE_ROUTER_EIP712_VERSION
    || domain.chainId !== BigInt(config.chainId)
    || ethers.getAddress(domain.verifyingContract) !== config.feeRouterAddress
  ) {
    throw new Error("[security] FEE_ROUTER_ADDRESS does not expose the FeeRouterV1 EIP-712 domain");
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
