import "dotenv/config";
import type { Server } from "node:http";
import app from "../app.js";
import { prisma } from "../db.js";
import { createToken } from "../middleware/auth.js";
import { POINTS_CONFIG } from "../config/points.js";
import { getSignerAddress } from "../services/voucher-signer.js";
import { ethers } from "ethers";
import { SiweMessage } from "siwe";
import {
  canSkipLockProof,
  MAINNET_IFR_LOCK_ADDRESS,
  loadPointsSecurityConfig,
  verifyLockProofRuntime,
} from "../config/security.js";

let server: Server;
let baseUrl: string;

let authToken: string;
const TEST_WALLET = "0x" + "a".repeat(40);

async function api(method: string, path: string, body?: object, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() as Record<string, unknown> };
}

async function cleanup() {
  await prisma.pointEvent.deleteMany();
  await prisma.voucher.deleteMany();
  await prisma.wallet.deleteMany();
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

async function assertRejects(operation: () => Promise<unknown>, name: string) {
  try {
    await operation();
    assert(false, name);
  } catch {
    assert(true, name);
  }
}

async function issueNonce(): Promise<string> {
  const { status, data } = await api("POST", "/auth/siwe/nonce");
  assert(status === 200, "nonce returns 200");
  assert(typeof data.nonce === "string" && data.nonce.length > 0, "nonce is a non-empty string");
  return data.nonce as string;
}

async function signedSiweMessage(
  wallet: { address: string; signMessage(message: string): Promise<string> },
  nonce: string,
  domain: string,
  uri: string,
  chainId: number,
): Promise<{ message: string; signature: string }> {
  const message = new SiweMessage({
    domain,
    address: wallet.address,
    statement: "Sign in to IFR Points",
    uri,
    version: "1",
    chainId,
    nonce,
  }).prepareMessage();
  return { message, signature: await wallet.signMessage(message) };
}

async function run() {
  console.log("\n🔥 Points Backend Tests\n");

  console.log("Security configuration:");
  const productionConfig = loadPointsSecurityConfig({
    NODE_ENV: "production",
    CHAIN_ID: "1",
    RPC_URL: "https://mainnet.example",
    IFR_LOCK_ADDRESS: MAINNET_IFR_LOCK_ADDRESS,
    SIWE_ALLOWED_ORIGINS: "https://ifrunit.tech,https://www.ifrunit.tech",
  });
  assert(productionConfig.chainId === 1, "production config accepts mainnet chain");
  assert(productionConfig.siweAllowedOrigins.size === 2, "production config parses SIWE origins");
  assertRejects(
    async () => loadPointsSecurityConfig({ NODE_ENV: "production", CHAIN_ID: "1" }),
    "production config rejects missing RPC and contract values",
  );
  assertRejects(
    async () => loadPointsSecurityConfig({
      NODE_ENV: "production",
      CHAIN_ID: "11155111",
      RPC_URL: "https://sepolia.example",
      IFR_LOCK_ADDRESS: MAINNET_IFR_LOCK_ADDRESS,
      SIWE_ALLOWED_ORIGINS: "https://ifrunit.tech",
    }),
    "production config rejects non-mainnet chain",
  );
  assertRejects(
    async () => loadPointsSecurityConfig({
      NODE_ENV: "production",
      CHAIN_ID: "1",
      RPC_URL: "https://mainnet.example",
      IFR_LOCK_ADDRESS: "0x0000000000000000000000000000000000000001",
      SIWE_ALLOWED_ORIGINS: "https://ifrunit.tech",
    }),
    "production config rejects a non-canonical IFRLock",
  );
  assertRejects(
    async () => loadPointsSecurityConfig({
      CHAIN_ID: "11155111",
      RPC_URL: "https://sepolia.example",
      IFR_LOCK_ADDRESS: "0x0000000000000000000000000000000000000001",
      SIWE_ALLOWED_ORIGINS: "https://ifrunit.tech",
    }),
    "unset NODE_ENV still rejects a non-mainnet configuration",
  );
  assertRejects(
    async () => loadPointsSecurityConfig({
      NODE_ENV: "production",
      CHAIN_ID: "1",
      RPC_URL: "https://mainnet.example",
      IFR_LOCK_ADDRESS: MAINNET_IFR_LOCK_ADDRESS,
      SIWE_ALLOWED_ORIGINS: "http://ifrunit.tech",
    }),
    "production config rejects non-HTTPS SIWE origins",
  );
  assertRejects(
    async () => loadPointsSecurityConfig({
      NODE_ENV: "production",
      CHAIN_ID: "1",
      RPC_URL: "http://mainnet.example",
      IFR_LOCK_ADDRESS: MAINNET_IFR_LOCK_ADDRESS,
      SIWE_ALLOWED_ORIGINS: "https://ifrunit.tech",
    }),
    "production config rejects a remote plaintext RPC",
  );
  const loopbackProductionConfig = loadPointsSecurityConfig({
    NODE_ENV: "production",
    CHAIN_ID: "1",
    RPC_URL: "http://127.0.0.1:8545",
    IFR_LOCK_ADDRESS: MAINNET_IFR_LOCK_ADDRESS,
    SIWE_ALLOWED_ORIGINS: "https://ifrunit.tech",
  });
  assert(loopbackProductionConfig.isProduction, "production permits loopback RPC transport");
  const developmentConfig = loadPointsSecurityConfig({
    NODE_ENV: "development",
    CHAIN_ID: "11155111",
    RPC_URL: "https://sepolia.example",
    IFR_LOCK_ADDRESS: "0x0000000000000000000000000000000000000001",
    SIWE_ALLOWED_ORIGINS: "http://localhost:3004",
  });
  assert(developmentConfig.chainId === 11155111, "explicit development network remains supported");
  assert(!canSkipLockProof(productionConfig, "true"), "production lock proof cannot be bypassed");
  assert(canSkipLockProof(developmentConfig, "true"), "explicit development may bypass lock proof");
  await verifyLockProofRuntime(productionConfig, async () => ({
    chainId: 1n,
    contractCode: "0x6000",
  }));
  assert(true, "runtime verification accepts mainnet RPC with deployed contract code");
  await assertRejects(
    () => verifyLockProofRuntime(productionConfig, async () => ({
      chainId: 11155111n,
      contractCode: "0x6000",
    })),
    "runtime verification rejects RPC chain mismatch",
  );
  await assertRejects(
    () => verifyLockProofRuntime(productionConfig, async () => ({
      chainId: 1n,
      contractCode: "0x",
    })),
    "runtime verification rejects missing IFRLock bytecode",
  );

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  // Setup: create test wallet in DB and get JWT
  await cleanup();
  await prisma.wallet.create({ data: { address: TEST_WALLET } });
  authToken = await createToken(TEST_WALLET);

  // ---- Health ----
  console.log("Health:");
  {
    const { status, data } = await api("GET", "/health");
    assert(status === 200, "health returns 200");
    assert(data.status === "ok", "health status is ok");
  }

  // ---- SIWE Nonce ----
  console.log("\nSIWE Nonce:");
  const siweWallet = ethers.Wallet.createRandom();
  const validSiwe = await signedSiweMessage(
    siweWallet,
    await issueNonce(),
    "localhost:3004",
    "http://localhost:3004",
    11155111,
  );
  {
    const results = await Promise.all([
      api("POST", "/auth/siwe/verify", validSiwe),
      api("POST", "/auth/siwe/verify", validSiwe),
    ]);
    const statuses = results.map(({ status }) => status).sort();
    assert(statuses[0] === 200 && statuses[1] === 401, "concurrent SIWE nonce replay is rejected");
    const success = results.find(({ status }) => status === 200);
    assert(success?.data.wallet === siweWallet.address.toLowerCase(), "SIWE response binds the signed wallet");
  }
  {
    const signed = await signedSiweMessage(
      siweWallet,
      await issueNonce(),
      "evil.example",
      "https://evil.example",
      11155111,
    );
    const { status } = await api("POST", "/auth/siwe/verify", signed);
    assert(status === 401, "foreign SIWE domain is rejected");
  }
  {
    const signed = await signedSiweMessage(
      siweWallet,
      await issueNonce(),
      "localhost:3004",
      "https://evil.example",
      11155111,
    );
    const { status } = await api("POST", "/auth/siwe/verify", signed);
    assert(status === 401, "foreign SIWE URI origin is rejected");
  }
  {
    const signed = await signedSiweMessage(
      siweWallet,
      await issueNonce(),
      "localhost:3004",
      "http://localhost:3004",
      1,
    );
    const { status } = await api("POST", "/auth/siwe/verify", signed);
    assert(status === 401, "wrong SIWE chain is rejected");
  }

  // ---- Auth Required ----
  console.log("\nAuth Required:");
  {
    const { status } = await api("POST", "/points/event", { type: "wallet_connect" });
    assert(status === 401, "points/event rejects without auth");
  }
  {
    const { status } = await api("GET", "/points/balance");
    assert(status === 401, "points/balance rejects without auth");
  }
  {
    const { status } = await api("POST", "/voucher/issue");
    assert(status === 401, "voucher/issue rejects without auth");
  }

  // ---- Points Event ----
  console.log("\nPoints Events:");
  {
    const { status, data } = await api("POST", "/points/event", { type: "wallet_connect" }, authToken);
    assert(status === 200, "wallet_connect event recorded");
    assert(data.points === 10, "wallet_connect gives 10 points");
    assert(data.total === 10, "total is 10 after first event");
  }
  {
    const { status, data } = await api("POST", "/points/event", { type: "guide_wallet_setup" }, authToken);
    assert(status === 200, "guide_wallet_setup event recorded");
    assert(data.total === 30, "total is 30 after two events");
  }

  // ---- Invalid Event Type ----
  {
    const { status } = await api("POST", "/points/event", { type: "invalid_type" }, authToken);
    assert(status === 400, "invalid event type rejected");
  }

  // ---- Daily Limit ----
  console.log("\nDaily Limit:");
  {
    const { status } = await api("POST", "/points/event", { type: "wallet_connect" }, authToken);
    assert(status === 429, "daily limit prevents duplicate wallet_connect");
  }

  // ---- Points Balance ----
  console.log("\nPoints Balance:");
  {
    const { status, data } = await api("GET", "/points/balance", undefined, authToken);
    assert(status === 200, "balance returns 200");
    assert(data.total === 30, "balance total is 30");
    assert(Array.isArray(data.events), "events is an array");
    assert((data.events as unknown[]).length === 2, "2 events in history");
    assert(data.voucherEligible === false, "not voucher eligible at 30 points");
  }

  // ---- Voucher Under Threshold ----
  console.log("\nVoucher:");
  assert(POINTS_CONFIG.voucher.discountBps === 5, "voucher matches deployed FeeRouterV1 fee");
  assert(
    POINTS_CONFIG.voucher.discountBps <= POINTS_CONFIG.voucher.maxDiscountBps,
    "voucher discount stays within configured maximum"
  );
  {
    const { status } = await api("POST", "/voucher/issue", {}, authToken);
    // 400 = under threshold, 403 = no IFR lock, 503 = lock RPC unavailable
    assert([400, 403, 503].includes(status), "voucher rejected (threshold, lock proof, or RPC unavailable)");
  }

  // ---- Reach Threshold and Issue Voucher ----
  {
    // Add more points to reach threshold (100)
    await prisma.wallet.update({
      where: { address: TEST_WALLET },
      data: { pointsTotal: POINTS_CONFIG.voucher.threshold },
    });

    // Need VOUCHER_SIGNER_PRIVATE_KEY for this test
    if (process.env.VOUCHER_SIGNER_PRIVATE_KEY) {
      const { status, data } = await api("POST", "/voucher/issue", {}, authToken);
      assert(status === 200, "voucher issued at threshold");
      assert(typeof data.signature === "string", "voucher has signature");
      assert((data.voucher as { discountBps: number }).discountBps === POINTS_CONFIG.voucher.discountBps, "voucher discountBps correct");

      // ---- Daily Wallet Limit ----
      const { status: status2 } = await api("POST", "/voucher/issue", {}, authToken);
      assert(status2 === 429, "second voucher same day rejected");
    } else {
      console.log("  ⊘ voucher signing tests skipped (no VOUCHER_SIGNER_PRIVATE_KEY)");
    }
  }

  // ---- EIP-712 Signer ----
  console.log("\nEIP-712 Signer:");
  if (process.env.VOUCHER_SIGNER_PRIVATE_KEY) {
    const addr = getSignerAddress();
    assert(ethers.isAddress(addr), "signer address is valid");
    assert(addr !== ethers.ZeroAddress, "signer address is not zero");
  } else {
    console.log("  ⊘ signer tests skipped (no VOUCHER_SIGNER_PRIVATE_KEY)");
  }

  // ---- Summary ----
  console.log(`\n${"─".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

  await cleanup();
  await prisma.$disconnect();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });

  if (failed > 0) process.exit(1);
}

run().catch(async (err) => {
  console.error("Test runner error:", err);
  await prisma.$disconnect().catch(() => undefined);
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  process.exit(1);
});
