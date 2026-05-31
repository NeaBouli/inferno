# Bootstrap finalise() — Execution Plan
**Datum: 05.06.2026 ab 23:50:23 UTC**
**(06.06.2026 ab 02:50 Uhr Athen)**

> Codex-reviewed: 31.05.2026 — alle 4 BRIDGE.md-Punkte beantwortet ✅

---

## On-chain Facts (verifiziert 31.05.2026)

| Feld | Wert |
|------|------|
| Vault | `0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141` |
| IFR Token | `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` |
| totalETHRaised | **0.030 ETH** |
| ifrAllocation | 100,000,000 IFR |
| Vault IFR Balance | **200,000,000 IFR** ✅ (2× allocation — ready) |
| endTime | `2026-06-05T23:50:23Z` |
| finalised | `false` |
| LP Token | `0x000...000` (erst nach finalise() bekannt) |

**Wichtige Erkenntnisse (Codex):**
- `finalise()` ist **PERMISSIONLESS** — kein Safe, kein onlyOwner
- Kein `minETH`-Check — 0.030 ETH reicht aus
- `hasRefundOccurred()` nicht im deployed Contract → Scripts behandeln als optional
- `estimateGas.finalise()` schützt vor Revert vor dem eigentlichen TX

---

## Pre-flight Checklist

- [x] Vault IFR Balance: 200M ✅
- [x] Governance Owner == TreasurySafe ✅
- [x] Deployer feeExempt ✅
- [x] BuybackController feeExempt ✅
- [x] FeeCollector == BuybackController ✅
- [x] `finalise-bootstrap.js` — Codex reviewed + chainId guard ✅
- [x] `check-bootstrap-status.js` — standalone, kein Hardhat ✅
- [ ] Gas ETH auf ausführender Wallet vorhanden?
- [ ] Alle 5 Signer informiert (A.K., M.G., A.M., Y.K., A.P.)?

---

## Ablauf — 05.06.2026 23:50 UTC

### Schritt 1 — Status prüfen (kurz vorher)

```bash
cd /Users/gio/Desktop/repos/inferno
node scripts/check-bootstrap-status.js
```

Erwartung: `endTime` erreicht, `finalised: false`

### Schritt 2 — finalise() aufrufen (PERMISSIONLESS)

```bash
node scripts/finalise-bootstrap.js
```

Script schätzt Gas → bestätigen → TX senden.
**TX Hash sofort notieren!**

### Schritt 3 — LP Token Adresse sichern

Aus finalise()-TX → `PairCreated` Event → LP Token Adresse.
Wird auch von `propose-pool-feeexempt.js` auto-gefetched.

### Schritt 4 — SOFORT: Uniswap Pool feeExempt (Issue #33)

```bash
node scripts/propose-pool-feeexempt.js
```

Proposal ID notieren → **48h Timelock** → danach ausführen.
**Ohne dieses Proposal: IFR auf Uniswap nicht handelbar (3.5% Fee auf jeden Swap)!**

### Schritt 5 — P0 berechnen + setzen (Issue #34)

```
P0 = totalETHRaised_wei / 100_000_000_000_000_000  (IFR Decimals = 9)
```

Bei 0.030 ETH: `P0 = 0.030e18 / 100e9 = 300_000_000` (= 3e-7 ETH/IFR)

Proposal erstellen: `setP0(p0Value)` auf CommitmentVault → 48h → ausführen.
**IMMUTABLE — korrekte Berechnung kritisch!**

### Schritt 6 — Post-Bootstrap Updates (Issue #35)

- `bootstrap.html`: Status auf ENDED setzen
- `index.html`: Buy IFR Button → Uniswap Link aktivieren
- Ali Copilot: hardcoded facts updaten + Railway redeploy
- `transparency.html`: finalise() TX eintragen
- Telegram @IFRtoken Announcement
- `TODO.md`: Issues #32–35 schließen

---

## Notfall — Falls finalise() reverted

```bash
node scripts/check-bootstrap-status.js
# estimateGas zeigt Revert-Grund
```

Häufigste Ursachen:
1. `endTime` noch nicht erreicht → warten
2. `finalised == true` → bereits erledigt
3. IFR Balance < 2× allocation → Vault auffüllen

---

## Kontakte

- TreasurySafe: `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b` (3-of-5)
- Signer: A.K., M.G., A.M., Y.K., A.P.
- GitHub Issues: [#32](https://github.com/NeaBouli/inferno/issues/32) [#33](https://github.com/NeaBouli/inferno/issues/33) [#34](https://github.com/NeaBouli/inferno/issues/34) [#35](https://github.com/NeaBouli/inferno/issues/35)
