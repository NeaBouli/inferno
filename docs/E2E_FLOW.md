# IFR Points → Voucher → FeeRouter — End-to-End Flow

## Overview

User earns points → receives voucher → saves on swap fees

## Complete Flow (Step by Step)

### Phase 1: Earning Points

1. User connects wallet on IFR website (WalletConnect/MetaMask)
2. AI Copilot guides user through guides
3. Points Backend records events (SIWE Auth):
   - `guide_wallet_setup`: +20 points
   - `guide_add_token`: +20 points
   - `guide_lock`: +30 points
   - Total: 70 points after 3 guides

### Phase 2: Voucher Issuance

4. User reaches 100-point threshold
5. `POST /voucher/issue` → Points Backend signs EIP-712 voucher:
   ```json
   {
     "user": "0xUSER...",
     "discountBps": 15,
     "maxUses": 1,
     "expiry": "now + 7 days",
     "nonce": "<unique>"
   }
   ```
6. User receives: `{ voucher, signature }`

### Phase 3: Redeeming Voucher on Swap

7. User swaps ETH → IFR via FeeRouter
8. `swapWithFee(adapter, swapData, voucher, sig, useVoucher=true)`
9. FeeRouter verifies:
   - Signature valid (`voucherSigner`)
   - Not expired
   - Nonce not used
   - `discount <= protocolFee`
10. Effective fee: 5 bps - 15 bps → 0 bps (clamped)
11. No protocol fee for this swap
12. Nonce marked as "used" → no replay possible

## Sequence Diagram (Text)

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

## Security Guarantees

- Points are off-chain, non-transferable
- Voucher verified on-chain (no trust in backend required)
- Replay protection: `usedNonces[wallet][nonce] = true`
- Expiry: 7 days, worthless after that
- Discount cap: never > `protocolFeeBps`
- Signer compromise: `pause()` + `setVoucherSigner()` via Governance

## Numerical Example

```
Swap: 1 ETH → IFR
Without voucher: 0.0005 ETH Protocol Fee (5 bps)
With voucher (15 bps discount): 0 ETH Protocol Fee (clamp)
Savings: ~$1.50 at ETH = $3000
```

## Links

- Points Backend: `apps/points-backend/`
- FeeRouter: `contracts/FeeRouterV1.sol`
- AI Copilot: `apps/ai-copilot/`
- Testnet Guide: `docs/TESTNET_GUIDE.md`
- Agent Wiki: `docs/wiki/agent.html`
