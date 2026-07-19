const assert = require("node:assert/strict");
const {
  DEFAULT_BENEFITS_API,
  IFR_API,
  IFRBenefitsClient,
  IFRClient,
  evaluateAccessRaw,
  getTierFromRaw,
  parseIFRAmount,
} = require("../dist");

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

async function testBenefitsCheckout() {
  const requests = [];
  const sellerWallet = "0x1111111111111111111111111111111111111111";
  const signature = `0x${"11".repeat(65)}`;
  const nonce = "ab".repeat(32);
  const timestamp = String(Date.now());
  const issuedAt = new Date(Number(timestamp)).toISOString();
  const expiresAt = new Date(Number(timestamp) + 10 * 60 * 1000).toISOString();
  const expectedMessage = [
    "IFR Benefits Network - Seller Authorization",
    "Action: sessions:create",
    "Business: coffee-shop",
    `Timestamp: ${timestamp}`,
    "Scope: rule-premium",
    `Nonce: ${nonce}`,
    "Only sign this message inside shop.ifrunit.tech.",
  ].join("\n");
  const mockFetch = async (url, init = {}) => {
    requests.push({ url, init });
    if (requests.length === 1) {
      return jsonResponse(200, {
        action: "sessions:create",
        businessId: "coffee-shop",
        walletAddress: sellerWallet,
        scope: "rule-premium",
        timestamp,
        issuedAt,
        expiresAt,
        message: expectedMessage,
        nonce,
      });
    }
    return jsonResponse(201, {
      sessionId: "session-1",
      expiresAt,
      qrUrl: "/r/session-1",
      benefitRuleId: "rule-premium",
      label: "Premium",
      category: "Coffee",
      productName: "Coffee membership",
      discountPercent: 15,
      requiredLockIFR: 5000,
      dailyRedemptionLimit: 1,
      monthlyRedemptionLimit: 4,
      tierLabel: null,
    });
  };
  const client = new IFRBenefitsClient({ fetch: mockFetch });
  const session = await client.createCheckout({
    businessId: "coffee-shop",
    benefitRuleId: "rule-premium",
    walletAddress: sellerWallet,
    signMessage: async (message) => {
      assert.equal(message, expectedMessage);
      return signature;
    },
  });

  const challengeUrl = new URL(requests[0].url);
  assert.equal(challengeUrl.origin, DEFAULT_BENEFITS_API);
  assert.equal(challengeUrl.searchParams.get("action"), "sessions:create");
  assert.equal(challengeUrl.searchParams.get("businessId"), "coffee-shop");
  assert.equal(challengeUrl.searchParams.get("walletAddress"), sellerWallet);
  assert.equal(challengeUrl.searchParams.get("scope"), "rule-premium");
  assert.equal(requests[1].init.method, "POST");
  assert.equal(requests[1].init.headers["x-ifr-wallet"], sellerWallet);
  assert.equal(requests[1].init.headers["x-ifr-signature"], signature);
  assert.equal(requests[1].init.headers["x-ifr-timestamp"], timestamp);
  assert.equal(requests[1].init.headers["x-ifr-nonce"], nonce);
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    businessId: "coffee-shop",
    benefitRuleId: "rule-premium",
  });
  assert.equal(session.customerUrl, "https://shop.ifrunit.tech/r/session-1");
}

async function testChallengeMismatchFailsBeforeWrite() {
  let requests = 0;
  let signed = false;
  const client = new IFRBenefitsClient({
    fetch: async () => {
      requests += 1;
      return jsonResponse(200, {
        action: "sessions:create",
        businessId: "another-business",
        walletAddress: "0x1111111111111111111111111111111111111111",
        scope: "default",
        timestamp: "1784400000000",
        message: "wrong binding",
        nonce: "ab".repeat(32),
      });
    },
  });
  await assert.rejects(
    client.createCheckout({
      businessId: "coffee-shop",
      walletAddress: "0x1111111111111111111111111111111111111111",
      signMessage: async () => {
        signed = true;
        return `0x${"11".repeat(65)}`;
      },
    }),
    /mismatched seller authorization challenge/
  );
  assert.equal(requests, 1);
  assert.equal(signed, false);
}

async function assertChallengeRejectedBeforeSigning(overrides, expectedPattern) {
  let requests = 0;
  let signed = false;
  const walletAddress = "0x1111111111111111111111111111111111111111";
  const timestamp = String(Date.now());
  const nonce = "ab".repeat(32);
  const challenge = {
    action: "sessions:create",
    businessId: "coffee-shop",
    walletAddress,
    scope: "default",
    timestamp,
    issuedAt: new Date(Number(timestamp)).toISOString(),
    expiresAt: new Date(Number(timestamp) + 10 * 60 * 1000).toISOString(),
    nonce,
    message: [
      "IFR Benefits Network - Seller Authorization",
      "Action: sessions:create",
      "Business: coffee-shop",
      `Timestamp: ${timestamp}`,
      "Scope: default",
      `Nonce: ${nonce}`,
      "Only sign this message inside shop.ifrunit.tech.",
    ].join("\n"),
    ...overrides,
  };
  const client = new IFRBenefitsClient({
    fetch: async () => {
      requests += 1;
      return jsonResponse(200, challenge);
    },
  });
  await assert.rejects(
    client.createCheckout({
      businessId: "coffee-shop",
      walletAddress,
      signMessage: async () => {
        signed = true;
        return `0x${"11".repeat(65)}`;
      },
    }),
    expectedPattern
  );
  assert.equal(requests, 1);
  assert.equal(signed, false);
}

async function main() {
  assert.equal(IFR_API, "https://copilot-api.ifrunit.tech");
  assert.throws(() => new IFRClient({ network: "sepolia" }), /Mainnet only/);
  assert.throws(() => parseIFRAmount("1.0000000001"), /at most 9 decimal places/);
  assert.equal(parseIFRAmount("1.000000001").toString(), "1000000001");
  assert.equal(getTierFromRaw(parseIFRAmount("499.999999999")), 0);
  assert.equal(getTierFromRaw(parseIFRAmount("500")), 1);
  const below = evaluateAccessRaw(0, parseIFRAmount("999.999999999"), parseIFRAmount("1000"));
  const exact = evaluateAccessRaw(0, parseIFRAmount("1000"), parseIFRAmount("1000"));
  assert.equal(below.hasAccess, false);
  assert.equal(exact.hasAccess, true);
  assert.throws(() => evaluateAccessRaw(-1, 0, 0), /non-negative/);
  assert.throws(() => new IFRBenefitsClient({ baseUrl: "http://example.com" }), /must use HTTPS/);
  assert.throws(
    () => new IFRBenefitsClient({ baseUrl: "https://example.com/prefix" }),
    /must be an origin/
  );
  await testBenefitsCheckout();
  await testChallengeMismatchFailsBeforeWrite();
  await assertChallengeRejectedBeforeSigning({ walletAddress: undefined }, /mismatched/);
  await assertChallengeRejectedBeforeSigning({ nonce: undefined }, /mismatched/);
  await assertChallengeRejectedBeforeSigning(
    { walletAddress: "0x2222222222222222222222222222222222222222" },
    /mismatched/
  );
  await assertChallengeRejectedBeforeSigning({ message: "Sign an unrelated message" }, /mismatched/);
  const staleTimestamp = String(Date.now() - 11 * 60 * 1000);
  const staleNonce = "ab".repeat(32);
  await assertChallengeRejectedBeforeSigning(
    {
      timestamp: staleTimestamp,
      issuedAt: new Date(Number(staleTimestamp)).toISOString(),
      expiresAt: new Date(Number(staleTimestamp) + 10 * 60 * 1000).toISOString(),
      message: [
        "IFR Benefits Network - Seller Authorization",
        "Action: sessions:create",
        "Business: coffee-shop",
        `Timestamp: ${staleTimestamp}`,
        "Scope: default",
        `Nonce: ${staleNonce}`,
        "Only sign this message inside shop.ifrunit.tech.",
      ].join("\n"),
    },
    /mismatched/
  );
  console.log("[ifr-sdk-test] PASS");
}

main().catch((error) => {
  console.error("[ifr-sdk-test] FAIL", error);
  process.exitCode = 1;
});
