# Partner Rewards Specification — IFR PartnerVault

## Uebersicht
Partner (Creator, Businesses, Developers) erhalten IFR-Rewards
wenn User IFR-Token sperren und auf den Partner verweisen.

## Reward-Mechanismus

### Formel
Reward = LockAmount x rewardBps / 10000

### Beispiel (rewardBps = 1500 = 15%):
- User sperrt: 10,000 IFR
- Partner Reward: 10,000 x 15% = 1,500 IFR
- Netto-Effekt: 10,000 gesperrt, 1,500 ausgezahlt
- Deflation: 8,500 IFR netto deflationary

### Wichtige Invariante:
**Reward IMMER < Lock** — garantiert Netto-Deflation
- Bei rewardBps 1500 (15%): 10,000 lock -> 1,500 reward
- Bei rewardBps 2500 (25%): 10,000 lock -> 2,500 reward
- Nie 1:1 oder 2x — waere inflationaer

## Parameter

| Parameter | Wert | Governance-Grenzen |
|-----------|------|-------------------|
| rewardBps | 1500 (15%) | 500-2500 bps (5-25%) |
| annualEmissionCap | 4,000,000 IFR | 1M-10M IFR |
| vestingDuration | 180 Tage (6 Monate) | Gov-aenderbar |
| maxVestingDuration | 365 Tage (12 Monate) | Gov-aenderbar |

## PartnerPool Nachhaltigkeit

| Jahr | Emission | Pool Rest |
|------|----------|-----------|
| 1 | 4,000,000 | 36,000,000 |
| 2 | 4,000,000 | 32,000,000 |
| 5 | 4,000,000 | 20,000,000 |
| 10 | 4,000,000 | 0 |

*Pool reicht 10 Jahre bei konstantem Cap.*
*Algorithmic Throttle verlaengert Laufzeit automatisch.*

## Vesting

- Rewards werden NICHT sofort ausgezahlt
- Linear vested ueber 6-12 Monate
- Claim via PartnerVault.claim() (permissionless nach Vesting)
- Teilauszahlung moeglich (claimable = vested - already claimed)

## Anti-Gaming

### authorizedCaller:
Nur whitelisted Backend-Wallets koennen recordLockReward() aufrufen.
Verhindert: Unbefugte Reward-Manipulation.

### Anti-double-count:
```solidity
mapping(address => mapping(bytes32 => bool)) public rewardClaimed;
```
Verhindert: Doppelte Rewards fuer denselben Lock-Event.

### Algorithmic Throttle (optional):
Bei hohem Lock-Ratio (>30%) sinkt effektiver rewardBps automatisch.
Verhindert: Emission-Explosion bei ploetzlich hohem Lock-Volumen.

## Partner-Typen

### Type A: Business Partner
- Akzeptiert IFR-Lock fuer Kunden-Rabatte
- Reward: Anteil des Lock-Betrags der Kunden
- Beispiel: Cafe akzeptiert Bronze Tier -> 1,000 IFR Lock -> 150 IFR Reward

### Type B: Creator Partner
- YouTube/Content Creator mit Hybrid-Zugang
- Reward: Anteil des Lock-Betrags der Fans
- Beispiel: 100 Fans x 5,000 IFR = 500,000 IFR Lock -> 75,000 IFR Reward (6 Mon.)

### Type C: Developer Partner
- Integriert IFR-Lock in eigene App/Plattform
- Reward: Anteil der Lock-Events ueber SDK
- Beispiel: App mit 1,000 Usern x 2,500 IFR = 2,500,000 IFR Lock -> 375,000 IFR Reward

## Onboarding

1. Partner-Antrag via GitHub Issue oder direkten Kontakt
2. Governance Proposal: createPartner(beneficiary, maxAlloc)
3. 48h Timelock -> Execute
4. Partner ist aktiv: authorizedCaller kann recordLockReward() aufrufen
5. Erster Lock-Event -> Reward beginnt zu vesten

## Links
- PartnerVault Contract: contracts/partner/PartnerVault.sol
- Deployment: 0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39 (Sepolia)
- Business Onboarding: docs/BUSINESS_ONBOARDING.md
- Creator Setup: docs/YOUTUBE_INTEGRATION.md
- Developer SDK: docs/SDK_QUICKSTART.md

---
*Stand: Februar 2026 | Version 1.0*
