# Inferno ($IFR) — Press Kit

## Kurzfassung

Inferno ($IFR) ist ein deflationaerer ERC-20 Utility-Token auf Ethereum. Nutzer sperren IFR-Token on-chain und erhalten dafuer lebenslangen Premium-Zugang zu Partner-Produkten — keine Abos, keine wiederkehrenden Zahlungen.

**Modell:** Community Fair Launch (CFLM) — kein Presale, kein VC, keine Insider-Allokation.

## Key Facts

| Metrik | Wert |
|--------|------|
| Token | $IFR (Inferno) |
| Standard | ERC-20, Ethereum |
| Decimals | 9 |
| Initiale Supply | 1,000,000,000 IFR |
| Aktuelle Supply | ~997,999,575 IFR |
| Verbrannt | ~2,000,425 IFR (0.2%) |
| Smart Contracts | 10 (alle verified) |
| Tests | 396 (99% Coverage) |
| Netzwerk | Sepolia Testnet (Pre-Mainnet) |
| Launch-Modell | Community Fair Launch (CFLM) |
| Mint-Funktion | Keine — Supply kann nur sinken |

## Token-Allokation

| Kategorie | Anteil | Menge | Mechanismus |
|-----------|--------|-------|-------------|
| DEX Liquidity | 40% | 400M IFR | Uniswap V2 Pairing |
| Liquidity Reserve | 20% | 200M IFR | 6-Monats-Lock, 50M/Quartal |
| Team (Vested) | 15% | 150M IFR | 12-Monats-Cliff, 36-Monats-Linear |
| Treasury | 15% | 150M IFR | Multisig-kontrolliert |
| Community & Grants | 6% | 60M IFR | Grants, Bounties, Ecosystem |
| Partner Ecosystem | 4% | 40M IFR | Milestone-basiert, 6-12 Mo Vesting |

## Deflations-Mechanismus

Jeder Transfer: -2.5% permanent verbrannt + 1% BuybackVault.

| Gebuehr | Rate | Ziel |
|---------|------|------|
| Sender Burn | 2.0% | Permanent verbrannt (Supply sinkt) |
| Recipient Burn | 0.5% | Permanent verbrannt (Supply sinkt) |
| Pool Fee | 1.0% | BuybackVault (Rueckkauf + Burn) |
| **Gesamt** | **3.5%** | Hard Cap: 5% max |

## Lock-to-Access Modell

Nutzer sperren IFR-Token im IFRLock-Contract → erhalten lebenslangen Premium-Zugang bei Partner-Produkten. Tokens bleiben im Besitz des Nutzers und koennen jederzeit entsperrt werden.

| Tier | Min. Lock | Beispiel-Zugang |
|------|-----------|-----------------|
| Bronze | 1,000 IFR | Basis-Features |
| Silver | 2,500 IFR | Erweiterte Features |
| Gold | 5,000 IFR | Premium-Zugang |
| Platinum | 10,000 IFR | Vollzugang + Priority Support |

## Partner Ecosystem

- **40M IFR** dedizierter Partner Pool
- Lock-triggered Creator Rewards (Algo-basiert)
- Milestone-basierte Freigabe + Vesting
- Partner-Token = DAO Voting Rights (Phase 4)
- Offen fuer alle Produkte — permissionless Integration

## Governance

- 48h Timelock auf alle Aenderungen
- Guardian Emergency Cancel
- Governance Proposals #0-#3 erfolgreich ausgefuehrt
- Ownership aller Contracts → Governance Timelock
- Roadmap: Admin → Multisig → Full DAO

## Technologie

| Komponente | Stack |
|------------|-------|
| Contracts | Solidity 0.8.20, OpenZeppelin v5 |
| Framework | Hardhat v2, ethers v5 |
| Tests | Chai v4, 396 Tests, 99% Coverage |
| Dashboard | React 18 + Vite + ethers v5 |
| Governance UI | React 18 + TypeScript + Tailwind |
| AI Copilot | Claude Haiku 4.5 + RAG |
| Benefits Network | Next.js 14 + wagmi v2 (PWA) |

## Roadmap (Kurzfassung)

- **Q1 2026:** Testnet, 396 Tests, alle Apps live
- **Q2 2026:** Security Audit, Mainnet Deploy, erste Partner
- **Q3 2026:** 10+ Partner, Creator Gateway MVP, Apps live
- **Q4 2026:** Community Governance, CEX Outreach
- **Q2 2027+:** Full DAO, Token Voting

## Links

| Ressource | URL |
|-----------|-----|
| Website | https://neabouli.github.io/inferno/ |
| GitHub | https://github.com/NeaBouli/inferno |
| Wiki | https://neabouli.github.io/inferno/wiki/ |
| Transparency | docs/TRANSPARENCY.md |
| Whitepaper | docs/WHITEPAPER.md |
| Fair Launch | docs/FAIR_LAUNCH.md |
| Roadmap | docs/ROADMAP.md |

## Medien-Anfragen

GitHub Discussions oder Issues:
https://github.com/NeaBouli/inferno/discussions

---
*Testnet Phase | Februar 2026 | Keine Anlageberatung*
