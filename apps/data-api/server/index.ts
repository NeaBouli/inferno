import "dotenv/config";
import express from "express";
import cors from "cors";
import { securityHeaders } from "./security-headers.js";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { IFR_DECIMALS, getAccessTier } from "./access-tiers.js";
import { resolveAllowedOrigins } from "./cors-origins.js";
import { toJsonSafeUint32 } from "./json-values.js";
import { builderConfigurationScore, type BuilderGenConfig } from "./builder-score.js";
import { LENDING_LOAN_ABI, serializeLendingLoan, type SerializedLendingLoan } from "./lending-loans.js";
import { ethCall, getRpcProvider, rpcHealth } from "./rpc.js";
import { balanceEntry, explorerBalanceEntry, finalizeBalances, lostSupply, parseAddressParam, requireBaseUnits, IFRLOCK_UNLOCKED_TOPIC, sumUnlockedLogs, unavailableEntry, type BalanceEntry } from "./balance-integrity.js";
import { Semaphore, SingleFlightCache, SlidingWindowLimiter, TRUSTED_PROXY_HOPS, ipRateLimit, positiveIntEnv } from "./request-guard.js";

const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.set(securityHeaders);
  next();
});
app.set("trust proxy", TRUSTED_PROXY_HOPS);
app.use(cors({ origin: resolveAllowedOrigins() }));
// Retired clients receive a stable tombstone even for obsolete/malformed chat payloads.
app.post("/api/chat", (_req, res) => {
  res.status(410).json({ error: "chat retired" });
});
app.use(express.json({ limit: '50kb' }));

const endpoints = [
  "GET /api/health",
  "GET /api/health/rpc",
  "GET /api/ifr/balances",
  "GET /api/ifr/supply",
  "GET /api/ifr/txfeed",
  "GET /api/ifr/transactions",
  "GET /api/locks/events",
  "GET /api/ifr/vault",
  "GET /api/ifr/price",
  "POST /api/bootstrap/vote",
  "GET /api/bootstrap/votes",
  "GET /api/builders/check/:address",
  "GET /api/builders/count",
  "GET /api/lending/stats",
  "GET /api/lending/offers",
  "GET /api/commitment/tranches/:address",
  "GET /api/commitment/status/:address",
  "GET /api/commitment/p0",
  "GET /api/commitment/leaderboard",
  "GET /api/lending/loans/:address",
  "GET /api/lending/health/:loanId",
  "GET /api/lending/lender/:address",
  "POST /api/builder/generate",
  "GET /api/ifr/check"
];

app.get("/", (_req, res) => {
  res.json({ service: "ifr-data-api", endpoints });
});

// CWA-11: public readiness only — no key-presence or deploy-version disclosure.
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// T-219: RPC failover status (labels and booleans only; configured URLs may contain keys and are never shown).
app.get("/api/health/rpc", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  const health = await rpcHealth();
  res.status(health.healthy > 0 ? 200 : 503).json(health);
});

// ── Etherscan Proxy — CORS-safe on-chain data for Landing + Transparency ──
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";
const IFR_TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const IFR_UNISWAP_V2_PAIR = "0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0";
const WETH_TOKEN = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const TOTAL_MINTED = 1_000_000_000; // 1B IFR minted at deploy, supply only decreases
const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";

const PROTOCOL_ADDRESSES: Record<string, string> = {
  InfernoToken: "0x77e99917Eca8539c62F509ED1193ac36580A6e7B",
  Governance: "0xc43d48E7FDA576C5022d0670B652A622E8caD041",
  IFRLock: "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb",
  BurnReserve: "0xaA1496133B6c274190A2113410B501C5802b6fCF",
  BuybackVault: "0x670D293e3D65f96171c10DdC8d88B96b0570F812",
  PartnerVault: "0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D",
  FeeRouterV1: "0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a",
  Vesting: "0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271",
  LiquidityReserve: "0xdc0309804803b3A105154f6073061E3185018f64",
  BootstrapVaultV3: "0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141",
  Deployer: "0x6b36687b0cd4386fb14cf565B67D7862110Fed67",
  GnosisSafe: "0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b",
  CommunitySafe: "0xaC5687547B2B21d80F8fd345B51e608d476667C7",
  TeamBeneficiary: "0x04FABC52c51d1F8ced6974E7C25a34249b1E6239",
  VoucherSigner: "0x790D99c320dafA03d83bEa152178A6523b49CA0d", // FeeRouterV1.voucherSigner since Proposal #18 (2026-10-05)
  LPReserveSafe: "0x5D93E7919a71d725054e31017eCA86B026F86C04",
  CommitmentVault: "0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3",
  LendingVault: "0x974305Ab0EC905172e697271C3d7d385194EB9DF",
};

const IFRLOCK_DEPLOY_BLOCK = 21965900;

// Bounds concurrent Etherscan calls so request bursts cannot exhaust the API quota.
const etherscanSlots = new Semaphore(positiveIntEnv("DATA_API_ETHERSCAN_CONCURRENCY", positiveIntEnv("COPILOT_ETHERSCAN_CONCURRENCY", 3)));

async function esApiFetch(params: string): Promise<unknown> {
  return etherscanSlots.run(() => esApiFetchDirect(params));
}

async function esApiFetchDirect(params: string): Promise<unknown> {
  const url = `https://api.etherscan.io/v2/api?chainid=1${params}${ETHERSCAN_API_KEY ? "&apikey=" + ETHERSCAN_API_KEY : ""}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return await r.json();
  } catch {
    clearTimeout(timer);
    throw new Error("Etherscan API timeout");
  }
}

// In-memory cache (125s TTL — covers 120s balances interval with buffer)
const esCache = new Map<string, { data: unknown; ts: number }>();
const ES_CACHE_TTL = 125_000;

function getCached(key: string): unknown | null {
  const entry = esCache.get(key);
  if (entry && Date.now() - entry.ts < ES_CACHE_TTL) return entry.data;
  return null;
}

function setCache(key: string, data: unknown): void {
  esCache.set(key, { data, ts: Date.now() });
}

// ── Shared fetch functions (used by routes + background pre-warm) ──

/** Sum of all IFRLock Unlocked amounts via explorer getLogs. Zero events ("No records found") is a valid 0;
 *  rate limits, other NOTOK replies and network errors throw (fail closed, T-262 D1). */
async function fetchIFRLockUnlockedTotal(): Promise<bigint> {
  const data = await esApiFetch(
    `&module=logs&action=getLogs&fromBlock=${IFRLOCK_DEPLOY_BLOCK}&toBlock=latest&address=${PROTOCOL_ADDRESSES.IFRLock}&topic0=${IFRLOCK_UNLOCKED_TOPIC}`
  );
  return sumUnlockedLogs(data);
}

async function fetchBalancesData() {
  const entries = Object.entries(PROTOCOL_ADDRESSES) as [string, string][];
  const ethersLib = (await import("ethers")).ethers;
  const provider = getRpcProvider();
  const token = new ethersLib.Contract(
    IFR_TOKEN,
    ["function balanceOf(address wallet) view returns (uint256)"],
    provider
  );
  const ifrLock = new ethersLib.Contract(
    PROTOCOL_ADDRESSES.IFRLock,
    ["function totalLocked() view returns (uint256)", "event Unlocked(address indexed user, uint256 amount)"],
    provider
  );
  const unlockedTotalPromise: Promise<bigint | null> = fetchIFRLockUnlockedTotal().catch(() => null);
  const results: Record<string, BalanceEntry> = {};
  for (let i = 0; i < entries.length; i += 4) {
    const batch = entries.slice(i, i + 4);
    const values = await Promise.all(batch.map(async ([label, addr]) => {
      try {
        const raw = label === "IFRLock" ? await ifrLock.totalLocked() : await token.balanceOf(addr);
        return [label, balanceEntry(raw)] as const;
      } catch {
        return [label, unavailableEntry()] as const;
      }
    }));
    for (const [label, value] of values) results[label] = value;
    if (i + 4 < entries.length) await new Promise(r => setTimeout(r, 150));
  }

  const response = finalizeBalances(results, await unlockedTotalPromise);
  // Never cache a response with unavailable values as if it were live data.
  if (!response.incomplete) setCache("balances", response);
  return response;
}

async function fetchBalancesDataEtherscanFallback() {
  const entries = Object.entries(PROTOCOL_ADDRESSES) as [string, string][];
  const ethersLib = (await import("ethers")).ethers;
  const provider = getRpcProvider();
  const ifrLock = new ethersLib.Contract(
    PROTOCOL_ADDRESSES.IFRLock,
    ["function totalLocked() view returns (uint256)", "event Unlocked(address indexed user, uint256 amount)"],
    provider
  );
  const unlockedTotalPromise: Promise<bigint | null> = fetchIFRLockUnlockedTotal().catch(() => null);
  const results: Record<string, BalanceEntry> = {};
  for (let i = 0; i < entries.length; i++) {
    const [label, addr] = entries[i];
    try {
      if (label === "IFRLock") {
        results[label] = balanceEntry(await ifrLock.totalLocked());
      } else {
        const data = await esApiFetch(
          `&module=account&action=tokenbalance&contractaddress=${IFR_TOKEN}&address=${addr}&tag=latest`
        ) as { status?: string; result?: string };
        results[label] = explorerBalanceEntry(data);
      }
    } catch {
      results[label] = unavailableEntry();
    }
    if (i < entries.length - 1) await new Promise(r => setTimeout(r, 250));
  }

  const response = finalizeBalances(results, await unlockedTotalPromise);
  if (!response.incomplete) setCache("balances", response);
  return response;
}

/** Supply inputs read on-chain through the shared failover provider (T-219); the explorer API is only a
 *  fallback, because an exhausted explorer quota previously made the live supply disappear. A failed
 *  totalSupply read throws (502), never a zero supply. No FeeRouterV1 read: it no longer affects /supply. */
async function readSupplyInputs(): Promise<{ totalSupplyRaw: string; burnReserveBalanceRaw: string }> {
  const ethersLib = (await import("ethers")).ethers;
  const token = new ethersLib.Contract(
    IFR_TOKEN,
    ["function totalSupply() view returns (uint256)", "function balanceOf(address wallet) view returns (uint256)"],
    getRpcProvider()
  );
  try {
    const [supply, burn] = await Promise.all([
      token.totalSupply() as Promise<bigint>,
      token.balanceOf(BURN_ADDRESS) as Promise<bigint>,
    ]);
    return { totalSupplyRaw: supply.toString(), burnReserveBalanceRaw: burn.toString() };
  } catch {
    const supplyData = await esApiFetch(
      `&module=stats&action=tokensupply&contractaddress=${IFR_TOKEN}`
    ) as { result?: string };
    const burnReserveData = await esApiFetch(
      `&module=account&action=tokenbalance&contractaddress=${IFR_TOKEN}&address=${BURN_ADDRESS}&tag=latest`
    ) as { result?: string };
    // A failed read must surface as an error (502), never as a zero supply.
    return {
      totalSupplyRaw: requireBaseUnits(supplyData.result, "totalSupply"),
      burnReserveBalanceRaw: requireBaseUnits(burnReserveData.result, "burn address balance"),
    };
  }
}

async function fetchSupplyData() {
  const { totalSupplyRaw, burnReserveBalanceRaw } = await readSupplyInputs();
  const totalSupply = parseInt(totalSupplyRaw, 10) / 10 ** IFR_DECIMALS;
  const burnAddressBalance = parseInt(burnReserveBalanceRaw, 10) / 10 ** IFR_DECIMALS;
  const burned = TOTAL_MINTED - totalSupply;
  // Legacy semantics, unchanged: circulating = totalSupply - dead-address balance. It still includes
  // permanently lost IFR; liveSupply is totalSupply minus permanently lost (CV-01 only) and is likewise
  // not a liquid or spendable figure (see LostSupply).
  const circulating = totalSupply - burnAddressBalance;
  const lost = lostSupply(totalSupplyRaw);
  const response = {
    totalMinted: TOTAL_MINTED, totalSupply, totalSupplyRaw, burnAddressBalance, burned, circulating,
    ...lost,
    // Every field is derived from reads that either succeed or fail the request; kept for shape compatibility.
    incomplete: false,
    timestamp: new Date().toISOString(), fetchedAt: Date.now(), source: "live" as const,
  };
  setCache("supply", response);
  return response;
}

// GET /api/ifr/balances — IFR balance for all protocol addresses
app.get("/api/ifr/balances", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  const cached = getCached("balances");
  if (cached) { res.json(cached); return; }
  try {
    res.json(await fetchBalancesData());
  } catch (err) {
    console.error("Etherscan balances error:", err);
    res.status(502).json({ error: "Failed to fetch balances" });
  }
});

// GET /api/ifr/supply — total supply + burned
// burned = 1B genesis - live totalSupply() (IFR burns via _update, reducing supply directly)
app.get("/api/ifr/supply", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  const cached = getCached("supply");
  if (cached) { res.json(cached); return; }
  try {
    res.json(await fetchSupplyData());
  } catch (err) {
    console.error("Etherscan supply error:", err);
    res.status(502).json({ error: "Failed to fetch supply" });
  }
});

// GET /api/ifr/txfeed — recent ETH + IFR transfers for key wallets
// Also aliased as /api/ifr/transactions for transparency.html frontend
// Public feeds fan out to several Etherscan calls: cache by parameters, share in-flight loads,
// serve a bounded stale copy on upstream failure and rate-limit per client.
const feedLimiter = ipRateLimit(
  new SlidingWindowLimiter([{ windowMs: 60_000, max: positiveIntEnv("DATA_API_FEED_PER_MINUTE", positiveIntEnv("COPILOT_FEED_PER_MINUTE", 30)) }]),
  "Too many requests. Try again later.",
);
const txFeedCache = new SingleFlightCache<unknown>(60_000, 10 * 60_000, 200);
const lockEventsCache = new SingleFlightCache<LockEventRow[]>(60_000, 10 * 60_000, 500);
const LOCK_EVENT_TYPES = new Set(["", "ifrlock", "commitmentvault", "lendingvault"]);

async function handleTxFeed(req: express.Request, res: express.Response) {
  res.set("Cache-Control", "public, max-age=30");
  const page = Math.max(1, Math.min(parseInt(String(req.query.page || "1"), 10) || 1, 100));
  const limit = Math.max(1, Math.min(parseInt(String(req.query.limit || "5"), 10) || 5, 20));
  try {
    const { data } = await txFeedCache.get(`txfeed:${page}:${limit}`, () => loadTxFeed(page, limit));
    res.json(data);
  } catch (err) {
    console.error("Etherscan txfeed error:", err);
    res.json({ transactions: [] });
  }
}

async function loadTxFeed(page: number, limit: number): Promise<unknown> {
  const feedWallets = ["FeeRouterV1", "GnosisSafe", "CommunitySafe", "Deployer"];
  let upstreamOk = 0;
  {
    const transactions: { wallet: string; dir: string; amount: string; type: string; hash: string; timestamp: number }[] = [];
    const seen = new Set<string>();
    const perWalletOffset = Math.min(50, Math.max(page * limit, 10));

    for (let i = 0; i < feedWallets.length; i++) {
      const label = feedWallets[i];
      const addr = PROTOCOL_ADDRESSES[label]?.toLowerCase();
      if (!addr) continue;

      // ETH transactions
      try {
        const ethData = await esApiFetch(
          `&module=account&action=txlist&address=${addr}&page=1&offset=${perWalletOffset}&sort=desc`
        ) as { status?: string; result?: Array<{ from: string; to: string; value: string; hash: string; timeStamp: string; isError: string }> };
        if (Array.isArray(ethData.result)) upstreamOk++;
        if (ethData.status === "1" && Array.isArray(ethData.result)) {
          for (const tx of ethData.result) {
            if (tx.isError === "1") continue;
            const key = tx.hash + "ETH";
            if (seen.has(key)) continue;
            seen.add(key);
            const isOut = tx.from.toLowerCase() === addr;
            const ethVal = parseFloat(tx.value) / 1e18;
            const fmtEth = ethVal === 0 ? "0" : ethVal < 0.0001 ? "<0.0001" : ethVal.toFixed(4);
            transactions.push({
              wallet: label, dir: isOut ? "OUT" : "IN",
              amount: fmtEth + " ETH", type: "ETH",
              hash: tx.hash, timestamp: parseInt(tx.timeStamp, 10),
            });
          }
        }
      } catch { /* skip */ }
      await new Promise(r => setTimeout(r, 350));

      // IFR token transactions
      try {
        const tokData = await esApiFetch(
          `&module=account&action=tokentx&contractaddress=${IFR_TOKEN}&address=${addr}&page=1&offset=${perWalletOffset}&sort=desc`
        ) as { status?: string; result?: Array<{ from: string; to: string; value: string; hash: string; timeStamp: string; contractAddress: string }> };
        if (Array.isArray(tokData.result)) upstreamOk++;
        if (tokData.status === "1" && Array.isArray(tokData.result)) {
          for (const tx of tokData.result) {
            if (tx.contractAddress.toLowerCase() !== IFR_TOKEN.toLowerCase()) continue;
            const key = tx.hash + "IFR";
            if (seen.has(key)) continue;
            seen.add(key);
            const isOut = tx.from.toLowerCase() === addr;
            const ifrVal = parseInt(tx.value, 10) / 10 ** IFR_DECIMALS;
            const fmtIfr = ifrVal >= 1e6 ? (ifrVal / 1e6).toFixed(2) + "M" :
                           ifrVal >= 1e3 ? (ifrVal / 1e3).toFixed(1) + "K" : ifrVal.toFixed(0);
            transactions.push({
              wallet: label, dir: isOut ? "OUT" : "IN",
              amount: fmtIfr + " IFR", type: "IFR",
              hash: tx.hash, timestamp: parseInt(tx.timeStamp, 10),
            });
          }
        }
      } catch { /* skip */ }
      if (i < feedWallets.length - 1) await new Promise(r => setTimeout(r, 350));
    }

    // Every upstream call failed: throw so the cache serves the last good copy instead of caching emptiness.
    if (upstreamOk === 0) throw new Error("all Etherscan feed calls failed");
    transactions.sort((a, b) => b.timestamp - a.timestamp);
    const start = (page - 1) * limit;
    return {
      transactions: transactions.slice(start, start + limit),
      page,
      limit,
      hasMore: transactions.length > start + limit,
      timestamp: new Date().toISOString(),
    };
  }
}
app.get("/api/ifr/txfeed", feedLimiter, handleTxFeed);
app.get("/api/ifr/transactions", feedLimiter, handleTxFeed);

type LockEventRow = {
  contract: string;
  action: string;
  wallet: string;
  amount: string;
  detail: string;
  hash: string;
  blockNumber: number;
  timestamp: number | null;
};

const LOCK_EVENT_SOURCES = [
  {
    contract: "IFRLock",
    address: PROTOCOL_ADDRESSES.IFRLock,
    fromBlock: IFRLOCK_DEPLOY_BLOCK,
    events: [
      "event Locked(address indexed user, uint256 amount, bytes32 indexed lockType)",
      "event Unlocked(address indexed user, uint256 amount)",
    ],
  },
  {
    contract: "CommitmentVault",
    address: PROTOCOL_ADDRESSES.CommitmentVault,
    fromBlock: 25278000,
    events: [
      "event Locked(address indexed wallet, uint256 indexed trancheId, uint256 amount, uint8 cType)",
      "event Unlocked(address indexed wallet, uint256 indexed trancheId, uint256 amount, address unlockedBy)",
    ],
  },
  {
    contract: "LendingVault",
    address: PROTOCOL_ADDRESSES.LendingVault,
    fromBlock: 25278000,
    events: [
      "event OfferCreated(address indexed lender, uint256 indexed offerId, uint256 amount)",
      "event OfferIncreased(address indexed lender, uint256 indexed offerId, uint256 addedAmount)",
      "event OfferWithdrawn(address indexed lender, uint256 indexed offerId, uint256 amount)",
      "event LoanCreated(uint256 indexed loanId, address indexed borrower, uint256 offerId, uint256 ifrAmount, uint256 ethCollateral)",
      "event LoanRepaid(uint256 indexed loanId, uint256 principal, uint256 interest)",
      "event LoanLiquidated(uint256 indexed loanId, address indexed liquidator, uint256 liquidatorBonus, uint256 lenderReceived)",
    ],
  },
];

function toEtherscanTopics(log: Record<string, unknown>): string[] {
  if (Array.isArray(log.topics)) return log.topics.filter(Boolean) as string[];
  return [log.topic0, log.topic1, log.topic2, log.topic3].filter(Boolean) as string[];
}

async function fetchLockEventsPage(page: number, limit: number, type: string, q: string): Promise<LockEventRow[]> {
  const ethersLib = (await import("ethers")).ethers;
  const normalizedType = type.toLowerCase();
  const normalizedQuery = q.toLowerCase();
  const start = (page - 1) * limit;
  const perSourceOffset = Math.min(100, Math.max(page * limit + 1, 10));
  const rows: LockEventRow[] = [];

  for (const source of LOCK_EVENT_SOURCES) {
    if (normalizedType && source.contract.toLowerCase() !== normalizedType) continue;
    const iface = new ethersLib.Interface(source.events);
    for (const event of source.events) {
      const topic0 = iface.getEvent(event)!.topicHash;
      const data = await esApiFetch(
        `&module=logs&action=getLogs&fromBlock=${source.fromBlock}&toBlock=latest&address=${source.address}&topic0=${topic0}&page=1&offset=${perSourceOffset}`
      ) as { status?: string; result?: Array<Record<string, unknown>> };
      if (data.status !== "1" || !Array.isArray(data.result)) continue;
      for (const rawLog of data.result) {
        try {
          const parsed = iface.parseLog({
            topics: toEtherscanTopics(rawLog),
            data: String(rawLog.data || "0x"),
          });
          if (!parsed) continue;
          const blockNumber = parseInt(String(rawLog.blockNumber || "0"), 16) || Number(rawLog.blockNumber || 0);
          const timestampRaw = rawLog.timeStamp ? String(rawLog.timeStamp) : "";
          const timestamp = timestampRaw ? (parseInt(timestampRaw, 16) || Number(timestampRaw)) : null;
          const wallet = String(parsed.args.user || parsed.args.wallet || parsed.args.lender || parsed.args.borrower || parsed.args.liquidator || "");
          const amountRaw = parsed.args.amount || parsed.args.addedAmount || parsed.args.ifrAmount || parsed.args.principal || parsed.args.lenderReceived || 0n;
          const amount = ethersLib.formatUnits(amountRaw, IFR_DECIMALS);
          const action = parsed.name;
          const detail = parsed.args.trancheId != null ? `Tranche ${parsed.args.trancheId.toString()}` :
            parsed.args.offerId != null ? `Offer ${parsed.args.offerId.toString()}` :
            parsed.args.loanId != null ? `Loan ${parsed.args.loanId.toString()}` : "";
          const row: LockEventRow = {
            contract: source.contract,
            action,
            wallet,
            amount,
            detail,
            hash: String(rawLog.transactionHash || ""),
            blockNumber,
            timestamp,
          };
          const haystack = `${row.contract} ${row.action} ${row.wallet} ${row.hash} ${row.detail}`.toLowerCase();
          if (!normalizedQuery || haystack.includes(normalizedQuery)) rows.push(row);
        } catch { /* skip malformed log */ }
      }
    }
  }

  rows.sort((a, b) => (b.blockNumber || 0) - (a.blockNumber || 0));
  return rows.slice(start, start + limit + 1);
}

// GET /api/locks/events — paged lock/lending event feed for Transparency page
app.get("/api/locks/events", feedLimiter, async (req, res) => {
  res.set("Cache-Control", "public, max-age=30");
  try {
    const page = Math.max(1, Math.min(parseInt(String(req.query.page || "1"), 10) || 1, 100));
    const limit = Math.max(1, Math.min(parseInt(String(req.query.limit || "5"), 10) || 5, 20));
    const type = String(req.query.type || "").toLowerCase();
    const q = String(req.query.q || "").trim().toLowerCase().slice(0, 66);
    if (!LOCK_EVENT_TYPES.has(type)) {
      res.status(400).json({ error: "Unknown lock event type" });
      return;
    }
    const { data: events } = await lockEventsCache.get(
      `locks:${page}:${limit}:${type}:${q}`,
      () => fetchLockEventsPage(page, limit, type, q),
    );
    res.json({
      events: events.slice(0, limit),
      page,
      limit,
      hasMore: events.length > limit,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Lock events error:", err);
    res.status(502).json({ error: "Failed to fetch lock events" });
  }
});

// GET /api/ifr/vault — BootstrapVaultV3 live status
const VAULT_TARGET_AMOUNT = 200_000_000;
const VAULT_FUNDED_DATE = "2026-03-11";
const VAULT_CACHE_TTL = 60_000;

async function fetchVaultData() {
  const addr = PROTOCOL_ADDRESSES.BootstrapVaultV3;
  const data = await esApiFetch(
    `&module=account&action=tokenbalance&contractaddress=${IFR_TOKEN}&address=${addr}&tag=latest`
  ) as { status?: string; result?: string };
  // A failed explorer read surfaces as an error (502) instead of an empty vault.
  const raw = requireBaseUnits(data.status === "1" ? data.result : undefined, "vault balance");
  const balance = parseInt(raw, 10) / 10 ** IFR_DECIMALS;
  const balanceFormatted = Math.floor(balance).toString();
  const percentFilled = Math.min((balance / VAULT_TARGET_AMOUNT) * 100, 100);
  const funded = balance >= VAULT_TARGET_AMOUNT * 0.99; // 1% tolerance for fee burns

  const response = {
    vaultAddress: addr,
    balance,
    balanceFormatted,
    targetAmount: VAULT_TARGET_AMOUNT,
    percentFilled: Math.round(percentFilled * 100) / 100,
    funded,
    fundedDate: funded ? VAULT_FUNDED_DATE : null,
    bootstrapStatus: funded ? "funded" : "pending",
    cachedAt: new Date().toISOString(),
  };
  setCache("vault", response);
  return response;
}

app.get("/api/ifr/vault", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  const cached = getCached("vault");
  if (cached) { res.json(cached); return; }
  try {
    res.json(await fetchVaultData());
  } catch (err) {
    console.error("Etherscan vault error:", err);
    res.status(502).json({ error: "Failed to fetch vault data" });
  }
});

// GET /api/ifr/price — IFR price status (Bootstrap → Uniswap TWAP)
app.get("/api/ifr/price", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  const cached = getCached("price");
  if (cached) { res.json(cached); return; }
  try {
    const ethersLib = (await import("ethers")).ethers;
    const provider = getRpcProvider();
    const pairAbi = [
      "function token0() view returns (address)",
      "function token1() view returns (address)",
      "function getReserves() view returns (uint112 reserve0,uint112 reserve1,uint32 blockTimestampLast)",
    ];
    const pair = new ethersLib.Contract(IFR_UNISWAP_V2_PAIR, pairAbi, provider);
    const [token0, token1, reserves, blockNumber] = await Promise.all([
      pair.token0(),
      pair.token1(),
      pair.getReserves(),
      provider.getBlockNumber(),
    ]);

    const token0Lower = token0.toLowerCase();
    const token1Lower = token1.toLowerCase();
    const ifrLower = IFR_TOKEN.toLowerCase();
    const wethLower = WETH_TOKEN.toLowerCase();

    if (!([token0Lower, token1Lower].includes(ifrLower)) || !([token0Lower, token1Lower].includes(wethLower))) {
      throw new Error("Configured IFR/WETH pair token mismatch");
    }

    const ifrReserveRaw = token0Lower === ifrLower ? reserves.reserve0 : reserves.reserve1;
    const wethReserveRaw = token0Lower === wethLower ? reserves.reserve0 : reserves.reserve1;
    const ifrReserve = parseFloat(ethersLib.formatUnits(ifrReserveRaw, IFR_DECIMALS));
    const ethReserve = parseFloat(ethersLib.formatEther(wethReserveRaw));
    const price = ifrReserve > 0 ? ethReserve / ifrReserve : null;

    const response = {
      price,
      currency: "ETH",
      status: price ? "uniswap_v2_live" : "pending_uniswap",
      source: "Uniswap V2 IFR/WETH reserves",
      pair: IFR_UNISWAP_V2_PAIR,
      blockNumber,
      reserves: {
        eth: ethReserve,
        ifr: ifrReserve,
      },
      ifrPerEth: ethReserve > 0 ? ifrReserve / ethReserve : null,
      blockTimestampLast: toJsonSafeUint32(reserves.blockTimestampLast),
      message: price ? "Live IFR/WETH spot price from Uniswap V2 reserves" : "Uniswap LP reserves not available yet",
      cachedAt: new Date().toISOString(),
    };
    setCache("price", response);
    res.json(response);
  } catch (err) {
    console.error("Price endpoint error:", err);
    res.status(502).json({ error: "Failed to fetch price data" });
  }
});

// ── Finalized Bootstrap Community Consensus Archive ─────────────────
// Historical read-only persistence priority:
//   1. BOOTSTRAP_VOTES env var (base64 JSON — survives deploys via Railway GraphQL API)
//   2. File /tmp/ifr_bootstrap_votes.json (survives restarts within same deploy)
const VOTES_FILE = join(process.env.RAILWAY_VOLUME_MOUNT_PATH || "/tmp", "ifr_bootstrap_votes.json");

type VoteEntry = { vote: string; ethWeight: number; timestamp: number };

// ── Load: env var → file → empty ────────────────────
function loadVotes(): Map<string, VoteEntry> {
  // 1. Try BOOTSTRAP_VOTES env var (base64-encoded JSON, set via Railway API)
  if (process.env.BOOTSTRAP_VOTES) {
    try {
      const raw = JSON.parse(Buffer.from(process.env.BOOTSTRAP_VOTES, "base64").toString("utf8"));
      const map = new Map<string, VoteEntry>();
      for (const [k, v] of Object.entries(raw)) map.set(k, v as VoteEntry);
      console.log(`[votes] Loaded ${map.size} votes from BOOTSTRAP_VOTES env var`);
      return map;
    } catch (e) {
      console.error("[votes] Env var parse error:", (e as Error).message);
    }
  }

  // 2. Try file
  try {
    if (existsSync(VOTES_FILE)) {
      const raw = JSON.parse(readFileSync(VOTES_FILE, "utf8"));
      const map = new Map<string, VoteEntry>();
      for (const [k, v] of Object.entries(raw)) map.set(k, v as VoteEntry);
      console.log(`[votes] Loaded ${map.size} votes from ${VOTES_FILE}`);
      return map;
    }
  } catch (e) {
    console.error("[votes] File load error:", (e as Error).message);
  }

  return new Map();
}

const bootstrapVotes = loadVotes();

app.post("/api/bootstrap/vote", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(410).json({
    error: "Bootstrap voting closed after finalization on June 5, 2026.",
    code: "bootstrap_vote_closed",
  });
});

app.get("/api/bootstrap/votes", (_req, res) => {
  let totalVoted = 0, finaliseETH = 0, refundETH = 0;
  const recentVotes: { wallet: string; vote: string; ethWeight: number; timestamp: number }[] = [];

  for (const [wallet, v] of bootstrapVotes.entries()) {
    totalVoted += v.ethWeight;
    if (v.vote === "finalise") finaliseETH += v.ethWeight;
    else refundETH += v.ethWeight;
    recentVotes.push({
      wallet: wallet.slice(0, 6) + "..." + wallet.slice(-4),
      vote: v.vote,
      ethWeight: v.ethWeight,
      timestamp: v.timestamp,
    });
  }
  recentVotes.sort((a, b) => b.timestamp - a.timestamp);

  res.json({
    totalVoted: totalVoted.toFixed(4),
    finaliseETH: finaliseETH.toFixed(4),
    refundETH: refundETH.toFixed(4),
    voteCount: bootstrapVotes.size,
    recentVotes: recentVotes.slice(0, 10),
  });
});

// ── BuilderRegistry — on-chain builder lookup (active when env var set) ──
// Contract: 0xdfe6636DA47F8949330697e1dC5391267CEf0EE3 (Mainnet)
// Uses direct JSON-RPC eth_call (Etherscan V1 proxy deprecated)
const BUILDER_REGISTRY_ADDR = process.env.BUILDER_REGISTRY_ADDR || null;
// eth_call goes through the shared failover provider (server/rpc.ts, T-219).

if (BUILDER_REGISTRY_ADDR) {
  app.get("/api/builders/check/:address", async (req, res) => {
    try {
      const addr = parseAddressParam(req.params.address);
      if (!addr) return res.status(400).json({ error: "Invalid address" });
      // isBuilder(address) selector: 0xb6b6b475
      const result = await ethCall(BUILDER_REGISTRY_ADDR, `0xb6b6b475000000000000000000000000${addr.slice(2).toLowerCase()}`);
      const isBuilder = result !== "0x" && result !== "0x0000000000000000000000000000000000000000000000000000000000000000";
      res.json({ address: addr, isBuilder });
    } catch (e: unknown) {
      console.error("[BuilderRegistry] check failed:", e instanceof Error ? e.message : e);
      res.status(502).json({ error: "Builder registry unavailable" });
    }
  });

  app.get("/api/builders/count", async (_req, res) => {
    try {
      // getBuilderCount() selector: 0xe54a01f9
      const result = await ethCall(BUILDER_REGISTRY_ADDR, "0xe54a01f9");
      const count = result && result !== "0x" ? parseInt(result, 16) : 0;
      res.json({ count: isNaN(count) ? 0 : count });
    } catch (e: unknown) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Unknown error" });
    }
  });

  console.log("[BuilderRegistry] Endpoints active:", BUILDER_REGISTRY_ADDR);
} else {
  console.log("[BuilderRegistry] BUILDER_REGISTRY_ADDR not set — endpoints disabled");
}

// ── Lending Market Endpoints ─────────────────────────────────────────
const LENDING_VAULT_ADDR = process.env.LENDING_VAULT_ADDR || PROTOCOL_ADDRESSES.LendingVault;

// GET /api/lending/stats — LendingVault market stats
app.get("/api/lending/stats", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    if (!LENDING_VAULT_ADDR || LENDING_VAULT_ADDR.startsWith("0x000")) {
      return res.json({
        status: "not_deployed",
        totalAvailable: 0,
        totalLent: 0,
        currentRate: 2,
        activeLoans: 0,
        message: "LendingVault address is unavailable in this API deployment",
      });
    }

    const lvAbi = [
      "function totalLent() view returns (uint256)",
      "function totalAvailable() view returns (uint256)",
      "function getInterestRate() view returns (uint256)",
      "function getLoanCount() view returns (uint256)",
      "function getOfferCount() view returns (uint256)",
      "function ifrPriceWei() view returns (uint256)",
    ];

    const ethersLib = (await import("ethers")).ethers;
    const provider = getRpcProvider();
    const lv = new ethersLib.Contract(LENDING_VAULT_ADDR, lvAbi, provider);

    const [lent, available, rate, loans, offers, price] = await Promise.all([
      lv.totalLent(),
      lv.totalAvailable(),
      lv.getInterestRate(),
      lv.getLoanCount(),
      lv.getOfferCount(),
      lv.ifrPriceWei(),
    ]);

    res.json({
      status: "active",
      totalLent: parseFloat(ethersLib.formatUnits(lent, IFR_DECIMALS)),
      totalAvailable: parseFloat(ethersLib.formatUnits(available, IFR_DECIMALS)),
      currentRate: Number(rate) / 100,
      activeLoans: Number(loans),
      offerCount: Number(offers),
      ifrPriceWei: price.toString(),
      priceSet: price !== 0n,
      borrowingEnabled: offers > 0n && price !== 0n,
      cachedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Lending stats error:", err);
    res.status(502).json({ error: "Failed to fetch lending stats" });
  }
});

// GET /api/lending/offers — all active lending offers
app.get("/api/lending/offers", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    if (!LENDING_VAULT_ADDR || LENDING_VAULT_ADDR.startsWith("0x000")) {
      return res.json([]);
    }

    const lvAbi = [
      "function getOfferCount() view returns (uint256)",
      "function getOffer(uint256) view returns (tuple(address lender, uint256 availableIFR, uint256 lentIFR, bool active))",
      "function getInterestRate() view returns (uint256)",
      "function ifrPriceWei() view returns (uint256)",
    ];

    const ethersLib = (await import("ethers")).ethers;
    const provider = getRpcProvider();
    const lv = new ethersLib.Contract(LENDING_VAULT_ADDR, lvAbi, provider);

    const count = Number(await lv.getOfferCount());
    const rate = Number(await lv.getInterestRate()) / 100;
    const price = await lv.ifrPriceWei();
    const offers: Array<Record<string, unknown>> = [];

    for (let i = 0; i < Math.min(count, 50); i++) {
      try {
        const o = await lv.getOffer(i);
        if (o.active && o.availableIFR > 0n) {
          offers.push({
            id: i,
            lender: o.lender,
            availableAmount: parseFloat(ethersLib.formatUnits(o.availableIFR, IFR_DECIMALS)),
            lentAmount: parseFloat(ethersLib.formatUnits(o.lentIFR, IFR_DECIMALS)),
            rate,
            borrowEnabled: price !== 0n,
            priceSet: price !== 0n,
          });
        }
      } catch { /* skip invalid */ }
    }

    res.json(offers);
  } catch (err) {
    console.error("Lending offers error:", err);
    res.status(502).json({ error: "Failed to fetch lending offers" });
  }
});

if (LENDING_VAULT_ADDR) {
  console.log("[LendingVault] Endpoints active:", LENDING_VAULT_ADDR);
} else {
  console.log("[LendingVault] Address unavailable — endpoints return placeholder data");
}

// ── CommitmentVault Endpoints ────────────────────────────────────────
const COMMITMENT_VAULT_ADDR = process.env.COMMITMENT_VAULT_ADDR || "";

const CV_ABI = [
  "function getTranches(address wallet) view returns (tuple(uint256 amount, uint8 cType, uint256 unlockTime, uint256 p0Multiplier, bool unlocked, uint256 conditionMetAt)[])",
  "function getTrancheCount(address wallet) view returns (uint256)",
  "function lockedBalance(address wallet) view returns (uint256)",
  "function hasActiveLock(address wallet) view returns (bool)",
  "function totalLocked() view returns (uint256)",
  "function p0() view returns (uint256)",
  "function p0Set() view returns (bool)",
];

const CONDITION_TYPES = ["TIME_ONLY", "PRICE_ONLY", "TIME_OR_PRICE", "TIME_AND_PRICE"] as const;
const AUTO_UNLOCK_DELAY = 30 * 86400; // 30 days in seconds

// GET /api/commitment/tranches/:address
app.get("/api/commitment/tranches/:address", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const addr = req.params.address;
    if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      return res.status(400).json({ error: "Invalid address" });
    }
    if (!COMMITMENT_VAULT_ADDR || COMMITMENT_VAULT_ADDR.startsWith("0x000")) {
      return res.json({ wallet: addr, trancheCount: 0, tranches: [], totalLocked: "0", p0Set: false, p0ETH: null });
    }

    const ethersLib = (await import("ethers")).ethers;
    const provider = getRpcProvider();
    const cv = new ethersLib.Contract(COMMITMENT_VAULT_ADDR, CV_ABI, provider);

    const [tranches, p0SetVal] = await Promise.all([cv.getTranches(addr), cv.p0Set()]);
    const p0Val = p0SetVal ? await cv.p0() : null;

    const formatted = tranches.map((t: { amount: bigint; cType: bigint; unlockTime: bigint; p0Multiplier: bigint; unlocked: boolean; conditionMetAt: bigint }, i: number) => {
      const condMetAt = Number(t.conditionMetAt);
      return {
        id: i,
        amount: ethersLib.formatUnits(t.amount, IFR_DECIMALS),
        conditionType: CONDITION_TYPES[Number(t.cType)] || "UNKNOWN",
        unlockTime: Number(t.unlockTime) || null,
        p0Multiplier: Number(t.p0Multiplier),
        unlocked: t.unlocked,
        conditionMetAt: condMetAt || null,
        autoUnlockAt: condMetAt > 0 ? condMetAt + AUTO_UNLOCK_DELAY : null,
      };
    });

    const totalLocked = tranches
      .filter((t: { unlocked: boolean }) => !t.unlocked)
      .reduce((sum: number, t: { amount: bigint }) => sum + parseFloat(ethersLib.formatUnits(t.amount, IFR_DECIMALS)), 0);

    res.json({
      wallet: addr,
      trancheCount: tranches.length,
      tranches: formatted,
      totalLocked: totalLocked.toFixed(0),
      p0Set: p0SetVal,
      p0ETH: p0Val ? ethersLib.formatEther(p0Val) : null,
    });
  } catch (err) {
    console.error("CV tranches error:", err);
    res.status(502).json({ error: "Failed to fetch tranches" });
  }
});

// GET /api/commitment/status/:address — short summary for widgets
app.get("/api/commitment/status/:address", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const addr = req.params.address;
    if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      return res.status(400).json({ error: "Invalid address" });
    }
    if (!COMMITMENT_VAULT_ADDR || COMMITMENT_VAULT_ADDR.startsWith("0x000")) {
      return res.json({ wallet: addr, isLocked: false, totalLocked: "0", tier: 0 });
    }

    const ethersLib = (await import("ethers")).ethers;
    const provider = getRpcProvider();
    const cv = new ethersLib.Contract(COMMITMENT_VAULT_ADDR, CV_ABI, provider);

    const [locked, hasLock] = await Promise.all([cv.lockedBalance(addr), cv.hasActiveLock(addr)]);
    const lockedBaseUnits = BigInt(locked);
    const lockedAmount = ethersLib.formatUnits(lockedBaseUnits, IFR_DECIMALS);
    const tier = getAccessTier(lockedBaseUnits);

    res.json({
      wallet: addr,
      isLocked: hasLock,
      totalLocked: lockedAmount,
      tier: tier.id,
      tierName: tier.name,
    });
  } catch (err) {
    console.error("CV status error:", err);
    res.status(502).json({ error: "Failed to fetch status" });
  }
});

// GET /api/commitment/p0
app.get("/api/commitment/p0", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    if (!COMMITMENT_VAULT_ADDR || COMMITMENT_VAULT_ADDR.startsWith("0x000")) {
      return res.json({ p0Set: false, p0ETH: null, message: "CommitmentVault not deployed yet" });
    }

    const ethersLib = (await import("ethers")).ethers;
    const provider = getRpcProvider();
    const cv = new ethersLib.Contract(COMMITMENT_VAULT_ADDR, CV_ABI, provider);

    const p0SetVal = await cv.p0Set();
    const p0Val = p0SetVal ? await cv.p0() : null;

    res.json({
      p0Set: p0SetVal,
      p0ETH: p0Val ? ethersLib.formatEther(p0Val) : null,
      message: p0SetVal ? "P0 is set" : "P0 is not set",
    });
  } catch (err) {
    console.error("CV p0 error:", err);
    res.status(502).json({ error: "Failed to fetch P0" });
  }
});

// GET /api/commitment/leaderboard
app.get("/api/commitment/leaderboard", async (_req, res) => {
  res.set("Cache-Control", "public, max-age=60");
  try {
    if (!COMMITMENT_VAULT_ADDR || COMMITMENT_VAULT_ADDR.startsWith("0x000")) {
      return res.json({ leaderboard: [], totalLockedProtocol: "0", message: "CommitmentVault not deployed yet" });
    }

    const ethersLib = (await import("ethers")).ethers;
    const provider = getRpcProvider();
    const cv = new ethersLib.Contract(COMMITMENT_VAULT_ADDR, CV_ABI, provider);

    const totalLocked = await cv.totalLocked();

    // Leaderboard requires event indexing (Phase 2) — return protocol total for now
    res.json({
      leaderboard: [],
      totalLockedProtocol: ethersLib.formatUnits(totalLocked, IFR_DECIMALS),
      message: "Individual rankings available after first locks are created",
    });
  } catch (err) {
    console.error("CV leaderboard error:", err);
    res.status(502).json({ error: "Failed to fetch leaderboard" });
  }
});

if (COMMITMENT_VAULT_ADDR) {
  console.log("[CommitmentVault] Endpoints active:", COMMITMENT_VAULT_ADDR);
} else {
  console.log("[CommitmentVault] COMMITMENT_VAULT_ADDR not set — endpoints return placeholder data");
}

// ── LendingVault — Additional Endpoints ──────────────────────────────

// GET /api/lending/loans/:address — active loans for a borrower
app.get("/api/lending/loans/:address", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const addr = req.params.address;
    if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      return res.status(400).json({ error: "Invalid address" });
    }
    if (!LENDING_VAULT_ADDR || LENDING_VAULT_ADDR.startsWith("0x000")) {
      return res.json({ wallet: addr, activeLoans: [] });
    }

    const ethersLib = (await import("ethers")).ethers;
    const provider = getRpcProvider();
    const lv = new ethersLib.Contract(LENDING_VAULT_ADDR, LENDING_LOAN_ABI, provider);

    const count = Number(await lv.getLoanCount());
    const myLoans: SerializedLendingLoan[] = [];

    for (let i = 0; i < Math.min(count, 100); i++) {
      try {
        const loan = serializeLendingLoan(i, await lv.getLoan(i));
        if (loan.active && loan.borrower.toLowerCase() === addr.toLowerCase()) {
          myLoans.push(loan);
        }
      } catch { /* skip invalid loan */ }
    }

    res.json({ wallet: addr, activeLoans: myLoans });
  } catch (err) {
    console.error("Lending loans error:", err);
    res.status(502).json({ error: "Failed to fetch loans" });
  }
});

// GET /api/lending/health/:loanId — collateral health check
app.get("/api/lending/health/:loanId", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const loanIdParam = req.params.loanId;
    const loanId = /^\d+$/.test(loanIdParam) ? Number(loanIdParam) : Number.NaN;
    if (!Number.isSafeInteger(loanId) || loanId < 0) {
      return res.status(400).json({ error: "Invalid loanId" });
    }
    if (!LENDING_VAULT_ADDR || LENDING_VAULT_ADDR.startsWith("0x000")) {
      return res.status(404).json({ error: "LendingVault not deployed" });
    }

    const ethersLib = (await import("ethers")).ethers;
    const provider = getRpcProvider();
    const lv = new ethersLib.Contract(LENDING_VAULT_ADDR, LENDING_LOAN_ABI, provider);

    const loan = serializeLendingLoan(loanId, await lv.getLoan(loanId));
    if (!loan.active) {
      return res.status(404).json({ error: "Loan not active" });
    }

    let collateralRatio = 0;
    let health: "HEALTHY" | "WARNING" | "CRITICAL" = "HEALTHY";
    try {
      collateralRatio = Number(await lv.getCollateralRatio(loanId));
      if (collateralRatio < 120) health = "CRITICAL";
      else if (collateralRatio < 150) health = "WARNING";
    } catch {
      // getCollateralRatio may revert if price not set — return basic data
    }

    res.json({
      loanId,
      offerId: loan.offerId,
      ethCollateral: loan.ethCollateral,
      ifrAmount: loan.ifrAmount,
      collateralRatio: collateralRatio > 0 ? collateralRatio + "%" : "N/A (price not set)",
      health,
      warningThreshold: "150%",
      liquidationThreshold: "120%",
    });
  } catch (err) {
    console.error("Lending health error:", err);
    res.status(502).json({ error: "Failed to fetch loan health" });
  }
});

// GET /api/lending/lender/:address — lender dashboard
app.get("/api/lending/lender/:address", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const addr = req.params.address;
    if (!addr || !/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      return res.status(400).json({ error: "Invalid address" });
    }
    if (!LENDING_VAULT_ADDR || LENDING_VAULT_ADDR.startsWith("0x000")) {
      return res.json({ wallet: addr, hasOffer: false });
    }

    const lvAbi = [
      "function hasOffer(address) view returns (bool)",
      "function lenderOfferIndex(address) view returns (uint256)",
      "function getOffer(uint256) view returns (tuple(address lender, uint256 availableIFR, uint256 lentIFR, bool active))",
      "function getInterestRate() view returns (uint256)",
    ];

    const ethersLib = (await import("ethers")).ethers;
    const provider = getRpcProvider();
    const lv = new ethersLib.Contract(LENDING_VAULT_ADDR, lvAbi, provider);

    const has = await lv.hasOffer(addr);
    if (!has) {
      return res.json({ wallet: addr, hasOffer: false });
    }

    const idx = Number(await lv.lenderOfferIndex(addr));
    const offer = await lv.getOffer(idx);
    const rate = Number(await lv.getInterestRate()) / 100;
    const availNum = parseFloat(ethersLib.formatUnits(offer.availableIFR, IFR_DECIMALS));
    const lentNum = parseFloat(ethersLib.formatUnits(offer.lentIFR, IFR_DECIMALS));
    const total = availNum + lentNum;

    res.json({
      wallet: addr,
      hasOffer: true,
      offerId: idx,
      availableAmount: availNum.toFixed(0),
      lentAmount: lentNum.toFixed(0),
      utilization: total > 0 ? ((lentNum / total) * 100).toFixed(1) + "%" : "0%",
      currentRate: rate + "%",
      active: offer.active,
    });
  } catch (err) {
    console.error("Lending lender error:", err);
    res.status(502).json({ error: "Failed to fetch lender data" });
  }
});

// ── Liquidation Monitor (every 4 hours) ──────────────────────────────
const LIQUIDATION_CHECK_MS = 4 * 60 * 60 * 1000; // 4 hours

async function checkLoanHealth() {
  if (!LENDING_VAULT_ADDR || LENDING_VAULT_ADDR.startsWith("0x000")) return;
  try {
    const ethersLib = (await import("ethers")).ethers;
    const provider = getRpcProvider();
    const lv = new ethersLib.Contract(LENDING_VAULT_ADDR, LENDING_LOAN_ABI, provider);

    const count = Number(await lv.getLoanCount());
    let warnings = 0;

    for (let i = 0; i < count; i++) {
      try {
        const loan = serializeLendingLoan(i, await lv.getLoan(i));
        if (!loan.active) continue;

        const ratio = Number(await lv.getCollateralRatio(i));
        if (ratio < 150) {
          warnings++;
          console.warn(`[Liquidation] Loan #${i}: collateral ratio ${ratio}% — ${ratio < 120 ? "CRITICAL" : "WARNING"}`);
        }
      } catch { /* skip — price may not be set */ }
    }

    console.log(`[Liquidation] Checked ${count} loans, ${warnings} below 150%`);
  } catch (e) {
    console.error("[Liquidation] Health check error:", (e as Error).message);
  }
}

// ── Builder Generator Engine ─────────────────────────────────────────

function builderGenerateCode(c: BuilderGenConfig) {
  const safeName = (c.productName || "MyProduct").replace(/[^a-zA-Z0-9]/g, "");
  const contractName = safeName + "Access";
  const useHardLock = !!c.hardLock;
  const useTier = !!c.tierSystem;
  const useCooldown = !!c.cooldown;
  const minWei = (c.minAmount || 500) * 1e9;
  const lockSecs = useHardLock ? (c.lockDuration || 7) * 86400 : 0;

  const bases = [useHardLock ? "HardLockModule" : "BaseAccessModule"];
  if (useTier) bases.push("TierModule");
  if (useCooldown) bases.push("CooldownModule");
  bases.push("Ownable");

  const hasAccessOverride = useHardLock ? "override(BaseAccessModule, HardLockModule)" : "override";
  const hasAccessBody = useHardLock ? "HardLockModule.hasAccess(user)" : "BaseAccessModule.hasAccess(user)";

  const ctorLines: string[] = [];
  if (useHardLock) ctorLines.push(`        minLockDuration = ${lockSecs};`);
  if (useTier) {
    ctorLines.push(`        tier1Threshold = ${(c.tier1Amount || 500) * 1e9};`);
    ctorLines.push(`        tier2Threshold = ${(c.tier2Amount || 2000) * 1e9};`);
    ctorLines.push(`        tier3Threshold = ${(c.tier3Amount || 10000) * 1e9};`);
  }

  const contractCode = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
// Generated by IFR Integration Builder — ${new Date().toISOString().split("T")[0]}
// Product: ${c.productName || "MyProduct"} | URL: ${c.productUrl || ""}

contract ${contractName} is ${bases.join(", ")} {
    constructor(address _governance)
        BaseAccessModule(0x77e99917Eca8539c62F509ED1193ac36580A6e7B, ${minWei})
        Ownable(_governance)
    {
${ctorLines.join("\n")}
    }

    function hasAccess(address user) public view ${hasAccessOverride} returns (bool) {
        return ${hasAccessBody};
    }
${useTier && useHardLock ? `
    function _tierBalance(address user) internal view override returns (uint256) {
        return locks[user].amount;
    }

    function getUserTier(address user) public view returns (uint8) {
        if (!hasAccess(user)) return 0;
        return getTier(user);
    }
` : ""}}`;

  const sdkSnippet = `// npm registry publication is pending.
// From a cloned Inferno repository: npm install --install-links ./apps/sdk
import { IFRClient } from "ifr-sdk";
const ifr = new IFRClient({ network: "mainnet" });
const access = await ifr.checkAccess({ wallet: userAddress, required: ${c.minAmount || 500} });
${useTier ? 'const { tier } = await ifr.getTier(userAddress);\nif (tier >= 2) enablePremium();' : ""}if (access.hasAccess) enableAccess();`;

  return { contractName, contractCode, sdkSnippet, deployGuide: "See: ifrunit.tech/wiki/business-onboarding.html" };
}

// POST /api/builder/generate — Generate contract + SDK + score from config
app.post("/api/builder/generate", async (req, res) => {
  try {
    const c = req.body as BuilderGenConfig;

    // Validate
    const errors: string[] = [];
    if (!c.productName?.trim()) errors.push("productName required");
    if (!c.minAmount || c.minAmount < 1) errors.push("minAmount must be >= 1");
    if (c.hardLock && ![7, 30, 90, 180, 365].includes(c.lockDuration || 0)) {
      errors.push("lockDuration must be 7, 30, 90, 180, or 365");
    }
    if (errors.length > 0) return res.status(400).json({ valid: false, errors });

    const security = builderConfigurationScore(c);
    const generated = builderGenerateCode(c);

    res.json({ valid: true, config: c, security, generated });
  } catch (err) {
    console.error("Builder generate error:", err);
    res.status(500).json({ error: "Generation failed" });
  }
});

console.log("[Builder] POST /api/builder/generate active");

// ── IFR SDK REST API ─────────────────────────────────────────────────

// GET /api/ifr/check — lightweight access check for SDK / REST clients
app.get("/api/ifr/check", async (req, res) => {
  res.set("Cache-Control", "public, max-age=30");
  try {
    const wallet = req.query.wallet as string;
    const requiredParam = typeof req.query.required === "string" ? req.query.required : "1000";
    const required = /^\d+$/.test(requiredParam) ? Number(requiredParam) : Number.NaN;

    if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    if (!Number.isSafeInteger(required) || required < 0) {
      return res.status(400).json({ error: "Invalid required IFR amount" });
    }

    const ethersLib = (await import("ethers")).ethers;
    const provider = getRpcProvider();

    const tokenAbi = ["function balanceOf(address) view returns (uint256)"];
    const lockAbi = ["function lockedBalance(address) view returns (uint256)"];

    const token = new ethersLib.Contract("0x77e99917Eca8539c62F509ED1193ac36580A6e7B", tokenAbi, provider);
    const lock = new ethersLib.Contract("0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb", lockAbi, provider);

    // A failed IFRLock read must not report tier 0: the whole check fails closed (502).
    const [balRaw, lockedRaw] = await Promise.all([
      token.balanceOf(wallet),
      lock.lockedBalance(wallet),
    ]);

    const balanceBaseUnits = BigInt(balRaw);
    const lockedBaseUnits = BigInt(lockedRaw);
    const totalBaseUnits = balanceBaseUnits + lockedBaseUnits;
    const requiredBaseUnits = BigInt(required) * (10n ** BigInt(IFR_DECIMALS));
    // Default tier preset counts IFR locked in IFRLock only (Benefits preset, owner decision 2026-10-03).
    const tier = getAccessTier(lockedBaseUnits);

    res.json({
      hasAccess: totalBaseUnits >= requiredBaseUnits,
      balance: ethersLib.formatUnits(balanceBaseUnits, IFR_DECIMALS),
      locked: ethersLib.formatUnits(lockedBaseUnits, IFR_DECIMALS),
      total: ethersLib.formatUnits(totalBaseUnits, IFR_DECIMALS),
      required,
      tier: tier.id,
      tierName: tier.name,
      tierBasis: "locked",
    });
  } catch (err) {
    console.error("IFR check error:", err);
    res.status(502).json({ error: "Failed to check access" });
  }
});

console.log("[SDK] GET /api/ifr/check active");

// Express's default finalhandler replaces CSP on 404/parser/error responses.
// Finish those responses here so the reviewed embedding policy also survives.
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});
const handleUnhandledError: express.ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  res.status(typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599
    ? status : 500).json({ error: "Request failed" });
};
app.use(handleUnhandledError);

const PORT = parseInt(process.env.PORT || "3003", 10);
app.listen(PORT, () => {
  console.log(`IFR data API on :${PORT}`);

  if (process.env.NODE_ENV === "test") {
    return;
  }

  // Pre-warm cache on startup so first user never waits
  (async () => {
    try { await fetchSupplyData(); console.log("[cache] supply pre-warmed"); } catch {}
    try { await fetchBalancesData(); console.log("[cache] balances pre-warmed"); } catch {}
    try { await fetchVaultData(); console.log("[cache] vault pre-warmed"); } catch {}
  })();

  // Liquidation monitor: check every 4 hours
  setInterval(checkLoanHealth, LIQUIDATION_CHECK_MS);
  console.log("[Liquidation] Monitor scheduled — every 4h");

  // Rate limit budget: ~19.440 calls/day
  // Supply: (86400/60)×2 = 2.880 | Balances: (86400/120)×17 = 12.240 | Total: ~15.120
  // Etherscan free tier: 100.000 calls/day — safe margin >80%
  setInterval(async () => {
    try { await fetchSupplyData(); } catch (e) {
      console.error("[cache] supply refresh failed:", (e as Error).message);
    }
  }, 60_000);
  setInterval(async () => {
    try { await fetchBalancesData(); } catch (e) {
      console.error("[cache] balances refresh failed:", (e as Error).message);
    }
  }, 120_000);
  setInterval(async () => {
    try { await fetchVaultData(); } catch (e) {
      console.error("[cache] vault refresh failed:", (e as Error).message);
    }
  }, 60_000);
});
