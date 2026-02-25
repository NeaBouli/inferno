# Security Policy — Inferno ($IFR)

## Responsible Disclosure

Wir nehmen Sicherheit ernst. Wenn du eine Schwachstelle findest,
bitte folge diesem Prozess — nicht öffentlich posten bevor wir
reagiert haben.

### Meldung
- **GitHub:** https://github.com/NeaBouli/inferno/security/advisories
- **Zeitrahmen:** Wir antworten innerhalb 48h
- **Sprache:** Deutsch oder Englisch

### Was wir brauchen:
- Beschreibung der Schwachstelle
- Reproduktions-Schritte
- Potenzielle Auswirkung
- Optional: Vorgeschlagener Fix

## Bug Bounty Framework (Testnet Phase)

Während der Testnet-Phase zahlen wir **keine monetären Bounties**,
aber wir erkennen Finder öffentlich an:

| Schweregrad | Beispiele | Anerkennung |
|-------------|-----------|-------------|
| Critical | Drain von Locked Tokens, Mint-Bug | Hall of Fame + NFT |
| High | Governance Bypass, Replay-Angriff | Hall of Fame |
| Medium | Parameter-Manipulation, DoS | Hall of Fame |
| Low | Info-Leak, Minor Logic Error | GitHub Credit |

**Mainnet Bug Bounty:** Nach Mainnet-Launch geplant (Details folgen).
Ziel: 5-10% eines definierten Treasury-Budgets für kritische Findings.

## Scope

### In Scope (Testnet Sepolia):
- contracts/token/InfernoToken.sol
- contracts/lock/IFRLock.sol
- contracts/partner/PartnerVault.sol
- contracts/FeeRouterV1.sol
- contracts/governance/Governance.sol
- apps/benefits-network/ (Backend + Frontend)
- apps/points-backend/

### Out of Scope:
- Third-party contracts (Uniswap V2, OpenZeppelin)
- Frontend UI bugs ohne Security-Relevanz
- Gas-Optimierungen
- Known issues (siehe AUDIT_BRIEF.md)

## Known Design Decisions (kein Bug)

| Thema | Entscheidung | Begründung |
|-------|-------------|------------|
| 9 Decimals | Absichtlich (nicht 18) | IFR-spezifisch |
| Kein Mint | Supply fix bei Deployment | Deflationary by design |
| Single EOA Testnet | Phase 0 Bootstrap | Multisig Phase 1+ |
| No Oracle | Phase 0 Pricing | USD-Pricing Phase 2+ |
| rewardBps 1500 | 15% default | Governance-änderbar |

## Security Audit Status

| Audit-Typ | Status | Ergebnis |
|-----------|--------|---------|
| Slither Static Analysis | Abgeschlossen | 0 High/Critical |
| ChatGPT Independent Audit | 7/7 PASS | Keine kritischen Findings |
| Professional Audit | Geplant vor Mainnet | Code4rena / Sherlock |

## Kontakt

Für dringende Security-Issues: GitHub Security Advisory (privat)
Für allgemeine Fragen: GitHub Issues (öffentlich)

---
*Stand: Februar 2026 | Version 1.0*
