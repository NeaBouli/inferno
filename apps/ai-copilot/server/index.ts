import "dotenv/config";
import express from "express";
import cors from "cors";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { SYSTEM_PROMPTS } from "../src/context/system-prompts.js";
import { loadWikiDocs, buildSystemPrompt, WikiDoc } from "./wiki-rag.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || 'https://ifrunit.tech,https://www.ifrunit.tech,https://neabouli.github.io,http://localhost:5175,http://localhost:3003').split(','),
}));
app.use(express.json({ limit: '50kb' }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const POINTS_BACKEND_URL = process.env.POINTS_BACKEND_URL || "http://localhost:3004";

// ── Anti-Abuse: In-memory rate limiter ──────────────────────────────
const rateBuckets = new Map<string, { minute: number[]; hour: number[] }>();
const MINUTE_LIMIT = 5;
const HOUR_LIMIT = 20;
const MAX_MESSAGE_LENGTH = 500;

function cleanBuckets(): void {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    bucket.minute = bucket.minute.filter(t => now - t < 60_000);
    bucket.hour = bucket.hour.filter(t => now - t < 3_600_000);
    if (bucket.minute.length === 0 && bucket.hour.length === 0) {
      rateBuckets.delete(ip);
    }
  }
}
// Clean stale entries every 5 minutes
setInterval(cleanBuckets, 300_000);

function checkRateLimit(ip: string): string | null {
  const now = Date.now();
  if (!rateBuckets.has(ip)) {
    rateBuckets.set(ip, { minute: [], hour: [] });
  }
  const bucket = rateBuckets.get(ip)!;
  bucket.minute = bucket.minute.filter(t => now - t < 60_000);
  bucket.hour = bucket.hour.filter(t => now - t < 3_600_000);

  if (bucket.minute.length >= MINUTE_LIMIT) {
    return "Slow down! Max 5 messages per minute.";
  }
  if (bucket.hour.length >= HOUR_LIMIT) {
    return "Too many requests. Please try again in an hour.";
  }
  bucket.minute.push(now);
  bucket.hour.push(now);
  return null;
}

// ── Cost tracking ───────────────────────────────────────────────────
let dailyCostEstimate = 0;
let lastCostReset = new Date().toDateString();

function trackCost(inputTokens: number, outputTokens: number): void {
  const today = new Date().toDateString();
  if (today !== lastCostReset) {
    dailyCostEstimate = 0;
    lastCostReset = today;
  }
  // Haiku 4.5 pricing: $1/M input, $5/M output
  const cost = (inputTokens / 1_000_000) * 1 + (outputTokens / 1_000_000) * 5;
  dailyCostEstimate += cost;
  if (dailyCostEstimate > 1.0) {
    console.warn(`[COST WARNING] Daily estimate: $${dailyCostEstimate.toFixed(4)}`);
  }
}

// Load wiki docs for RAG at startup (local/pre-built JSON)
const WIKI_DIR = resolve(__dirname, "../../../docs/wiki");
let wikiDocs: WikiDoc[] = [];
try {
  wikiDocs = loadWikiDocs(WIKI_DIR);
  console.log(`Wiki RAG loaded: ${wikiDocs.length} documents`);
} catch (err) {
  console.warn("Wiki RAG failed to load (non-critical):", err);
}

// ── Live Wiki Fetcher — auto-discover + fetch ALL wiki pages from ifrunit.tech ──
let liveWikiContext = "";
let liveWikiLastFetched = 0;
const WIKI_CACHE_TTL = 1000 * 60 * 60; // 1 hour refresh

async function fetchLiveWikiContext(): Promise<string> {
  const now = Date.now();
  if (liveWikiContext && now - liveWikiLastFetched < WIKI_CACHE_TTL) return liveWikiContext;

  const BASE = "https://ifrunit.tech";
  const results: string[] = [];

  try {
    // Step 1: fetch wiki index to discover all links
    const pagesToFetch = new Set<string>();

    const indexRes = await fetch(`${BASE}/wiki/index.html`, { signal: AbortSignal.timeout(8000) });
    const indexHtml = await indexRes.text();

    // Extract all wiki page links
    const linkMatches = indexHtml.matchAll(/href="([^"]*\.html)"/g);
    for (const match of linkMatches) {
      const href = match[1];
      if (href.startsWith("http")) {
        pagesToFetch.add(href);
      } else if (href.startsWith("/wiki/") || href.startsWith("wiki/")) {
        pagesToFetch.add(`${BASE}/${href.replace(/^\//, "")}`);
      } else if (!href.startsWith("http") && href.endsWith(".html")) {
        pagesToFetch.add(`${BASE}/wiki/${href}`);
      }
    }

    // Also fetch main landing page
    pagesToFetch.add(`${BASE}/index.html`);

    console.log(`[wiki-fetch] Fetching ${pagesToFetch.size} pages for Ali context...`);

    // Step 2: fetch each page
    for (const url of pagesToFetch) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        const html = await res.text();
        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&mdash;/g, "—")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 4000);
        results.push(`=== ${url} ===\n${text}`);
      } catch {
        console.error(`[wiki-fetch] Failed: ${url}`);
      }
    }
  } catch (err) {
    console.error("[wiki-fetch] Wiki discovery failed:", err);
  }

  liveWikiContext = results.join("\n\n");
  liveWikiLastFetched = Date.now();
  console.log(`[wiki-fetch] Ali wiki context ready: ${results.length} pages, ${liveWikiContext.length} chars`);
  return liveWikiContext;
}

// Pre-warm wiki context on startup
fetchLiveWikiContext().catch(() => {});

// Detect guide-completion in AI responses
function detectGuideCompletion(userMessage: string, assistantReply: string): string | null {
  const msg = userMessage.toLowerCase();
  const reply = assistantReply.toLowerCase();

  if (msg.includes("wallet") && (reply.includes("step") || reply.includes("done") || reply.includes("complete"))) {
    return "guide_wallet_setup";
  }
  if ((msg.includes("add") || msg.includes("import")) && msg.includes("token")) {
    return "guide_add_token";
  }
  if (msg.includes("lock") && reply.includes("success")) {
    return "guide_lock";
  }
  if (msg.includes("business") || msg.includes("partner") || msg.includes("onboarding")) {
    return "partner_onboarding";
  }
  return null;
}

// Send points event to Points Backend (fire-and-forget)
async function recordPointsEvent(
  walletAddress: string,
  eventType: string,
  authToken: string
): Promise<void> {
  try {
    await fetch(`${POINTS_BACKEND_URL}/points/event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ type: eventType }),
    });
  } catch (err) {
    // Points failures are non-critical — chat continues
    console.log("Points event failed (non-critical):", err);
  }
}

app.get("/", (_req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IFR Copilot</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #0d0d0d;
  color: #fff;
  height: 100vh;
  display: flex;
  flex-direction: column;
}
#header {
  padding: 10px 16px;
  background: #1a1a1a;
  border-bottom: 1px solid #333;
  font-weight: 600;
  font-size: 14px;
}
#header-top {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}
#tabs {
  display: flex;
  gap: 4px;
}
.tab {
  padding: 6px 14px;
  border-radius: 20px;
  border: 1px solid #444;
  background: transparent;
  color: #999;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.tab:hover { border-color: #666; color: #ccc; }
.tab.active-explorer { background: #ff6600; color: #fff; border-color: #ff6600; }
.tab.active-user { background: #9b59b6; color: #fff; border-color: #9b59b6; }
.tab.active-dev { background: #2ecc71; color: #fff; border-color: #2ecc71; }
#messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.msg {
  max-width: 85%;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  word-wrap: break-word;
  white-space: pre-wrap;
}
.msg.user {
  align-self: flex-end;
  border-bottom-right-radius: 4px;
}
.msg.user.explorer { background: #ff6600; color: #fff; }
.msg.user.usermode { background: #9b59b6; color: #fff; }
.msg.user.dev { background: #2ecc71; color: #fff; }
.msg.bot {
  background: #1e1e1e;
  color: #e0e0e0;
  align-self: flex-start;
  border-bottom-left-radius: 4px;
  border: 1px solid #333;
}
.msg.bot.thinking { color: #666; font-style: italic; }
#input-area {
  padding: 12px;
  background: #1a1a1a;
  border-top: 1px solid #333;
  display: flex;
  gap: 8px;
}
#input {
  flex: 1;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 8px;
  padding: 10px 14px;
  color: white;
  font-size: 14px;
  outline: none;
}
#input:focus { border-color: #ff6600; }
#send-btn {
  border: none;
  border-radius: 8px;
  padding: 10px 16px;
  color: white;
  cursor: pointer;
  font-size: 16px;
}
#send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
</head>
<body>
<div id="header">
  <div id="header-top">
    <span>&#x1f525; IFR Copilot</span>
    <span style="color:#ff6600;font-size:11px;margin-left:auto;">Inferno Protocol</span>
  </div>
  <div id="tabs">
    <button class="tab active-explorer" onclick="switchMode('explorer')" id="tab-explorer">&#x1f525; Explorer</button>
    <button class="tab" onclick="switchMode('user')" id="tab-user">&#x1f48e; User</button>
    <button class="tab" onclick="switchMode('dev')" id="tab-dev">&#x2699;&#xfe0f; Dev</button>
  </div>
</div>
<div id="messages"></div>
<div id="ali-disclaimer" style="background:#0f172a;border-top:1px solid #f59e0b;padding:5px 12px;font-size:10px;color:#64748b;line-height:1.5;flex-shrink:0;">
  &#x26a0;&#xfe0f; <strong style="color:#f59e0b;">AI assistant</strong> &#x2014; not 100% accurate. Never share private keys or wallet addresses. &nbsp;&#xb7;&nbsp;
  &#x1f49b; <a href="https://etherscan.io/address/0xA0860f872a9cAB34817D9a764e71ab43B942b275" target="_blank" style="color:#f97316;text-decoration:none;">Support ETH/IFR</a>
</div>
<div id="input-area">
  <input id="input" type="text" maxlength="500" placeholder="Ask about IFR..." onkeydown="if(event.key==='Enter'&&!event.shiftKey)send()" oninput="document.getElementById('charcount').textContent=this.value.length+'/500'">
  <span id="charcount" style="color:#666;font-size:11px;align-self:center;">0/500</span>
  <button id="send-btn" onclick="send()">&#x27A4;</button>
</div>
<script>
var currentMode = 'explorer';
var histories = { explorer: [], user: [], dev: [] };
function getBootstrapWelcomeText() {
  var now = Date.now();
  var END = new Date("2026-06-05T00:00:00Z").getTime();
  if (now < END) return "\\u{1f525} Bootstrap Event is LIVE since March 7, 2026! Contribute ETH at ifrunit.tech/wiki/bootstrap.html";
  return "Bootstrap Event ended June 5, 2026. IFR now live on Uniswap";
}
var welcomes = {
  explorer: "Welcome to IFR Copilot. &#x1f44b;\\n\\nYou're browsing without a connected wallet \\u2014 no problem!\\n\\n\\u2756 Without a wallet, you can:\\n\\u2022 Ask about IFR tokenomics, governance, or lock mechanism\\n\\u2022 " + getBootstrapWelcomeText() + "\\n\\u2022 Explore the roadmap and security model\\n\\n\\u2756 Connect your wallet to unlock (Phase 2):\\n\\u2022 Your personal IFR balance and lock position\\n\\u2022 Personalized guidance based on your on-chain state\\n\\n\\u2756 Lock \\u22651,000 IFR to unlock (Phase 2):\\n\\u2022 Premium Copilot with deeper on-chain analysis\\n\\u2022 AI Copilot Gate (gated content platform)\\n\\u2022 Builder onboarding pathway\\n\\nOr just ask me anything! &#x1f525;",
  user: "Hey! &#x1f48e; Ready to help you get the most out of your IFR tokens.\\n\\nI can assist with:\\n\\u2022 Locking IFR for benefits\\n\\u2022 Understanding your tier (Bronze/Silver/Gold/Platinum)\\n\\u2022 Partner discounts \\u0026 Benefits Network\\n\\u2022 Step-by-step guides",
  dev: "Dev mode active. &#x2699;&#xfe0f;\\n\\n16 verified on-chain components \\u2022 544 tests \\u2022 91% branch coverage\\n\\nI can help with:\\n\\u2022 Contract addresses \\u0026 ABIs\\n\\u2022 Integration (ethers.js v5, 9 decimals)\\n\\u2022 Governance \\u0026 Timelock\\n\\u2022 Security audit results"
};
var modeColors = { explorer: '#ff6600', user: '#9b59b6', dev: '#2ecc71' };

function switchMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.tab').forEach(function(t) { t.className = 'tab'; });
  var activeClass = mode === 'user' ? 'active-user' : mode === 'dev' ? 'active-dev' : 'active-explorer';
  document.getElementById('tab-' + mode).classList.add(activeClass);
  document.getElementById('send-btn').style.background = modeColors[mode];
  renderMessages();
  document.getElementById('input').focus();
}

function renderMessages() {
  var container = document.getElementById('messages');
  container.innerHTML = '<div class="msg bot">' + welcomes[currentMode] + '</div>';
  var history = histories[currentMode];
  for (var i = 0; i < history.length; i++) {
    var m = history[i];
    var div = document.createElement('div');
    if (m.role === 'user') {
      div.className = 'msg user ' + (currentMode === 'user' ? 'usermode' : currentMode);
      div.textContent = m.content;
    } else {
      div.className = 'msg bot';
      div.textContent = m.content;
    }
    container.appendChild(div);
  }
  container.scrollTop = container.scrollHeight;
}

async function send() {
  var input = document.getElementById('input');
  var text = input.value.trim();
  if (!text) return;
  if (text.length > 500) { alert('Max 500 characters.'); return; }
  if (histories[currentMode].length >= 40) {
    alert('Conversation too long. Please switch tabs or reload to start fresh.');
    return;
  }
  input.value = '';
  document.getElementById('charcount').textContent = '0/500';

  histories[currentMode].push({ role: 'user', content: text });
  renderMessages();

  var thinking = document.createElement('div');
  thinking.className = 'msg bot thinking';
  thinking.textContent = 'Thinking...';
  var container = document.getElementById('messages');
  container.appendChild(thinking);
  container.scrollTop = container.scrollHeight;

  var sendBtn = document.getElementById('send-btn');
  sendBtn.disabled = true;

  try {
    var res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: histories[currentMode], mode: currentMode })
    });
    var data = await res.json();
    var reply = data.reply || 'Sorry, please try again.';
    histories[currentMode].push({ role: 'assistant', content: reply });
  } catch(e) {
    histories[currentMode].push({ role: 'assistant', content: 'Connection error. Please try again.' });
  }

  sendBtn.disabled = false;
  renderMessages();
}

// Init
switchMode('explorer');
</script>
</body>
</html>`);
});

app.post("/api/chat", async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    res.status(500).json({ reply: "ANTHROPIC_API_KEY not configured." });
    return;
  }

  // Rate limit check
  const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
    || req.socket.remoteAddress || "unknown";
  const rateLimitMsg = checkRateLimit(clientIp);
  if (rateLimitMsg) {
    res.status(429).json({ reply: rateLimitMsg });
    return;
  }

  const { mode, messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ reply: "Invalid request: messages required." });
    return;
  }

  if (messages.length > 20) {
    res.status(400).json({ reply: "Conversation too long (max 20 messages). Please start a new conversation." });
    return;
  }

  // Validate last user message length
  const lastMsg = messages[messages.length - 1];
  if (lastMsg?.role === "user" && typeof lastMsg.content === "string" && lastMsg.content.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ reply: `Message too long (max ${MAX_MESSAGE_LENGTH} characters).` });
    return;
  }

  const basePrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.customer;
  let systemPrompt = buildSystemPrompt(basePrompt, mode || "customer", wikiDocs);

  // Append live wiki context (fetched from ifrunit.tech, 1h cache)
  const liveWiki = await fetchLiveWikiContext();
  if (liveWiki) {
    systemPrompt += `\n\n--- LIVE WIKI CONTEXT (auto-fetched from ifrunit.tech) ---\n${liveWiki.slice(0, 80000)}\n--- END WIKI CONTEXT ---\nAlways prioritize this context for accurate IFR information.`;
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system: systemPrompt,
        messages
      })
    });

    const data = await response.json() as Record<string, unknown>;
    if (process.env.NODE_ENV !== "production") {
      console.log("Anthropic response status:", response.status);
      console.log("Anthropic response:", JSON.stringify(data).slice(0, 500));
    }

    if (!response.ok) {
      const errMsg = (data as { error?: { message?: string } }).error?.message || "Unknown API error";
      console.error("Anthropic API error:", errMsg);
      res.status(500).json({ reply: "AI service temporarily unavailable. Please try again." });
      return;
    }

    const content = data.content as { text?: string }[] | undefined;
    const text = content?.[0]?.text || "Sorry, I couldn't process that.";

    // Cost tracking
    const usage = data.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    if (usage) {
      trackCost(usage.input_tokens || 0, usage.output_tokens || 0);
      console.log(`[API] ip=${clientIp} mode=${mode || "explorer"} in=${usage.input_tokens} out=${usage.output_tokens} cost_today=$${dailyCostEstimate.toFixed(4)}`);
    }

    // Optional: record points for guide completion
    const walletAddress = req.headers["x-wallet-address"] as string;
    const authToken = req.headers["x-auth-token"] as string;
    if (walletAddress && authToken) {
      const guideEvent = detectGuideCompletion(
        messages[messages.length - 1]?.content || "",
        text
      );
      if (guideEvent) {
        recordPointsEvent(walletAddress, guideEvent, authToken); // fire-and-forget
      }
    }

    res.json({ reply: text });
  } catch (err) {
    console.error("Anthropic API error:", err);
    res.status(500).json({ reply: "API error - please try again." });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    apiKeySet: !!ANTHROPIC_API_KEY,
    etherscanKeySet: !!process.env.ETHERSCAN_API_KEY,
    version: "2026-03-07-proxy",
  });
});

// ── Etherscan Proxy — CORS-safe on-chain data for Landing + Transparency ──
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";
const IFR_TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const IFR_DECIMALS = 9;
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
  VoucherSigner: "0x17F8DD6dECCb3ff5d95691982B85A87d7d9872d4",
  LPReserveSafe: "0x5D93E7919a71d725054e31017eCA86B026F86C04",
  CommitmentVault: "0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3",
  LendingVault: "0x974305Ab0EC905172e697271C3d7d385194EB9DF",
};

async function esApiFetch(params: string): Promise<unknown> {
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

async function fetchBalancesData() {
  const entries = Object.entries(PROTOCOL_ADDRESSES) as [string, string][];
  // Sequential fetching — Etherscan free tier allows 5 calls/sec
  // Parallel batches caused rate limiting (3 calls at t=0 = 3 simultaneous)
  // Sequential with 400ms delay = safe and reliable
  const results: Record<string, { raw: string; formatted: number }> = {};
  for (let i = 0; i < entries.length; i++) {
    const [label, addr] = entries[i];
    try {
      const data = await esApiFetch(
        `&module=account&action=tokenbalance&contractaddress=${IFR_TOKEN}&address=${addr}&tag=latest`
      ) as { status?: string; result?: string };
      const raw = (data.status === "1" && data.result) ? data.result : "0";
      results[label] = { raw, formatted: parseInt(raw, 10) / 10 ** IFR_DECIMALS };
    } catch {
      results[label] = { raw: "0", formatted: 0 };
    }
    if (i < entries.length - 1) await new Promise(r => setTimeout(r, 250));
  }

  const response = { balances: results, timestamp: new Date().toISOString(), fetchedAt: Date.now(), source: "live" as const };
  setCache("balances", response);
  return response;
}

async function fetchSupplyData() {
  const supplyData = await esApiFetch(
    `&module=stats&action=tokensupply&contractaddress=${IFR_TOKEN}`
  ) as { result?: string };
  const burnReserveData = await esApiFetch(
    `&module=account&action=tokenbalance&contractaddress=${IFR_TOKEN}&address=${BURN_ADDRESS}&tag=latest`
  ) as { result?: string };
  const totalSupplyRaw = supplyData.result || "0";
  const burnReserveBalanceRaw = burnReserveData.result || "0";
  const totalSupply = parseInt(totalSupplyRaw, 10) / 10 ** IFR_DECIMALS;
  const burnAddressBalance = parseInt(burnReserveBalanceRaw, 10) / 10 ** IFR_DECIMALS;
  const burned = TOTAL_MINTED - totalSupply;
  const circulating = totalSupply - burnAddressBalance;
  const response = {
    totalMinted: TOTAL_MINTED, totalSupply, burnAddressBalance, burned, circulating,
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
async function handleTxFeed(_req: express.Request, res: express.Response) {
  res.set("Cache-Control", "no-store");
  const cached = getCached("txfeed");
  if (cached) { res.json(cached); return; }

  const feedWallets = ["FeeRouterV1", "GnosisSafe", "CommunitySafe", "Deployer"];
  try {
    const transactions: { wallet: string; dir: string; amount: string; type: string; hash: string; timestamp: number }[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < feedWallets.length; i++) {
      const label = feedWallets[i];
      const addr = PROTOCOL_ADDRESSES[label]?.toLowerCase();
      if (!addr) continue;

      // ETH transactions
      try {
        const ethData = await esApiFetch(
          `&module=account&action=txlist&address=${addr}&page=1&offset=10&sort=desc`
        ) as { status?: string; result?: Array<{ from: string; to: string; value: string; hash: string; timeStamp: string; isError: string }> };
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
          `&module=account&action=tokentx&contractaddress=${IFR_TOKEN}&address=${addr}&page=1&offset=10&sort=desc`
        ) as { status?: string; result?: Array<{ from: string; to: string; value: string; hash: string; timeStamp: string; contractAddress: string }> };
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

    transactions.sort((a, b) => b.timestamp - a.timestamp);
    const response = { transactions: transactions.slice(0, 20), timestamp: new Date().toISOString() };
    setCache("txfeed", response);
    res.json(response);
  } catch (err) {
    console.error("Etherscan txfeed error:", err);
    res.json({ transactions: [] });
  }
}
app.get("/api/ifr/txfeed", handleTxFeed);
app.get("/api/ifr/transactions", handleTxFeed);

// GET /api/ifr/vault — BootstrapVaultV3 live status
const VAULT_TARGET_AMOUNT = 200_000_000;
const VAULT_FUNDED_DATE = "2026-03-11";
const VAULT_CACHE_TTL = 60_000;

async function fetchVaultData() {
  const addr = PROTOCOL_ADDRESSES.BootstrapVaultV3;
  const data = await esApiFetch(
    `&module=account&action=tokenbalance&contractaddress=${IFR_TOKEN}&address=${addr}&tag=latest`
  ) as { status?: string; result?: string };
  const raw = (data.status === "1" && data.result) ? data.result : "0";
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
    // Read BootstrapVaultV3 to check if finalized
    const vaultAddr = PROTOCOL_ADDRESSES.BootstrapVaultV3;

    // finalized() → bool (selector 0xb3f05b97)
    const finalizedData = await esApiFetch(
      `&module=proxy&action=eth_call&to=${vaultAddr}&data=0xb3f05b97&tag=latest`
    ) as { result?: string };
    const finalized = finalizedData.result && finalizedData.result !== "0x" + "0".repeat(64);

    if (!finalized) {
      // Bootstrap still active — read totalETHRaised via ETH balance of vault
      const ethBalData = await esApiFetch(
        `&module=account&action=balance&address=${vaultAddr}&tag=latest`
      ) as { status?: string; result?: string };
      const ethRaised = (ethBalData.status === "1" && ethBalData.result)
        ? parseInt(ethBalData.result, 10) / 1e18 : 0;

      const IFR_BOOTSTRAP_ALLOCATION = 100_000_000; // 100M IFR
      const estimatedP0 = ethRaised > 0 ? ethRaised / IFR_BOOTSTRAP_ALLOCATION : 0;

      const response = {
        price: null,
        currency: "ETH",
        status: "bootstrap_active",
        bootstrapEndDate: "2026-06-05",
        estimatedP0ETH: estimatedP0,
        ethRaised,
        message: "Price available after Bootstrap finalise() — June 5, 2026",
        cachedAt: new Date().toISOString(),
      };
      setCache("price", response);
      res.json(response);
    } else {
      // Bootstrap finalized — Phase 2: Uniswap TWAP here
      const response = {
        price: null,
        currency: "ETH",
        status: "pending_uniswap",
        message: "Uniswap LP launching soon — price available after liquidity deployment",
        cachedAt: new Date().toISOString(),
      };
      setCache("price", response);
      res.json(response);
    }
  } catch (err) {
    console.error("Price endpoint error:", err);
    res.status(502).json({ error: "Failed to fetch price data" });
  }
});

// ── Bootstrap Community Consensus Votes ─────────────────────────────
// Persistence priority:
//   1. BOOTSTRAP_VOTES env var (base64 JSON — survives deploys via Railway GraphQL API)
//   2. File /tmp/ifr_bootstrap_votes.json (survives restarts within same deploy)
const VOTES_FILE = join(process.env.RAILWAY_VOLUME_MOUNT_PATH || "/tmp", "ifr_bootstrap_votes.json");

type VoteEntry = { vote: string; ethWeight: number; timestamp: number };

function votesToObj(votes: Map<string, VoteEntry>): Record<string, VoteEntry> {
  const obj: Record<string, VoteEntry> = {};
  for (const [k, v] of votes.entries()) obj[k] = v;
  return obj;
}

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

// ── Save: file + Railway API ────────────────────────
function saveVotesToFile(votes: Map<string, VoteEntry>): void {
  try {
    writeFileSync(VOTES_FILE, JSON.stringify(votesToObj(votes), null, 2), "utf8");
  } catch (e) {
    console.error("[votes] File save error:", (e as Error).message);
  }
}

async function saveVotesToRailway(votes: Map<string, VoteEntry>): Promise<void> {
  // Always save to file first (immediate)
  saveVotesToFile(votes);

  // Then try Railway GraphQL API for cross-deploy persistence
  const token = process.env.RAILWAY_TOKEN;
  const projectId = process.env.RAILWAY_PROJECT_ID;
  const serviceId = process.env.RAILWAY_SERVICE_ID;
  const envId = process.env.RAILWAY_ENVIRONMENT_ID;
  if (!token || !projectId || !serviceId || !envId) return;

  try {
    const encoded = Buffer.from(JSON.stringify(votesToObj(votes))).toString("base64");
    const body = JSON.stringify({
      query: `mutation { variableUpsert(input: { projectId: "${projectId}", serviceId: "${serviceId}", environmentId: "${envId}", name: "BOOTSTRAP_VOTES", value: "${encoded}" }) }`
    });
    const r = await fetch("https://backboard.railway.app/graphql/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body,
    });
    const result = (await r.json()) as { errors?: { message: string }[] };
    if (result.errors) {
      console.error("[votes] Railway API error:", result.errors[0].message);
    } else {
      console.log("[votes] Saved to Railway env var");
    }
  } catch (e) {
    console.error("[votes] Railway API fetch error:", (e as Error).message);
  }
}

const bootstrapVotes = loadVotes();

async function verifyContribution(wallet: string): Promise<number> {
  // Use Etherscan eth_call to read contributions(address) from BootstrapVaultV3
  // contributions(address) selector = 0x42e94c90
  const addr = wallet.toLowerCase().replace("0x", "").padStart(64, "0");
  const data = "0x42e94c90" + addr;
  const params = `&module=proxy&action=eth_call&to=${PROTOCOL_ADDRESSES.BootstrapVaultV3}&data=${data}&tag=latest`;
  const result = (await esApiFetch(params)) as { result?: string };
  if (!result.result || result.result === "0x") return 0;
  return parseInt(result.result, 16) / 1e18;
}

app.post("/api/bootstrap/vote", async (req, res) => {
  const { wallet, vote } = req.body as { wallet?: string; vote?: string };
  if (!wallet || !vote) {
    res.status(400).json({ error: "Missing wallet or vote" });
    return;
  }
  if (!["finalise", "refund"].includes(vote)) {
    res.status(400).json({ error: "Invalid vote type" });
    return;
  }
  try {
    const ethWeight = await verifyContribution(wallet);
    if (ethWeight <= 0) {
      res.status(403).json({ error: "No contribution found on-chain" });
      return;
    }
    bootstrapVotes.set(wallet.toLowerCase(), { vote, ethWeight, timestamp: Date.now() });
    saveVotesToRailway(bootstrapVotes).catch(() => {});
    console.log(`[vote] ${wallet.slice(0, 8)} → ${vote} (${ethWeight.toFixed(4)} ETH)`);
    res.json({ success: true, ethWeight });
  } catch (e) {
    console.error("[vote] error:", (e as Error).message);
    res.status(500).json({ error: "Verification failed" });
  }
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
const ETH_RPC_URL = process.env.MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com";

async function ethCall(to: string, data: string): Promise<string> {
  const resp = await fetch(ETH_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
  });
  const json = await resp.json() as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result || "0x";
}

if (BUILDER_REGISTRY_ADDR) {
  app.get("/api/builders/check/:address", async (req, res) => {
    try {
      const addr = req.params.address;
      // isBuilder(address) selector: 0xb6b6b475
      const result = await ethCall(BUILDER_REGISTRY_ADDR, `0xb6b6b475000000000000000000000000${addr.replace("0x", "").toLowerCase()}`);
      const isBuilder = result !== "0x" && result !== "0x0000000000000000000000000000000000000000000000000000000000000000";
      res.json({ address: addr, isBuilder });
    } catch (e: unknown) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Unknown error" });
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
const LENDING_VAULT_ADDR = process.env.LENDING_VAULT_ADDR || "";

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
        message: "LendingVault deploys after Bootstrap finalise — June 2026",
      });
    }

    const lvAbi = [
      "function totalLent() view returns (uint256)",
      "function totalAvailable() view returns (uint256)",
      "function getInterestRate() view returns (uint256)",
      "function getLoanCount() view returns (uint256)",
    ];

    const url = process.env.MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com";
    const provider = new (await import("ethers")).ethers.providers.JsonRpcProvider(url);
    const lv = new (await import("ethers")).ethers.Contract(LENDING_VAULT_ADDR, lvAbi, provider);

    const [lent, available, rate, loans] = await Promise.all([
      lv.totalLent(),
      lv.totalAvailable(),
      lv.getInterestRate(),
      lv.getLoanCount(),
    ]);

    res.json({
      status: "active",
      totalLent: parseFloat((await import("ethers")).ethers.utils.formatUnits(lent, IFR_DECIMALS)),
      totalAvailable: parseFloat((await import("ethers")).ethers.utils.formatUnits(available, IFR_DECIMALS)),
      currentRate: rate.toNumber() / 100,
      activeLoans: loans.toNumber(),
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
    ];

    const url = process.env.MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com";
    const provider = new (await import("ethers")).ethers.providers.JsonRpcProvider(url);
    const lv = new (await import("ethers")).ethers.Contract(LENDING_VAULT_ADDR, lvAbi, provider);
    const ethersLib = (await import("ethers")).ethers;

    const count = (await lv.getOfferCount()).toNumber();
    const rate = (await lv.getInterestRate()).toNumber() / 100;
    const offers: Array<Record<string, unknown>> = [];

    for (let i = 0; i < Math.min(count, 50); i++) {
      try {
        const o = await lv.getOffer(i);
        if (o.active && o.availableIFR.gt(0)) {
          offers.push({
            id: i,
            lender: o.lender,
            availableAmount: parseFloat(ethersLib.utils.formatUnits(o.availableIFR, IFR_DECIMALS)),
            lentAmount: parseFloat(ethersLib.utils.formatUnits(o.lentIFR, IFR_DECIMALS)),
            rate,
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
  console.log("[LendingVault] LENDING_VAULT_ADDR not set — endpoints return placeholder data");
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
    const provider = new ethersLib.providers.JsonRpcProvider(ETH_RPC_URL);
    const cv = new ethersLib.Contract(COMMITMENT_VAULT_ADDR, CV_ABI, provider);

    const [tranches, p0SetVal] = await Promise.all([cv.getTranches(addr), cv.p0Set()]);
    const p0Val = p0SetVal ? await cv.p0() : null;

    const formatted = tranches.map((t: { amount: { toString: () => string }; cType: number; unlockTime: { toNumber: () => number }; p0Multiplier: { toNumber: () => number }; unlocked: boolean; conditionMetAt: { toNumber: () => number } }, i: number) => {
      const condMetAt = t.conditionMetAt.toNumber();
      return {
        id: i,
        amount: ethersLib.utils.formatUnits(t.amount, IFR_DECIMALS),
        conditionType: CONDITION_TYPES[t.cType] || "UNKNOWN",
        unlockTime: t.unlockTime.toNumber() || null,
        p0Multiplier: t.p0Multiplier.toNumber(),
        unlocked: t.unlocked,
        conditionMetAt: condMetAt || null,
        autoUnlockAt: condMetAt > 0 ? condMetAt + AUTO_UNLOCK_DELAY : null,
      };
    });

    const totalLocked = tranches
      .filter((t: { unlocked: boolean }) => !t.unlocked)
      .reduce((sum: number, t: { amount: { toString: () => string } }) => sum + parseFloat(ethersLib.utils.formatUnits(t.amount, IFR_DECIMALS)), 0);

    res.json({
      wallet: addr,
      trancheCount: tranches.length,
      tranches: formatted,
      totalLocked: totalLocked.toFixed(0),
      p0Set: p0SetVal,
      p0ETH: p0Val ? ethersLib.utils.formatEther(p0Val) : null,
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
    const provider = new ethersLib.providers.JsonRpcProvider(ETH_RPC_URL);
    const cv = new ethersLib.Contract(COMMITMENT_VAULT_ADDR, CV_ABI, provider);

    const [locked, hasLock] = await Promise.all([cv.lockedBalance(addr), cv.hasActiveLock(addr)]);
    const lockedNum = parseFloat(ethersLib.utils.formatUnits(locked, IFR_DECIMALS));

    let tier = 0;
    if (lockedNum >= 10000) tier = 3;
    else if (lockedNum >= 2000) tier = 2;
    else if (lockedNum >= 500) tier = 1;

    res.json({ wallet: addr, isLocked: hasLock, totalLocked: lockedNum.toFixed(0), tier });
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
    const provider = new ethersLib.providers.JsonRpcProvider(ETH_RPC_URL);
    const cv = new ethersLib.Contract(COMMITMENT_VAULT_ADDR, CV_ABI, provider);

    const p0SetVal = await cv.p0Set();
    const p0Val = p0SetVal ? await cv.p0() : null;

    res.json({
      p0Set: p0SetVal,
      p0ETH: p0Val ? ethersLib.utils.formatEther(p0Val) : null,
      message: p0SetVal ? "P0 is set" : "P0 set after Bootstrap finalise()",
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
    const provider = new ethersLib.providers.JsonRpcProvider(ETH_RPC_URL);
    const cv = new ethersLib.Contract(COMMITMENT_VAULT_ADDR, CV_ABI, provider);

    const totalLocked = await cv.totalLocked();

    // Leaderboard requires event indexing (Phase 2) — return protocol total for now
    res.json({
      leaderboard: [],
      totalLockedProtocol: ethersLib.utils.formatUnits(totalLocked, IFR_DECIMALS),
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

const LV_LOAN_ABI = [
  "function getLoanCount() view returns (uint256)",
  "function getLoan(uint256 loanId) view returns (tuple(address borrower, uint256 ifrAmount, uint256 ethCollateral, uint256 startTime, uint256 duration, uint256 monthlyRateBps, uint256 repaidAt, bool active))",
  "function getCollateralRatio(uint256 loanId) view returns (uint256)",
  "function checkHealth(uint256 loanId) view returns (uint256)",
];

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
    const provider = new ethersLib.providers.JsonRpcProvider(ETH_RPC_URL);
    const lv = new ethersLib.Contract(LENDING_VAULT_ADDR, LV_LOAN_ABI, provider);

    const count = (await lv.getLoanCount()).toNumber();
    const myLoans: Array<Record<string, unknown>> = [];

    for (let i = 0; i < Math.min(count, 100); i++) {
      try {
        const loan = await lv.getLoan(i);
        if (loan.active && loan.borrower.toLowerCase() === addr.toLowerCase()) {
          const dueTs = loan.startTime.toNumber() + loan.duration.toNumber();
          myLoans.push({
            id: i,
            ifrAmount: ethersLib.utils.formatUnits(loan.ifrAmount, IFR_DECIMALS),
            ethCollateral: ethersLib.utils.formatEther(loan.ethCollateral),
            startTime: loan.startTime.toNumber(),
            dueDate: new Date(dueTs * 1000).toISOString().split("T")[0],
            monthlyRate: loan.monthlyRateBps.toNumber() / 100 + "%",
            active: loan.active,
          });
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
    const loanId = parseInt(req.params.loanId, 10);
    if (isNaN(loanId) || loanId < 0) {
      return res.status(400).json({ error: "Invalid loanId" });
    }
    if (!LENDING_VAULT_ADDR || LENDING_VAULT_ADDR.startsWith("0x000")) {
      return res.status(404).json({ error: "LendingVault not deployed" });
    }

    const ethersLib = (await import("ethers")).ethers;
    const provider = new ethersLib.providers.JsonRpcProvider(ETH_RPC_URL);
    const lv = new ethersLib.Contract(LENDING_VAULT_ADDR, LV_LOAN_ABI, provider);

    const loan = await lv.getLoan(loanId);
    if (!loan.active) {
      return res.status(404).json({ error: "Loan not active" });
    }

    let collateralRatio = 0;
    let health: "HEALTHY" | "WARNING" | "CRITICAL" = "HEALTHY";
    try {
      collateralRatio = (await lv.getCollateralRatio(loanId)).toNumber();
      if (collateralRatio < 120) health = "CRITICAL";
      else if (collateralRatio < 150) health = "WARNING";
    } catch {
      // getCollateralRatio may revert if price not set — return basic data
    }

    res.json({
      loanId,
      ethCollateral: ethersLib.utils.formatEther(loan.ethCollateral),
      ifrAmount: ethersLib.utils.formatUnits(loan.ifrAmount, IFR_DECIMALS),
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
    const provider = new ethersLib.providers.JsonRpcProvider(ETH_RPC_URL);
    const lv = new ethersLib.Contract(LENDING_VAULT_ADDR, lvAbi, provider);

    const has = await lv.hasOffer(addr);
    if (!has) {
      return res.json({ wallet: addr, hasOffer: false });
    }

    const idx = (await lv.lenderOfferIndex(addr)).toNumber();
    const offer = await lv.getOffer(idx);
    const rate = (await lv.getInterestRate()).toNumber() / 100;
    const availNum = parseFloat(ethersLib.utils.formatUnits(offer.availableIFR, IFR_DECIMALS));
    const lentNum = parseFloat(ethersLib.utils.formatUnits(offer.lentIFR, IFR_DECIMALS));
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
    const provider = new ethersLib.providers.JsonRpcProvider(ETH_RPC_URL);
    const lv = new ethersLib.Contract(LENDING_VAULT_ADDR, LV_LOAN_ABI, provider);

    const count = (await lv.getLoanCount()).toNumber();
    let warnings = 0;

    for (let i = 0; i < count; i++) {
      try {
        const loan = await lv.getLoan(i);
        if (!loan.active) continue;

        const ratio = (await lv.getCollateralRatio(i)).toNumber();
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

interface BuilderGenConfig {
  productName?: string;
  productUrl?: string;
  minAmount?: number;
  hardLock?: boolean;
  lockDuration?: number;
  tierSystem?: boolean;
  cooldown?: boolean;
  apiCheck?: boolean;
  tier1Amount?: number;
  tier2Amount?: number;
  tier3Amount?: number;
  cooldownHours?: number;
}

function builderSecurityScore(c: BuilderGenConfig) {
  let score = 0;
  if (c.hardLock) {
    if ((c.lockDuration || 0) >= 90) score += 30;
    else if ((c.lockDuration || 0) >= 30) score += 25;
    else if ((c.lockDuration || 0) >= 7) score += 20;
    else score += 10;
  }
  if (c.cooldown) score += 20;
  if (c.tierSystem) score += 15;
  if ((c.minAmount || 0) >= 10000) score += 20;
  else if ((c.minAmount || 0) >= 1000) score += 15;
  else if ((c.minAmount || 0) >= 500) score += 10;
  else if ((c.minAmount || 0) >= 100) score += 5;
  if (!c.apiCheck) score += 15; else score += 5;
  const level = score >= 80 ? "SAFE" : score >= 50 ? "MEDIUM" : "RISKY";
  const emoji = level === "SAFE" ? "🟢" : level === "MEDIUM" ? "🟡" : "🔴";

  const recommendations: string[] = [];
  if (!c.hardLock) recommendations.push("Enable Hard Lock to prevent flash access");
  if (!c.cooldown) recommendations.push("Enable Cooldown for anti-gaming protection");
  if ((c.minAmount || 0) < 500) recommendations.push("Increase minimum to >=500 IFR");
  if (!c.tierSystem) recommendations.push("Add Tier System for graduated access");

  return { score, level, emoji, recommendations };
}

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

  const sdkSnippet = `import { IFRClient } from "ifr-sdk";
const ifr = new IFRClient({ network: "mainnet" });
const hasAccess = await ifr.checkAccess({ wallet: userAddress, required: ${c.minAmount || 500} });
${useTier ? 'const tier = await ifr.getTier(userAddress);\nif (tier >= 2) enablePremium();' : ""}if (hasAccess) enableAccess();`;

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

    const security = builderSecurityScore(c);
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
    const required = parseInt(req.query.required as string || "1000", 10);

    if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    const ethersLib = (await import("ethers")).ethers;
    const provider = new ethersLib.providers.JsonRpcProvider(ETH_RPC_URL);

    const tokenAbi = ["function balanceOf(address) view returns (uint256)"];
    const lockAbi = ["function lockedBalance(address) view returns (uint256)"];

    const token = new ethersLib.Contract("0x77e99917Eca8539c62F509ED1193ac36580A6e7B", tokenAbi, provider);
    const lock = new ethersLib.Contract("0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb", lockAbi, provider);

    const [balRaw, lockedRaw] = await Promise.all([
      token.balanceOf(wallet),
      lock.lockedBalance(wallet).catch(() => ethersLib.BigNumber.from(0)),
    ]);

    const balance = parseFloat(ethersLib.utils.formatUnits(balRaw, IFR_DECIMALS));
    const locked = parseFloat(ethersLib.utils.formatUnits(lockedRaw, IFR_DECIMALS));
    const total = balance + locked;

    const tier = total >= 10000 ? 3 : total >= 2000 ? 2 : total >= 500 ? 1 : 0;
    const tierNames = ["None", "Basic", "Premium", "Pro"];

    res.json({
      hasAccess: total >= required,
      balance: balance.toFixed(0),
      locked: locked.toFixed(0),
      total: total.toFixed(0),
      required,
      tier,
      tierName: tierNames[tier],
    });
  } catch (err) {
    console.error("IFR check error:", err);
    res.status(502).json({ error: "Failed to check access" });
  }
});

console.log("[SDK] GET /api/ifr/check active");

const PORT = parseInt(process.env.PORT || "3003", 10);
app.listen(PORT, () => {
  console.log(`IFR Copilot API on :${PORT}`);

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
