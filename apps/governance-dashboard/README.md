# Inferno Governance Dashboard

Read-only governance dashboard for the Inferno ($IFR) protocol on Sepolia testnet.

## Views

| Tab | Description |
|-----|-------------|
| **Overview** | PartnerVault stats (totalRewarded, yearlyEmitted, rewardBps), IFRToken totalSupply, IFRLock totalLocked, algo throttle status |
| **Partners** | Table of all partners from PartnerCreated events with live claimable amounts |
| **Timelock Queue** | Pending governance proposals with countdown timers |
| **Calldata Generator** | Encode function calls for governance proposals with copy-to-clipboard |

## Tech Stack

- React 18 + Vite + TypeScript
- Tailwind CSS
- ethers.js v5 (read-only, no wallet required)

## Setup

```bash
cd apps/governance-dashboard
npm install
npm run dev
# → http://localhost:5174
```

## Environment

```env
VITE_SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
```

## Contracts

| Contract | Sepolia Address |
|----------|----------------|
| InfernoToken | `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4` |
| IFRLock | `0x0Cab0A9440643128540222acC6eF5028736675d3` |
| PartnerVault | `0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39` |
| Governance | `0x6050b22E4EAF3f414d1155fBaF30B868E0107017` |
