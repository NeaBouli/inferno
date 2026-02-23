# IFR Benefits Network — Backend

Verification backend for the IFR Benefits Network. Enables any business to verify customer IFR lock status on-chain and grant discounts/premium access.

## Quick Start

```bash
npm install
cp .env.example .env   # edit with your values
npx prisma generate && npx prisma migrate dev
npm run dev            # http://localhost:3001
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CHAIN_ID` | Ethereum chain ID | `11155111` (Sepolia) |
| `RPC_URL` | JSON-RPC endpoint | required |
| `IFRLOCK_ADDRESS` | IFRLock contract address | required |
| `ADMIN_SECRET` | Bearer token for /api/admin/* | required |
| `DATABASE_URL` | Prisma database URL | `file:./dev.db` |
| `PORT` | Server port | `3001` |

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/admin/businesses` | Admin | Create business |
| PATCH | `/api/admin/businesses/:id` | Admin | Update business |
| GET | `/api/businesses/:id` | Public | Get business info |
| POST | `/api/sessions` | Public | Start verification session |
| GET | `/api/sessions/:id` | Public | Poll session status |
| GET | `/api/sessions/:id/challenge` | Public | Get signature challenge |
| POST | `/api/attest` | Public | Submit signature + verify |
| POST | `/api/sessions/:id/redeem` | Public | Mark session as redeemed |

## Session Flow

1. Merchant creates session → gets QR code URL
2. Customer scans QR → connects wallet → signs challenge
3. Backend verifies signature → checks IFRLock on-chain
4. Merchant sees APPROVED → presses Redeem (one-time)

## Tests

```bash
npm test   # 8 tests: signature, expiry, replay, redeem, threshold, rate-limit
```

## Security

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for the full threat model.
