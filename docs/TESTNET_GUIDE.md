# IFR Testnet Integration Guide — Sepolia

Step-by-step guide for builders and developers to test the full IFR
integration on Sepolia. Mainnet was deployed on 2026-03-05 — see
[DEPLOYMENTS.md](DEPLOYMENTS.md) for mainnet addresses.

---

## Contract Addresses (Sepolia)

| Contract | Address | Etherscan |
|----------|---------|-----------|
| IFRToken | `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4` | [View](https://sepolia.etherscan.io/address/0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4) |
| IFRLock | `0x0Cab0A9440643128540222acC6eF5028736675d3` | [View](https://sepolia.etherscan.io/address/0x0Cab0A9440643128540222acC6eF5028736675d3) |
| PartnerVault | `0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39` | [View](https://sepolia.etherscan.io/address/0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39) |
| Governance | `0x6050b22E4EAF3f414d1155fBaF30B868E0107017` | [View](https://sepolia.etherscan.io/address/0x6050b22E4EAF3f414d1155fBaF30B868E0107017) |
| FeeRouterV1 | `0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4` | [View](https://sepolia.etherscan.io/address/0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4) |

Network: **Sepolia Testnet** | Chain ID: **11155111** | Token Decimals: **9**

---

## Prerequisites

- [ ] MetaMask installed (or another EIP-1193 wallet)
- [ ] Sepolia ETH available (Faucet: https://sepoliafaucet.com)
- [ ] Node.js >= 18 installed
- [ ] Repo cloned: `git clone https://github.com/NeaBouli/inferno`
- [ ] Dependencies: `npm install`
- [ ] `.env` configured (see `.env.example`)

---

## Step 1: Add IFR Token to MetaMask

1. Open MetaMask -> "Import Token"
2. Token Contract Address: `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4`
3. Symbol: `IFR`
4. **Decimals: 9** — critical, not 18!
5. "Save" -> IFR appears in your wallet

**Wrong decimals (18 instead of 9) = all amounts off by a factor of 10^9.**

---

## Step 2: Obtain Test IFR

Option A — Script:
```bash
cd /Users/gio/Desktop/Inferno
npx hardhat run scripts/mint-test-tokens.js --network sepolia
# Sends test IFR to your wallet (testnet only)
```

Option B — Directly via Etherscan:
1. Open IFRToken on Sepolia Etherscan
2. "Write Contract" -> connect wallet
3. `transfer()` from deployer (if you have access)

---

## Step 3: Lock IFR

### Via Script:
```bash
# Lock 5,000 IFR (Gold Tier)
npx hardhat run scripts/lock-tokens.js --network sepolia
# Script asks: Amount? -> 5000
```

### Via Etherscan (manual):
1. IFRLock Contract -> "Write Contract"
2. Function: `lock(uint256 amount)`
3. Amount: `5000000000000` (= 5,000 IFR x 10^9)
4. Confirm transaction

### Verification:
```bash
npx hardhat run scripts/check-lock.js --network sepolia
# Output: Locked: 5000.0 IFR | isLocked(5000): true
```

---

## Step 4: Check Lock Status (isLocked)
```javascript
// check-lock.js (or directly in Node REPL)
const { ethers } = require("ethers");

const provider = new ethers.providers.JsonRpcProvider(process.env.SEPOLIA_RPC);
const ifrLock = new ethers.Contract(
  "0x0Cab0A9440643128540222acC6eF5028736675d3",
  ["function isLocked(address, uint256) view returns (bool)",
   "function lockedAmount(address) view returns (uint256)"],
  provider
);

const wallet = "0xYOUR_WALLET_ADDRESS";
const amount = ethers.utils.parseUnits("5000", 9);

const locked = await ifrLock.isLocked(wallet, amount);
const total = await ifrLock.lockedAmount(wallet);

console.log("isLocked(5000):", locked);        // true
console.log("Total locked:", ethers.utils.formatUnits(total, 9), "IFR");
```

---

## Step 5: Test Benefits Network (QR Flow)

### Start backend:
```bash
cd apps/benefits-network/backend
cp .env.example .env
# .env: CHAIN_ID=11155111, IFRLOCK_ADDRESS=0x0Cab0A..., RPC_URL=SEPOLIA_RPC
npm install && npm run dev
# Backend runs on port 3001
```

### Start frontend:
```bash
cd apps/benefits-network/frontend
npm install && npm run dev
# Frontend runs on port 3000
```

### Create test business:
```bash
curl -X POST http://localhost:3001/api/admin/businesses \
  -H "Authorization: Bearer test-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Business Sepolia",
    "discountPercent": 15,
    "requiredLockIFR": 1000,
    "tierLabel": "Bronze"
  }'
# -> returns businessId
```

### Test QR flow:
1. Browser: `http://localhost:3000/b/{businessId}`
2. "Start verification" -> QR code appears
3. Phone: Scan QR -> WalletConnect -> sign
4. Merchant sees: **APPROVED** (green screen)
5. Click "Redeem" -> Status: REDEEMED

---

## Step 6: Test Governance Dashboard
```bash
cd apps/governance-dashboard
npm run dev
# Dashboard runs at http://localhost:5174
```

What you see:
- **Overview Tab**: PartnerVault balance, RewardBps 15%, TotalSupply
- **Timelock Queue**: Proposals #4-#6 (Pending, Ownership Transfer)
- **Calldata Generator**: Create governance proposals

---

## Step 7: Test Builder Lock Reward (PartnerVault)

This step requires:
- PartnerVault is feeExempt (after Proposal #3)
- A builder is registered in PartnerVault (via Governance)

```bash
# Register builder (Governance Proposal required)
npx hardhat run scripts/propose-create-partner.js --network sepolia

# Execute after 48h:
npx hardhat run scripts/execute-proposal.js --network sepolia

# Record lock reward (as authorizedCaller):
npx hardhat run scripts/record-lock-reward.js --network sepolia
# Args: partnerId, lockAmount, userWallet
```

---

## Step 8: Test FeeRouter

### FeeRouter Contract
- Address: `0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4`
- Etherscan: [View](https://sepolia.etherscan.io/address/0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4)

### Check protocol fee:
```javascript
const { ethers } = require("ethers");

const provider = new ethers.providers.JsonRpcProvider(process.env.SEPOLIA_RPC);
const feeRouter = new ethers.Contract(
  "0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4",
  [
    "function protocolFeeBps() view returns (uint16)",
    "function FEE_CAP_BPS() view returns (uint16)",
    "function paused() view returns (bool)",
    "function feeCollector() view returns (address)",
    "function voucherSigner() view returns (address)",
  ],
  provider
);

const feeBps = await feeRouter.protocolFeeBps();
const cap = await feeRouter.FEE_CAP_BPS();
const isPaused = await feeRouter.paused();

console.log("Protocol Fee:", feeBps.toString(), "bps (", (feeBps / 100).toFixed(2), "%)");
console.log("Fee Cap:", cap.toString(), "bps (", (cap / 100).toFixed(2), "%)");
console.log("Paused:", isPaused);
```

### Expected values:
| Parameter | Value | Meaning |
|-----------|-------|---------|
| protocolFeeBps | 5 | 0.05% protocol fee |
| FEE_CAP_BPS | 25 | 0.25% hard cap (cannot be exceeded) |
| paused | false | Router active |

### Verify EIP-712 voucher:
```javascript
// Check if a voucher is valid (without redeeming it)
const isValid = await feeRouter.isVoucherValid(
  "0xYOUR_WALLET_ADDRESS", // user
  1,                        // nonce
  10,                       // discountBps (0.10%)
  Math.floor(Date.now() / 1000) + 3600 // deadline (1h)
);
console.log("Voucher valid:", isValid);
```

### Governance changes (via Calldata Generator):
In the Governance Dashboard (`http://localhost:5174`) -> Calldata Generator:
- `FeeRouter: setFeeBps(uint16)` — Change protocol fee (0-25 bps)
- `FeeRouter: setAdapter(address, bool)` — Whitelist adapter
- `FeeRouter: setVoucherSigner(address)` — Change voucher signer
- `FeeRouter: setPaused(bool)` — Emergency pause

---

## Step 9: Full Smoke Test (automated)
```bash
cd /Users/gio/Desktop/Inferno
npx hardhat test --network sepolia --grep "smoke"
# Or all tests:
npx hardhat test
```

Expected result: **568 tests passing**

---

## Common Errors

| Error | Cause | Solution |
|-------|-------|---------|
| "insufficient funds" | No Sepolia ETH | Faucet: sepoliafaucet.com |
| Wrong token amount | Decimals 18 instead of 9 | Always use `parseUnits(x, 9)` |
| "execution reverted" | feeExempt not set | Execute Proposal #3 first |
| "Not authorized" | Not an authorizedCaller | setAuthorizedCaller via Governance |
| RPC timeout | Alchemy Free Tier | Use your own RPC key |
| MetaMask "wrong network" | Not on Sepolia | Switch network (Chain ID 11155111) |

---

## Next Steps After Successful Test

Mainnet is deployed (2026-03-05). See:
- [ ] Mainnet deployment details: [DEPLOYMENTS.md](DEPLOYMENTS.md)
- [ ] Security audit: [AUDIT_BRIEF.md](AUDIT_BRIEF.md)
- [ ] Multisig setup: [MULTISIG_SETUP.md](MULTISIG_SETUP.md)
- [ ] Builder integration: [PARTNER_INTEGRATION_SPEC.md](PARTNER_INTEGRATION_SPEC.md)

---
*As of: March 2026 | Sepolia Testnet Guide v1.1*
