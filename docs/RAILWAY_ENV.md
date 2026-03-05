# Points Backend — Railway Environment Variables

As of: March 2026

## Required Variables

| Variable | Example | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `file:./prod.db` | SQLite path (Railway: `file:./prod.db`) |
| `JWT_SECRET` | `<random 32+ chars>` | Signature for SIWE JWT token |
| `VOUCHER_SIGNER_PRIVATE_KEY` | `0x...` | EIP-712 voucher signature (Deployer Key) |
| `FEE_ROUTER_ADDRESS` | `0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a` | FeeRouterV1 Contract (Mainnet) |
| `CHAIN_ID` | `1` | Ethereum Mainnet (11155111 for Sepolia) |
| `PORT` | `3004` | Server port |
| `ADMIN_SECRET` | `<secure secret>` | Admin API auth |

## Railway Setup

```bash
# 1. Railway CLI
npm i -g @railway/cli && railway login

# 2. Link project
cd apps/points-backend
railway link

# 3. Set env variables
railway variables set DATABASE_URL="file:./prod.db"
railway variables set JWT_SECRET="$(openssl rand -hex 32)"
railway variables set CHAIN_ID="1"
railway variables set PORT="3004"
# VOUCHER_SIGNER_PRIVATE_KEY and ADMIN_SECRET must be set manually

# 4. Deploy
railway up
```

## Health Check

```bash
curl https://<railway-url>/health
# -> { "status": "ok" }
```

## Security

- `VOUCHER_SIGNER_PRIVATE_KEY` **NEVER** commit
- `JWT_SECRET` must be unique per environment
- `ADMIN_SECRET` for admin-only endpoints

---
*See also: apps/points-backend/DEPLOY.md*
