# BuilderRegistry Deployment Checklist

## Status: DEPLOYED (Sepolia + Mainnet) — 20.03.2026

| Network | Address | Etherscan |
|---------|---------|-----------|
| Mainnet | `0xdfe6636DA47F8949330697e1dC5391267CEf0EE3` | [Verified](https://etherscan.io/address/0xdfe6636DA47F8949330697e1dC5391267CEf0EE3#code) |
| Sepolia | `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` | [Verified](https://sepolia.etherscan.io/address/0x77e99917Eca8539c62F509ED1193ac36580A6e7B#code) |

**Owner:** Governance (0xc43d...D041) → TreasurySafe 3-of-5

### Contract
- **Source:** `contracts/BuilderRegistry.sol`
- **Tests:** `test/BuilderRegistry.test.js` (27/27 passing)
- **ABI:** `abi/BuilderRegistry.json`

---

### Prerequisites
- [x] Core Dev deploys BuilderRegistry.sol on Sepolia ✅ (20.03.2026)
- [ ] Audit completed
- [x] Core Dev deploys BuilderRegistry.sol on Mainnet ✅ (20.03.2026)
- [x] Etherscan verification ✅

### After Mainnet Deploy
1. Copy contract address from Etherscan
2. Railway → ifr-ai-copilot Service → Variables:
   ```
   BUILDER_REGISTRY_ADDR = 0x[contract_address]
   ```
3. Railway redeploys automatically
4. Verify: `GET /api/builders/count` → returns `{ "count": 0 }`
5. Verify: `GET /api/builders/check/0x...` → returns `{ "address": "0x...", "isBuilder": false }`

### Telegram Bot
Already integrated in `apps/telegram/telegram-bot/src/services/onChainReader.js`:
- Set `BUILDER_REGISTRY_ADDR` env var in Railway telegram-bot service
- Bot uses `isBuilderOnChain()` for Tier 3 (Dev & Builder topic access)

### API Endpoints (active after env var set)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/builders/check/:address` | GET | Check if address is registered builder |
| `/api/builders/count` | GET | Get total registered builder count |

### ABI Functions Used
- `isRegistered(address) → bool`
- `getBuilder(address) → (string, string, uint256)`
- `builderCount() → uint256`
