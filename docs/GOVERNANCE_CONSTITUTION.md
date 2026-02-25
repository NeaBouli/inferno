# Inferno ($IFR) Governance Constitution v1.0

## Präambel
Die Inferno Governance sichert dezentrale Kontrolle über alle
kritischen Protokoll-Parameter. Kein einzelner Akteur kann ohne
48-stündige Timelock-Periode und Quorum-Zustimmung Änderungen vornehmen.

## Artikel 1 — Governance Prinzipien
1. **Transparenz:** Alle Proposals sind on-chain nachvollziehbar
2. **Zeitverzögerung:** 48h Timelock für alle Änderungen (kein Bypass)
3. **Dezentralisierung:** Ziel 4-of-7 Multisig bis Mainnet
4. **Unveränderlichkeit von Kernwerten:** Burn-Rate, Max-Fee, Supply nie änderbar
5. **Guardian-Recht:** Emergency Cancel durch 2-of-3 Guardian Multisig

## Artikel 2 — Governance-fähige Parameter

### 2.1 PartnerVault
| Parameter | Beschreibung | Grenzen |
|-----------|-------------|---------|
| rewardBps | Partner Reward Rate | 500–2500 bps (5–25%) |
| annualEmissionCap | Jährliches Emissionslimit | 1M–10M IFR |
| authorizedCaller | Whitelist für recordLockReward() | beliebige Adresse |
| algoThrottleEnabled | Algorithmic Throttle an/aus | bool |

### 2.2 FeeRouterV1
| Parameter | Beschreibung | Grenzen |
|-----------|-------------|---------|
| protocolFeeBps | Protocol Fee | 0–25 bps (Hard Cap) |
| whitelistedAdapters | Swap Adapter Whitelist | beliebige Adresse |
| voucherSigner | EIP-712 Voucher Signer | beliebige Adresse |
| paused | Emergency Pause | bool |
| feeCollector | Fee Empfänger | beliebige Adresse |

### 2.3 IFRToken (unveränderlich)
| Parameter | Wert | Änderbar? |
|-----------|------|-----------|
| totalSupply | 1,000,000,000 IFR | Nein |
| burnFeeBps | 250 (2.5%) | Nein |
| poolFeeBps | 100 (1.0%) | Nein |
| decimals | 9 | Nein |
| maxFeeBps | 500 (5.0%) | Hard Cap |

## Artikel 3 — Proposal Lifecycle

### Phase 1: Proposal
1. Proposer ruft `governance.propose(targets, values, calldatas, description)` auf
2. Proposal erscheint in Timelock Queue
3. ETA = block.timestamp + 48h (minimum)
4. Status: **PENDING**

### Phase 2: Timelock
- 48h Wartezeit (unveränderlich im Contract)
- Während dieser Zeit: Community-Review, Guardian-Cancel möglich
- Status: **QUEUED**

### Phase 3: Execution
- Nach ETA: Jeder kann `execute()` aufrufen (permissionless)
- Vor Execution: Nochmalige Prüfung ob Proposal noch aktuell
- Status: **EXECUTED**

### Phase 4: Abgelehnte/Gecancelte Proposals
- Guardian kann jederzeit canceln: `guardian.cancel(proposalId)`
- Gecancelte Proposals können nicht erneut executed werden
- Status: **CANCELLED**

## Artikel 4 — Multisig Struktur (Mainnet)

### Owner Multisig (4-of-7)
Verantwortlich für: Alle Governance Proposals
- 2 Gründer-Wallets (Hardware Wallet, Ledger)
- 2 Community-Vertreter (gewählt via Snapshot)
- 2 Partner-Vertreter (erste akkreditierte Partner)
- 1 Reserve-Wallet (Cold Storage, Notfall)

### Guardian Multisig (2-of-3)
Verantwortlich für: Emergency Cancel only
- 1 Gründer-Wallet
- 1 unabhängiger Security-Reviewer
- 1 Community-Vertreter

## Artikel 5 — Verbotene Governance-Aktionen
Die folgenden Aktionen sind durch Contract-Design technisch unmöglich:
- Minting neuer IFR Token
- Erhöhung der Burn-Rate über 5%
- Direkter Zugriff auf gesperrte User-Tokens
- Bypass der 48h Timelock
- Änderung der Token Decimals

## Artikel 6 — Governance Phasen

| Phase | Status | Beschreibung |
|-------|--------|-------------|
| Phase 0 | Aktiv | Single EOA (Deployer), Bootstrap |
| Phase 1 | Geplant | 2-of-3 Multisig |
| Phase 2 | Geplant | 3-of-5 Multisig |
| Phase 3 | Geplant | 4-of-7 Multisig |
| Phase 4 | Geplant | Full DAO (Token Voting) |

## Artikel 7 — Änderungen dieser Constitution
- Änderungen erfordern Governance Proposal + 48h Timelock
- Kernwerte (Artikel 5) sind unveränderlich (Contract-Level)
- Versionierung: GOVERNANCE_CONSTITUTION_v{n}.md

---
*Version: 1.0 | Stand: Februar 2026 | Netzwerk: Sepolia (Testnet)*
