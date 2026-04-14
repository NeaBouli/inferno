# inferno — Backlog

## 🔴 Aktiv (diese Session)
- [ ] Wiki: contracts.html — BuybackController Sektion hinzufügen (Mainnet + Sepolia Adressen)
- [ ] Wiki: roadmap.html — BuybackController als deployed markieren, Proposal A/B Timeline
- [ ] Wiki: tokenomics.html — BuybackController Rolle im Fee-Flow dokumentieren
- [ ] Execute Proposal A: setFeeExempt(BuybackController, true) — ~16.04.2026, 07:30 UTC+2

## 🟡 Nächste Session
- [ ] Execute Proposal A nach 48h Timelock (~16.04.2026)
- [ ] Submit Proposal B: setFeeCollector(BuybackController) auf FeeRouterV1 (nach Execute A)
- [ ] Execute Proposal B nach 48h Timelock (~18.04.2026)
- [ ] npm audit: 34 vulnerabilities fixen (2 critical)
- [ ] .env cleanup (DEPLOYER_PRIVATE_KEY Konsistenz)

## 🟢 Irgendwann / Ideas
- [ ] Bootstrap finalise() aufrufen (05.06.2026)
- [ ] Proposal #13: Uniswap Pool feeExempt (SOFORT nach finalise!)
- [ ] CoinGecko / CoinMarketCap Listing
- [ ] Professional Security Audit

## ✅ Erledigt
- [x] BuybackController deployed + verified Mainnet (14.04.2026) — `0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c`
- [x] BuybackController deployed + verified Sepolia (13.04.2026) — `0xaA1496133B6c274190A2113410B501C5802b6fCF`
- [x] Proposal A submitted: setFeeExempt(BuybackController, true) — 3/5 Signaturen, 48h Timelock
- [x] BuybackController BC-1: Slippage Protection (minIFR/minETH statt 0)
- [x] BuybackController BC-2: Exact approve statt unbegrenzt
- [x] PRIVATE_KEY → DEPLOYER_PRIVATE_KEY Konsistenz
- [x] propose_7.js + propose_8.js gefixt
- [x] deploy-buyback-controller.js erstellt
- [x] propose-buyback-wiring.js erstellt
- [x] docs/safe-proposal-a.json erstellt
- [x] Security Audit alle 10 Repos ✓ (Gitleaks, Workflows)
- [x] Proposals #11+#12: feeExempt(CV+LV) — EXECUTED 06.04.2026

---
*Zuletzt aktualisiert: 2026-04-14*
