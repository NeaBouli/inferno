# IFR Creator Gateway — Technical Specification

## Konzept
Der IFR Creator Gateway ist eine Open-Source Bridge, die Creators ermoeglicht,
ihre eigene Verifikations-Infrastruktur zu betreiben.

IFR bleibt reiner On-Chain Truth Layer.
Creators betreiben eigene Server (Docker, selbst gehostet).
Kein zentraler IFR-Server der Google-IDs oder persoenliche Daten speichert.

## Architektur

```
User → [OAuth / WalletConnect] → Creator Gateway (Docker)
                                        ↓
                               IFRLock Contract (Ethereum)
                                        ↓
                               Entitlement Engine
                                        ↓
                    [Discord Role / Private Content / API Access]
```

## Repository-Struktur (geplant)

```
IFR-Creator-Gateway/ (separates GitHub Repo)
├── docker-compose.yml
├── .env.example
├── src/
│   ├── oauth/          # Google OAuth Handler
│   ├── wallet/         # WalletConnect + signMessage Verifier
│   ├── lock/           # IFRLock on-chain check (ethers v5)
│   ├── entitlement/    # Entitlement Engine (Rules-Engine)
│   ├── api/            # REST API fuer Creator-Apps
│   └── dashboard/      # Einfaches Web-Dashboard
└── README.md
```

## Hybrid Modell B — YouTube Integration

Zugang = YouTube Membership ODER IFR Lock (Creator waehlt)

Flow:
1. User oeffnet Creator Gateway URL
2. Login: Google OAuth (YouTube Membership Check) + Wallet Connect
3. User signiert Message (Wallet-Ownership-Proof)
4. Gateway prueft:
   - YouTubeMember == true? → APPROVED
   - IFRLocked >= threshold? → APPROVED
   - Beides false? → REJECTED
5. Creator-App erhaelt: `{ approved: true/false, method: 'youtube'|'ifr'|'both' }`

Warum Hybrid:
- Bestehende YouTube-Subscriber werden nicht ausgeschlossen
- IFR-Holder bekommen alternativen Zugang
- Creator behaelt YouTube-Einnahmen UND gewinnt IFR-Oekosystem

## Environment Variables (.env.example)

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
YOUTUBE_CHANNEL_ID=
IFR_LOCK_ADDRESS=0x...
RPC_URL=https://...
MIN_IFR_LOCK=1000        # Human units
CHAIN_ID=1
SESSION_SECRET=
PORT=3002
```

## Entitlement Rules (konfigurierbar)

```json
{
  "rules": [
    {
      "name": "youtube_member",
      "type": "youtube_membership",
      "channelId": "UC...",
      "grants": ["premium"]
    },
    {
      "name": "ifr_holder",
      "type": "ifr_lock",
      "minAmount": 1000,
      "grants": ["premium"]
    }
  ],
  "logic": "OR"
}
```

## API Endpoints

```
POST /auth/google     → OAuth callback
POST /auth/wallet     → WalletConnect + signMessage
GET  /entitlement     → { premium: bool, method: string }
GET  /health          → { status: 'ok' }
```

## Docker Setup (Creator Quickstart)

```bash
git clone https://github.com/NeaBouli/ifr-creator-gateway
cd ifr-creator-gateway
cp .env.example .env
# .env ausfuellen (Google OAuth Keys, RPC URL, IFRLock Adresse)
docker-compose up -d
# Gateway laeuft auf Port 3002
```

## Datenschutz
- IFR speichert keine Google-IDs
- Wallet-Adressen werden nicht persistiert
- Sessions sind temporaer (TTL: 24h)
- Creator betreibt eigenen Server → eigene Datenschutz-Verantwortung

## Status
- Spezifikation: Vollstaendig
- Implementierung: Geplant (Phase 3)
- Repository: github.com/NeaBouli/ifr-creator-gateway (geplant)

---
*Stand: Februar 2026 | IFR Creator Gateway v0.1 Spec*
