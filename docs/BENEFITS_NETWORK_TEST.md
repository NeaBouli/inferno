# Benefits Network — Test Guide

## Schnellstart (Lokal)

```bash
# Backend starten
cd apps/benefits-network/backend
cp .env.example .env
npm install && npm run dev

# Frontend starten (neues Terminal)
cd apps/benefits-network/frontend
npm install && npm run dev

# E2E Test ausfuehren (neues Terminal)
bash apps/benefits-network/backend/scripts/e2e-test.sh
```

## Sepolia Test Voraussetzungen

- Sepolia ETH vorhanden (fuer Gas)
- Mindestens 1,000 IFR auf Sepolia (Bronze Tier)
- IFR Token zu MetaMask hinzugefuegt:
  - Adresse: `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4`
  - Decimals: **9** (nicht 18!)
  - Symbol: IFR
- `IFRLOCK_ADDRESS` konfiguriert in Backend `.env`

## Test-Flow (Manuell)

1. Backend + Frontend starten (siehe Schnellstart)
2. Browser: `http://localhost:3000/b/{businessId}` (Merchant Console)
3. "Verifikation starten" → QR Code erscheint
4. Wallet-App → QR scannen → signieren
5. Merchant-Screen zeigt: APPROVED oder DENIED
6. Optional: "Einloesen" → Status wechselt zu REDEEMED

## E2E Test Script

Das Script (`apps/benefits-network/backend/scripts/e2e-test.sh`) fuehrt automatisiert aus:

1. Health Check (`GET /health`)
2. Business anlegen (`POST /api/admin/businesses`)
3. QR Session starten (`POST /api/verification/start`)
4. Session Status pruefen (`GET /api/verification/status/:id`)

### Konfiguration

| Variable | Default | Beschreibung |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3001` | Backend URL |
| `ADMIN_SECRET` | aus `.env` | Admin-Token fuer Business-Erstellung |

## Lock Tiers

| Tier | Minimum Lock | Typischer Rabatt |
|------|-------------|-----------------|
| Bronze | 1,000 IFR | 5-10% |
| Silver | 5,000 IFR | 10-15% |
| Gold | 25,000 IFR | 15-25% |
| Diamond | 100,000 IFR | 25%+ |

## Haeufige Fehler

| Fehler | Ursache | Fix |
|--------|---------|-----|
| `isLocked returns false` | IFR nicht gesperrt | `IFRLock.lock(amount)` aufrufen |
| `Decimals error` | 18 statt 9 | `parseUnits(x, 9)` verwenden |
| `Session expired` | >60s vergangen | Neue Session starten |
| `Invalid signature` | Falsche Chain | Auf Sepolia (11155111) wechseln |
| `ADMIN_SECRET mismatch` | `.env` nicht konfiguriert | `ADMIN_SECRET` in `.env` setzen |

## API Endpoints

| Method | Path | Auth | Beschreibung |
|--------|------|------|-------------|
| GET | `/health` | - | Health Check |
| POST | `/api/admin/businesses` | Admin | Business anlegen |
| GET | `/api/admin/businesses` | Admin | Alle Businesses |
| POST | `/api/verification/start` | - | QR Session starten |
| GET | `/api/verification/status/:id` | - | Session Status |
| POST | `/api/verification/verify` | - | Wallet + Signatur verifizieren |
| POST | `/api/verification/redeem/:id` | - | Session einloesen |

---
*Stand: Februar 2026 | Version 1.0*
