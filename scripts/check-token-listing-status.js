#!/usr/bin/env node

/**
 * INFERNO — IFR external-listing monitor (read-only)
 *
 * Performs only HTTP GET requests against public endpoints. No secrets,
 * no authentication and no write operations are required or performed.
 *
 * Checks:
 *   Invariants (project-controlled, exit 1 on failure):
 *   - Official token list        https://ifrunit.tech/token-list.json
 *   - Well-known token list      https://ifrunit.tech/.well-known/token-list.json
 *     Both must contain chainId 1 entry with the exact IFR address,
 *     symbol "IFR", name "Inferno", decimals 9 and the official icon URL.
 *
 *   External gates (reported as statuses, never fail the command):
 *   - GitHub API: MetaMask/contract-metadata PR 1858,
 *     Uniswap/default-token-list issue 2509, ethereum-lists/tokens PR 1036
 *   - CoinGecko exact-contract endpoint and simple token-price endpoint
 *   - CoinMarketCap DexScan exact-contract page reachability + unverified label
 *   - Rainbow exact-contract page reachability + Inferno/IFR identity evidence
 *
 * Exit codes:
 *   0 — official metadata invariants hold (external states may be pending)
 *   1 — invariant failure, unreachable official metadata, or monitor error
 *
 * Usage:
 *   node scripts/check-token-listing-status.js
 */

const IFR_ADDRESS = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const IFR_ADDRESS_LOWER = IFR_ADDRESS.toLowerCase();
const IFR_SYMBOL = "IFR";
const IFR_NAME = "Inferno";
const IFR_DECIMALS = 9;
const IFR_CHAIN_ID = 1;
const IFR_ICON_URL = "https://ifrunit.tech/assets/ifr_icon_256.png";

const OFFICIAL_TOKEN_LIST_URLS = [
  "https://ifrunit.tech/token-list.json",
  "https://ifrunit.tech/.well-known/token-list.json",
];

const GITHUB_TARGETS = [
  {
    key: "metamaskContractMetadataPr1858",
    kind: "pull",
    apiUrl: "https://api.github.com/repos/MetaMask/contract-metadata/pulls/1858",
    webUrl: "https://github.com/MetaMask/contract-metadata/pull/1858",
  },
  {
    key: "uniswapDefaultTokenListIssue2509",
    kind: "issue",
    apiUrl: "https://api.github.com/repos/Uniswap/default-token-list/issues/2509",
    webUrl: "https://github.com/Uniswap/default-token-list/issues/2509",
  },
  {
    key: "ethereumListsTokensPr1036",
    kind: "pull",
    apiUrl: "https://api.github.com/repos/ethereum-lists/tokens/pulls/1036",
    webUrl: "https://github.com/ethereum-lists/tokens/pull/1036",
  },
];

const COINGECKO_CONTRACT_URL =
  `https://api.coingecko.com/api/v3/coins/ethereum/contract/${IFR_ADDRESS}`;
const COINGECKO_PRICE_URL =
  `https://api.coingecko.com/api/v3/simple/token_price/ethereum` +
  `?contract_addresses=${IFR_ADDRESS}&vs_currencies=usd`;

const DEXSCAN_TOKEN_URL =
  `https://dex.coinmarketcap.com/token/ethereum/${IFR_ADDRESS_LOWER}/`;
const RAINBOW_TOKEN_URL =
  `https://rainbow.me/token/ethereum/${IFR_ADDRESS_LOWER}`;

const USER_AGENT =
  "inferno-listing-monitor/1.0 (+https://github.com/NeaBouli/inferno)";
const REQUEST_TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Reads a response body with a hard byte cap. Mocks in tests only need to
 * expose `{ status, text() }`; real undici responses use the stream reader.
 */
async function readBodyCapped(res, maxBytes) {
  if (res.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    let truncated = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - total;
      if (value.byteLength > remaining) {
        chunks.push(Buffer.from(value.subarray(0, Math.max(remaining, 0))));
        total = maxBytes;
        truncated = true;
        try {
          await reader.cancel();
        } catch (_) {
          // ignore cancellation errors
        }
        break;
      }
      chunks.push(Buffer.from(value));
      total += value.byteLength;
    }
    return { text: Buffer.concat(chunks).toString("utf8"), truncated };
  }
  const raw = typeof res.text === "function" ? await res.text() : String(res.body ?? "");
  if (raw.length > maxBytes) {
    return { text: raw.slice(0, maxBytes), truncated: true };
  }
  return { text: raw, truncated: false };
}

async function httpGet(fetchImpl, url, { timeoutMs, maxBodyBytes }) {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/json, text/html;q=0.8, */*;q=0.5",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res || typeof res.status !== "number") {
    throw new Error("malformed fetch response object");
  }
  const { text, truncated } = await readBodyCapped(res, maxBodyBytes);
  return { httpStatus: res.status, body: text, truncated };
}

function shortError(error) {
  const message = error && error.message ? error.message : String(error);
  return message.slice(0, 200);
}

/**
 * Validates one official token list document against the canonical IFR
 * metadata. Returns { ok, problems } — pure function, unit-testable.
 */
function evaluateTokenListDocument(doc) {
  const problems = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, problems: ["document is not a JSON object"] };
  }
  if (!Array.isArray(doc.tokens)) {
    return { ok: false, problems: ["missing tokens array"] };
  }
  const matches = doc.tokens.filter(
    (t) =>
      t &&
      t.chainId === IFR_CHAIN_ID &&
      typeof t.address === "string" &&
      t.address.toLowerCase() === IFR_ADDRESS_LOWER
  );
  if (matches.length === 0) {
    problems.push(`no chainId ${IFR_CHAIN_ID} entry for ${IFR_ADDRESS}`);
    return { ok: false, problems };
  }
  if (matches.length > 1) {
    problems.push(`duplicate IFR entries: ${matches.length}`);
  }
  const token = matches[0];
  if (token.symbol !== IFR_SYMBOL) {
    problems.push(`symbol is ${JSON.stringify(token.symbol)}, expected "${IFR_SYMBOL}"`);
  }
  if (token.name !== IFR_NAME) {
    problems.push(`name is ${JSON.stringify(token.name)}, expected "${IFR_NAME}"`);
  }
  if (token.decimals !== IFR_DECIMALS) {
    problems.push(`decimals is ${JSON.stringify(token.decimals)}, expected ${IFR_DECIMALS}`);
  }
  if (token.logoURI !== IFR_ICON_URL) {
    problems.push(`logoURI is ${JSON.stringify(token.logoURI)}, expected "${IFR_ICON_URL}"`);
  }
  return { ok: problems.length === 0, problems };
}

async function checkOfficialTokenList(fetchImpl, url, opts) {
  try {
    const { httpStatus, body, truncated } = await httpGet(fetchImpl, url, opts);
    if (httpStatus !== 200) {
      return {
        url,
        ok: false,
        problems: [`unexpected HTTP ${httpStatus} (official metadata unreachable)`],
      };
    }
    let doc;
    try {
      doc = JSON.parse(body);
    } catch (_) {
      return { url, ok: false, problems: ["response is not valid JSON"] };
    }
    const result = evaluateTokenListDocument(doc);
    return { url, ok: result.ok, problems: result.problems, truncated };
  } catch (error) {
    // Official metadata is project-controlled: fail closed.
    return { url, ok: false, problems: [`fetch failed: ${shortError(error)}`] };
  }
}

async function checkGithubTarget(fetchImpl, target, opts) {
  const base = { url: target.webUrl, apiUrl: target.apiUrl, kind: target.kind };
  try {
    const { httpStatus, body } = await httpGet(fetchImpl, target.apiUrl, opts);
    if (httpStatus === 403 || httpStatus === 429) {
      return { ...base, status: "rate_limited", httpStatus };
    }
    if (httpStatus !== 200) {
      return { ...base, status: "unreachable", httpStatus };
    }
    let data;
    try {
      data = JSON.parse(body);
    } catch (_) {
      return { ...base, status: "unreachable", httpStatus, error: "invalid JSON" };
    }
    if (target.kind === "pull") {
      return {
        ...base,
        status: "ok",
        state: data.state ?? null,
        merged: data.merged === true || Boolean(data.merged_at),
        draft: Boolean(data.draft),
        mergeable: data.mergeable ?? null,
        mergeableState: data.mergeable_state ?? null,
        updatedAt: data.updated_at ?? null,
        comments: typeof data.comments === "number" ? data.comments : null,
        reviewComments:
          typeof data.review_comments === "number" ? data.review_comments : null,
        title: typeof data.title === "string" ? data.title.slice(0, 120) : null,
      };
    }
    return {
      ...base,
      status: "ok",
      state: data.state ?? null,
      stateReason: data.state_reason ?? null,
      comments: typeof data.comments === "number" ? data.comments : null,
      updatedAt: data.updated_at ?? null,
      title: typeof data.title === "string" ? data.title.slice(0, 120) : null,
    };
  } catch (error) {
    return { ...base, status: "unreachable", error: shortError(error) };
  }
}

async function checkCoingeckoContract(fetchImpl, opts) {
  const base = { url: COINGECKO_CONTRACT_URL };
  try {
    const { httpStatus, body } = await httpGet(fetchImpl, COINGECKO_CONTRACT_URL, opts);
    if (httpStatus === 404) {
      return { ...base, status: "not_found", httpStatus };
    }
    if (httpStatus === 429) {
      return { ...base, status: "rate_limited", httpStatus };
    }
    if (httpStatus !== 200) {
      return { ...base, status: "unreachable", httpStatus };
    }
    let data;
    try {
      data = JSON.parse(body);
    } catch (_) {
      return { ...base, status: "unreachable", httpStatus, error: "invalid JSON" };
    }
    return {
      ...base,
      status: "listed",
      id: data.id ?? null,
      symbol: data.symbol ?? null,
      name: data.name ?? null,
    };
  } catch (error) {
    return { ...base, status: "unreachable", error: shortError(error) };
  }
}

async function checkCoingeckoPrice(fetchImpl, opts) {
  const base = { url: COINGECKO_PRICE_URL };
  try {
    const { httpStatus, body } = await httpGet(fetchImpl, COINGECKO_PRICE_URL, opts);
    if (httpStatus === 429) {
      return { ...base, status: "rate_limited", httpStatus };
    }
    if (httpStatus !== 200) {
      return { ...base, status: "unreachable", httpStatus };
    }
    let data;
    try {
      data = JSON.parse(body);
    } catch (_) {
      return { ...base, status: "unreachable", httpStatus, error: "invalid JSON" };
    }
    const entry = data ? data[IFR_ADDRESS_LOWER] : undefined;
    if (entry && typeof entry.usd === "number") {
      return { ...base, status: "priced", usd: entry.usd };
    }
    return { ...base, status: "no_price" };
  } catch (error) {
    return { ...base, status: "unreachable", error: shortError(error) };
  }
}

async function checkDexscan(fetchImpl, opts) {
  const base = { url: DEXSCAN_TOKEN_URL };
  try {
    const { httpStatus, body, truncated } = await httpGet(fetchImpl, DEXSCAN_TOKEN_URL, opts);
    if (httpStatus !== 200) {
      return { ...base, status: "unreachable", httpStatus };
    }
    const lower = body.toLowerCase();
    const hasUnverifiedLabel = lower.includes("not verified");
    const hasAddress = lower.includes(IFR_ADDRESS_LOWER);
    return {
      ...base,
      status: "reachable",
      httpStatus,
      contractReferenced: hasAddress,
      verification: hasUnverifiedLabel ? "unverified" : "unverified_label_absent",
      truncated,
    };
  } catch (error) {
    return { ...base, status: "unreachable", error: shortError(error) };
  }
}

async function checkRainbow(fetchImpl, opts) {
  const base = { url: RAINBOW_TOKEN_URL };
  try {
    const { httpStatus, body, truncated } = await httpGet(fetchImpl, RAINBOW_TOKEN_URL, opts);
    if (httpStatus !== 200) {
      return { ...base, status: "unreachable", httpStatus };
    }
    const identity = {
      nameInferno: /inferno/i.test(body),
      symbolIfr: /\bIFR\b/.test(body),
      contractReferenced: body.toLowerCase().includes(IFR_ADDRESS_LOWER),
    };
    const full =
      identity.nameInferno && identity.symbolIfr && identity.contractReferenced;
    return {
      ...base,
      status: full ? "live_with_identity" : "live_identity_unclear",
      httpStatus,
      identity,
      truncated,
    };
  } catch (error) {
    return { ...base, status: "unreachable", error: shortError(error) };
  }
}

/**
 * Runs the full monitor. Options:
 *   fetchImpl    — fetch-compatible function (default: global fetch)
 *   timeoutMs    — per-request timeout (default 15000)
 *   maxBodyBytes — response body cap (default 2 MiB)
 *   now          — Date for generatedAt (default: new Date())
 * Returns the structured report including `ok` and `exitCode`.
 */
async function run(options = {}) {
  const fetchImpl = options.fetchImpl === undefined ? globalThis.fetch : options.fetchImpl;
  if (typeof fetchImpl !== "function") {
    throw new Error("monitor misconfigured: no fetch implementation available");
  }
  const opts = {
    timeoutMs: options.timeoutMs || REQUEST_TIMEOUT_MS,
    maxBodyBytes: options.maxBodyBytes || MAX_BODY_BYTES,
  };
  const now = options.now || new Date();

  const [listA, listB, gh0, gh1, gh2, cgContract, cgPrice, dexscan, rainbow] =
    await Promise.all([
      ...OFFICIAL_TOKEN_LIST_URLS.map((url) => checkOfficialTokenList(fetchImpl, url, opts)),
      ...GITHUB_TARGETS.map((target) => checkGithubTarget(fetchImpl, target, opts)),
      checkCoingeckoContract(fetchImpl, opts),
      checkCoingeckoPrice(fetchImpl, opts),
      checkDexscan(fetchImpl, opts),
      checkRainbow(fetchImpl, opts),
    ]);

  const officialTokenLists = { [OFFICIAL_TOKEN_LIST_URLS[0]]: listA, [OFFICIAL_TOKEN_LIST_URLS[1]]: listB };
  const invariantsOk = listA.ok && listB.ok;

  const report = {
    monitor: "ifr-external-listing-monitor",
    version: 1,
    generatedAt: now.toISOString(),
    token: {
      name: IFR_NAME,
      symbol: IFR_SYMBOL,
      decimals: IFR_DECIMALS,
      chainId: IFR_CHAIN_ID,
      address: IFR_ADDRESS,
      iconUrl: IFR_ICON_URL,
    },
    invariants: {
      ok: invariantsOk,
      officialTokenLists,
    },
    external: {
      github: {
        [GITHUB_TARGETS[0].key]: gh0,
        [GITHUB_TARGETS[1].key]: gh1,
        [GITHUB_TARGETS[2].key]: gh2,
      },
      coingecko: {
        contract: cgContract,
        simplePrice: cgPrice,
      },
      coinmarketcapDexscan: dexscan,
      rainbow,
    },
    ok: invariantsOk,
    exitCode: invariantsOk ? 0 : 1,
  };
  return report;
}

async function main() {
  try {
    const report = await run();
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (!report.ok) {
      console.error("[listing-monitor] FAIL: official IFR token metadata invariant violated");
    }
    process.exit(report.exitCode);
  } catch (error) {
    console.error("[listing-monitor] monitor error:", shortError(error));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  run,
  evaluateTokenListDocument,
  IFR_ADDRESS,
  IFR_ADDRESS_LOWER,
  IFR_SYMBOL,
  IFR_NAME,
  IFR_DECIMALS,
  IFR_CHAIN_ID,
  IFR_ICON_URL,
  OFFICIAL_TOKEN_LIST_URLS,
  GITHUB_TARGETS,
  COINGECKO_CONTRACT_URL,
  COINGECKO_PRICE_URL,
  DEXSCAN_TOKEN_URL,
  RAINBOW_TOKEN_URL,
  USER_AGENT,
  REQUEST_TIMEOUT_MS,
  MAX_BODY_BYTES,
};
