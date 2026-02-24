# IFR AI Copilot

Chat widget for Inferno ($IFR) — helps users, partners, and developers
with token mechanics, lock integration, and the Benefits Network.

## Features

- **3 Modes**: Customer, Partner, Developer — each with tailored system prompts
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
| Partner | Businesses | QR-flow, Benefits Network, Creator Rewards |
| Developer | Developers | SDK integration, ethers.js, wagmi, Python |

## Embedding in Wiki Pages

See `public/embed.html` for the iframe embed snippet.

## Tech Stack

- React 18 + Vite + TypeScript
- Tailwind CSS
- Express (API proxy)
- Anthropic Claude API (Haiku 4.5)

## Environment Variables

| Variable | Description |
|----------|-------------|
| ANTHROPIC_API_KEY | Anthropic API key (required) |
