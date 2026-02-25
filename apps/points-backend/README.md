# IFR Points Backend

Points system for Inferno ($IFR) — SIWE authentication, points events, and EIP-712 signed voucher issuance.

## Features

- **SIWE Authentication**: Sign-In with Ethereum — wallet-based auth, JWT sessions
- **Points Events**: Track user actions (wallet connect, guide completion, partner onboarding)
- **Daily Limits**: Per-event-type daily caps to prevent abuse
- **EIP-712 Vouchers**: Signed discount vouchers redeemable on-chain via FeeRouter
- **Anti-Sybil**: Rate limiting per IP + per wallet + global daily caps

## Setup

```bash
cd apps/points-backend
npm install
cp .env.example .env
# Edit .env — set JWT_SECRET and VOUCHER_SIGNER_PRIVATE_KEY
npx prisma migrate dev --name init
npm run dev
```

Server runs on http://localhost:3004

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/siwe/nonce` | No | Generate SIWE nonce |
| POST | `/auth/siwe/verify` | No | Verify SIWE signature, get JWT |
| POST | `/points/event` | JWT | Record a points event |
| GET | `/points/balance` | JWT | Get wallet balance + event history |
| POST | `/voucher/issue` | JWT | Issue signed EIP-712 voucher |
| GET | `/health` | No | Health check |

## Points Events

| Type | Points | Daily Limit |
|------|--------|-------------|
| `wallet_connect` | 10 | 1 |
| `guide_wallet_setup` | 20 | 1 |
| `guide_add_token` | 20 | 1 |
| `guide_lock` | 30 | 1 |
| `partner_onboarding` | 50 | 1 |

**Voucher threshold:** 100 points → 0.15% protocol fee discount (EIP-712 signed)

## Rate Limits

- 10 requests per IP per minute (general)
- 1 SIWE verify per IP per hour
- 1 voucher per wallet per day
- 100 vouchers global daily cap

## Security

- JWT tokens expire after 24h
- SIWE nonces expire after 5 minutes
- EIP-712 voucher signatures are verifiable on-chain
- Voucher signer private key stays server-side (`.env`)
- Rate limiting on all sensitive endpoints

## Tech Stack

- Node.js + Express + TypeScript
- Prisma + SQLite
- ethers.js v5 (EIP-712 signing)
- siwe (Sign-In with Ethereum)
- jose (JWT)

## Environment Variables

| Variable | Description |
|----------|-------------|
| DATABASE_URL | Prisma SQLite path (default: `file:./dev.db`) |
| JWT_SECRET | Secret for JWT signing |
| VOUCHER_SIGNER_PRIVATE_KEY | Private key for EIP-712 voucher signing |
| FEE_ROUTER_ADDRESS | FeeRouter contract address (for EIP-712 domain) |
| CHAIN_ID | Chain ID (default: 11155111 = Sepolia) |
| PORT | Server port (default: 3004) |
| ADMIN_SECRET | Admin API secret (reserved) |
