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

   ```
   BUILDER_REGISTRY_ADDR = 0x[contract_address]
   ```

2. Configure `BUILDER_REGISTRY_ADDR` on the retained Data API service (`apps/data-api`) through the authorized operator.
3. Release the reviewed service under the Compose release gate.
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

### Registry administration and enumeration

The ownership line above records the Mainnet Governance/TreasurySafe arrangement in the
14 September 2026 audit snapshot; it is not a fresh ownership read. The constructor accepts any
nonzero owner address without checking Governance identity.

The source and committed ABI expose five owner-only mutations: `registerBuilder`,
`removeBuilder`, `updateBuilder`, inherited `transferOwnership` and `renounceOwnership`.
Governance can administer records while it owns the registry, but cannot upgrade its code.
There is no proxy or upgrade entry point; a code change requires a new deployment and migration.
The Governance proposal delay applies only while Governance remains owner. The registry itself
has no delay: ownership transfer is single-step to any nonzero address; renunciation sets owner
to zero and permanently disables administration without deleting records.

Removal retains metadata and list entries. Re-registration appends the wallet again, so the
`/api/builders/count` result and `getBuilderCount()` count registration entries, not unique wallets,
and `getActiveBuilders()` can return duplicates. Consumers should deduplicate lists and use
`isBuilder(wallet)` for membership.

The ABI names listed in the earlier checklist above are obsolete. The current ABI exposes
`isBuilder(address)`, `getBuilderInfo(address)` (name, URL, category, registration time, active flag)
and `getBuilderCount()`; it has no `isRegistered`, `getBuilder` or `builderCount` function.
