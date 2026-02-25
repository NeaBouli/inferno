# IFR Creator Gateway

YouTube x IFR Lock Bridge — Hybrid Model B

## Was ist das?
Open-source Bridge fuer Creator, die YouTube Membership UND IFR Lock
als Zugangsvoraussetzung fuer Premium-Content anbieten wollen.

## Quick Start
```bash
cp .env.example .env
# .env konfigurieren
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
- GET /auth/google?wallet=0x... — Google OAuth Start
- GET /auth/google/callback — OAuth Callback -> JWT
- POST /auth/wallet — Wallet-only Auth -> JWT
- GET /access/check — Entitlement Check (Auth required)

## Entitlement Logic
- OR: YouTube Member OR IFR Lock >= minIFR
- AND: YouTube Member AND IFR Lock >= minIFR
- Konfigurierbar via src/services/entitlement.ts
