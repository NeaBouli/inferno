# BuilderRegistry Deployment Checklist

## Status: WAITING FOR CORE DEV

### Contract
- **Source:** `contracts/BuilderRegistry.sol`
- **Tests:** `test/BuilderRegistry.test.js` (27/27 passing)
- **ABI:** `abi/BuilderRegistry.json`

---

### Prerequisites
- [ ] Core Dev deploys BuilderRegistry.sol on Sepolia
- [ ] Audit completed
- [ ] Core Dev deploys BuilderRegistry.sol on Mainnet
- [ ] Etherscan verification

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
