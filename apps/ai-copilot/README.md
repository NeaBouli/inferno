# IFR AI Copilot

Chat widget for Inferno ($IFR) — helps users, builders, and developers
with token mechanics, lock integration, and the Benefits Network.

## Features

- **3 Modes**: Customer, Builder, Developer — each with tailored system prompts
- **RAG Knowledge Base**: All IFR facts (contracts, tokenomics, tiers, governance) embedded as structured context
- **Safety Guards**: Automatic seed phrase / private key detection with instant warnings
- **Source Tags**: Every response cites its source (IFR_KNOWLEDGE)
- **Dark Theme**: Matches IFR branding (dark bg, red accents)

## Setup

```bash
cd apps/ai-copilot
npm install
cp .env.example .env
# Add your Anthropic API key to .env
npm run dev
```

- Frontend: http://localhost:5175
- Backend API: http://localhost:3003

## Architecture

```
Browser (React) → /api/chat → Express Server → Anthropic Claude API
                                    |
                          System Prompt (mode-specific)
                                    +
                          IFR_KNOWLEDGE (RAG context)
```

The Anthropic API key stays on the server — never exposed to the browser.

## Modes

| Mode | Audience | Focus |
|------|----------|-------|
| Customer | Token holders | Wallet setup, locking, tiers, benefits |
| Builder | Businesses | QR-flow, Benefits Network, Creator Rewards |
| Developer | Developers | SDK integration, ethers.js, wagmi, Python |

## Embedding in Wiki Pages

See `public/embed.html` for the iframe embed snippet.

## Tech Stack

- React 18 + Vite + TypeScript
- Tailwind CSS
- Express (API proxy)
- Anthropic Claude API (Haiku 4.5)

## Daily Cost Budget (fail-closed)

Every chat request reserves a conservative maximum cost (serialized request
UTF-8 bytes as the input-token upper bound plus max output tokens, integer
micro-USD) *before* the Anthropic call, so
concurrent requests cannot all pass the same remaining-budget check. After a
successful call the reservation is settled against actual token usage. If a
dispatched request fails or returns no usage, the full reservation is charged
because provider-side billing cannot be ruled out. Spend resets at the UTC day
boundary.

When no reservation is available, Anthropic is not called. The chat endpoint
answers:

```
HTTP/1.1 429 Too Many Requests
Retry-After: <seconds until the next 00:00 UTC reset>

{ "reply": "The AI assistant has reached its daily capacity. Please try again later.", "code": "budget_exhausted" }
```

The response intentionally carries no dollar totals or configuration values.
All other response shapes are unchanged.

`COPILOT_DAILY_BUDGET_USD` configures the aggregate daily USD limit with at
most two decimals. The default is `1`, the hard configuration ceiling is
`1000`, and invalid values abort startup rather than disabling the guard.

## Live Wiki Snapshot (bounded trust)

The committed `src/context/wiki-content.json` RAG snapshot remains the primary,
reviewable knowledge base. The optional live Wiki snapshot is refreshed only at
startup and on a 1-hour background interval — never from a chat request, and
only one refresh runs at a time. Chat reads the last good snapshot
synchronously; discovery timeouts, page failures, and partial refreshes keep
the last good snapshot (stale-if-error).

Fetching is restricted to the IFR origins compiled into the server; the
environment setting may select a subset but cannot add other hosts. The index,
every discovered link, every redirect hop, and every fetched page must parse
to an allowlisted HTTPS origin with a path under `/wiki/*.html` (plus the
landing `index.html`). Foreign, lookalike, credential-bearing, downgraded, and
non-HTTP(S) URLs are rejected. Redirects (3), per-response bytes (256 KB),
page count (40), timeouts, and total context size (80 KB) are bounded, and
remote HTML is stripped to inert text marked as untrusted reference data.

`COPILOT_WIKI_ALLOWED_ORIGINS` may select a subset of the IFR origins compiled
into the server (`https://ifrunit.tech`, `https://www.ifrunit.tech`). Unknown
origins abort startup, so runtime configuration cannot widen the trust
boundary.

## Environment Variables

| Variable | Description |
|----------|-------------|
| ANTHROPIC_API_KEY | Anthropic API key (required) |
