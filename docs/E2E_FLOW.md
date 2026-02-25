# IFR Points → Voucher → FeeRouter — End-to-End Flow

## Uebersicht

User verdient Punkte → bekommt Voucher → spart bei Swap

## Vollstaendiger Flow (Schritt fuer Schritt)

### Phase 1: Punkte verdienen

1. User verbindet Wallet auf IFR Website (WalletConnect/MetaMask)
2. AI Copilot fuehrt User durch Guides
3. Points Backend zeichnet Events auf (SIWE Auth):
   - `guide_wallet_setup`: +20 Punkte
   - `guide_add_token`: +20 Punkte
   - `guide_lock`: +30 Punkte
   - Total: 70 Punkte nach 3 Guides

### Phase 2: Voucher ausstellen

4. User erreicht 100 Punkte-Schwelle
5. `POST /voucher/issue` → Points Backend signiert EIP-712 Voucher:
   ```json
   {
     "user": "0xUSER...",
     "discountBps": 15,
     "maxUses": 1,
     "expiry": "now + 7 days",
     "nonce": "<unique>"
   }
   ```
6. User erhaelt: `{ voucher, signature }`

### Phase 3: Voucher beim Swap einloesen

7. User macht Swap ETH → IFR ueber FeeRouter
8. `swapWithFee(adapter, swapData, voucher, sig, useVoucher=true)`
9. FeeRouter prueft:
   - Signatur gueltig (`voucherSigner`)
   - Nicht abgelaufen
   - Nonce nicht verwendet
   - `discount <= protocolFee`
10. Effektive Fee: 5 bps - 15 bps → 0 bps (geclampt)
11. Kein Protocol Fee fuer diesen Swap
12. Nonce als "used" markiert → kein Replay moeglich

## Sequenz-Diagramm (Text)

```
User → AI Copilot: "How do I lock IFR?"
AI Copilot → Points Backend: guide_lock event (+30 pts)
Points Backend → DB: update pointsTotal
User → Points Backend: POST /voucher/issue
Points Backend → User: { voucher, signature }
User → FeeRouter: swapWithFee(..., voucher, sig, true)
FeeRouter → voucherSigner: verify EIP-712
FeeRouter → feeCollector: fee = 0 (discounted)
FeeRouter → Uniswap Adapter: execute swap
```

## Sicherheits-Garantien

- Punkte sind off-chain, nicht transferierbar
- Voucher on-chain verifiziert (kein Trust in Backend noetig)
- Replay-Schutz: `usedNonces[wallet][nonce] = true`
- Expiry: 7 Tage, danach wertlos
- Discount cap: niemals > `protocolFeeBps`
- Signer-Kompromittierung: `pause()` + `setVoucherSigner()` via Governance

## Zahlen-Beispiel

```
Swap: 1 ETH → IFR
Ohne Voucher: 0.0005 ETH Protocol Fee (5 bps)
Mit Voucher (15 bps discount): 0 ETH Protocol Fee (clamp)
Ersparnis: ~$1.50 bei ETH = $3000
```

## Links

- Points Backend: `apps/points-backend/`
- FeeRouter: `contracts/FeeRouterV1.sol`
- AI Copilot: `apps/ai-copilot/`
- Testnet Guide: `docs/TESTNET_GUIDE.md`
- Agent Wiki: `docs/wiki/agent.html`
