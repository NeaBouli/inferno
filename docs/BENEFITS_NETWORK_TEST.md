# Benefits Network — Test Guide

## Quick Start (Local)

```bash
# Start backend
cd apps/benefits-network/backend
cp .env.example .env
npm install && npm run dev

# Start frontend (new terminal)
cd apps/benefits-network/frontend
npm install && npm run dev

# Run E2E test (new terminal)
bash apps/benefits-network/backend/scripts/e2e-test.sh
```

## Sepolia Test Prerequisites

- Sepolia ETH available (for gas)
- At least 1,000 IFR on Sepolia (Bronze Tier)
- IFR Token added to MetaMask:
  - Address: `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4`
  - Decimals: **9** (not 18!)
  - Symbol: IFR
- `IFRLOCK_ADDRESS` configured in backend `.env`

## Test Flow (Manual)

1. Start backend + frontend (see Quick Start)
2. Browser: `http://localhost:3000/b/{businessId}` (Merchant Console)
3. "Start Verification" → QR code appears
4. Wallet app → Scan QR → Sign
5. Merchant screen shows: APPROVED or DENIED
6. Optional: "Redeem" → Status changes to REDEEMED

## E2E Test Script

The script (`apps/benefits-network/backend/scripts/e2e-test.sh`) runs automatically:

1. Health Check (`GET /health`)
2. Create Business (`POST /api/admin/businesses`)
3. Start QR Session (`POST /api/verification/start`)
4. Check Session Status (`GET /api/verification/status/:id`)

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3001` | Backend URL |
| `ADMIN_SECRET` | from `.env` | Admin token for business creation |

## Lock Tiers

| Tier | Minimum Lock | Typical Discount |
|------|-------------|-----------------|
| Bronze | 1,000 IFR | 5-10% |
| Silver | 5,000 IFR | 10-15% |
| Gold | 25,000 IFR | 15-25% |
| Diamond | 100,000 IFR | 25%+ |

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `isLocked returns false` | IFR not locked | Call `IFRLock.lock(amount)` |
| `Decimals error` | 18 instead of 9 | Use `parseUnits(x, 9)` |
| `Session expired` | >60s elapsed | Start a new session |
| `Invalid signature` | Wrong chain | Switch to Sepolia (11155111) |
| `ADMIN_SECRET mismatch` | `.env` not configured | Set `ADMIN_SECRET` in `.env` |

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | - | Health check |
| POST | `/api/admin/businesses` | Admin | Create business |
| GET | `/api/admin/businesses` | Admin | List all businesses |
| POST | `/api/verification/start` | - | Start QR session |
| GET | `/api/verification/status/:id` | - | Session status |
| POST | `/api/verification/verify` | - | Verify wallet + signature |
| POST | `/api/verification/redeem/:id` | - | Redeem session |

---
*As of: February 2026 | Version 1.0*
