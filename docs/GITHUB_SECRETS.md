# GitHub Actions — Required Secrets

Diese Secrets muessen in GitHub Repository Settings →
Secrets and Variables → Actions eingetragen werden.

## Repository Secrets

### Pflicht fuer CI/CD

| Secret Name | Beschreibung | Wo generieren |
|-------------|-------------|---------------|
| SEPOLIA_RPC_URL | Alchemy/Infura Sepolia RPC | https://alchemy.com |
| DEPLOYER_PRIVATE_KEY | Deployer Wallet Private Key | MetaMask Export |

### Fuer Apps (wenn deployed)

| Secret Name | App | Beschreibung |
|-------------|-----|-------------|
| ANTHROPIC_API_KEY | AI Copilot | https://console.anthropic.com |
| RAILWAY_TOKEN | Points Backend | https://railway.app/account/tokens |
| VERCEL_TOKEN | AI Copilot Frontend | https://vercel.com/account/tokens |
| VERCEL_ORG_ID | AI Copilot Frontend | vercel env ls |
| VERCEL_PROJECT_ID | AI Copilot Frontend | vercel env ls |

## Setup Anleitung

1. GitHub Repo → Settings → Secrets and Variables → Actions
2. "New repository secret"
3. Name und Value eintragen
4. Save

## Sicherheits-Regeln

- DEPLOYER_PRIVATE_KEY: NUR Testnet-Deployer (kein Mainnet Key in CI!)
- Fuer Mainnet: separate CI-Wallet mit minimalem Balance
- Alle Keys regelmaessig rotieren
- NIEMALS Secrets in Code committen

## Workflows die Secrets brauchen

| Workflow | Secrets |
|----------|---------|
| update-stats.yml | SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY |
| post-deploy.yml | SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY |
| ci.yml | Keine (nur Tests) |
| creator-gateway.yml | Keine (nur Tests) |
| points-backend.yml | Keine (nur Tests) |

## GitHub Environments (fuer Mainnet)

Vor Mainnet: GitHub Environments einrichten:
- Environment: "testnet" — kein Protection Rule
- Environment: "mainnet" — Required Reviewers (2+), Wait Timer (5 min)

---
*Stand: Februar 2026*
