# IFR Lock — Developer Quickstart

Integrate IFR Lock verification into your product in under 30 minutes.

---

## 1. Contract Addresses

| Network | Contract | Address |
|---------|----------|---------|
| Sepolia (Testnet) | IFRToken | `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4` |
| Sepolia (Testnet) | IFRLock | `0x0Cab0A9440643128540222acC6eF5028736675d3` |
| Mainnet | IFRToken | `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` |
| Mainnet | IFRLock | `0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb` |

Token Decimals: **9**

---

## 2. Minimal ABI (read-only)
```javascript
const IFRLOCK_ABI = [
  "function isLocked(address user, uint256 minAmount) external view returns (bool)",
  "function lockedAmount(address user) external view returns (uint256)",
  "function totalLocked() external view returns (uint256)"
];

const IFRTOKEN_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
  "function decimals() external view returns (uint8)"
];
```

---

## 3. Basic Integration (ethers.js v5)
```javascript
import { ethers } from "ethers";

const IFRLOCK_ADDRESS = "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb"; // Mainnet
const IFRLOCK_ABI = ["function isLocked(address, uint256) view returns (bool)"];

// Provider (read-only, no wallet needed)
const provider = new ethers.providers.JsonRpcProvider(
  "https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"
);

const ifrLock = new ethers.Contract(IFRLOCK_ADDRESS, IFRLOCK_ABI, provider);

// Check if user has 5,000 IFR locked (Gold Tier)
async function checkAccess(userWallet) {
  const minAmount = ethers.utils.parseUnits("5000", 9); // 9 decimals
  const hasAccess = await ifrLock.isLocked(userWallet, minAmount);
  return hasAccess;
}
```

---

## 4. Backend Integration (Node.js + Express)
```javascript
import express from "express";
import { ethers } from "ethers";

const app = express();

const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const ifrLock = new ethers.Contract(
  process.env.IFRLOCK_ADDRESS,
  ["function isLocked(address, uint256) view returns (bool)"],
  provider
);

// Middleware: IFR Lock Check
export async function requireIFRLock(minIFR = 1000) {
  return async (req, res, next) => {
    const wallet = req.headers["x-wallet-address"];
    if (!wallet || !ethers.utils.isAddress(wallet)) {
      return res.status(401).json({ error: "Valid wallet address required" });
    }
    const minAmount = ethers.utils.parseUnits(String(minIFR), 9);
    const locked = await ifrLock.isLocked(wallet, minAmount);
    if (!locked) {
      return res.status(403).json({
        error: "Insufficient IFR locked",
        required: minIFR,
        unit: "IFR"
      });
    }
    req.wallet = wallet;
    next();
  };
}

// Example route — Gold Tier only (5,000 IFR)
app.get("/premium/content", requireIFRLock(5000), (req, res) => {
  res.json({ content: "Premium content for IFR holders" });
});
```

---

## 5. Frontend Integration (React + wagmi v2)
```typescript
import { useReadContract } from "wagmi";
import { parseUnits } from "viem";

const IFRLOCK_ABI = [
  {
    name: "isLocked",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "minAmount", type: "uint256" }
    ],
    outputs: [{ type: "bool" }]
  }
] as const;

export function useIFRAccess(userAddress: string, minIFR: number) {
  return useReadContract({
    address: IFRLOCK_ADDRESS,
    abi: IFRLOCK_ABI,
    functionName: "isLocked",
    args: [userAddress as `0x${string}`, parseUnits(String(minIFR), 9)],
    query: { enabled: !!userAddress }
  });
}

// Usage in component:
function PremiumFeature({ userAddress }) {
  const { data: hasAccess, isLoading } = useIFRAccess(userAddress, 5000);

  if (isLoading) return <div>Checking access...</div>;
  if (!hasAccess) return <div>Lock 5,000 IFR for access</div>;
  return <div>Premium content</div>;
}
```

---

## 6. Python Integration
```python
from web3 import Web3

RPC_URL = "https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"
IFRLOCK_ADDRESS = "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb"  # Mainnet
IFRLOCK_ABI = [
    {
        "name": "isLocked",
        "type": "function",
        "stateMutability": "view",
        "inputs": [
            {"name": "user", "type": "address"},
            {"name": "minAmount", "type": "uint256"}
        ],
        "outputs": [{"type": "bool"}]
    }
]

w3 = Web3(Web3.HTTPProvider(RPC_URL))
ifr_lock = w3.eth.contract(
    address=Web3.to_checksum_address(IFRLOCK_ADDRESS),
    abi=IFRLOCK_ABI
)

def check_ifr_access(wallet: str, min_ifr: int = 5000) -> bool:
    """Check if wallet has min_ifr IFR locked. IFR has 9 decimals."""
    min_amount = min_ifr * 10**9
    return ifr_lock.functions.isLocked(
        Web3.to_checksum_address(wallet),
        min_amount
    ).call()

# Usage:
if check_ifr_access("0xUserWallet...", min_ifr=5000):
    print("Access granted")
```

---

## 7. Tier System Example
```javascript
const TIERS = {
  bronze:   { minIFR: 1000,  label: "Bronze",   discount: 5  },
  silver:   { minIFR: 2500,  label: "Silver",   discount: 10 },
  gold:     { minIFR: 5000,  label: "Gold",     discount: 15 },
  platinum: { minIFR: 10000, label: "Platinum", discount: 20 }
};

async function getUserTier(wallet) {
  const amount = await ifrLock.lockedAmount(wallet);
  const ifr = parseFloat(ethers.utils.formatUnits(amount, 9));

  if (ifr >= TIERS.platinum.minIFR) return TIERS.platinum;
  if (ifr >= TIERS.gold.minIFR)     return TIERS.gold;
  if (ifr >= TIERS.silver.minIFR)   return TIERS.silver;
  if (ifr >= TIERS.bronze.minIFR)   return TIERS.bronze;
  return null; // no tier
}
```

---

## 8. Wallet Signature Verification (Anti-Spoofing)
```javascript
// User must prove wallet ownership — not just know the address

// Frontend: User signs
const message = `IFR Access Verification\nWallet: ${wallet}\nTimestamp: ${Date.now()}`;
const signature = await signer.signMessage(message);

// Backend: Verify signature
import { ethers } from "ethers";

function verifyWalletOwnership(message, signature, expectedWallet) {
  const recovered = ethers.utils.verifyMessage(message, signature);
  return recovered.toLowerCase() === expectedWallet.toLowerCase();
}
```

---

## 9. Error Handling
```javascript
async function safeCheckAccess(wallet, minIFR) {
  try {
    if (!ethers.utils.isAddress(wallet)) {
      return { access: false, error: "Invalid wallet address" };
    }
    const minAmount = ethers.utils.parseUnits(String(minIFR), 9);
    const locked = await ifrLock.isLocked(wallet, minAmount);
    return { access: locked, error: null };
  } catch (err) {
    console.error("IFR check failed:", err.message);
    // Fail closed: no access on RPC error
    return { access: false, error: "RPC error — try again" };
  }
}
```

---

## 10. Checklist Before Go-Live

- [ ] RPC_URL set to Mainnet (not Sepolia)
- [ ] IFRLOCK_ADDRESS correct (`0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb`)
- [ ] Decimals = 9 correct everywhere (not 18!)
- [ ] Wallet Signature Verification enabled (anti-spoofing)
- [ ] Fail-closed on RPC error (no access on failure)
- [ ] Rate limiting on check endpoint (max 10 req/min per IP)
- [ ] Tier thresholds documented and communicated

---

## 11. Support & Links

| | |
|-|-|
| Builder Integration Spec | [docs/PARTNER_INTEGRATION_SPEC.md](PARTNER_INTEGRATION_SPEC.md) |
| Builder Onboarding | [docs/BUSINESS_ONBOARDING.md](BUSINESS_ONBOARDING.md) |
| Contract ABI (complete) | [docs/PARTNER_INTEGRATION_SPEC.md](PARTNER_INTEGRATION_SPEC.md) |
| GitHub | https://github.com/NeaBouli/inferno |
| Docs | https://ifrunit.tech/wiki/ |

---
*As of: March 2026 | IFR SDK Quickstart v1.1*
