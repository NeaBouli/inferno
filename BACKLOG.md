# inferno — Backlog

## 🔴 Aktiv (diese Session)
- [ ] Bootstrap finalise() aufrufen — **Deadline: 05.06.2026** (26 Tage!) — Script: `scripts/finalise-bootstrap.js`
- [ ] Proposal #11 (Uniswap Pool feeExempt) — SOFORT nach finalise() ausführen!
- [ ] npm audit: ethers@5→@6 Migration für restliche 3 criticals (dev-only)

## 🟡 Nächste Session
- [ ] .env cleanup (DEPLOYER_PRIVATE_KEY Konsistenz prüfen)
- [ ] CoinGecko / CoinMarketCap Listing vorbereiten
- [ ] Professional Security Audit beauftragen

## 🟢 Irgendwann / Ideas
- [ ] Proposal #12: Contributor locks 100M IFR in CommitmentVault
- [ ] First Builder loans via LendingVault
- [ ] DAO Governance Übergang (2027+)

## ✅ Erledigt
- [x] BuybackController deployed + verified Mainnet (14.04.2026) — `0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c`
- [x] BuybackController deployed + verified Sepolia (13.04.2026) — `0xaA1496133B6c274190A2113410B501C5802b6fCF`
- [x] Proposal A submitted: setFeeExempt(BuybackController, true) — 3/5 Signaturen, 48h Timelock
- [x] Proposal #13 (setFeeExempt BuybackController) — EXECUTED 16.04.2026
- [x] Proposal #14 (setFeeCollector → BuybackController) — EXECUTED 18.04.2026
- [x] BuybackController governance wiring complete — fully active ✅
- [x] BuybackController BC-1: Slippage Protection (minIFR/minETH statt 0)
- [x] BuybackController BC-2: Exact approve statt unbegrenzt
- [x] PRIVATE_KEY → DEPLOYER_PRIVATE_KEY Konsistenz
- [x] propose_7.js + propose_8.js gefixt
- [x] deploy-buyback-controller.js erstellt
- [x] propose-buyback-wiring.js erstellt
- [x] docs/safe-proposal-a.json erstellt
- [x] Security Audit alle 10 Repos ✓ (Gitleaks, Workflows)
- [x] Proposals #11+#12: feeExempt(CV+LV) — EXECUTED 06.04.2026
- [x] npm audit: 69→60 vulnerabilities (overrides + non-breaking fix, 2026-05-10)
- [x] Wiki: contracts.html — BuybackController Status auf Active ✅
- [x] Wiki: roadmap.html — BuybackController governance wiring dokumentiert
- [x] Wiki: tokenomics.html — BuybackController fee-flow bereits korrekt
- [x] scripts/finalise-bootstrap.js — erstellt 2026-05-10 (pre-flight checks, gas estimate, critical warnings)
- [x] scripts/propose-pool-feeexempt.js — erstellt 2026-05-10 (LP_TOKEN env var → Proposal #11)

---
*Zuletzt aktualisiert: 2026-05-10*
