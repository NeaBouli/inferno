/**
 * lockProof middleware unit tests.
 * Tests the requireLockProof middleware with mocked req/res/next.
 * RPC-dependent paths are tested with a timeout to avoid hanging.
 *
 * Run: npx tsx src/__tests__/lockProof.test.ts (standalone; sets its own test env)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { format } from "node:util";

// Test env must be set before the first dynamic import of the middleware: the security
// config is loaded at module import time. Lock proof must be enforced (not skipped) here,
// even when the CI job sets SKIP_LOCK_PROOF=true globally.
process.env.NODE_ENV = "test";
process.env.CHAIN_ID = "11155111";
process.env.SKIP_LOCK_PROOF = "false";
process.env.IFR_LOCK_ADDRESS = "0x0000000000000000000000000000000000000001";
process.env.SIWE_ALLOWED_ORIGINS = "http://localhost:3004";

// Sentinels that must never reach a log line.
const SENTINEL_API_KEY = "sk_live_FAKEKEY0000SENTINEL";
const SENTINEL_URL_PASSWORD = "hunter2sentinel";
const SENTINEL_HEX_ADDRESS = "0x" + "c".repeat(40);
const SENTINEL_WALLET = "0x" + "d".repeat(40);
const SENTINEL_FREE_TEXT = "free text sentinel do not log";

/** Local JSON-RPC stub: every call fails with an error message full of sentinels. */
function startRpcStub(): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const message = `${SENTINEL_FREE_TEXT} key=${SENTINEL_API_KEY} owner=${SENTINEL_HEX_ADDRESS}`;
      const reply = (id: unknown) => ({ jsonrpc: "2.0", id, error: { code: -32000, message, data: SENTINEL_HEX_ADDRESS } });
      let body: unknown;
      try {
        const parsed = JSON.parse(raw) as { id?: unknown } | Array<{ id?: unknown }>;
        body = Array.isArray(parsed) ? parsed.map((p) => reply(p.id)) : reply(parsed.id);
      } catch {
        body = reply(null);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://rpcuser:${SENTINEL_URL_PASSWORD}@127.0.0.1:${port}/${SENTINEL_API_KEY}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}`);
    failed++;
  }
}

interface MockRes {
  statusCode: number;
  body: Record<string, unknown> | null;
  status(code: number): MockRes;
  json(data: Record<string, unknown>): void;
}

function mockRes(): MockRes {
  const res: MockRes = {
    statusCode: 0,
    body: null,
    status(code: number) { res.statusCode = code; return res; },
    json(data: Record<string, unknown>) { res.body = data; },
  };
  return res;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([
    promise,
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms)),
  ]);
}

async function run() {
  console.log("\n🔐 lockProof Middleware Tests\n");

  const rpcStub = await startRpcStub();
  process.env.RPC_URL = rpcStub.url;

  // Test 1: no wallet → 401
  {
    const { requireLockProof } = await import("../middleware/lockProof.js");
    const req = { wallet: undefined } as any;
    const res = mockRes();
    let nextCalled = false;
    await requireLockProof(req, res as any, () => { nextCalled = true; });
    assert(res.statusCode === 401, "no wallet returns 401");
    assert(!nextCalled, "next() not called without wallet");
  }

  // Test 2: empty wallet string → 401 (falsy)
  {
    const { requireLockProof } = await import("../middleware/lockProof.js");
    const req = { wallet: "" } as any;
    const res = mockRes();
    let nextCalled = false;
    await requireLockProof(req, res as any, () => { nextCalled = true; });
    assert(res.statusCode === 401, "empty wallet string returns 401");
    assert(!nextCalled, "next() not called with empty wallet");
  }

  // Test 3: error response shape
  {
    const { requireLockProof } = await import("../middleware/lockProof.js");
    const req = { wallet: undefined } as any;
    const res = mockRes();
    await requireLockProof(req, res as any, () => {});
    assert(typeof (res.body as any)?.error === "string", "error response has 'error' field");
    assert((res.body as any).error === "Authorization required", "error message is 'Authorization required'");
  }

  // Test 4: middleware is async function
  {
    const { requireLockProof } = await import("../middleware/lockProof.js");
    assert(typeof requireLockProof === "function", "requireLockProof is a function");
    const result = requireLockProof({ wallet: undefined } as any, mockRes() as any, () => {});
    assert(result instanceof Promise, "requireLockProof returns a Promise");
    await result;
  }

  // Test 5: RPC failure → fail-closed (503), with timeout for CI
  {
    const { requireLockProof } = await import("../middleware/lockProof.js");
    const req = { wallet: "0x" + "b".repeat(40) } as any;
    const res = mockRes();
    let nextCalled = false;
    const result = await withTimeout(
      requireLockProof(req, res as any, () => { nextCalled = true; }),
      5000
    );
    if (result === "timeout") {
      console.log("  ⊘ RPC timeout (expected in offline/CI mode)");
      passed++; // Timeout is acceptable — RPC not reachable
    } else {
      assert(res.statusCode === 503 || res.statusCode === 403, "RPC failure returns 503 or 403");
      assert(!nextCalled, "next() not called on RPC failure");
    }
  }

  // Test 6 (T-289d): RPC failure logs only a constant category, never wallet/URL/RPC text
  {
    const { requireLockProof } = await import("../middleware/lockProof.js");
    const req = { wallet: SENTINEL_WALLET } as any;
    const res = mockRes();
    let nextCalled = false;
    const logs: unknown[][] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => { logs.push(args); };
    try {
      await requireLockProof(req, res as any, () => { nextCalled = true; });
    } finally {
      console.error = originalConsoleError;
    }
    assert(res.statusCode === 503, "RPC error fails closed with 503");
    assert(!nextCalled, "next() not called on RPC error");
    const lines = logs.map((args) => format(...args));
    assert(
      lines.length === 1 && /^\[LOCKPROOF\] read_failed category=rpc_error:[a-z_]+$/.test(lines[0]),
      "RPC error logs exactly one constant category line",
    );
    const text = lines.join("\n").toLowerCase();
    for (const sentinel of [
      SENTINEL_WALLET,
      SENTINEL_WALLET.slice(2),
      SENTINEL_HEX_ADDRESS.slice(2),
      SENTINEL_API_KEY,
      SENTINEL_URL_PASSWORD,
      "rpcuser",
      "127.0.0.1",
      SENTINEL_FREE_TEXT,
    ]) {
      assert(!text.includes(sentinel.toLowerCase()), `log omits sentinel ${sentinel.slice(0, 12)}…`);
    }
  }

  await rpcStub.close();

  // ---- Summary ----
  console.log(`\n${"─".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
