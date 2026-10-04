// T-219: the shared read provider must fail over to the next endpoint and must never turn a
// total outage into a zero. Local mock JSON-RPC servers stand in for the public endpoints.
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createRpcProvider, ethCall, rpcEndpoints, rpcHealth, PUBLIC_MAINNET_RPCS } from "../server/rpc.js";

const SUPPLY = "0x" + (996687518329891940n * 1n).toString(16).padStart(64, "0");
const WRONG_CHAIN_SUPPLY = "0x" + (123n * 10n ** 27n).toString(16).padStart(64, "0");
type Mode = "ok" | "http500" | "rpcError" | "hang";

/** chainId: the eth_chainId answer; "error" answers eth_chainId with a JSON-RPC error. */
function mockRpc(mode: Mode, chainId = "0x1"): Promise<{ url: string; calls: () => number; methods: string[]; close: () => Promise<void> }> {
  let calls = 0;
  const methods: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      calls += 1;
      if (mode === "hang") return; // never answers
      if (mode === "http500") {
        res.writeHead(500).end("upstream error");
        return;
      }
      const payload = JSON.parse(body);
      const requests = Array.isArray(payload) ? payload : [payload];
      const answers = requests.map((r: { id: number; method: string }) => {
        methods.push(r.method);
        if (mode === "rpcError") return { jsonrpc: "2.0", id: r.id, error: { code: -32005, message: "rate limited" } };
        if (r.method === "eth_chainId") {
          return chainId === "error"
            ? { jsonrpc: "2.0", id: r.id, error: { code: -32603, message: "internal error" } }
            : { jsonrpc: "2.0", id: r.id, result: chainId };
        }
        if (r.method === "eth_blockNumber") return { jsonrpc: "2.0", id: r.id, result: "0x18e5d89" };
        if (r.method === "eth_call") return { jsonrpc: "2.0", id: r.id, result: chainId === "0x1" ? SUPPLY : WRONG_CHAIN_SUPPLY };
        return { jsonrpc: "2.0", id: r.id, error: { code: -32601, message: "method not found" } };
      });
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(Array.isArray(payload) ? answers : answers[0]));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        calls: () => calls,
        methods,
        close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }),
      });
    }),
  );
}

const IFR = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const step = (m: string) => console.error(`[rpc-failover] ${m}`);
const watchdog = setTimeout(() => { console.error("[rpc-failover] FAIL - timeout"); process.exit(1); }, 60_000);
const TOTAL_SUPPLY = "0x18160ddd";
const asEndpoints = (urls: string[]) => urls.map((url, i) => ({ label: `mock${i}`, url }));

step("Endpoint list:");
// Endpoint list: configured URL first, public fallbacks after, https only, no duplicates.
{
  const list = rpcEndpoints("https://rpc.example.invalid/key123");
  assert.equal(list[0].label, "configured");
  assert.deepEqual(list.slice(1).map((e) => e.url), [...PUBLIC_MAINNET_RPCS]);
  assert.equal(rpcEndpoints(undefined).length, PUBLIC_MAINNET_RPCS.length);
  assert.equal(rpcEndpoints("http://insecure.example").length, PUBLIC_MAINNET_RPCS.length, "non-https configured URL is ignored");
  assert.equal(rpcEndpoints(PUBLIC_MAINNET_RPCS[0]).length, PUBLIC_MAINNET_RPCS.length, "duplicates are dropped");
}

step("Failover:");
// Failover: dead primary (HTTP 500), rate-limited second, healthy third → read succeeds with the real value.
{
  const dead = await mockRpc("http500");
  const limited = await mockRpc("rpcError");
  const good = await mockRpc("ok");
  const provider = createRpcProvider(asEndpoints([dead.url, limited.url, good.url]), { stallTimeoutMs: 200, requestTimeoutMs: 800 });
  const result = await ethCall(IFR, TOTAL_SUPPLY, provider);
  assert.equal(BigInt(result), BigInt(SUPPLY), "value comes from the healthy endpoint");
  assert.ok(good.calls() > 0, "healthy endpoint was used");
  provider.destroy();
  await Promise.all([dead.close(), limited.close(), good.close()]);
}

step("A hanging primary");
// A hanging primary is bypassed after the stall timeout.
{
  const hang = await mockRpc("hang");
  const good = await mockRpc("ok");
  const provider = createRpcProvider(asEndpoints([hang.url, good.url]), { stallTimeoutMs: 150, requestTimeoutMs: 800 });
  const started = Date.now();
  const result = await ethCall(IFR, TOTAL_SUPPLY, provider);
  assert.equal(BigInt(result), BigInt(SUPPLY));
  assert.ok(Date.now() - started < 10000, "stalled endpoint does not block the read");
  provider.destroy();
  await Promise.all([hang.close(), good.close()]);
}

step("Total outage:");
// Total outage: the read throws; it must never resolve to "0x" / zero.
{
  const a = await mockRpc("http500");
  const b = await mockRpc("rpcError");
  const provider = createRpcProvider(asEndpoints([a.url, b.url]), { stallTimeoutMs: 100, requestTimeoutMs: 800 });
  await assert.rejects(() => ethCall(IFR, TOTAL_SUPPLY, provider), "total outage rejects instead of returning zero");
  provider.destroy();
  await Promise.all([a.close(), b.close()]);
}

step("Wrong-chain configured endpoint:");
// T-236: a configured endpoint reporting Goerli (0x5) has priority 1 and quorum 1, but must never answer.
{
  const goerli = await mockRpc("ok", "0x5");
  const good = await mockRpc("ok");
  const provider = createRpcProvider(asEndpoints([goerli.url, good.url]), { stallTimeoutMs: 200, requestTimeoutMs: 800 });
  for (let i = 0; i < 3; i++) {
    assert.equal(BigInt(await ethCall(IFR, TOTAL_SUPPLY, provider)), BigInt(SUPPLY), "value comes from the Mainnet endpoint");
  }
  assert.ok(goerli.methods.length > 0, "wrong-chain endpoint was probed");
  assert.deepEqual([...new Set(goerli.methods)], ["eth_chainId"], "wrong-chain endpoint only ever saw eth_chainId");
  assert.ok(good.methods.includes("eth_call"), "Mainnet endpoint served the call");
  provider.destroy();
  await Promise.all([goerli.close(), good.close()]);
}

step("Unreadable chain id:");
// An endpoint whose eth_chainId errors, is not hex, or hangs is excluded the same way (fail closed).
{
  const unreadable = await mockRpc("ok", "error");
  const garbage = await mockRpc("ok", "mainnet");
  const hang = await mockRpc("hang");
  const good = await mockRpc("ok");
  const provider = createRpcProvider(asEndpoints([unreadable.url, garbage.url, hang.url, good.url]), { stallTimeoutMs: 150, requestTimeoutMs: 800 });
  assert.equal(BigInt(await ethCall(IFR, TOTAL_SUPPLY, provider)), BigInt(SUPPLY));
  for (const bad of [unreadable, garbage]) assert.deepEqual([...new Set(bad.methods)], ["eth_chainId"], "unverified endpoint only saw eth_chainId");
  assert.equal(hang.calls(), 1, "hanging endpoint received only the chain id probe");
  provider.destroy();
  await Promise.all([unreadable.close(), garbage.close(), hang.close(), good.close()]);
}

step("All endpoints wrong chain:");
// Every endpoint on the wrong chain (or unreadable): the read rejects, so callers report unavailable,
// and no wrong-chain eth_call value is ever produced.
{
  const goerli = await mockRpc("ok", "0x5");
  const sepolia = await mockRpc("ok", "0xaa36a7");
  const unreadable = await mockRpc("ok", "error");
  const provider = createRpcProvider(asEndpoints([goerli.url, sepolia.url, unreadable.url]), { stallTimeoutMs: 100, requestTimeoutMs: 800 });
  const started = Date.now();
  await assert.rejects(() => ethCall(IFR, TOTAL_SUPPLY, provider), "all wrong-chain endpoints reject instead of returning a value");
  await assert.rejects(() => ethCall(IFR, TOTAL_SUPPLY, provider), "and keep rejecting on later reads");
  assert.ok(Date.now() - started < 10000, "fail-closed path stays bounded");
  for (const bad of [goerli, sepolia, unreadable]) assert.ok(!bad.methods.includes("eth_call"), "no eth_call reached a wrong-chain endpoint");
  provider.destroy();
  await Promise.all([goerli.close(), sepolia.close(), unreadable.close()]);
}

step("Chain check error hides URLs:");
{
  const goerli = await mockRpc("ok", "0x5");
  const provider = createRpcProvider([{ label: "configured", url: goerli.url }], { stallTimeoutMs: 100, requestTimeoutMs: 800 });
  const error = await ethCall(IFR, TOTAL_SUPPLY, provider).then(() => null, (e: unknown) => e);
  assert.ok(error instanceof Error, "single wrong-chain endpoint rejects");
  assert.ok(!JSON.stringify({ message: error.message, stack: error.stack }).includes(String(new URL(goerli.url).port)), "error does not expose the endpoint URL");
  provider.destroy();
  await goerli.close();
}

step("Health output:");
// Health output: labels and booleans only, no URLs.
{
  const good = await mockRpc("ok");
  const dead = await mockRpc("http500");
  const health = await rpcHealth([{ label: "configured", url: good.url }, { label: "fallback", url: dead.url }], 1000);
  assert.deepEqual(health, { healthy: 1, total: 2, endpoints: [{ label: "configured", ok: true }, { label: "fallback", ok: false }] });
  assert.ok(!JSON.stringify(health).includes("127.0.0.1"), "health never exposes URLs");
  await Promise.all([good.close(), dead.close()]);
}

// Source guards: no per-request providers, and supply is read on-chain before the explorer fallback.
{
  const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
  assert.ok(!/new\s+ethersLib\.JsonRpcProvider\(/.test(server), "server must use the shared provider, not per-request JsonRpcProvider");
  assert.ok(!/const ETH_RPC_URL\b/.test(server), "single-URL ETH_RPC_URL must not come back");
  const supply = server.slice(server.indexOf("async function readSupplyInputs"), server.indexOf("async function fetchSupplyData"));
  assert.ok(supply.indexOf("token.totalSupply()") > -1 && supply.indexOf("token.totalSupply()") < supply.indexOf("esApiFetch("), "supply reads the chain first, explorer only as fallback");
}
clearTimeout(watchdog);
console.log("[rpc-failover] PASS - ordered failover, stall bypass, no zero on outage, wrong-chain fail closed, URL-free health");
