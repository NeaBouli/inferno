import "dotenv/config";
import express from "express";
import cors from "cors";
import { SYSTEM_PROMPTS } from "../src/context/system-prompts.js";

const app = express();
app.use(cors());
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const POINTS_BACKEND_URL = process.env.POINTS_BACKEND_URL || "http://localhost:3004";

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

app.post("/api/chat", async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    res.status(500).json({ reply: "ANTHROPIC_API_KEY not configured." });
    return;
  }

  const { mode, messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ reply: "Invalid request: messages required." });
    return;
  }

  const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.customer;

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
        max_tokens: 1024,
        system: systemPrompt,
        messages
      })
    });

    const data = await response.json() as Record<string, unknown>;
    console.log("Anthropic response status:", response.status);
    console.log("Anthropic response:", JSON.stringify(data).slice(0, 500));

    if (!response.ok) {
      const errMsg = (data as { error?: { message?: string } }).error?.message || "Unknown API error";
      console.error("Anthropic API error:", errMsg);
      res.status(500).json({ reply: `API error: ${errMsg}` });
      return;
    }

    const content = data.content as { text?: string }[] | undefined;
    const text = content?.[0]?.text || "Sorry, I couldn't process that.";

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

app.listen(3003, () => {
  console.log("IFR Copilot API on :3003");
});
