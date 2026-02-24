# Inferno ($IFR) — Governance Constitution v1.0

## 1. Prinzipien
- Governance ist Steuerung, nicht Machtinstrument
- Hard bounds sind im Code erzwungen — nicht durch Voting überschreibbar
- Policy targets sind Leitlinien, keine Garantien
- Dezentralisierung erfolgt graduell (Phase 2→4), nicht sofort

## 2. Was Governance DARF
- Parameter ändern (nur innerhalb hard bounds, via 48h Timelock)
- AuthorizedCaller setzen (Verify Backend Wallet für recordLockReward)
- Business Tiers zuweisen
- EmissionFactor senken
- Partner aktivieren/deaktivieren
- AlgoThrottle aktivieren/deaktivieren
- feeExempt für interne Protokoll-Adressen setzen (IFRLock, PartnerVault, Vesting etc.)

## 3. Was Governance NICHT DARF
- Neue IFR minten (kein Mint im Contract — technisch unmöglich)
- Hard bounds überschreiten (MIN/MAX_REWARD_BPS, AnnualCap bounds)
- Timelock umgehen (kein instant change — 48h Pflicht)
- Supply erhöhen
- PartnerPool über 40M IFR vergrößern

## 4. Hard Bounds (Contract-Enforced)

| Parameter | Min | Max | Default/Aktuell |
|-----------|-----|-----|-----------------|
| RewardBps | 500 (5%) | 2500 (25%) | 1500 (15%) |
| AnnualEmissionCap | 1,000,000 IFR | 10,000,000 IFR | 4,000,000 IFR |
| VestingDuration | 180 days | 365 days | partner-spezifisch |
| TimelockDelay | 48h | — | 48h |

## 5. Policy Targets (Governance-Empfehlung, nicht erzwungen)

| Parameter | Policy Target |
|-----------|--------------|
| RewardBps | 10–20% |
| Annual Default | 4M IFR |
| Max Reward pro Partner | 1M IFR |

## 6. Rollen & Berechtigungen

| Rolle | Adresse | Kann | Kann NICHT |
|-------|---------|------|------------|
| Owner/Admin | Governance Timelock (0x6050...) | propose, execute | instant change |
| Guardian | Guardian EOA (0x5Ecc...) | cancel proposals | propose, execute |
| AuthorizedCaller | Verify Backend Wallet | recordLockReward() | alles andere |
| PartnerBeneficiary | Partner-Adresse | claim() | Parameter ändern |

## 7. Upgrade-Pfad

| Phase | Status | Governance |
|-------|--------|------------|
| Phase 0 (jetzt, Sepolia) | Aktiv | Single EOA Owner — Testnet |
| Phase 1 (Mainnet Launch) | Geplant | Single EOA → sofort Multisig-Migration |
| Phase 2 | Geplant | Multisig (empfohlen: 4-of-7 Gnosis Safe, Hardware Wallets) |
| Phase 4 | Langfristig | DAO Controller mit Token-Voting (kein Flash-Loan-Voting) |

## 8. Transparenz-Regel
Jede Parameteränderung:
- Muss als Governance Proposal öffentlich sichtbar sein (48h Minimum)
- Muss innerhalb Hard Bounds liegen
- Jede Abweichung von Policy Targets erfordert Begründung in der Proposal Description
- Guardian kann jede Proposal innerhalb der 48h canceln

---
*Stand: Februar 2026 | Version 1.0 | Inferno Protocol*
