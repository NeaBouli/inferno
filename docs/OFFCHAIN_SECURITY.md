# Off-Chain Security — IFR Ecosystem

## Overview of Off-Chain Components

| App | Critical Assets | Risk |
|-----|-----------------|------|
| Points Backend | VoucherSigner Private Key | High |
| AI Copilot | ANTHROPIC_API_KEY | Medium |
| Creator Gateway | JWT_SECRET, Google OAuth | Medium |
| Benefits Network | Admin Secret | Medium |

## VoucherSigner Key Management (CRITICAL)

The VoucherSigner Key signs EIP-712 vouchers for FeeRouter.
A compromised key allows arbitrary voucher creation.

### Protective Measures:
- Key ONLY in Railway/Render environment variables
- NEVER committed in .env files (-> .gitignore!)
- Key rotation via Governance: setVoucherSigner(newKey)
- Monitoring: Alert on >100 vouchers/day

### Key Rotation Process:
1. Generate new key
2. Update Points Backend (new signer)
3. Governance Proposal: setVoucherSigner(newKey)
4. 48h Timelock -> Execute
5. Deactivate old key

## JWT Secrets

All JWT secrets must:
- Be at least 32 characters
- Be cryptographically random (not a password!)
- Be different per app
- Be rotated regularly (every 90 days)

Generate: `openssl rand -hex 32`

## SIWE (Sign-In With Ethereum)

Points Backend + Benefits Network use SIWE:
- Nonce is one-time use (replay protection)
- Nonce Expiry: 10 minutes
- Chain ID check: 11155111 (Sepolia) / 1 (Mainnet)
- Domain binding: prevents phishing signature reuse

## Rate Limiting

| App | Limit | Protects Against |
|-----|-------|------------------|
| Points Backend | 60 req/min/IP | Bot farming |
| SIWE Auth | 5 req/hour/IP | Brute force |
| Voucher Issuance | 1/wallet/day | Sybil |
| AI Copilot | 60 req/min/IP | API abuse |
| Creator Gateway | 60 req/min/IP | Scraping |

## Admin Endpoints

All admin endpoints must:
- Use ADMIN_SECRET header auth (at least 32 characters)
- Never be publicly accessible (IP whitelist or VPN)
- Log all actions with timestamp

## Secrets Checklist (Mainnet)

- [ ] VoucherSigner Key: Hardware Wallet or HSM
- [ ] All JWT Secrets: 32+ characters, random
- [ ] ANTHROPIC_API_KEY: only in Vercel env
- [ ] Google OAuth Credentials: keep scope minimal
- [ ] ADMIN_SECRET: 32+ characters, never in code
- [ ] Rate Limits: adjust for mainnet load
- [ ] Monitoring: alert on anomalies
- [ ] Key Rotation: process documented

---
*Version 1.0 | March 2026*
