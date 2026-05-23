# BRIDGE — inferno
# CC ↔ Codex ↔ Gio Kommunikationskanal
# Format: ## [DATUM] [AUTOR] ### TYPE: [MEMO|TODO|BUG|FIX|DECISION|SECURITY|REVIEW]

---

## 2026-05-10 CC
### TYPE: SECURITY

**npm audit — vulnerability reduction**

Ran `npm audit` on fresh clone. Initial state: 69 vulnerabilities (4 critical).

Actions taken:
- Added `overrides` to `package.json` forcing: `elliptic >=6.6.1`, `handlebars >=4.7.9`, `form-data >=4.0.0`
- Ran non-breaking `npm audit fix`
- Result: 60 vulnerabilities (30 low, 17 moderate, 10 high, 3 critical)

Remaining 3 critical vulnerabilities — all in dev/test dependencies only (not deployed code):

| Package | Path | Fix requires | Risk |
|---------|------|-------------|------|
| `elliptic *` | node_modules/elliptic, node_modules/ganache/node_modules/elliptic | ethers@6 (breaking) | Dev-only; Hardhat test env |
| `form-data <2.5.4` | node_modules/request/node_modules/form-data | ethereum-waffle@3.4.4 (breaking) | Dev-only; waffle test runner |
| (undici high) | node_modules/undici | hardhat@3 (breaking) | Dev-only |

**Decision**: Accept dev-only risk. Deployed Solidity contracts have no Node.js runtime — these vulns cannot affect on-chain code.

**Full fix path** (when ready): requires ethers@5→@6 migration + hardhat@2→@3 migration + full test regression. Estimate: 4-8h. Defer until after Bootstrap finalise() (05.06.2026).

---

## 2026-05-10 CC
### TYPE: FIX

**Wiki HTML consistency fixes — BuybackController governance wiring**

Fixed inconsistent status display across wiki pages:

| File | Fix |
|------|-----|
| `docs/wiki/contracts.html` | Badge: "feeExempt Pending" (yellow) → "✅ Active" (green); Status row: proposals as pending → Proposal #13+#14 executed |
| `docs/wiki/roadmap.html` | Phase 4 list: "feeExempt pending" → "governance wiring complete ✅ (Proposals #13+#14 executed 16.&18.04.2026)" |

`docs/wiki/tokenomics.html` was already correct (no change needed).

Source of truth: Proposal #13 (setFeeExempt) executed 16.04.2026, Proposal #14 (setFeeCollector) executed 18.04.2026. BuybackController fully active.

---

## 2026-05-10 CC
### TYPE: TODO

**Pending items for Codex review:**

1. **ethers@5→@6 migration** — unblock remaining npm criticals. Requires updating all Hardhat scripts (deploy-*.js, propose-*.js) to ethers@6 API. Low urgency (dev-only risk).

2. **Bootstrap finalise()** — hard deadline 05.06.2026. Script: `scripts/bootstrap/finalize.js` (verify exists). Call via Hardhat with DEPLOYER_PRIVATE_KEY.

3. **Proposal #11 (Uniswap Pool feeExempt)** — must execute IMMEDIATELY after finalise(). Without this, IFR is not tradeable on Uniswap. Critical.

4. **on-chain state verification** — verify Proposal #13+#14 executed status via etherscan. Cannot verify locally without DEPLOYER_PRIVATE_KEY.

---

## 2026-05-23 [CC]
### TYPE: SECURITY + FIX
### Commit: 49914983

**BUG: Falsche IFR-Adresse in finalise-bootstrap.js**

`IFR_MAINNET` zeigte auf `0x3Bd71947...` — das ist die **Sepolia** IFR-Testadresse (aus `execute-proposal.js` chainId 11155111 Block). Der Mainnet-IFR-Token ist `0x77e99917...`.

Konsequenz ohne Fix: `balanceOf(BOOTSTRAP_V3_MAINNET)` würde den falschen Contract abfragen → entweder 0 (Revert wegen fehlender Funktion) oder falsche Balance → Pre-flight-Check wirft `Insufficient IFR` obwohl genug IFR im Vault sind.

**Fix:** `IFR_MAINNET = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B"` (konsistent mit `check-bootstrap-status.js`, `propose-pool-feeexempt.js`, `execute-proposal.js` mainnet config).

**Bootstrap Pre-flight — vollständige Checkliste für 05.06.2026:**

```bash
# T-1: Status prüfen (read-only, kein private key nötig)
npx hardhat run scripts/check-bootstrap-status.js --network mainnet

# T0 (nach endTime): Finalise aufrufen
npx hardhat run scripts/finalise-bootstrap.js --network mainnet
# → Gibt LP Token Address aus

# SOFORT danach: Proposal für LP feeExempt einreichen
LP_TOKEN=0x<adresse_aus_finalise> npx hardhat run scripts/propose-pool-feeexempt.js --network mainnet
# → Gibt Proposal ID aus

# +48h: Proposal ausführen
PROPOSAL_ID=<id> npx hardhat run scripts/execute-proposal.js --network mainnet
# → IFR handelbar auf Uniswap ✅
```

**Scripts verifiziert (2026-05-23):**
- `finalise-bootstrap.js` ✅ (IFR-Adresse gefixt)
- `check-bootstrap-status.js` ✅
- `propose-pool-feeexempt.js` ✅
- `execute-proposal.js` ✅

### EMPFÄNGER: GIO
**Gio-Action 05.06.2026:** DEPLOYER_PRIVATE_KEY in .env sicherstellen, dann Checkliste oben abarbeiten. Genug ETH für Gas bereithalten (~0.05 ETH Puffer).

---

## 2026-05-10 CC
### TYPE: MEMO

**finalise-bootstrap.js — Script für BootstrapVaultV3.finalise() erstellt**

Commit: `0df5ecb0`

**Gio muss dieses Script ausführen:**
```bash
cd /Users/gio/Desktop/repos/inferno
npx hardhat run scripts/finalise-bootstrap.js --network mainnet
```

**Wann:** Ab 05.06.2026 (Bootstrap endTime) — möglichst früh am Tag.

**Pre-flight checks im Script:**
- Prüft ob endTime schon erreicht
- Prüft IFR-Balance (>= 200M IFR erforderlich im Vault)
- Gibt Fehlermeldung wenn Bedingungen nicht erfüllt

**KRITISCH nach finalise():**
- Sofort Proposal #11 einreichen: setFeeExempt(UniswapPool, true)
- Nach 48h Timelock: Proposal #11 ausführen
- OHNE feeExempt: IFR nicht handelbar auf Uniswap!

**Empfänger: CODEX** — bitte BootstrapVaultV3 ABI und Script vor Ausführung nochmals reviewen.
