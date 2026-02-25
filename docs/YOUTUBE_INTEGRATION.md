# YouTube × IFR Integration Guide — Hybrid Model B

## Konzept
Creator bietet Premium-Content an, zugänglich durch:
- YouTube Channel Membership (klassisch), ODER
- IFR Token Lock (mindestens X IFR) — permissionless

## Warum Hybrid?
- Bestehende YouTube-Fans behalten Zugang (keine Disruption)
- Crypto-natives zahlen via IFR Lock statt Fiat
- Creator diversifiziert Revenue-Streams
- IFR Lock = langfristiges Commitment (kein einmaliger Kauf)

## Architektur
```
User → YouTube OAuth (wenn Member) → Zugang
User → WalletConnect → IFRLock.isLocked() → Zugang
User → Weder noch → Zugang verweigert
```

### Komponenten:
1. **Creator Gateway** (Docker, self-hosted)
   - OAuth Handler: Google OAuth 2.0
   - Lock Checker: ethers.js → IFRLock.isLocked()
   - Entitlement Engine: OR-Logik (Member OR Locked)
   - Session Manager: JWT, 24h

2. **IFR Lock Contract** (on-chain)
   - `isLocked(address, uint256) → bool`
   - Kein Backend-Trust nötig — direkte Chain-Abfrage

3. **Content Gate** (Creator-seitig)
   - Discord Role Assignment, oder
   - Patreon-ähnliche Content-Wall, oder
   - Custom API-Endpunkt

## Setup für Creator (Step by Step)

### Voraussetzung:
- Docker installiert
- Google OAuth Credentials (YouTube API)
- Ethereum RPC URL (Alchemy/Infura)

### Installation:
```bash
git clone https://github.com/NeaBouli/inferno
cd apps/creator-gateway
cp .env.example .env
# .env konfigurieren:
# GOOGLE_CLIENT_ID=...
# GOOGLE_CLIENT_SECRET=...
# YOUTUBE_CHANNEL_ID=UC...
# IFRLOCK_ADDRESS=0x0Cab0A9440643128540222acC6eF5028736675d3
# MIN_LOCK_IFR=5000
# RPC_URL=https://eth-sepolia.g.alchemy.com/v2/...
docker-compose up -d
```

### Entitlement Config (config/entitlements.json):
```json
{
  "premium": {
    "logic": "OR",
    "conditions": [
      { "type": "youtube_member", "tier": "any" },
      { "type": "ifr_lock", "minIFR": 5000 }
    ]
  }
}
```

## Privacy & DSGVO
- Google OAuth: Creator Gateway speichert keine Google-IDs dauerhaft
- IFR Lock: Wallet-Adressen sind öffentlich (on-chain)
- Sessions: 24h JWT, dann re-auth nötig
- Keine personenbezogenen Daten werden an IFR-Server übermittelt

## Monetarisierung für Creator
- Creator erhält PartnerVault Rewards (15% des Lock-Betrags)
- Beispiel: 100 User × 5.000 IFR Lock = 500.000 IFR gesperrt
- Creator Reward: 500.000 × 15% = 75.000 IFR (über 6-12 Monate vested)
- Zusätzlich: YouTube Membership Revenue (unverändert)

## Roadmap
- Phase 1 (aktuell): Spec + Docker-Setup
- Phase 2: Creator Gateway MVP (Q3 2026)
- Phase 3: YouTube API Integration (Q4 2026)
- Phase 4: Multi-Platform (Twitch, Discord) (Q1 2027)

---
*Stand: Februar 2026 | Version 1.0*
