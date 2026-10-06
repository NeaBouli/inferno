import "dotenv/config";
import type { Server } from "node:http";
import express, { type Request } from "express";
import app, { resolveAllowedOrigins } from "../app.js";
import { prisma } from "../db.js";
import { createToken } from "../middleware/auth.js";
import {
  FixedWindowBuckets,
  NONCE_PER_IPV6_48,
  NONCE_WINDOW_MS,
  admitNonce,
  ipv6Prefix48Key,
  rateLimitKey,
  TRUSTED_PROXY_HOPS,
} from "../middleware/rate-limit.js";
import { MAX_OUTSTANDING_NONCES } from "../routes/auth.js";
import { POINTS_CONFIG } from "../config/points.js";
import { getSignerAddress } from "../services/voucher-signer.js";
import { capVoucherDiscountBps } from "../services/voucher-eip712.js";
import {
  getProtocolFeeBps,
  PROTOCOL_FEE_CACHE_TTL_MS,
  setProtocolFeeReader,
} from "../services/fee-router-fee.js";
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
  // No chain in unit tests: serve the deployed FeeRouterV1 fee (5 bps) unless a test overrides it.
  const feeReading = (feeBps: number, chainId = BigInt(loadPointsSecurityConfig().chainId)) =>
    async () => ({ chainId, feeBps });
  setProtocolFeeReader(feeReading(5));

  console.log("Voucher discount cap (T-289):");
  assert(capVoucherDiscountBps({ discountBps: 15, maxDiscountBps: 25 }, 5) === 5, "15 bps config is capped at a 5 bps on-chain fee");
  assert(capVoucherDiscountBps({ discountBps: 5, maxDiscountBps: 5 }, 3) === 3, "discount follows a lowered on-chain fee");
  assert(capVoucherDiscountBps({ discountBps: 5, maxDiscountBps: 5 }, 25) === 5, "a raised fee never raises the configured discount");
  assert(capVoucherDiscountBps({ discountBps: 15, maxDiscountBps: 5 }, 25) === 5, "maxDiscountBps bounds the configured discount");
  assert(capVoucherDiscountBps(POINTS_CONFIG.voucher, 0) === 0, "a zero on-chain fee yields no discount");
  {
    let threw = false;
    try { capVoucherDiscountBps(POINTS_CONFIG.voucher, 26); } catch { threw = true; }
    assert(threw, "a fee above FEE_CAP_BPS is rejected as unreadable");
  }
  {
    let reads = 0;
    setProtocolFeeReader(async () => { reads++; return { chainId: BigInt(loadPointsSecurityConfig().chainId), feeBps: 5 }; });
    const t0 = 1_000_000;
    await getProtocolFeeBps(t0);
    await getProtocolFeeBps(t0 + PROTOCOL_FEE_CACHE_TTL_MS - 1);
    assert(reads === 1, "fee read is cached within the TTL");
    await getProtocolFeeBps(t0 + PROTOCOL_FEE_CACHE_TTL_MS);
    assert(reads === 2, "fee is re-read after the TTL");
    let fail = true;
    setProtocolFeeReader(async () => { reads++; if (fail) throw new Error("rpc down"); return { chainId: BigInt(loadPointsSecurityConfig().chainId), feeBps: 4 }; });
    await assertRejects(() => getProtocolFeeBps(t0), "fee read failure propagates");
    fail = false;
    assert(await getProtocolFeeBps(t0) === 4, "fee read failure is not cached");
    setProtocolFeeReader(feeReading(5, 1n));
    await assertRejects(() => getProtocolFeeBps(t0), "fee read from the wrong chain is rejected");
    setProtocolFeeReader(feeReading(5.5));
    await assertRejects(() => getProtocolFeeBps(t0), "non-integer fee is rejected");
    setProtocolFeeReader(feeReading(26));
    await assertRejects(() => getProtocolFeeBps(t0), "fee above FEE_CAP_BPS is rejected");
    setProtocolFeeReader(feeReading(5));
  }

  console.log("CORS defaults (T-212b-10):");
  assert(resolveAllowedOrigins({ NODE_ENV: "production" }).length === 0, "production without ALLOWED_ORIGINS refuses cross-origin");
  assert(!resolveAllowedOrigins({ NODE_ENV: "production" }).some((o) => o.includes("localhost")), "no localhost in production defaults");
  assert(resolveAllowedOrigins({ NODE_ENV: "test" }).includes("http://localhost:3004"), "non-production keeps the local origin");
  assert(resolveAllowedOrigins({ NODE_ENV: "production", ALLOWED_ORIGINS: " https://ifrunit.tech ,," }).join() === "https://ifrunit.tech", "configured origins are trimmed");

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
    assert(status === 400, "voucher below threshold is rejected");
    const belowThreshold = await prisma.wallet.findUniqueOrThrow({ where: { address: TEST_WALLET } });
    assert(belowThreshold.pointsTotal === 30, "threshold rejection leaves points unchanged");
  }

  // ---- On-chain fee guard (T-289): no voucher and no point debit unless the fee is verified ----
  if (process.env.VOUCHER_SIGNER_PRIVATE_KEY) {
    await prisma.wallet.update({
      where: { address: TEST_WALLET },
      data: { pointsTotal: POINTS_CONFIG.voucher.threshold },
    });
    const assertNothingIssued = async (label: string) => {
      const w = await prisma.wallet.findUniqueOrThrow({ where: { address: TEST_WALLET } });
      assert(w.pointsTotal === POINTS_CONFIG.voucher.threshold, `${label}: points are not deducted`);
      assert(await prisma.voucher.count() === 0, `${label}: no voucher is stored`);
      assert(
        await prisma.pointEvent.count({ where: { type: "voucher_redemption" } }) === 0,
        `${label}: no redemption event is recorded`,
      );
    };

    setProtocolFeeReader(async () => { throw new Error("rpc down"); });
    const unreadable = await api("POST", "/voucher/issue", {}, authToken);
    assert(unreadable.status === 503, "unreadable on-chain fee refuses voucher issuance");
    assert(typeof unreadable.data.error === "string" && !("signature" in unreadable.data), "unreadable fee returns no signature");
    await assertNothingIssued("unreadable fee");

    setProtocolFeeReader(feeReading(5, 1n));
    const wrongChain = await api("POST", "/voucher/issue", {}, authToken);
    assert(wrongChain.status === 503, "fee read from the wrong chain refuses voucher issuance");
    await assertNothingIssued("wrong-chain fee");

    setProtocolFeeReader(feeReading(0));
    const zeroFee = await api("POST", "/voucher/issue", {}, authToken);
    assert(zeroFee.status === 503, "zero on-chain fee refuses voucher issuance");
    await assertNothingIssued("zero fee");

    setProtocolFeeReader(feeReading(3));
    const lowered = await api("POST", "/voucher/issue", {}, authToken);
    assert(lowered.status === 200, "voucher issues under a lowered on-chain fee");
    assert((lowered.data.voucher as { discountBps: number }).discountBps === 3, "issued discount is capped at the on-chain fee");
    const storedLowered = await prisma.voucher.findFirst();
    assert(storedLowered?.discountBps === 3, "stored voucher records the capped discount");

    setProtocolFeeReader(feeReading(5));
    await prisma.voucher.deleteMany();
    await prisma.pointEvent.deleteMany({ where: { type: "voucher_redemption" } });
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
      const issuedNonce = (data.voucher as { nonce: string }).nonce;
      const afterIssue = await prisma.wallet.findUniqueOrThrow({ where: { address: TEST_WALLET } });
      assert(afterIssue.pointsTotal === 0, "voucher issuance consumes the threshold points");
      const redemption = await prisma.pointEvent.findFirst({
        where: { walletId: afterIssue.id, type: "voucher_redemption" },
      });
      assert(redemption?.points === -POINTS_CONFIG.voucher.threshold, "voucher redemption is recorded");

      const validation = await api("GET", `/voucher/validate/${issuedNonce}`);
      assert(validation.status === 200 && validation.data.valid === true, "issued voucher validates");
      assert(!Object.hasOwn(validation.data, "wallet"), "public validation omits wallet identity");
      assert(!Object.hasOwn(validation.data, "usedCount"), "validation makes no off-chain usage claim");
      const redemptionInfo = validation.data.redemption as { tracked?: boolean; authoritative?: string } | undefined;
      assert(redemptionInfo?.tracked === false && redemptionInfo?.authoritative === "FeeRouterV1.usedNonces(user, nonce)", "validation points to the on-chain nonce mapping");

      // ---- Daily Wallet Limit ----
      const { status: status2 } = await api("POST", "/voucher/issue", {}, authToken);
      assert(status2 === 429, "second voucher same day rejected");

      // ---- Transaction rollback on signer failure ----
      await prisma.voucher.deleteMany();
      await prisma.pointEvent.deleteMany({ where: { type: "voucher_redemption" } });
      await prisma.wallet.update({
        where: { address: TEST_WALLET },
        data: { pointsTotal: POINTS_CONFIG.voucher.threshold },
      });
      const testSignerKey = process.env.VOUCHER_SIGNER_PRIVATE_KEY;
      delete process.env.VOUCHER_SIGNER_PRIVATE_KEY;
      const failedIssue = await api("POST", "/voucher/issue", {}, authToken);
      process.env.VOUCHER_SIGNER_PRIVATE_KEY = testSignerKey;
      assert(failedIssue.status === 500, "signer failure rejects voucher issuance");
      const afterFailure = await prisma.wallet.findUniqueOrThrow({ where: { address: TEST_WALLET } });
      assert(afterFailure.pointsTotal === POINTS_CONFIG.voucher.threshold, "signer failure rolls back points");
      assert(await prisma.voucher.count() === 0, "signer failure creates no voucher");
      assert(
        await prisma.pointEvent.count({ where: { type: "voucher_redemption" } }) === 0,
        "signer failure creates no redemption event",
      );

      // ---- Concurrent issuance ----
      const concurrent = await Promise.all([
        api("POST", "/voucher/issue", {}, authToken),
        api("POST", "/voucher/issue", {}, authToken),
      ]);
      const concurrentStatuses = concurrent.map(({ status }) => status).sort();
      assert(
        concurrentStatuses[0] === 200 && [400, 429].includes(concurrentStatuses[1]),
        "concurrent issuance produces one winner without server error",
      );
      const afterConcurrent = await prisma.wallet.findUniqueOrThrow({ where: { address: TEST_WALLET } });
      assert(afterConcurrent.pointsTotal === 0, "concurrent issuance consumes points once");
      assert(await prisma.voucher.count() === 1, "concurrent issuance creates one voucher");
      assert(
        await prisma.pointEvent.count({ where: { type: "voucher_redemption" } }) === 1,
        "concurrent issuance records one redemption",
      );

      // ---- Concurrent issuance with surplus points still respects the wallet window ----
      await prisma.voucher.deleteMany();
      await prisma.pointEvent.deleteMany({ where: { type: "voucher_redemption" } });
      await prisma.wallet.update({
        where: { address: TEST_WALLET },
        data: { pointsTotal: POINTS_CONFIG.voucher.threshold * 2 },
      });
      const surplusConcurrent = await Promise.all([
        api("POST", "/voucher/issue", {}, authToken),
        api("POST", "/voucher/issue", {}, authToken),
      ]);
      const surplusStatuses = surplusConcurrent.map(({ status }) => status).sort();
      assert(
        surplusStatuses[0] === 200 && surplusStatuses[1] === 429,
        "wallet window allows one concurrent voucher even with surplus points",
      );
      const afterSurplus = await prisma.wallet.findUniqueOrThrow({ where: { address: TEST_WALLET } });
      assert(
        afterSurplus.pointsTotal === POINTS_CONFIG.voucher.threshold,
        "surplus concurrency consumes one threshold",
      );
      assert(await prisma.voucher.count() === 1, "surplus concurrency creates one voucher");
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

  // ---- Trusted client IP: spoofed X-Forwarded-For entries cannot rotate the limit key (T-216) ----
  console.log("\nTrusted client IP");
  {
    const realClient = "203.0.113.77";
    let lastStatus = 0;
    let okCount = 0;
    for (let i = 0; i < 31; i++) {
      const res = await fetch(`${baseUrl}/auth/siwe/nonce`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": `10.${i}.0.1, ${realClient}` },
      });
      lastStatus = res.status;
      if (res.status === 200) okCount++;
    }
    assert(okCount === 30 && lastStatus === 429, "nonce limit holds when the spoofed left-most entry rotates");
    const other = await fetch(`${baseUrl}/auth/siwe/nonce`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": `1.2.3.4, 198.51.100.77` },
    });
    assert(other.status === 200, "a different proxy-appended client keeps its own nonce budget");
  }

  // ---- req.ip classifier behind TRUSTED_PROXY_HOPS; proxy-addr advisory canary (T-283) ----
  console.log("\nTrusted proxy classifier (GHSA-jqcg-44mw-7w3h)");
  {
    const appTrusting = (subnets: string[]) => {
      const trusting = express();
      trusting.set("trust proxy", subnets);
      return trusting;
    };
    const clientIp = (on: ReturnType<typeof express>, peer: string, forwardedFor: string) => {
      const socket = { remoteAddress: peer };
      const req = Object.create(on.request) as Request;
      Object.defineProperty(req, "headers", { value: { "x-forwarded-for": forwardedFor } });
      Object.defineProperty(req, "socket", { value: socket });
      Object.defineProperty(req, "connection", { value: socket });
      return req.ip;
    };
    const ours = appTrusting(TRUSTED_PROXY_HOPS);
    assert(clientIp(ours, "203.0.113.9", "6.6.6.6") === "203.0.113.9", "untrusted IPv4 peer: spoofed XFF ignored");
    assert(clientIp(ours, "::ffff:203.0.113.9", "6.6.6.6") === "::ffff:203.0.113.9", "untrusted IPv4-mapped peer: spoofed XFF ignored");
    assert(clientIp(ours, "2001:db8::9", "6.6.6.6") === "2001:db8::9", "untrusted IPv6 peer: spoofed XFF ignored");
    assert(clientIp(ours, "172.18.0.5", "6.6.6.6, 198.51.100.7") === "198.51.100.7", "trusted Traefik hop: first untrusted hop wins");
    for (const subnet of ["::ffff:10.0.0.0/8", "::/1"]) {
      assert(
        clientIp(appTrusting([subnet]), "203.0.113.9", "6.6.6.6") === "203.0.113.9",
        `patched proxy-addr: misconfigured ${subnet} no longer trusts every IPv4 peer`
      );
    }
  }

  // ---- Rate-limit keys: IPv4 single address, IPv4-mapped == IPv4, IPv6 /64 (T-259) ----
  console.log("\nRate-limit keys (IPv6 /64)");
  {
    assert(rateLimitKey("203.0.113.7") === "203.0.113.7", "IPv4 keyed by single address");
    assert(rateLimitKey("::ffff:203.0.113.7") === "203.0.113.7", "IPv4-mapped equals IPv4");
    assert(rateLimitKey("::ffff:cb00:7107") === "203.0.113.7", "hex IPv4-mapped equals IPv4");
    assert(
      rateLimitKey("2001:db8:abcd:ef01::1") === rateLimitKey("2001:0DB8:abcd:ef01:ffff:1:2:3"),
      "IPv6 addresses in one /64 share a key",
    );
    assert(rateLimitKey("2001:db8:abcd:ef01::1") === "2001:db8:abcd:ef01::/64", "IPv6 key is the /64 prefix");
    assert(
      rateLimitKey("2001:db8:abcd:ef01::1") !== rateLimitKey("2001:db8:abcd:ef02::1"),
      "different /64 prefixes get different keys",
    );
    assert(rateLimitKey("unknown") === "unknown", "non-IP values pass through");

    // Bounded map is fail-closed: a live window is never discarded to admit an unseen key.
    const bounded = new FixedWindowBuckets(2);
    assert(bounded.check("exhausted", 1, 3_600_000, 0), "first hit admitted");
    assert(bounded.check("normal", 2, 60_000, 1), "second key admitted");
    for (let i = 0; i < 20; i++) {
      assert(!bounded.check(`churn${i}`, 5, 60_000, 10 + i), "unseen key refused at saturation");
      assert(bounded.size <= 2, "bucket map never exceeds the cap");
    }
    assert(!bounded.check("exhausted", 1, 3_600_000, 100), "exhausted client stays blocked after key churn");
    assert(bounded.check("normal", 2, 60_000, 101), "existing non-exhausted client is admitted");
    assert(!bounded.check("normal", 2, 60_000, 102), "existing client keeps its limit");
    assert(!bounded.check("unseen", 5, 60_000, 60_000), "no window reclaimable before expiry");
    assert(bounded.check("unseen", 5, 60_000, 60_001), "expiry admits an unseen key again");
    assert(bounded.size === 2, "bucket map stays at the cap");
    assert(!bounded.check("exhausted", 1, 3_600_000, 3_599_999), "long-window budget is not reset");
    const prefersExpired = new FixedWindowBuckets(2);
    prefersExpired.check("active", 1, 60_000, 0);
    prefersExpired.check("expired", 1, 10, 1);
    prefersExpired.check("fresh", 1, 60_000, 20);
    assert(!prefersExpired.check("active", 1, 60_000, 21), "eviction reclaims expired windows before active budgets");

    // SIWE nonce: one /64 rotating addresses cannot exceed its 30-nonce budget (so it cannot fill the global cap).
    const nonceFrom = async (client: string) =>
      (await fetch(`${baseUrl}/auth/siwe/nonce`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": client },
      })).status;
    const rotated: number[] = [];
    for (let i = 1; i <= 40; i++) rotated.push(await nonceFrom(`2001:db8:abcd:ef01::${i.toString(16)}`));
    assert(
      rotated.filter((st) => st === 200).length === 30 && rotated.slice(30).every((st) => st === 429),
      "IPv6 rotation inside one /64 shares one nonce bucket",
    );
    assert((await nonceFrom("2001:db8:abcd:ef02::1")) === 200, "a different /64 keeps its own nonce budget");
    for (let i = 0; i < 30; i++) await nonceFrom("192.0.2.50");
    assert((await nonceFrom("::ffff:192.0.2.50")) === 429, "IPv4-mapped client shares the IPv4 nonce bucket");
  }

  // ---- SIWE nonce per-/48 tier: one /48 cannot fill the global nonce cap (T-260) ----
  console.log("\nSIWE nonce /48 tier");
  {
    assert(
      ipv6Prefix48Key("2001:db8:1:a::1") === ipv6Prefix48Key("2001:0DB8:0001:ffff:1:2:3:4"),
      "different /64s inside one /48 share a /48 key",
    );
    assert(ipv6Prefix48Key("2001:db8:1:a::1") === "2001:db8:1::/48", "/48 key is the first three groups");
    assert(ipv6Prefix48Key("2001:db8:1::1") !== ipv6Prefix48Key("2001:db8:2::1"), "different /48s get different keys");
    assert(ipv6Prefix48Key("203.0.113.7") === null, "IPv4 has no /48 key");
    assert(ipv6Prefix48Key("::ffff:203.0.113.7") === null, "IPv4-mapped has no /48 key");
    assert(ipv6Prefix48Key("unknown") === null, "non-IP has no /48 key");
    assert(2 * NONCE_PER_IPV6_48 <= MAX_OUTSTANDING_NONCES * 0.05, "boundary burst of one /48 stays <= 5% of the global cap");
    assert(NONCE_WINDOW_MS >= 5 * 60_000, "window covers the 5-minute nonce lifetime");

    const t0 = 1_000_000;
    {
      const client = new FixedWindowBuckets(100_000);
      const prefix = new FixedWindowBuckets(100);
      let ok = 0;
      for (let i = 0; i < NONCE_PER_IPV6_48 + 50; i++) {
        if (admitNonce(`2001:db8:1:${i.toString(16)}::1`, t0 + i, client, prefix)) ok++;
      }
      assert(ok === NONCE_PER_IPV6_48, "/48 tier caps many distinct /64s inside one /48");
      assert(admitNonce("2001:db8:2::1", t0 + 400, client, prefix), "a different /48 keeps its own budget");
      assert(!admitNonce("2001:db8:1:ffff::1", t0 + 401, client, prefix), "a fresh /64 in the exhausted /48 is refused");
      assert(admitNonce("2001:db8:1:ffff::1", t0 + NONCE_WINDOW_MS + 1, client, prefix), "/48 budget renews after the window");
    }
    {
      const client = new FixedWindowBuckets(100_000);
      const prefix = new FixedWindowBuckets(100);
      for (let i = 0; i < 100; i++) admitNonce("2001:db8:3:1::1", t0 + i, client, prefix);
      let ok = 0;
      for (let i = 0; i < NONCE_PER_IPV6_48; i++) {
        if (admitNonce(`2001:db8:3:${(i + 2).toString(16)}::1`, t0 + 200 + i, client, prefix)) ok++;
      }
      assert(ok === NONCE_PER_IPV6_48 - 30, "an exhausted /64 consumes only its own 30 from the /48 budget");
    }
    {
      const client = new FixedWindowBuckets(100_000);
      const prefix = new FixedWindowBuckets(100);
      let ok = 0;
      for (let i = 0; i < 300; i++) {
        if (admitNonce(`10.0.${i >> 8}.${i & 0xff}`, t0 + i, client, prefix)) ok++;
      }
      assert(ok === 300 && prefix.size === 0, "IPv4 stays per address (no /24 aggregation, no /48 buckets)");
      for (let i = 0; i < 30; i++) admitNonce("192.0.2.9", t0 + 400 + i, client, prefix);
      assert(!admitNonce("192.0.2.9", t0 + 500, client, prefix), "IPv4 per-address nonce limit unchanged");
      assert(!admitNonce("::ffff:192.0.2.9", t0 + 501, client, prefix), "IPv4-mapped shares the IPv4 limit");
    }
    {
      // Bounded /48 map: fail-closed, never evicts a live window.
      const client = new FixedWindowBuckets(100_000);
      const prefix = new FixedWindowBuckets(2);
      for (let i = 0; i < NONCE_PER_IPV6_48; i++) admitNonce(`2001:db8:a:${i.toString(16)}::1`, t0 + i, client, prefix);
      assert(admitNonce("2001:db8:b::1", t0 + 300, client, prefix), "second /48 admitted");
      for (let i = 0; i < 20; i++) {
        assert(!admitNonce(`2001:db8:${(0x100 + i).toString(16)}::1`, t0 + 400 + i, client, prefix), "unseen /48 refused when the map is full");
        assert(prefix.size <= 2, "/48 map never exceeds its bound");
      }
      assert(!admitNonce("2001:db8:a:ffff::1", t0 + 500, client, prefix), "exhausted /48 stays limited after flooding");
      assert(admitNonce("2001:db8:b:1::1", t0 + 501, client, prefix), "existing /48 keeps its budget");
      assert(admitNonce("2001:db8:1ff::1", t0 + NONCE_WINDOW_MS + 1, client, prefix), "expired windows free space for an unseen /48");
      assert(prefix.size <= 2, "/48 map stays within its bound after reclamation");
    }

    // Route level: rotating /64s inside one /48 hit the /48 budget; another /48 is unaffected.
    const nonceFrom48 = async (client: string) =>
      (await fetch(`${baseUrl}/auth/siwe/nonce`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": client },
      })).status;
    const statuses: number[] = [];
    for (let i = 0; i < NONCE_PER_IPV6_48 + 10; i++) statuses.push(await nonceFrom48(`2001:db8:48:${i.toString(16)}::1`));
    assert(
      statuses.filter((st) => st === 200).length === NONCE_PER_IPV6_48 &&
        statuses.slice(NONCE_PER_IPV6_48).every((st) => st === 429),
      "route: distinct /64s in one /48 share the /48 nonce budget",
    );
    assert((await nonceFrom48("2001:db8:49::1")) === 200, "route: a different /48 keeps its own nonce budget");
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
