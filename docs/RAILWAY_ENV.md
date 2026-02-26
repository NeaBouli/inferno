# Points Backend — Railway Environment Variables

Stand: 26. Februar 2026

## Erforderliche Variablen

| Variable | Beispiel | Beschreibung |
|----------|---------|-------------|
| `DATABASE_URL` | `file:./prod.db` | SQLite Pfad (Railway: `file:./prod.db`) |
| `JWT_SECRET` | `<random 32+ chars>` | Signatur fuer SIWE JWT Token |
| `VOUCHER_SIGNER_PRIVATE_KEY` | `0x...` | EIP-712 Voucher Signatur (Deployer Key) |
| `FEE_ROUTER_ADDRESS` | `0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4` | FeeRouterV1 Contract |
| `CHAIN_ID` | `11155111` | Sepolia Testnet (1 fuer Mainnet) |
| `PORT` | `3004` | Server Port |
| `ADMIN_SECRET` | `<secure secret>` | Admin API Auth |

## Railway Setup

```bash
# 1. Railway CLI
npm i -g @railway/cli && railway login

# 2. Link Projekt
cd apps/points-backend
railway link

# 3. Env setzen
railway variables set DATABASE_URL="file:./prod.db"
railway variables set JWT_SECRET="$(openssl rand -hex 32)"
railway variables set CHAIN_ID="11155111"
railway variables set PORT="3004"
# VOUCHER_SIGNER_PRIVATE_KEY und ADMIN_SECRET manuell setzen

# 4. Deploy
railway up
```

## Health Check

```bash
curl https://<railway-url>/health
# → { "status": "ok" }
```

## Sicherheit

- `VOUCHER_SIGNER_PRIVATE_KEY` **NIEMALS** committen
- `JWT_SECRET` muss unique pro Environment sein
- `ADMIN_SECRET` fuer Admin-only Endpoints

---
*Siehe auch: apps/points-backend/DEPLOY.md*
