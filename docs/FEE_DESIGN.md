# IFR Fee Design — Warum 3.5%?

## Kernprinzip: Lock > Transfer

IFR ist kein Trading-Token. Das Modell basiert auf:
1. Einmalig kaufen
2. Einmalig locken
3. Dauerhaft Benefits nutzen

Transfers passieren selten — beim Kauf, beim Lock, beim Unlock.
Nicht täglich. Daher ist 3.5% tragbar.

## Fee-Aufteilung

| Fee | Wohin | Zweck |
|-----|-------|-------|
| 2.5% | Burn (permanent) | Deflation — Supply sinkt |
| 1.0% | BuybackVault | Liquidität stärken |
| Gesamt | 3.5% | Automatisch, kein Governance |

## Fee-Exempt Adressen

| Adresse | Warum exempt? |
|---------|--------------|
| IFRLock | Lock/Unlock soll keine Fee kosten |
| LiquidityReserve | Interne Protokoll-Transfers |
| BuybackVault | Buyback-Logik ohne Verlust |
| BurnReserve | Burn-Mechanismus |
| PartnerVault | Reward-Auszahlung (nach Proposal #3) |
| DEX Router | Uniswap V2 Swap ohne Double-Fee |

Alle Exempt-Adressen: on-chain transparent, nur via Governance änderbar.

## CEX-Listing Strategie

Fee-on-transfer Tokens haben erhöhte CEX-Anforderungen:
- Transparenz über Fee-Mechanismus (check)
- Kein "hidden fee" (check — alles on-chain)
- Koordination mit Exchange über Fee-Exempt

Phase 0: DEX-only (Uniswap V2)
Phase 2+: CEX-Outreach nach Mainnet und Audit

## MEV & Slippage

Bei Uniswap V2 Swaps:
- Slippage-Einstellung mindestens 4% empfohlen (3.5% Fee + AMM Slippage)
- Alternativ: direkt über IFR Governance Dashboard kaufen
- FeeRouter übernimmt Routing mit korrekten Parametern

---
*Version 1.0 | Februar 2026*
