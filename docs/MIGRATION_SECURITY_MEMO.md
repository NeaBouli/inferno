# MIGRATION SECURITY MEMO
## Projekt: Inferno ($IFR)
## Datum: 14.04.2026

### Was wurde gefixt
- BuybackController: Zero-Slippage bei LP → minIFR/minETH Schutz hinzugefügt
- BuybackController: Unbegrenztes approve → exact approve + reset nach Nutzung
- propose_7.js + propose_8.js: PRIVATE_KEY → DEPLOYER_PRIVATE_KEY (Konsistenz)
- .gitleaks.toml erstellt (ETH Keys, Anthropic, Telegram, Alchemy, BIP39)
- .github/workflows/security-audit.yml (Gitleaks + Dependency Audit, wöchentlich)
- .github/workflows/docs-validator.yml (war 0-byte, jetzt 5 Jobs)
- .github/workflows/post-deploy.yml: permissions: contents: write hinzugefügt
- BuybackController deployed + verified: Sepolia (0xaA14...6fCF) + Mainnet (0x1e05...1F7c)
- Deploy-Script netzwerk-aware (Mainnet + Sepolia + local)
- Governance Proposal A (setFeeExempt) eingereicht via Safe TX Builder

### Bei Migration beachten
- [ ] Proposal A (setFeeExempt BuybackController) am ~16.04.2026 executen (48h Timelock)
- [ ] NACH Proposal A Execute: Proposal B (setFeeCollector) einreichen
- [ ] Proposal B Execute nach weiteren 48h
- [ ] Verify: InfernoToken.feeExempt(0x1e0547D5...) == true
- [ ] Verify: FeeRouterV1.feeCollector() == 0x1e0547D5...
- [ ] npm audit hat 67 Vulnerabilities (4 critical) — Hardhat 3 Upgrade separat planen
- [ ] Alchemy API Key wird in 6+ lokalen .env Dateien wiederverwendet — separate Keys pro App empfohlen

### Benoetigte ENV-Variablen
- DEPLOYER_PRIVATE_KEY (nur fuer Deployment-Scripts, nie auf Server)
- SEPOLIA_RPC_URL
- MAINNET_RPC_URL
- ETHERSCAN_API_KEY
- TREASURY_ADDRESS
- COMMUNITY_ADDRESS
- TEAM_BENEFICIARY
- VOUCHER_SIGNER_ADDRESS

### Was NIE auf den Server darf
- .env / .env.mainnet (enthalten Deployer Private Key)
- Deployer Private Key (0x3a50d51bb...) — nur lokale Nutzung
- arweave-wallet.json (falls vorhanden)

### Migrations-Reihenfolge
1. Execute Proposal A (setFeeExempt) via TreasurySafe 3-of-5
2. Verify on-chain: feeExempt(BuybackController) == true
3. Submit Proposal B (setFeeCollector) via Safe TX Builder
4. Warte 48h Timelock
5. Execute Proposal B via TreasurySafe 3-of-5
6. Verify: feeCollector() == BuybackController Adresse
7. BuybackController ist jetzt aktiv — permissionless execute() nach Cooldown
