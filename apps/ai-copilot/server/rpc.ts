// T-219: one shared Mainnet read provider with ordered failover.
// Before, every request built its own JsonRpcProvider against a single URL. Each instance ran network
// detection and a single unhealthy endpoint (or its rate limit) turned every on-chain read into a failure.
// Now all reads share one FallbackProvider over several public endpoints with a static network,
// per-endpoint stall timeouts and quorum 1. A read that fails on every endpoint throws; callers keep the
// T-212b rule that a failed read is reported as unavailable, never as zero.
import { FallbackProvider, FetchRequest, JsonRpcProvider, Network, type Provider } from "ethers";

/** Public Mainnet endpoints that answered eth_chainId=0x1 and an IFR eth_call on 2026-10-03.
 *  Checked and dropped: cloudflare-eth.com (eth_call internal error), 1rpc.io and eth.merkle.io
 *  (rate limited), rpc.ankr.com (requires a key), eth.llamarpc.com (HTTP 525). */
export const PUBLIC_MAINNET_RPCS: readonly string[] = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
  "https://mainnet.gateway.tenderly.co",
  "https://eth-mainnet.public.blastapi.io",
];

const MAINNET = Network.from(1);

export interface RpcEndpoint {
  /** Public label for health output; a configured URL may contain a key and is never exposed. */
  label: string;
  url: string;
}

/** Ordered endpoint list: the operator-configured URL first (if any), then the public fallbacks. */
export function rpcEndpoints(configured: string | undefined = process.env.MAINNET_RPC_URL): RpcEndpoint[] {
  const out: RpcEndpoint[] = [];
  const seen = new Set<string>();
  const add = (label: string, url: string | undefined) => {
    const value = (url || "").trim();
    if (!/^https:\/\//.test(value) || seen.has(value)) return;
    seen.add(value);
    out.push({ label, url: value });
  };
  add("configured", configured);
  for (const url of PUBLIC_MAINNET_RPCS) add(new URL(url).hostname, url);
  return out;
}

export interface RpcOptions {
  /** Milliseconds before the next endpoint is started in parallel. */
  stallTimeoutMs?: number;
  /** Hard per-request timeout. ethers defaults to 300 s, which let one hanging endpoint stall every read
   *  (FallbackProvider syncs all endpoints before its first call). */
  requestTimeoutMs?: number;
}

/** Builds a quorum-1 FallbackProvider; endpoints are tried in order and never re-detect the network. */
export function createRpcProvider(endpoints: RpcEndpoint[], options: RpcOptions = {}): FallbackProvider {
  if (endpoints.length === 0) throw new Error("no RPC endpoints configured");
  const stallTimeout = options.stallTimeoutMs ?? 2500;
  const requestTimeout = options.requestTimeoutMs ?? 5000;
  const configs = endpoints.map((endpoint, index) => {
    const request = new FetchRequest(endpoint.url);
    request.timeout = requestTimeout;
    return {
      provider: new JsonRpcProvider(request, MAINNET, { staticNetwork: MAINNET, batchMaxCount: 1 }),
      priority: index + 1,
      weight: 1,
      stallTimeout,
    };
  });
  return new FallbackProvider(configs, MAINNET, { quorum: 1, eventQuorum: 1 });
}

let shared: FallbackProvider | null = null;

/** The process-wide read provider. All server routes use this instead of constructing their own. */
export function getRpcProvider(): Provider {
  if (!shared) shared = createRpcProvider(rpcEndpoints());
  return shared;
}

/** Raw eth_call through the shared provider (replaces the old single-URL fetch helper). */
export async function ethCall(to: string, data: string, provider: Provider = getRpcProvider()): Promise<string> {
  return provider.call({ to, data });
}

export interface RpcHealth {
  healthy: number;
  total: number;
  endpoints: { label: string; ok: boolean }[];
}

/** Probes each endpoint with eth_chainId (expects 0x1). Output never contains URLs. */
export async function rpcHealth(endpoints: RpcEndpoint[] = rpcEndpoints(), timeoutMs = 3000): Promise<RpcHealth> {
  const results = await Promise.all(
    endpoints.map(async ({ label, url }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
          signal: controller.signal,
        });
        const json = (await resp.json()) as { result?: string };
        return { label, ok: resp.ok && json.result === "0x1" };
      } catch {
        return { label, ok: false };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return { healthy: results.filter((r) => r.ok).length, total: results.length, endpoints: results };
}
