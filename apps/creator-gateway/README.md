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
- GET /auth/google?wallet=0x... — Google OAuth start
- GET /auth/google/callback — OAuth callback -> JWT
- POST /auth/wallet — Wallet-only auth -> JWT
- GET /access/check — Entitlement check (auth required)

## Entitlement Logic
- OR: YouTube Member OR IFR Lock >= minIFR
- AND: YouTube Member AND IFR Lock >= minIFR
- Configurable via src/services/entitlement.ts
