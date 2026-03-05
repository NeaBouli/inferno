# YouTube x IFR Integration Guide — Hybrid Model B

## Concept
Creators offer premium content, accessible through:
- YouTube Channel Membership (traditional), OR
- IFR Token Lock (minimum X IFR) — permissionless

## Why Hybrid?
- Existing YouTube fans keep access (no disruption)
- Crypto-natives pay via IFR lock instead of fiat
- Creator diversifies revenue streams
- IFR Lock = long-term commitment (not a one-time purchase)

## Architecture
```
User -> YouTube OAuth (if member) -> Access
User -> WalletConnect -> IFRLock.isLocked() -> Access
User -> Neither -> Access denied
```

### Components:
1. **Creator Gateway** (Docker, self-hosted)
   - OAuth Handler: Google OAuth 2.0
   - Lock Checker: ethers.js -> IFRLock.isLocked()
   - Entitlement Engine: OR logic (Member OR Locked)
   - Session Manager: JWT, 24h

2. **IFR Lock Contract** (on-chain)
   - `isLocked(address, uint256) -> bool`
   - No backend trust needed — direct chain query

3. **Content Gate** (creator-side)
   - Discord Role Assignment, or
   - Patreon-like content wall, or
   - Custom API endpoint

## Setup for Creators (Step by Step)

### Prerequisites:
- Docker installed
- Google OAuth Credentials (YouTube API)
- Ethereum RPC URL (Alchemy/Infura)

### Installation:
```bash
git clone https://github.com/NeaBouli/inferno
cd apps/creator-gateway
cp .env.example .env
# Configure .env:
# GOOGLE_CLIENT_ID=...
# GOOGLE_CLIENT_SECRET=...
# YOUTUBE_CHANNEL_ID=UC...
# IFRLOCK_ADDRESS=0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb (Mainnet)
# MIN_LOCK_IFR=5000
# RPC_URL=https://eth-mainnet.g.alchemy.com/v2/...
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

## Privacy & GDPR
- Google OAuth: Creator Gateway does not store Google IDs permanently
- IFR Lock: Wallet addresses are public (on-chain)
- Sessions: 24h JWT, then re-auth required
- No personal data is transmitted to IFR servers

## Monetization for Creators
- Creator receives PartnerVault rewards (15% of lock amount)
- Example: 100 users x 5,000 IFR Lock = 500,000 IFR locked
- Creator reward: 500,000 x 15% = 75,000 IFR (vested over 6-12 months)
- Additionally: YouTube Membership revenue (unchanged)

## Roadmap
- Phase 1 (current): Spec + Docker setup
- Phase 2: Creator Gateway MVP (Q3 2026)
- Phase 3: YouTube API Integration (Q4 2026)
- Phase 4: Multi-Platform (Twitch, Discord) (Q1 2027)

---
*As of: March 2026 | Version 1.1*
