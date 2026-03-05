# GitHub Actions — Required Secrets

These secrets must be configured in GitHub Repository Settings →
Secrets and Variables → Actions.

## Repository Secrets

### Required for CI/CD

| Secret Name | Description | Where to Generate |
|-------------|-------------|-------------------|
| SEPOLIA_RPC_URL | Alchemy/Infura Sepolia RPC | https://alchemy.com |
| DEPLOYER_PRIVATE_KEY | Deployer wallet private key | MetaMask Export |

### For Apps (when deployed)

| Secret Name | App | Description |
|-------------|-----|-------------|
| ANTHROPIC_API_KEY | AI Copilot | https://console.anthropic.com |
| RAILWAY_TOKEN | Points Backend | https://railway.app/account/tokens |
| VERCEL_TOKEN | AI Copilot Frontend | https://vercel.com/account/tokens |
| VERCEL_ORG_ID | AI Copilot Frontend | vercel env ls |
| VERCEL_PROJECT_ID | AI Copilot Frontend | vercel env ls |

## Setup Instructions

1. GitHub Repo → Settings → Secrets and Variables → Actions
2. "New repository secret"
3. Enter name and value
4. Save

## Security Rules

- DEPLOYER_PRIVATE_KEY: ONLY testnet deployer (no mainnet key in CI!)
- For mainnet: separate CI wallet with minimal balance
- Rotate all keys regularly
- NEVER commit secrets to code

## Workflows That Require Secrets

| Workflow | Secrets |
|----------|---------|
| update-stats.yml | SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY |
| post-deploy.yml | SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY |
| ci.yml | None (tests only) |
| creator-gateway.yml | None (tests only) |
| points-backend.yml | None (tests only) |

## GitHub Environments (for Mainnet)

For mainnet: set up GitHub Environments:
- Environment: "testnet" — no protection rule
- Environment: "mainnet" — required reviewers (2+), wait timer (5 min)

---
*As of: March 2026*
