# IFR Creator Gateway

YouTube x IFR Lock Bridge — Hybrid Model B

## What Is This?
Open-source bridge for creators who want to offer YouTube Membership AND IFR Lock
as access requirements for premium content.

## Quick Start
```bash
cp .env.example .env
# Configure .env
npm install
npm run dev
# -> http://localhost:3005
```

## Docker
```bash
docker-compose up -d
```

## API Endpoints
- GET /health — Status
- GET /auth/siwe/nonce — SIWE nonce (single-use, 10 min TTL)
- POST /auth/siwe/verify — SIWE signature check -> JWT (canonical wallet auth)
- GET /auth/google — Google OAuth start (server-side one-time state bound to an
  HttpOnly/SameSite=Lax initiator cookie, Secure in production; send a SIWE
  bearer token to link a wallet — ?wallet= is rejected as untrusted input)
- GET /auth/google/callback — OAuth callback -> JWT (requires the matching
  initiator cookie; minimal claims; YouTube tokens stay server-side)
- GET /access/check — Entitlement check (auth required)

## Entitlement Logic
- OR: YouTube Member OR IFR Lock >= minIFR
- AND: YouTube Member AND IFR Lock >= minIFR
- Configurable via src/services/entitlement.ts
