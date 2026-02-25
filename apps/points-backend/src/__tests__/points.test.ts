import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { createToken } from "../middleware/auth";
import { POINTS_CONFIG } from "../config/points";
import { signVoucher, getSignerAddress } from "../services/voucher-signer";
import { ethers } from "ethers";

const prisma = new PrismaClient();

const BASE_URL = "http://localhost:3004";

let authToken: string;
const TEST_WALLET = "0x" + "a".repeat(40);

async function api(method: string, path: string, body?: object, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
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

async function run() {
  console.log("\n🔥 Points Backend Tests\n");

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
  {
    const { status, data } = await api("POST", "/auth/siwe/nonce");
    assert(status === 200, "nonce returns 200");
    assert(typeof data.nonce === "string" && (data.nonce as string).length > 0, "nonce is a non-empty string");
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
  {
    const { status } = await api("POST", "/voucher/issue", {}, authToken);
    assert(status === 400, "voucher rejected under threshold");
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
    assert(ethers.utils.isAddress(addr), "signer address is valid");
    assert(addr !== ethers.constants.AddressZero, "signer address is not zero");
  } else {
    console.log("  ⊘ signer tests skipped (no VOUCHER_SIGNER_PRIVATE_KEY)");
  }

  // ---- Summary ----
  console.log(`\n${"─".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

  await cleanup();
  await prisma.$disconnect();

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
