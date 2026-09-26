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

## Verify API — CORS-Policy (CWA-39)

Die Verify API (`POST /api/verify`) akzeptiert Browser-Aufrufe ausschließlich
von exakt allowlisteten HTTPS-Origins: `https://ifrunit.tech` und
`https://www.ifrunit.tech` (siehe `src/middleware/verifyCors.js`). Der
Origin-Header wird als URL geparst und als serialisierter Origin verglichen —
keine Substring-/Suffix-Matches, keine Credentials, keine alternativen Ports
oder Schemes; `null` und malformed Origins erhalten keine CORS-Header.

Requests **ohne** Origin-Header gelten als Nicht-Browser-Clients (curl,
Server-zu-Server, Health-Checks): CORS greift fuer sie nicht, sie werden
normal verarbeitet, erhalten aber keine `Access-Control-*`-Header.

## Channel → Community Sync — Trusted Source (CWA-45)

Der Auto-Sync (inkl. Auto-Pin) repostet nur Posts aus dem explizit ueber
`TELEGRAM_CHANNEL_ID` konfigurierten offiziellen Channel in
`TELEGRAM_GROUP_ID`. Unbekannte, weitergeleitete (`forward_*`/
`is_automatic_forward`) oder im Namen fremder Chats gesendete Posts sowie
fehlende Quell-Metadaten werden verworfen (fail closed). Channel-Text und
`/ask`-Antworten werden als Plain Text (ohne `parse_mode`, max. 4096 Zeichen)
ausgegeben.

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

## Council-Agenda veröffentlichen

Der Publisher liest standardmäßig den kanonischen Text aus
`docs/social/telegram-council-exchange-agenda.md` und läuft ohne explizite
Freigabe nur als Dry-Run:

```bash
npm run post:council-agenda
```

Ein echter Versand benötigt zusätzlich `TELEGRAM_ALLOW_LIVE=true`, den im
Dry-Run ausgegebenen `TELEGRAM_POST_CONFIRM`-Hash sowie
`TELEGRAM_GROUP_ID`, `TELEGRAM_COUNCIL_TOPIC_ID` und den Bot-Token. Der Text
wird ausschließlich in den konfigurierten Council-Thread gesendet, nicht
angepinnt und nicht parallel im öffentlichen Channel veröffentlicht.
