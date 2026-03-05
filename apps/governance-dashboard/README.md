# Inferno Governance Dashboard

Read-only governance dashboard for the Inferno ($IFR) protocol.

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
VITE_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
```

## Contracts (Mainnet)

| Contract | Address |
|----------|---------|
| InfernoToken | `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` |
| Governance | `0xc43d48E7FDA576C5022d0670B652A622E8caD041` |
| IFRLock | `0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb` |
| PartnerVault | `0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D` |

## Legacy: Sepolia Testnet Addresses

| Contract | Sepolia Address |
|----------|----------------|
| InfernoToken | `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4` |
| IFRLock | `0x0Cab0A9440643128540222acC6eF5028736675d3` |
| PartnerVault | `0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39` |
| Governance | `0x6050b22E4EAF3f414d1155fBaF30B868E0107017` |
