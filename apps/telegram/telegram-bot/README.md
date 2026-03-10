# 🔥 IFR Telegram Bot

Offizieller Community-Bot für [Inferno ($IFR)](https://ifrunit.tech).

## Stack

- **Node.js 18** + **Telegraf v4**
- **ethers.js v5** (IFR Token: 9 Decimals)
- **AI Copilot** für /ask
- **Railway** (auto-deploy via GitHub main)

## Setup (lokal)

```bash
cd apps/telegram
npm install
cp .env.example .env
# .env mit echten Werten befüllen (Projektleiter anfragen)
node src/index.js
```

## Commands

| Command | Beschreibung | On-Chain? |
|---------|-------------|-----------|
| `/start` `/help` | Willkommen & Übersicht | Nein |
| `/lock <wallet>` | Lock-Status prüfen | Ja (IFRLock) |
| `/burns` | Burns & aktueller Supply | Ja (Railway/RPC) |
| `/tokenomics` | Token-Verteilung | Nein |
| `/bootstrap` | Bootstrap-Info | Nein |
| `/partner` | Partner-Ökosystem | Nein |
| `/roadmap` | Projekt-Roadmap | Nein |
| `/ask <frage>` | KI-Frage (Copilot) | Nein |
| `/admin` | Admin-Status (Whitelist) | Nein |

## ABIs

Der Bot nutzt die ABIs aus `/abi/` im Root-Repo:
- `IFRLock.json` → `isLocked()`, `getLockAmount()`
- `InfernoToken.json` → `totalSupply()`, `balanceOf()`

⚠️ **IFR hat 9 Decimals** — immer `formatUnits(amount, 9)`, nie `formatEther()`.

## Deployment (Railway)

1. Railway Dashboard → Neuer Service → GitHub Repo
2. Root Directory: `apps/telegram`
3. Start Command: `node src/index.js`
4. Alle ENV Variables aus `.env.example` setzen
5. Deploy → Logs prüfen

## Environment Variables

Siehe `.env.example` für alle Variablen.

## Git-Konventionen

- Branch: `main` (kein Feature-Branch)
- Author: `IFR Protocol <protocol@ifrunit.tech>`
- Kein force-push, kein rebase
- `.env` ist in `.gitignore` — niemals committen

## Verifikation nach Deploy

```bash
# Railway Health
curl https://ifr-ai-copilot-production.up.railway.app/health

# Bot testen
# Telegram: /start, /burns, /lock 0x6b36687b0cd4386fb14cf565B67D7862110Fed67
```
