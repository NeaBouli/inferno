import "dotenv/config";
import express from "express";
import cors from "cors";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
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

// Load wiki docs for RAG at startup
const WIKI_DIR = resolve(__dirname, "../../../docs/wiki");
let wikiDocs: WikiDoc[] = [];
try {
  wikiDocs = loadWikiDocs(WIKI_DIR);
  console.log(`Wiki RAG loaded: ${wikiDocs.length} documents`);
} catch (err) {
  console.warn("Wiki RAG failed to load (non-critical):", err);
}

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
<div id="input-area">
  <input id="input" type="text" maxlength="500" placeholder="Ask about IFR..." onkeydown="if(event.key==='Enter'&&!event.shiftKey)send()" oninput="document.getElementById('charcount').textContent=this.value.length+'/500'">
  <span id="charcount" style="color:#666;font-size:11px;align-self:center;">0/500</span>
  <button id="send-btn" onclick="send()">&#x27A4;</button>
</div>
<script>
var currentMode = 'explorer';
var histories = { explorer: [], user: [], dev: [] };
var welcomes = {
  explorer: "Welcome! I'm the IFR Copilot. &#x1f525;\\n\\nI can help you understand Inferno Protocol \\u2014 a deflationary utility token on Ethereum. Ask me about:\\n\\n\\u2022 What is $IFR?\\n\\u2022 How does Lock-to-Access work?\\n\\u2022 The Bootstrap Event\\n\\u2022 Fair Launch model",
  user: "Hey! &#x1f48e; Ready to help you get the most out of your IFR tokens.\\n\\nI can assist with:\\n\\u2022 Locking IFR for benefits\\n\\u2022 Understanding your tier (Bronze/Silver/Gold/Platinum)\\n\\u2022 Partner discounts \\u0026 Benefits Network\\n\\u2022 Step-by-step guides",
  dev: "Dev mode active. &#x2699;&#xfe0f;\\n\\n9 verified mainnet contracts \\u2022 444 tests \\u2022 99% coverage\\n\\nI can help with:\\n\\u2022 Contract addresses \\u0026 ABIs\\n\\u2022 Integration (ethers.js v5, 9 decimals)\\n\\u2022 Governance \\u0026 Timelock\\n\\u2022 Security audit results"
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
  const systemPrompt = buildSystemPrompt(basePrompt, mode || "customer", wikiDocs);

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
  res.json({ status: "ok", apiKeySet: !!ANTHROPIC_API_KEY });
});

const PORT = parseInt(process.env.PORT || "3003", 10);
app.listen(PORT, () => {
  console.log(`IFR Copilot API on :${PORT}`);
});
