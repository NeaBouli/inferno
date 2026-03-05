# IFR Creator Gateway — Technical Specification

## Concept
The IFR Creator Gateway is an open-source bridge that enables creators
to operate their own verification infrastructure.

IFR remains a pure on-chain truth layer.
Creators operate their own servers (Docker, self-hosted).
No central IFR server that stores Google IDs or personal data.

## Architecture

```
User → [OAuth / WalletConnect] → Creator Gateway (Docker)
                                        ↓
                               IFRLock Contract (Ethereum)
                                        ↓
                               Entitlement Engine
                                        ↓
                    [Discord Role / Private Content / API Access]
```

## Repository Structure (planned)

```
IFR-Creator-Gateway/ (separate GitHub repo)
├── docker-compose.yml
├── .env.example
├── src/
│   ├── oauth/          # Google OAuth handler
│   ├── wallet/         # WalletConnect + signMessage verifier
│   ├── lock/           # IFRLock on-chain check (ethers v5)
│   ├── entitlement/    # Entitlement Engine (rules engine)
│   ├── api/            # REST API for creator apps
│   └── dashboard/      # Simple web dashboard
└── README.md
```

## Hybrid Model B — YouTube Integration

Access = YouTube Membership OR IFR Lock (creator chooses)

Flow:
1. User opens Creator Gateway URL
2. Login: Google OAuth (YouTube Membership check) + Wallet Connect
3. User signs message (wallet ownership proof)
4. Gateway checks:
   - YouTubeMember == true? → APPROVED
   - IFRLocked >= threshold? → APPROVED
   - Both false? → REJECTED
5. Creator app receives: `{ approved: true/false, method: 'youtube'|'ifr'|'both' }`

Why Hybrid:
- Existing YouTube subscribers are not excluded
- IFR holders get alternative access
- Creator keeps YouTube revenue AND gains IFR ecosystem

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

## Entitlement Rules (configurable)

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
# Fill in .env (Google OAuth keys, RPC URL, IFRLock address)
docker-compose up -d
# Gateway runs on port 3002
```

## Privacy
- IFR does not store Google IDs
- Wallet addresses are not persisted
- Sessions are temporary (TTL: 24h)
- Creator operates their own server → their own data privacy responsibility

## Status
- Specification: Complete
- Implementation: Planned (Phase 3)
- Repository: github.com/NeaBouli/ifr-creator-gateway (planned)

---
*As of: March 2026 | IFR Creator Gateway v0.1 Spec*
