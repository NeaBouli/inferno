import { useState, useRef, useEffect } from "react";

type Mode = "customer" | "partner" | "developer";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const MODE_LABELS: Record<Mode, string> = {
  customer: "Customer",
  partner: "Partner",
  developer: "Developer",
};

const MODE_PLACEHOLDERS: Record<Mode, string> = {
  customer: "How do I lock IFR tokens?",
  partner: "How does the QR verification work?",
  developer: "Show me isLocked() integration code",
};

export default function IFRCopilot() {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("customer");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const SAFETY_WORDS = ["seed phrase", "private key", "mnemonic", "secret recovery"];

  function checkSafety(text: string): string | null {
    const lower = text.toLowerCase();
    for (const word of SAFETY_WORDS) {
      if (lower.includes(word)) {
        return "STOP — Never share your seed phrase, private key, or mnemonic with anyone. Not even this assistant. Keep your keys safe and secret.";
      }
    }
    return null;
  }

  async function sendMessage() {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const safetyWarning = checkSafety(trimmed);
    if (safetyWarning) {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed },
        { role: "assistant", content: safetyWarning },
      ]);
      setInput("");
      return;
    }

    const newMessages: Message[] = [
      ...messages,
      { role: "user", content: trimmed },
    ];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      // Optional: pass wallet info for points tracking
      const walletAddress = (window as unknown as Record<string, unknown>).__IFR_WALLET_ADDRESS as string | undefined;
      const authToken = (window as unknown as Record<string, unknown>).__IFR_AUTH_TOKEN as string | undefined;

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (walletAddress) headers["x-wallet-address"] = walletAddress;
      if (authToken) headers["x-auth-token"] = authToken;

      const response = await fetch("/api/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({
          mode,
          messages: newMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });
      const data = await response.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Connection error. Please try again." },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleModeChange(newMode: Mode) {
    setMode(newMode);
    setMessages([]);
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full bg-ifr-red hover:bg-red-700 text-white shadow-lg shadow-red-900/40 flex items-center justify-center transition-all hover:scale-110"
        title="IFR Copilot"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 w-[400px] h-[600px] bg-ifr-dark border border-ifr-border rounded-2xl shadow-2xl shadow-black/60 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-ifr-card border-b border-ifr-border p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-ifr-red animate-pulse" />
            <span className="text-white font-semibold text-sm">IFR Copilot</span>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="text-ifr-muted hover:text-white transition-colors text-lg leading-none"
          >
            &times;
          </button>
        </div>

        {/* Mode selector */}
        <div className="flex gap-1">
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => handleModeChange(m)}
              className={`flex-1 text-xs py-1.5 rounded-md transition-all ${
                mode === m
                  ? "bg-ifr-red text-white"
                  : "bg-ifr-dark text-ifr-muted hover:text-white"
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {/* Disclaimer banner */}
      <div style={{background:'#1a1a2e',border:'1px solid #f97316',borderRadius:'8px',padding:'10px 14px',margin:'8px 8px 0',fontSize:'12px',color:'#94a3b8',display:'flex',alignItems:'flex-start',gap:'8px'}}>
        <span style={{color:'#f97316',fontSize:'14px'}}>&#x26A0;</span>
        <span>AI responses may not always be accurate. Always verify critical info at <a href="https://ifrunit.tech" target="_blank" rel="noreferrer" style={{color:'#f97316'}}>ifrunit.tech</a>. Never share private keys or seed phrases.</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex justify-start">
            <div className="max-w-[92%] bg-ifr-card text-gray-200 border border-ifr-border rounded-xl px-4 py-3 text-sm leading-relaxed">
              <p className="mb-2">Welcome to IFR Copilot.</p>
              <p className="text-ifr-muted text-xs mb-3">
                You&apos;re browsing without a connected wallet &mdash; no problem! I can still help you with everything about the IFR Protocol.
              </p>

              <p className="text-white font-semibold text-xs mb-1">Without a wallet, you can:</p>
              <ul className="text-ifr-muted text-xs mb-3 space-y-0.5 list-disc list-inside">
                <li>Ask anything about IFR tokenomics, governance, or the lock mechanism</li>
                <li>Learn how the Bootstrap phase works</li>
                <li>Explore the roadmap and security model</li>
                <li>Understand how IFR creates real utility</li>
              </ul>

              <p className="text-white font-semibold text-xs mb-1">Connect your wallet to unlock:</p>
              <ul className="text-ifr-muted text-xs mb-3 space-y-0.5 list-disc list-inside">
                <li>Your personal IFR balance and lock position</li>
                <li>Your vesting schedule (if applicable)</li>
                <li>Personalized guidance based on your on-chain state</li>
              </ul>

              <p className="text-white font-semibold text-xs mb-1">Lock &ge;1,000 IFR to unlock:</p>
              <ul className="text-ifr-muted text-xs mb-3 space-y-0.5 list-disc list-inside">
                <li>Premium Copilot access with deeper on-chain analysis</li>
                <li>Access to the AI Copilot Gate (gated content platform)</li>
                <li>Builder onboarding pathway</li>
                <li>Your lock is verified on-chain &mdash; no account needed</li>
              </ul>

              <button
                onClick={() => console.log("WalletConnect coming soon")}
                className="w-full bg-ifr-dark border border-ifr-border text-ifr-muted rounded-lg py-2 text-xs font-medium mb-3 cursor-default opacity-60"
              >
                Connect Wallet (coming soon)
              </button>

              <p className="text-ifr-muted text-xs italic">
                Or just ask me anything! Try: &ldquo;{MODE_PLACEHOLDERS[mode]}&rdquo;
              </p>
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-ifr-red/20 text-white border border-ifr-red/30"
                  : "bg-ifr-card text-gray-200 border border-ifr-border"
              }`}
            >
              {msg.content}
              {msg.role === "assistant" && (
                <div className="mt-1.5">
                  <span className="inline-block text-[10px] bg-ifr-dark text-ifr-muted px-1.5 py-0.5 rounded">
                    Source: IFR_KNOWLEDGE
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-ifr-card border border-ifr-border rounded-xl px-3 py-2 text-sm text-ifr-muted">
              <span className="inline-flex gap-1">
                <span className="animate-bounce">.</span>
                <span className="animate-bounce" style={{ animationDelay: "0.1s" }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: "0.2s" }}>.</span>
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-ifr-border p-3">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder={MODE_PLACEHOLDERS[mode]}
            disabled={isLoading}
            className="flex-1 bg-ifr-card border border-ifr-border rounded-lg px-3 py-2 text-sm text-white placeholder-ifr-muted outline-none focus:border-ifr-red transition-colors"
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            className="bg-ifr-red hover:bg-red-700 disabled:opacity-40 disabled:hover:bg-ifr-red text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
