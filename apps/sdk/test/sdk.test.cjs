const assert = require("node:assert/strict");
const {
  DEFAULT_BENEFITS_API,
  IFR_API,
  IFRBenefitsClient,
  IFRClient,
  evaluateAccessRaw,
  getTierFromRaw,
  parseIFRAmount,
  DEFAULT_TIERS,
  getBenefitTierFromRaw,
  validateTiers,
  IFRReadError,
} = require("../dist");

const SELLER_DOMAIN = "shop.ifrunit.tech";
const SELLER_CHAIN_ID = 1;

function buildSellerMessage(action, businessId, timestamp, scope, nonce, domain = SELLER_DOMAIN, chainId = SELLER_CHAIN_ID) {
  return [
    "IFR Benefits Network - Seller Authorization",
    `Domain: ${domain}`,
    `Chain ID: ${chainId}`,
    `Action: ${action}`,
    `Business: ${businessId}`,
    `Scope: ${scope}`,
    `Nonce: ${nonce}`,
    `Timestamp: ${timestamp}`,
    `Expires: ${new Date(Number(timestamp) + 10 * 60 * 1000).toISOString()}`,
    `Only sign this message inside ${domain}.`,
  ].join("\n");
}

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
  const expectedMessage = buildSellerMessage("sessions:create", "coffee-shop", timestamp, "rule-premium", nonce);
  const mockFetch = async (url, init = {}) => {
    requests.push({ url, init });
    if (requests.length === 1) {
      return jsonResponse(200, {
        action: "sessions:create",
        businessId: "coffee-shop",
        scope: "rule-premium",
        domain: SELLER_DOMAIN,
        chainId: SELLER_CHAIN_ID,
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
  assert.equal(challengeUrl.searchParams.has("walletAddress"), false);
  assert.equal(requests[0].url.toLowerCase().includes(sellerWallet.slice(2).toLowerCase()), false);
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

async function assertChallengeRejectedBeforeSigning(overrides, expectedPattern, clientConfig = {}) {
  let requests = 0;
  let signed = false;
  const walletAddress = "0x1111111111111111111111111111111111111111";
  const timestamp = String(Date.now());
  const nonce = "ab".repeat(32);
  const challenge = {
    action: "sessions:create",
    businessId: "coffee-shop",
    scope: "default",
    domain: SELLER_DOMAIN,
    chainId: SELLER_CHAIN_ID,
    timestamp,
    issuedAt: new Date(Number(timestamp)).toISOString(),
    expiresAt: new Date(Number(timestamp) + 10 * 60 * 1000).toISOString(),
    nonce,
    message: buildSellerMessage("sessions:create", "coffee-shop", timestamp, "default", nonce),
    ...overrides,
  };
  const client = new IFRBenefitsClient({
    ...clientConfig,
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

function validRedeemChallenge(sessionId, walletAddress, overrides = {}) {
  const timestamp = String(Date.now());
  const nonce = "ab".repeat(32);
  return {
    action: "sessions:redeem",
    businessId: sessionId,
    scope: sessionId,
    domain: SELLER_DOMAIN,
    chainId: SELLER_CHAIN_ID,
    timestamp,
    issuedAt: new Date(Number(timestamp)).toISOString(),
    expiresAt: new Date(Number(timestamp) + 10 * 60 * 1000).toISOString(),
    nonce,
    message: buildSellerMessage("sessions:redeem", sessionId, timestamp, sessionId, nonce),
    ...overrides,
  };
}

async function testGetCheckoutStatus() {
  const requests = [];
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const client = new IFRBenefitsClient({
    fetch: async (url, init = {}) => {
      requests.push({ url, init });
      return jsonResponse(200, {
        status: "APPROVED",
        reason: null,
        redeemedAt: null,
        expiresAt,
        attestAttempts: 1,
        businessId: "coffee-shop",
        benefitRuleId: "rule-premium",
        benefit: { label: "Premium" },
        presentation: "SELLER_QR",
      });
    },
  });
  const status = await client.getCheckoutStatus("session-1");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `${DEFAULT_BENEFITS_API}/api/sessions/session-1`);
  assert.equal(requests[0].init.method, "GET");
  assert.equal(requests[0].init.cache, "no-store");
  assert.deepEqual(status, {
    status: "APPROVED",
    reason: null,
    redeemedAt: null,
    expiresAt,
    attestAttempts: 1,
    businessId: "coffee-shop",
    benefitRuleId: "rule-premium",
    presentation: "SELLER_QR",
  });
}

async function testGetCheckoutStatusRedeemed() {
  const redeemedAt = new Date().toISOString();
  const client = new IFRBenefitsClient({
    fetch: async () =>
      jsonResponse(200, {
        status: "REDEEMED",
        reason: null,
        redeemedAt,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        attestAttempts: 2,
        businessId: "coffee-shop",
        benefitRuleId: null,
        presentation: "CUSTOMER_PASS",
      }),
  });
  const status = await client.getCheckoutStatus("session-9");
  assert.equal(status.status, "REDEEMED");
  assert.equal(status.redeemedAt, redeemedAt);
  assert.equal(status.presentation, "CUSTOMER_PASS");
}

async function assertStatusRejected(body) {
  const client = new IFRBenefitsClient({
    fetch: async () => jsonResponse(200, body),
  });
  await assert.rejects(client.getCheckoutStatus("session-1"), /invalid checkout status/);
}

async function testGetCheckoutStatusMalformed() {
  const valid = {
    status: "PENDING",
    reason: null,
    redeemedAt: null,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    attestAttempts: 0,
    businessId: "coffee-shop",
    benefitRuleId: "rule-premium",
    presentation: "SELLER_QR",
  };
  await assertStatusRejected(null);
  await assertStatusRejected({ ...valid, status: "UNKNOWN" });
  await assertStatusRejected({ ...valid, status: undefined });
  await assertStatusRejected({ ...valid, expiresAt: "not-a-date" });
  await assertStatusRejected({ ...valid, expiresAt: "2026-07-27" });
  await assertStatusRejected({ ...valid, expiresAt: undefined });
  await assertStatusRejected({ ...valid, redeemedAt: "not-a-date" });
  await assertStatusRejected({ ...valid, redeemedAt: "2026-07-27T00:00:00+00:00" });
  await assertStatusRejected({ ...valid, redeemedAt: undefined });
  await assertStatusRejected({ ...valid, attestAttempts: -1 });
  await assertStatusRejected({ ...valid, attestAttempts: 1.5 });
  await assertStatusRejected({ ...valid, businessId: "" });
  await assertStatusRejected({ ...valid, reason: 42 });
  await assertStatusRejected({ ...valid, benefitRuleId: 42 });
  await assertStatusRejected({ ...valid, presentation: "UNKNOWN" });
}

async function testInvalidSessionIdRejectedBeforeRequest() {
  let requests = 0;
  const client = new IFRBenefitsClient({
    fetch: async () => {
      requests += 1;
      return jsonResponse(200, {});
    },
  });
  const signMessage = async () => `0x${"11".repeat(65)}`;
  for (const bad of ["a/b", "..", "a..b", " a", "a ", "", "a?b", "a#b", "a\\b", "a\nb"]) {
    await assert.rejects(client.getCheckoutStatus(bad), /Invalid checkout session ID/);
    await assert.rejects(
      client.redeemCheckout({ sessionId: bad, walletAddress: "0x1111111111111111111111111111111111111111", signMessage }),
      /Invalid checkout session ID/
    );
  }
  assert.equal(requests, 0);
}

async function testRedeemCheckout() {
  const requests = [];
  const sellerWallet = "0x1111111111111111111111111111111111111111";
  const signature = `0x${"22".repeat(65)}`;
  const sessionId = "session-1";
  const challenge = validRedeemChallenge(sessionId, sellerWallet);
  const mockFetch = async (url, init = {}) => {
    requests.push({ url, init });
    if (requests.length === 1) return jsonResponse(200, challenge);
    return jsonResponse(200, { status: "REDEEMED" });
  };
  const client = new IFRBenefitsClient({ fetch: mockFetch });
  const result = await client.redeemCheckout({
    sessionId,
    walletAddress: sellerWallet,
    signMessage: async (message) => {
      assert.equal(message, challenge.message);
      return signature;
    },
  });

  assert.equal(requests.length, 2);
  const challengeUrl = new URL(requests[0].url);
  assert.equal(challengeUrl.origin, DEFAULT_BENEFITS_API);
  assert.equal(challengeUrl.pathname, "/api/seller/auth-message");
  assert.equal(challengeUrl.searchParams.get("action"), "sessions:redeem");
  assert.equal(challengeUrl.searchParams.get("businessId"), sessionId);
  assert.equal(challengeUrl.searchParams.get("scope"), sessionId);
  assert.equal(challengeUrl.searchParams.has("walletAddress"), false);
  assert.equal(requests[0].url.toLowerCase().includes(sellerWallet.slice(2).toLowerCase()), false);
  assert.equal(requests[1].url, `${DEFAULT_BENEFITS_API}/api/sessions/session-1/redeem`);
  assert.equal(requests[1].init.method, "POST");
  assert.equal(requests[1].init.headers["x-ifr-wallet"], sellerWallet);
  assert.equal(requests[1].init.headers["x-ifr-signature"], signature);
  assert.equal(requests[1].init.headers["x-ifr-timestamp"], challenge.timestamp);
  assert.equal(requests[1].init.headers["x-ifr-nonce"], challenge.nonce);
  assert.deepEqual(result, { status: "REDEEMED" });
}

async function assertRedeemChallengeRejectedBeforeSigning(overrides, expectedPattern) {
  let requests = 0;
  let signed = false;
  const walletAddress = "0x1111111111111111111111111111111111111111";
  const sessionId = "session-1";
  const challenge = validRedeemChallenge(sessionId, walletAddress, overrides);
  const client = new IFRBenefitsClient({
    fetch: async () => {
      requests += 1;
      return jsonResponse(200, challenge);
    },
  });
  await assert.rejects(
    client.redeemCheckout({
      sessionId,
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

async function testRedeemChallengeMismatchFailsBeforeSigning() {
  const sessionId = "session-1";
  await assertRedeemChallengeRejectedBeforeSigning({ action: "sessions:create" }, /mismatched/);
  await assertRedeemChallengeRejectedBeforeSigning({ businessId: "other-session" }, /mismatched/);
  await assertRedeemChallengeRejectedBeforeSigning({ scope: "other-scope" }, /mismatched/);
  await assertRedeemChallengeRejectedBeforeSigning({ nonce: undefined }, /mismatched/);
  await assertRedeemChallengeRejectedBeforeSigning({ message: "Sign an unrelated message" }, /mismatched/);
  const staleTimestamp = String(Date.now() - 11 * 60 * 1000);
  const staleNonce = "cd".repeat(32);
  await assertRedeemChallengeRejectedBeforeSigning(
    {
      timestamp: staleTimestamp,
      issuedAt: new Date(Number(staleTimestamp)).toISOString(),
      expiresAt: new Date(Number(staleTimestamp) + 10 * 60 * 1000).toISOString(),
      nonce: staleNonce,
      message: buildSellerMessage("sessions:redeem", sessionId, staleTimestamp, sessionId, staleNonce),
    },
    /mismatched/
  );
  // Redeem must also reject a challenge that would be valid for createCheckout.
  const createTimestamp = String(Date.now());
  const createNonce = "ef".repeat(32);
  await assertRedeemChallengeRejectedBeforeSigning(
    {
      action: "sessions:create",
      message: buildSellerMessage("sessions:create", sessionId, createTimestamp, sessionId, createNonce),
      timestamp: createTimestamp,
      issuedAt: new Date(Number(createTimestamp)).toISOString(),
      expiresAt: new Date(Number(createTimestamp) + 10 * 60 * 1000).toISOString(),
      nonce: createNonce,
    },
    /mismatched/
  );
}

async function testRedeemInvalidSignatureRejectedBeforePost() {
  let requests = 0;
  const walletAddress = "0x1111111111111111111111111111111111111111";
  const sessionId = "session-1";
  const client = new IFRBenefitsClient({
    fetch: async () => {
      requests += 1;
      return jsonResponse(200, validRedeemChallenge(sessionId, walletAddress));
    },
  });
  await assert.rejects(
    client.redeemCheckout({
      sessionId,
      walletAddress,
      signMessage: async () => "not-a-signature",
    }),
    /invalid signature/
  );
  assert.equal(requests, 1);
}

async function testRedeemMalformedResultRejected() {
  const walletAddress = "0x1111111111111111111111111111111111111111";
  const sessionId = "session-1";
  let requests = 0;
  const client = new IFRBenefitsClient({
    fetch: async () => {
      requests += 1;
      if (requests === 1) return jsonResponse(200, validRedeemChallenge(sessionId, walletAddress));
      return jsonResponse(200, { status: "APPROVED" });
    },
  });
  await assert.rejects(
    client.redeemCheckout({
      sessionId,
      walletAddress,
      signMessage: async () => `0x${"11".repeat(65)}`,
    }),
    /invalid checkout redemption/
  );
  assert.equal(requests, 2);
}

async function testBenefitTiers() {
  // Default preset = Benefits network preset, locked IFR only.
  assert.deepEqual(DEFAULT_TIERS.map((t) => [t.key, t.minLocked]), [
    ["bronze", "1000"], ["silver", "2500"], ["gold", "5000"], ["platinum", "10000"],
  ]);
  assert.ok(Object.isFrozen(DEFAULT_TIERS) && Object.isFrozen(DEFAULT_TIERS[0]));
  const at = (v) => getBenefitTierFromRaw(parseIFRAmount(v));
  assert.deepEqual([at("0").level, at("0").key, at("0").name], [0, null, "None"]);
  assert.equal(at("999.999999999").level, 0);
  assert.deepEqual([at("1000").level, at("1000").name], [1, "Bronze"]);
  assert.equal(at("2499.999999999").key, "bronze");
  assert.equal(at("2500").key, "silver");
  assert.equal(at("5000").key, "gold");
  assert.equal(at("10000").key, "platinum");
  assert.equal(at("1000000000").key, "platinum");
  assert.equal(at("2500").lockedRaw, "2500000000000");
  assert.throws(() => getBenefitTierFromRaw(-1n), /non-negative/);
  // Partners / integrators may use their own thresholds.
  const custom = [
    { key: "fan", name: "Fan", minLocked: "1" },
    { key: "vip", name: "VIP", minLocked: "500.5" },
  ];
  assert.equal(getBenefitTierFromRaw(parseIFRAmount("0.999999999"), custom).level, 0);
  assert.equal(getBenefitTierFromRaw(parseIFRAmount("1"), custom).key, "fan");
  assert.equal(getBenefitTierFromRaw(parseIFRAmount("500.499999999"), custom).key, "fan");
  assert.equal(getBenefitTierFromRaw(parseIFRAmount("500.5"), custom).key, "vip");
  // Invalid tier lists are refused.
  assert.throws(() => validateTiers([]), /non-empty/);
  assert.throws(() => validateTiers([{ key: "a", name: "A", minLocked: "10" }, { key: "b", name: "B", minLocked: "10" }]), /strictly ascending/);
  assert.throws(() => validateTiers([{ key: "a", name: "A", minLocked: "10" }, { key: "a", name: "B", minLocked: "20" }]), /duplicate/);
  assert.throws(() => validateTiers([{ key: "a", name: "A", minLocked: "1e3" }]), /at most 9 decimal/);
  assert.throws(() => validateTiers([{ key: "", name: "A", minLocked: "1" }]), /key and name/);
  // IFRClient.getBenefitTier reads IFRLock only and fails closed on read errors.
  const client = new IFRClient({ rpcUrl: "http://127.0.0.1:9" });
  client.lockContract = { lockedBalance: async () => parseIFRAmount("5000") };
  client.token = { balanceOf: async () => { throw new Error("balance must not be read"); } };
  const r = await client.getBenefitTier("0x000000000000000000000000000000000000dEaD");
  assert.equal(r.key, "gold");
  client.lockContract = { lockedBalance: async () => { throw new Error("rpc down"); } };
  await assert.rejects(client.getBenefitTier("0x000000000000000000000000000000000000dEaD"), /rpc down/);
  await assert.rejects(client.getBenefitTier("not-an-address"), /Invalid wallet/);

  // No silent zeros/false on read failures (T-212b-data-integrity).
  const dead = "0x000000000000000000000000000000000000dEaD";
  const down = async () => { throw new Error("rpc down"); };
  client.token = { balanceOf: async () => parseIFRAmount("10") };
  client.lockContract = { lockedBalance: down };
  for (const call of [
    () => client.getLockedBalance(dead),
    () => client.getTier(dead),
    () => client.checkAccess({ wallet: dead, required: "1" }),
  ]) {
    await assert.rejects(call(), (error) => error instanceof IFRReadError && error.read === "IFRLock.lockedBalance" && /rpc down/.test(error.message));
  }
  // checkLocked:false does not read IFRLock at all.
  const noLock = await client.checkAccess({ wallet: dead, required: "1", checkLocked: false });
  assert.equal(noLock.hasAccess, true);
  client.registry = { isBuilder: down };
  await assert.rejects(client.isBuilder(dead), (error) => error instanceof IFRReadError && error.read === "BuilderRegistry.isBuilder");
  client.registry = { isBuilder: async () => true };
  assert.equal(await client.isBuilder(dead), true);
  client.lockContract = { lockedBalance: async () => parseIFRAmount("2.5") };
  assert.equal(await client.getLockedBalance(dead), 2.5);
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
  await assertChallengeRejectedBeforeSigning({ nonce: undefined }, /mismatched/);
  await assertChallengeRejectedBeforeSigning({ message: "Sign an unrelated message" }, /mismatched/);
  const staleTimestamp = String(Date.now() - 11 * 60 * 1000);
  const staleNonce = "ab".repeat(32);
  await assertChallengeRejectedBeforeSigning(
    {
      timestamp: staleTimestamp,
      issuedAt: new Date(Number(staleTimestamp)).toISOString(),
      expiresAt: new Date(Number(staleTimestamp) + 10 * 60 * 1000).toISOString(),
      message: buildSellerMessage("sessions:create", "coffee-shop", staleTimestamp, "default", staleNonce),
    },
    /mismatched/
  );
  // Domain and chain binding: a challenge for another deployment is refused before signing.
  const boundTimestamp = String(Date.now());
  const boundNonce = "ab".repeat(32);
  await assertChallengeRejectedBeforeSigning(
    {
      domain: "shop.attacker.example",
      timestamp: boundTimestamp,
      issuedAt: new Date(Number(boundTimestamp)).toISOString(),
      expiresAt: new Date(Number(boundTimestamp) + 10 * 60 * 1000).toISOString(),
      message: buildSellerMessage(
        "sessions:create", "coffee-shop", boundTimestamp, "default", boundNonce, "shop.attacker.example"
      ),
    },
    /mismatched/
  );
  await assertChallengeRejectedBeforeSigning({ chainId: undefined }, /mismatched/);
  await assertChallengeRejectedBeforeSigning({ chainId: "1" }, /mismatched/);
  await assertChallengeRejectedBeforeSigning(
    {
      chainId: 11155111,
      timestamp: boundTimestamp,
      issuedAt: new Date(Number(boundTimestamp)).toISOString(),
      expiresAt: new Date(Number(boundTimestamp) + 10 * 60 * 1000).toISOString(),
      message: buildSellerMessage(
        "sessions:create", "coffee-shop", boundTimestamp, "default", boundNonce, SELLER_DOMAIN, 11155111
      ),
    },
    /mismatched/,
    { chainId: 1 }
  );
  assert.throws(() => new IFRBenefitsClient({ chainId: 0 }), /Invalid Benefits chain ID/);
  await testGetCheckoutStatus();
  await testGetCheckoutStatusRedeemed();
  await testGetCheckoutStatusMalformed();
  await testInvalidSessionIdRejectedBeforeRequest();
  await testRedeemCheckout();
  await testRedeemChallengeMismatchFailsBeforeSigning();
  await testRedeemInvalidSignatureRejectedBeforePost();
  await testRedeemMalformedResultRejected();
  await testBenefitTiers();
  console.log("[ifr-sdk-test] PASS");
}

main().catch((error) => {
  console.error("[ifr-sdk-test] FAIL", error);
  process.exitCode = 1;
});

// CommitmentVault V2 address (T-223)
{
  const sdk = require("../dist/index.js");
  if (sdk.MAINNET_ADDRESSES.commitmentVaultV2 !== "0x8efae0C85ad6d44C731cAEDA1cBC275904Fc7c8F") throw new Error("commitmentVaultV2 address");
  if (sdk.MAINNET_ADDRESSES.commitmentVault !== "0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3") throw new Error("commitmentVault V1 address");
  console.log("  ok MAINNET_ADDRESSES includes CommitmentVault V1 and V2");
}
