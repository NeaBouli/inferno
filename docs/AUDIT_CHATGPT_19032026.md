# External Security Audit — InfernoToken.sol

| Field | Value |
|-------|-------|
| **Date** | 2026-03-19 |
| **Reviewer** | Independent AI Security Analysis |
| **Contract** | InfernoToken.sol (ERC-20 with fee-on-transfer) |
| **Network** | Ethereum Mainnet |
| **Address** | `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` |

---

## Audit Scope

- InfernoToken.sol (ERC-20 with fee-on-transfer)
- Fee mechanism (`_update` override)
- Owner controls (`setFeeRates`, `setFeeExempt`, `setPoolFeeReceiver`)
- Supply mechanics (burn, no mint)

---

## Findings

### FINDING-01: Owner Control (Critical)

**Risk:** Owner can call `setFeeRates()`, `setFeeExempt()`, `setPoolFeeReceiver()` without on-chain restriction.

**Attack Vector:**
1. Owner sets self as feeExempt
2. All others pay 3.5% fee
3. Owner trades without fees — unfair advantage

**IFR Mitigation:**
- Owner = Governance Contract (not EOA)
- 48h Timelock on all changes
- TreasurySafe 3-of-5 controls Governance
- On-chain verifiable at all times

**Status:** MITIGATED by Governance Architecture

---

### FINDING-02: FeeExempt Logic (High)

**Risk:** If ONE side of a transfer is exempt, NO fees are charged for the entire transfer.

**Attack Vector:**
- DEX Router set as exempt → all trades fee-free
- Insider wallet exempt → arbitrage possible

**IFR Mitigation:**
- Only protocol contracts are exempt
- All exempt addresses publicly verifiable on Etherscan
- No DEX routers exempted
- Governance-controlled — community oversight

**Exempt Addresses (as of audit date):**
- Vesting Contract
- BurnReserve
- BootstrapVaultV3
- TreasurySafe (3-of-5 Gnosis Safe)
- CommunitySafe (3-of-5 Gnosis Safe)
- Deployer (legacy, no governance power)

**Status:** MITIGATED — Transparent + Controlled

---

### FINDING-03: Rounding / Dust (Low)

**Risk:** Very small transfers may pay zero fees due to integer division.

**Impact:** Minimal — not exploitable at scale. At 9 decimals, the smallest meaningful transfer that avoids fees would need to be below ~28 tokens (at 3.5% fee rate).

**Status:** Known, acceptable risk

---

### FINDING-04: Decimals = 9 (Low / Design)

**Risk:** Some DEX/tool compatibility issues. Most ERC-20 tokens use 18 decimals.

**IFR Response:** Deliberate design choice. Provides sufficient precision while keeping amounts readable. Fully compatible with Uniswap V2.

**Status:** By design, documented

---

## Confirmed Strengths

| Check | Result |
|-------|--------|
| Reentrancy Risk | No external calls in `_update()` |
| Burn Mechanism | Real burn — tokens sent to `address(0)` |
| Fee Cap | Hardcoded max 5%, cannot be exceeded |
| Mint Function | None — supply can only decrease |
| Base Library | OpenZeppelin v5 (current standard) |
| Proxy/Upgrade | No proxy — contract is immutable |

---

## Overall Assessment

Code quality is **good**. Logic is **clean**. No exploitable bugs found.

The critical risks (Owner control, FeeExempt) are fully mitigated by IFR's Governance architecture:
- **48h Timelock** — all changes are publicly visible before execution
- **TreasurySafe 3-of-5** — no single person can execute changes
- **On-chain verifiable** — anyone can audit exempt addresses and fee rates

Trust is not based on the deployer — it is enforced by smart contract architecture.

---

## References

- Token Contract: [Etherscan](https://etherscan.io/address/0x77e99917Eca8539c62F509ED1193ac36580A6e7B)
- Governance Contract: [Etherscan](https://etherscan.io/address/0xc43d48E7FDA576C5022d0670B652A622E8caD041)
- TreasurySafe: [Etherscan](https://etherscan.io/address/0x55fB5D5C3e9E02e8240E87F2709856E0b7C3dE21)
- Security Wiki: [ifrunit.tech/wiki/security.html](https://ifrunit.tech/wiki/security.html#external-audit)
- Full Documentation: [ifrunit.tech](https://ifrunit.tech)

---

*This document is part of the IFR Protocol security documentation.*
*Published: 2026-04-04*
