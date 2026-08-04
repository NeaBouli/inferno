#!/usr/bin/env node

/**
 * Deterministic tests for scripts/check-token-listing-status.js.
 * All HTTP is mocked — no live network access.
 *
 * Usage: node scripts/test-token-listing-status.cjs
 */

const assert = require("node:assert/strict");
const monitor = require("./check-token-listing-status.js");

const FIXED_NOW = new Date("2026-08-04T12:00:00.000Z");

function validTokenListDoc() {
  return {
    name: "Inferno Token List",
    version: { major: 1, minor: 0, patch: 1 },
    tokens: [
      {
        chainId: 1,
        address: monitor.IFR_ADDRESS,
        name: "Inferno",
        symbol: "IFR",
        decimals: 9,
        logoURI: monitor.IFR_ICON_URL,
      },
    ],
  };
}

function jsonResponse(body, status = 200) {
  return {
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

/**
 * Builds a fetch mock from a route map: url -> response | () => response.
 * Unknown urls throw, so tests prove no unmocked endpoint is touched.
 */
function makeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const route = routes[url];
    if (!route) {
      throw new Error(`unexpected url in test: ${url}`);
    }
    const value = typeof route === "function" ? route() : route;
    if (value instanceof Error) throw value;
    return value;
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function pendingExternalRoutes() {
  return {
    [monitor.GITHUB_TARGETS[0].apiUrl]: jsonResponse({
      state: "open",
      merged_at: null,
      merged: false,
      draft: false,
      mergeable: null,
      mergeable_state: "unstable",
      updated_at: "2026-07-08T08:28:04Z",
      comments: 1,
      review_comments: 0,
      title: "Add Inferno (IFR)",
    }),
    [monitor.GITHUB_TARGETS[1].apiUrl]: jsonResponse({
      state: "open",
      state_reason: null,
      comments: 3,
      updated_at: "2026-07-08T06:59:55Z",
      title: "Add IFR to default list",
    }),
    [monitor.GITHUB_TARGETS[2].apiUrl]: jsonResponse({
      state: "open",
      merged_at: null,
      merged: false,
      draft: false,
      mergeable: true,
      mergeable_state: "blocked",
      updated_at: "2026-07-08T08:28:27Z",
      comments: 1,
      review_comments: 0,
      title: "Add IFR token",
    }),
    [monitor.COINGECKO_CONTRACT_URL]: jsonResponse({ error: "coin not found" }, 404),
    [monitor.COINGECKO_PRICE_URL]: jsonResponse({}),
    [monitor.DEXSCAN_TOKEN_URL]: jsonResponse(
      `<html><body>${monitor.IFR_ADDRESS_LOWER} is not verified by CoinMarketCap</body></html>`
    ),
    [monitor.RAINBOW_TOKEN_URL]: jsonResponse(
      `<html><body>Inferno IFR ${monitor.IFR_ADDRESS_LOWER}</body></html>`
    ),
  };
}

function officialRoutes() {
  return {
    [monitor.OFFICIAL_TOKEN_LIST_URLS[0]]: jsonResponse(validTokenListDoc()),
    [monitor.OFFICIAL_TOKEN_LIST_URLS[1]]: jsonResponse(validTokenListDoc()),
  };
}

async function testHappyPathPendingExternals() {
  const fetchImpl = makeFetch({ ...officialRoutes(), ...pendingExternalRoutes() });
  const report = await monitor.run({ fetchImpl, now: FIXED_NOW });

  assert.equal(report.exitCode, 0, "pending external states must not fail the command");
  assert.equal(report.ok, true);
  assert.equal(report.invariants.ok, true);
  assert.equal(report.generatedAt, "2026-08-04T12:00:00.000Z");
  assert.equal(report.token.decimals, 9);

  const gh = report.external.github;
  assert.equal(gh.metamaskContractMetadataPr1858.status, "ok");
  assert.equal(gh.metamaskContractMetadataPr1858.state, "open");
  assert.equal(gh.metamaskContractMetadataPr1858.merged, false);
  assert.equal(gh.metamaskContractMetadataPr1858.reviewComments, 0);
  assert.equal(gh.metamaskContractMetadataPr1858.updatedAt, "2026-07-08T08:28:04Z");
  assert.equal(gh.uniswapDefaultTokenListIssue2509.state, "open");
  assert.equal(gh.uniswapDefaultTokenListIssue2509.comments, 3);
  assert.equal(gh.ethereumListsTokensPr1036.mergeableState, "blocked");

  assert.equal(report.external.coingecko.contract.status, "not_found");
  assert.equal(report.external.coingecko.simplePrice.status, "no_price");
  assert.equal(report.external.coinmarketcapDexscan.status, "reachable");
  assert.equal(report.external.coinmarketcapDexscan.verification, "unverified");
  assert.equal(report.external.rainbow.status, "live_with_identity");
  assert.equal(report.external.rainbow.identity.nameInferno, true);

  for (const call of fetchImpl.calls) {
    assert.equal(call.init.method, "GET", "monitor must only issue GET requests");
    assert.equal(
      call.init.headers["user-agent"],
      monitor.USER_AGENT,
      "monitor must send a clear user-agent"
    );
  }
  console.log("[listing-monitor-test] PASS pending externals report with exit 0");
}

async function testWrongOfficialMetadataFails() {
  const wrong = validTokenListDoc();
  wrong.tokens[0].symbol = "IFRp";
  wrong.tokens[0].decimals = 18;
  const fetchImpl = makeFetch({
    [monitor.OFFICIAL_TOKEN_LIST_URLS[0]]: jsonResponse(wrong),
    [monitor.OFFICIAL_TOKEN_LIST_URLS[1]]: jsonResponse(validTokenListDoc()),
    ...pendingExternalRoutes(),
  });
  const report = await monitor.run({ fetchImpl, now: FIXED_NOW });

  assert.equal(report.exitCode, 1, "wrong official metadata must fail the command");
  assert.equal(report.ok, false);
  const listResult = report.invariants.officialTokenLists[monitor.OFFICIAL_TOKEN_LIST_URLS[0]];
  assert.equal(listResult.ok, false);
  assert.ok(listResult.problems.some((p) => p.includes("symbol")), "must report wrong symbol");
  assert.ok(listResult.problems.some((p) => p.includes("decimals")), "must report wrong decimals");
  console.log("[listing-monitor-test] PASS wrong official metadata exits 1");
}

async function testMalformedOfficialListFails() {
  const fetchImpl = makeFetch({
    [monitor.OFFICIAL_TOKEN_LIST_URLS[0]]: jsonResponse(validTokenListDoc()),
    [monitor.OFFICIAL_TOKEN_LIST_URLS[1]]: { status: 200, text: async () => "not-json{{{" },
    ...pendingExternalRoutes(),
  });
  const report = await monitor.run({ fetchImpl, now: FIXED_NOW });

  assert.equal(report.exitCode, 1);
  const listResult = report.invariants.officialTokenLists[monitor.OFFICIAL_TOKEN_LIST_URLS[1]];
  assert.equal(listResult.ok, false);
  assert.ok(listResult.problems.some((p) => p.includes("not valid JSON")));
  console.log("[listing-monitor-test] PASS malformed official list exits 1");
}

async function testUnreachableOfficialListFailsClosed() {
  const fetchImpl = makeFetch({
    [monitor.OFFICIAL_TOKEN_LIST_URLS[0]]: new Error("ENOTFOUND ifrunit.tech"),
    [monitor.OFFICIAL_TOKEN_LIST_URLS[1]]: jsonResponse(validTokenListDoc()),
    ...pendingExternalRoutes(),
  });
  const report = await monitor.run({ fetchImpl, now: FIXED_NOW });

  assert.equal(report.exitCode, 1, "project-controlled metadata must fail closed");
  const listResult = report.invariants.officialTokenLists[monitor.OFFICIAL_TOKEN_LIST_URLS[0]];
  assert.equal(listResult.ok, false);
  assert.ok(listResult.problems.some((p) => p.includes("fetch failed")));
  console.log("[listing-monitor-test] PASS unreachable official list exits 1 (fail closed)");
}

async function testUnreachableExternalsStillSucceed() {
  const fetchImpl = makeFetch({
    ...officialRoutes(),
    [monitor.GITHUB_TARGETS[0].apiUrl]: jsonResponse({ message: "API rate limit exceeded" }, 403),
    [monitor.GITHUB_TARGETS[1].apiUrl]: new Error("socket hang up"),
    [monitor.GITHUB_TARGETS[2].apiUrl]: jsonResponse("Server Error", 502),
    [monitor.COINGECKO_CONTRACT_URL]: jsonResponse({}, 429),
    [monitor.COINGECKO_PRICE_URL]: new Error("timeout"),
    [monitor.DEXSCAN_TOKEN_URL]: jsonResponse("Just a moment...", 403),
    [monitor.RAINBOW_TOKEN_URL]: jsonResponse("oops", 500),
  });
  const report = await monitor.run({ fetchImpl, now: FIXED_NOW });

  assert.equal(report.exitCode, 0, "external outages must not fail the command");
  assert.equal(report.external.github.metamaskContractMetadataPr1858.status, "rate_limited");
  assert.equal(report.external.github.uniswapDefaultTokenListIssue2509.status, "unreachable");
  assert.equal(report.external.github.ethereumListsTokensPr1036.status, "unreachable");
  assert.equal(report.external.coingecko.contract.status, "rate_limited");
  assert.equal(report.external.coingecko.simplePrice.status, "unreachable");
  assert.equal(report.external.coinmarketcapDexscan.status, "unreachable");
  assert.equal(report.external.rainbow.status, "unreachable");
  console.log("[listing-monitor-test] PASS external outages reported, exit 0");
}

async function testListedExternalStates() {
  const fetchImpl = makeFetch({
    ...officialRoutes(),
    [monitor.GITHUB_TARGETS[0].apiUrl]: jsonResponse({
      state: "closed",
      merged_at: "2026-08-01T00:00:00Z",
      merged: true,
      draft: false,
      mergeable: null,
      mergeable_state: "clean",
      updated_at: "2026-08-01T00:00:00Z",
      comments: 2,
      review_comments: 1,
      title: "Add Inferno (IFR)",
    }),
    [monitor.GITHUB_TARGETS[1].apiUrl]: jsonResponse({
      state: "closed",
      state_reason: "completed",
      comments: 7,
      updated_at: "2026-08-01T00:00:00Z",
      title: "Add IFR",
    }),
    [monitor.GITHUB_TARGETS[2].apiUrl]: jsonResponse({
      state: "closed",
      merged_at: "2026-08-02T00:00:00Z",
      merged: true,
      draft: false,
      mergeable: null,
      mergeable_state: "clean",
      updated_at: "2026-08-02T00:00:00Z",
      comments: 1,
      review_comments: 1,
      title: "Add IFR token",
    }),
    [monitor.COINGECKO_CONTRACT_URL]: jsonResponse({
      id: "inferno",
      symbol: "ifr",
      name: "Inferno",
    }),
    [monitor.COINGECKO_PRICE_URL]: jsonResponse({
      [monitor.IFR_ADDRESS_LOWER]: { usd: 0.0123 },
    }),
    [monitor.DEXSCAN_TOKEN_URL]: jsonResponse(
      `<html><body>${monitor.IFR_ADDRESS_LOWER} verified token page</body></html>`
    ),
    [monitor.RAINBOW_TOKEN_URL]: jsonResponse(
      `<html><body>Inferno IFR ${monitor.IFR_ADDRESS_LOWER}</body></html>`
    ),
  });
  const report = await monitor.run({ fetchImpl, now: FIXED_NOW });

  assert.equal(report.exitCode, 0);
  assert.equal(report.external.github.metamaskContractMetadataPr1858.merged, true);
  assert.equal(report.external.github.uniswapDefaultTokenListIssue2509.stateReason, "completed");
  assert.equal(report.external.coingecko.contract.status, "listed");
  assert.equal(report.external.coingecko.contract.id, "inferno");
  assert.equal(report.external.coingecko.simplePrice.status, "priced");
  assert.equal(report.external.coingecko.simplePrice.usd, 0.0123);
  assert.equal(
    report.external.coinmarketcapDexscan.verification,
    "unverified_label_absent"
  );
  console.log("[listing-monitor-test] PASS listed states reported correctly");
}

async function testRainbowIdentityUnclear() {
  const fetchImpl = makeFetch({
    ...officialRoutes(),
    ...pendingExternalRoutes(),
    [monitor.RAINBOW_TOKEN_URL]: jsonResponse("<html><body>page without token data</body></html>"),
  });
  const report = await monitor.run({ fetchImpl, now: FIXED_NOW });

  assert.equal(report.exitCode, 0, "unclear identity evidence must not fail the command");
  assert.equal(report.external.rainbow.status, "live_identity_unclear");
  assert.equal(report.external.rainbow.identity.nameInferno, false);
  console.log("[listing-monitor-test] PASS rainbow unclear identity is status-only");
}

async function testRainbowRequiresExactContract() {
  const fetchImpl = makeFetch({
    ...officialRoutes(),
    ...pendingExternalRoutes(),
    [monitor.RAINBOW_TOKEN_URL]: jsonResponse("<html><body>Inferno IFR</body></html>"),
  });
  const report = await monitor.run({ fetchImpl, now: FIXED_NOW });

  assert.equal(report.exitCode, 0, "third-party identity ambiguity is status-only");
  assert.equal(report.external.rainbow.status, "live_identity_unclear");
  assert.equal(report.external.rainbow.identity.nameInferno, true);
  assert.equal(report.external.rainbow.identity.symbolIfr, true);
  assert.equal(report.external.rainbow.identity.contractReferenced, false);
  console.log("[listing-monitor-test] PASS rainbow identity requires exact contract");
}

async function testMonitorMisconfiguration() {
  await assert.rejects(
    () => monitor.run({ fetchImpl: null, now: FIXED_NOW }),
    /no fetch implementation/,
    "malformed monitor configuration must throw so main() exits 1"
  );
  console.log("[listing-monitor-test] PASS misconfigured monitor throws (exit 1 via main)");
}

async function testEvaluateTokenListDocumentEdgeCases() {
  assert.equal(monitor.evaluateTokenListDocument(null).ok, false);
  assert.equal(monitor.evaluateTokenListDocument([]).ok, false);
  assert.equal(monitor.evaluateTokenListDocument({}).ok, false);
  const noEntry = monitor.evaluateTokenListDocument({ tokens: [] });
  assert.equal(noEntry.ok, false);
  assert.ok(noEntry.problems[0].includes("no chainId 1 entry"));
  const wrongAddress = monitor.evaluateTokenListDocument({
    tokens: [{ chainId: 1, address: "0x0000000000000000000000000000000000000001", symbol: "IFR", name: "Inferno", decimals: 9, logoURI: monitor.IFR_ICON_URL }],
  });
  assert.equal(wrongAddress.ok, false, "wrong address must not satisfy the invariant");
  const lowercaseAddress = validTokenListDoc();
  lowercaseAddress.tokens[0].address = monitor.IFR_ADDRESS_LOWER;
  assert.equal(
    monitor.evaluateTokenListDocument(lowercaseAddress).ok,
    true,
    "address comparison must be case-insensitive"
  );
  console.log("[listing-monitor-test] PASS token-list document edge cases");
}

async function main() {
  await testHappyPathPendingExternals();
  await testWrongOfficialMetadataFails();
  await testMalformedOfficialListFails();
  await testUnreachableOfficialListFailsClosed();
  await testUnreachableExternalsStillSucceed();
  await testListedExternalStates();
  await testRainbowIdentityUnclear();
  await testRainbowRequiresExactContract();
  await testMonitorMisconfiguration();
  await testEvaluateTokenListDocumentEdgeCases();
  console.log("[listing-monitor-test] ALL TESTS PASSED");
}

main().catch((error) => {
  console.error("[listing-monitor-test] FAIL:", error);
  process.exit(1);
});
