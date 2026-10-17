# IFR Points → Voucher → FeeRouter — End-to-End Flow

## Overview

User earns points → receives voucher → saves on swap fees

## Complete Flow (Step by Step)

### Phase 1: Earning Points

1. User connects wallet on IFR website (WalletConnect/MetaMask)
2. Points Backend records the retained `wallet_connect` event under SIWE authentication.
3. Previously awarded Points remain in the existing ledger. The retired web guides no longer produce events.

### Phase 2: Voucher Issuance

4. User reaches 100-point threshold
5. `POST /voucher/issue` → Points Backend signs EIP-712 voucher:
   ```json
   {
     "user": "0xUSER...",
     "discountBps": 5,
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
10. Effective fee: 5 bps - 5 bps -> 0 bps
11. No protocol fee for this swap
12. Nonce marked as "used" → no replay possible

## Sequence Diagram (Text)

```
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
With voucher (5 bps discount): 0 ETH Protocol Fee
Savings: ~$1.50 at ETH = $3000
```

The web guide event producer has been retired. Already-awarded Points and the backend event schema remain unchanged; `wallet_connect` remains supported.

## Links

- Points Backend: `apps/points-backend/`
- FeeRouter: `contracts/FeeRouterV1.sol`
- Testnet Guide: `docs/TESTNET_GUIDE.md`
- Points Wiki: `docs/wiki/agent.html`
