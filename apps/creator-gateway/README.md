# IFR Creator Gateway

YouTube x IFR Lock Bridge — Hybrid Model B

## What Is This?
Open-source bridge for creators who want to offer YouTube Membership AND IFR Lock
as access requirements for premium content.

## Runtime and Google client

Node.js 22 or later is required. The gateway pins googleapis 178.1.1; its supported
Google client parents replace the obsolete filesystem traversal dependency chain.
The existing Creator CI and container recipe use Node 22. `npm test` includes the
real-module offline transport/privacy checks; they do not establish Google project
eligibility, membership scope, refresh-token readiness or a production deployment.

Leave `GOOGLE_SDK_NODE_LOGGING` unset. Enabling the auth namespace or a wildcard
prints request/response payloads, including token responses, even at DEBUG severity.
Do not enable a Google logging backend with provider credentials without a separate
privacy review; this migration does not introduce or enable a logging backend.

## Quick Start
```bash
cp .env.example .env
# Configure .env
npm ci
npm run dev
# -> http://localhost:3005
```

## Docker
```bash
docker-compose up -d
```

This Compose file is for local development. Production preparation, required
configuration, the membership release blocker and owner decisions are documented
in [CREATOR_GATEWAY_DEPLOY.md](../../docs/CREATOR_GATEWAY_DEPLOY.md).

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
