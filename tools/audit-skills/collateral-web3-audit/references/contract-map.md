# IFR Protocol — Contract & Deployment Map

Factual baseline from read-only recon on 2026-09-13/14 (repo `NeaBouli/inferno` @ main,
last push 2026-09-13T13:15:17Z; site ifrunit.tech). Verify everything against the pinned
baseline before relying on it. Repo framework: Hardhat 3.15.0 (dual compilers 0.8.20/paris +
0.8.28/cancun), ethers 6.17.0, OpenZeppelin ^5.6.1 as the only Solidity dependency.
**No proxy/upgradeability anywhere** — evolution happens via redeployment (BootstrapVault V1→V3).

## Mainnet addresses (Ethereum, chainId 1)

### Protocol contracts (14)

| Address | Contract | Key roles (documented — verify on-chain) |
|---|---|---|
| `0x77e99917Eca8539c62F509ED1193ac36580A6e7B` | InfernoToken (IFR), ERC-20, 9 decimals | owner = Governance |
| `0xc43d48E7FDA576C5022d0670B652A622E8caD041` | Governance (timelock) | owner = Treasury Safe 3-of-5 (since 20.03.2026); guardian = Deployer EOA |
| `0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb` | IFRLock | guardian = Deployer EOA (pause-only) |
| `0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271` | Vesting (team, 150M) | beneficiary `0x04FABC52…6239` immutable; guardian = Deployer EOA |
| `0xdc0309804803b3A105154f6073061E3185018f64` | LiquidityReserve (200M) | owner = Governance; guardian pause |
| `0x670D293e3D65f96171c10DdC8d88B96b0570F812` | BuybackVault | owner = Governance |
| `0xaA1496133B6c274190A2113410B501C5802b6fCF` | BurnReserve | owner = Governance; burn-only |
| `0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D` | PartnerVault (40M builder pool) | admin = Governance; rewardBps=1000, cap=4M/yr |
| `0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a` | FeeRouterV1 | governance immutable at construction; feeCollector → BuybackController (Prop #14) |
| `0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141` | BootstrapVaultV3 | FINALIZED 05.06.2026; zero admin surface |
| `0xdfe6636DA47F8949330697e1dC5391267CEf0EE3` | BuilderRegistry | owner = Governance; 0 builders registered (OPS-005) |
| `0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3` | CommitmentVault | owner = Governance; priceOracle = 0x0 |
| `0x974305Ab0EC905172e697271C3d7d385194EB9DF` | LendingVault | owner = Governance; ifrPriceWei = 0 (fail-closed) |
| `0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c` | BuybackController (14.04.2026) | **owner = Deployer EOA** — centralization exception |

### Market / external

| Address | Label |
|---|---|
| `0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0` | Uniswap V2 LP pair IFR/WETH (LP tokens held inside BootstrapVaultV3, no withdrawal fn) |
| `0xA820540936d18e1377C39dd9445E5b36F3F1261a` | BootstrapVault V1 — DEPRECATED (transferFrom bug) |
| `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` | Uniswap V2 Router (external, referenced) |

### Gnosis Safes (all documented 3-of-5, same 5 signers — verify `getThreshold()`/`getOwners()`)

| Address | Label |
|---|---|
| `0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b` | Treasury Safe (= Governance owner) |
| `0xaC5687547B2B21d80F8fd345B51e608d476667C7` | Community Safe |
| `0x5D93E7919a71d725054e31017eCA86B026F86C04` | LP Reserve Safe (held 400.6M IFR at recon) |

### EOAs

| Address | Label |
|---|---|
| `0x6b36687b0cd4386fb14cf565b67d7862110fed67` | Deployer; Guardian (cancel/pause only); signer #1 (named "A.K." on multisig page, "G.M. (Kaspartizan)" on transparency page — doc conflict) |
| `0x17F8DD6dECCb3ff5d95691982B85A87d7d9872d4` | Signer M.G.; also Voucher Signer (Points/Benefits backend) |
| `0x0c4893DcF730E0Ddc7D18CF9723932784Fb4ED74` | Signer A.M. |
| `0xA0860f872a9cAB34817D9a764e71ab43B942b275` | Signer Y.K.; doubles as ETH infrastructure-donation address |
| `0x32cF8b4F29A8F211804857EcF8BF0847f0BC0fE9` | Signer A.P. |
| `0x04FABC52c51d1F8ced6974E7C25a34249b1E6239` | Team vesting beneficiary (immutable) |
| `0x61aF4E72C77b58F4b50964Ee93d420750Cd9857E` | Community EOA (historical, migrated) |
| `0xC8f4B45fA0C4727E9b27c13Af3d000C922a2ac9c` | Treasury EOA (historical, migrated) |
| `0x80fF32c5441cBCbFa5c3ce0dC70359BDD05B6958` | Contributor "C2" (20,156,940.95 IFR locked in 10 TIME_ONLY tranches, unlock 29.07.2026) |

BTC donation: `bc1qu0z0yur24cck25wc6rmack9tvczvx6g50y9sse` (core-team EOA, disclosed).

### Sepolia (spot-check scope only)

Token `0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4` · Governance `0x6050b22E4EAF3f414d1155fBaF30B868e0107017` · IFRLock `0x0Cab0A9440643128540222acC6eF5028736675d3` · LiquidityReserve v2 `0xF7E90D0d17f8232365186AA085D26eaEfAf011aF` · Vesting `0xa710f9FE7bf42981E60BE2Fbe7D87Fb3541a3F8B` · BuybackVault v2 `0xC8ABb9039BEd24f4dBf5Cff09699877D81f0D63C` · BurnReserve v2 `0x6D4582FCac792FD3880e252fC0a585A0c1823e80` · PartnerVault v2 `0x5F12C0bC616e9Ca347D48C33266aA8fe98490A39` · FeeRouterV1 `0x499289C8Ef49769F4FcFF3ca86D4BD7b55B49aa4` · LP pair `0x2252e8bBDE0E50CD372748aC233A99C08627d9c7` · BootstrapVaultV3 `0x16086d4f7F191047d8A4fFf2090126E12e865A7E` · Deployer `0x5Ecc668eab04C5bee81b5c7242e1077c946dE406`.

## Per-contract risk notes (from source review at recon)

- **InfernoToken.sol** (4.2 KB) — `ERC20, ERC20Burnable, Ownable`. Defaults senderBurn 200 bps /
  recipientBurn 50 bps / poolFee 100 bps; `setFeeRates` hard cap sum ≤ 500 bps. Fee logic in
  `_update` override; fees skipped on mint/burn and when either party is `feeExempt`. 1B minted
  to deployer at construction; no mint function. Check: exemption semantics (`feeExempt` bypasses
  ALL fees incl. burns → supply-model consequences), `setPoolFeeReceiver` trust.
- **Governance.sol** (5.1 KB) — custom timelock, no OZ. delay 48h (MIN 1h / MAX 30d);
  `propose`/`execute` onlyOwner; `cancel` onlyOwnerOrGuardian; `setDelay`/`setOwner` onlySelf
  (routed through own timelock — W1 fix); **`setGuardian` onlyOwner, NOT timelocked (W15/M-01
  open)**; execution via raw `target.call(data)` — arbitrary-call power after delay.
- **IFRLock.sol** (4.5 KB) — ReentrancyGuard + Pausable. One lock per wallet; `unlock()`
  deliberately not pausable; guardian can only pause new locks. Views: `isLocked(user,minAmount)`,
  `totalLocked`. Local IERC20 with bool-return check.
- **CommitmentVault.sol** (10.6 KB) — 4 condition types (TIME_ONLY / PRICE_ONLY / TIME_OR_PRICE /
  TIME_AND_PRICE); MAX_TRANCHES 50; AUTO_UNLOCK_DELAY 30 days (permissionless unlock FOR the
  depositor, funds always to original wallet); `p0` set-once then immutable; **`_getCurrentPrice()`
  is a stub returning 0** → all price conditions fail-closed; mainnet priceOracle = 0x0 (OPS-002).
  Accounting depends on token feeExempt for the vault.
- **LendingVault.sol** (16.9 KB, largest) — IFR lending vs ETH collateral. INITIAL 200% /
  WARNING 150% / LIQUIDATION 120%, liquidator bonus 5%, interest 50/50 lender/protocol,
  utilization-tiered monthly rate 2→25%, MIN/MAX duration 30/365d, MAX_LOANS_PER_BORROWER 10.
  **All collateral math hinges on the single governance-set `ifrPriceWei`** — no oracle, no
  bounds, no freshness; mainnet = 0 → borrowing fail-closed (OPS-001). `liquidate()` permissionless;
  uses `payable.transfer()` (2300 gas) for collateral returns — can freeze collateral of contract
  borrowers. `calculateInterest` enforces minimum 1 month.
- **PartnerVault.sol** (20.2 KB) — ReentrancyGuard, Pausable, SafeERC20. rewardBps hard bounds
  500–2500; annual emission cap 1M–10M IFR; vesting 180–365d, cliff ≤ duration; algo throttle:
  reward scales toward MIN_REWARD_BPS as IFRLock lock-ratio goes 1%→50%; anti-double-count per
  (wallet, partnerId); authorizedCaller whitelist; `_checkAnnualCap` resets yearly window.
- **FeeRouterV1.sol** (8.5 KB) — EIP-712 "InfernoFeeRouter" v1 + ECDSA. `protocolFeeBps=5`,
  immutable cap 25 bps. `swapWithFee(adapter, swapData, voucher, voucherSig, useVoucher)` payable:
  fee to feeCollector via `.call`, remainder forwarded to whitelisted adapter **with arbitrary
  calldata** — adapter whitelist is the security boundary. Voucher: nonce-based replay protection
  but **`maxUses` never enforced (W19/L-03)**; **`setVoucherSigner`/`setFeeCollector` accept
  address(0) (W10/L-04)**; **no nonReentrant (W11/L-05)**.
- **BuybackVault.sol** (6.3 KB) — ETH→IFR buyback via Uniswap V2; 50/50 burnReserve/treasury;
  60-day activation delay; 1h cooldown; 5% slippage. `executeBuyback` onlyOwner, **no
  nonReentrant**; `setParams` bounded (W3 partially addressed).
- **BuybackController.sol** (9.8 KB) — permissionless `execute()` after 24h cooldown (bounds
  1h–7d), minTrigger 0.01 ETH, slippage 500 (max 1000). 50% buy-and-burn → immutable burnReserve,
  50% add-liquidity → lpReceiver; LP failure falls back to buyback. Emergency
  `withdrawETH`/`withdrawIFR` onlyOwner; **unchecked ERC20 return in withdrawIFR** (Slither
  baseline entry). **Mainnet owner = Deployer EOA** (verify current).
- **LiquidityReserve.sol** (5.7 KB) — immutable lockEnd/periodDuration (180d lock ended
  01.09.2026; 90-day periods); mutable maxWithdrawPerPeriod 50M IFR; withdraw onlyOwner + guardian
  pause. Held 200M IFR, 0 withdrawn at block 25918433. **Withdrawal capability is live now.**
- **Vesting.sol** (5.1 KB) — immutable except guardian. 150M IFR, 12m cliff (~05.03.2027) + 36m
  linear; `release()` onlyBeneficiary. **Not feeExempt → each release pays ~3.5% transfer fees
  (W6, accepted)**; guardian pause not rotatable (W18).
- **BurnReserve.sol** (3.6 KB) — deposit public; `burn`/`burnAll` onlyOwnerOrGuardian via
  ERC20Burnable; tokens can only be burned, never withdrawn.
- **BootstrapVaultV3.sol** (10.1 KB) — ReentrancyGuard only; zero admin surface. contribute
  0.01–2 ETH/wallet; `finalise()` permissionless after endTime with
  `addLiquidityETH(amountTokenMin=0, amountETHMin=0)` (W13 accepted); **LP tokens sent to the
  vault itself, Team.Finance locker disabled → LP permanently stranded, no withdrawal function
  (W17 accepted)**; V3 adds permissionless `refund()` after endTime + 30d grace. Finalized
  05.06.2026 with 100M IFR + 0.030 ETH; 3 contributors claimed.
- **BuilderRegistry.sol** (6.6 KB) — Ownable (owner=Governance); categories
  creator|integration|tooling|dao; 0 builders on mainnet (OPS-005).
- **Library modules** (`contracts/library/`, integration templates, not deployed as protocol):
  BaseAccessModule (soft lock), HardLockModule (7d–365d), TierModule (500/2,000/10,000 IFR),
  CooldownModule (24h), IFRBuilderVault (composition, self-labeled "SAFE 85-95/100"). Mocks:
  MockToken, MockRouter, MockInfernoToken, MockAdapter, MockBootstrapHelpers.

## Known-issues register (verify current status; do not re-report as new)

- **Skywalker internal audit** (`docs/SECURITY_AUDIT_SKYWALKER.md`, 2026-03-04, auditor
  "Claude Opus 4.6"): 10 contracts / 1,880 SLOC → **0 FAIL / 20 WARN (W16 fixed) / 81 PASS**.
  Highlights: W1 `setOwner()` timelock bypass (FIXED — setOwner now onlySelf through timelock;
  the 20.03.2026 direct setOwner was the pre-fix path, proposal #10 was cancelled for the
  "onlyOwner bug"); W3 unbounded setParams (partially addressed); W4 MEV; W6 Vesting pays
  transfer fees (accepted); W10 FeeRouter zero-address setters; W11 FeeRouter no nonReentrant;
  W13 bootstrap 0-min LP add (accepted); W15 setGuardian not timelocked (OPEN); W17 LP stranded
  in BootstrapVaultV3 (accepted, irreversible); W18 Vesting guardian not rotatable; W19 voucher
  maxUses unenforced.
- **OPS register** (`docs/KNOWN-ISSUES.md`): OPS-001 LendingVault ifrPriceWei=0 (fail-closed);
  OPS-002 CommitmentVault priceOracle=0x0 + stub; OPS-005 BuilderRegistry empty.
- **Slither baseline** (`audit/slither-high-baseline.json`, Slither 0.11.5 / solc 0.8.28):
  6 reviewed High signals — 3× by-design (BuybackController arbitrary-send-eth ×2, LendingVault
  liquidate bonus), 1× deprecated V1, 1× constrained/V2-hardening (BuybackController.execute
  reentrancy-eth), 1× hardening item (withdrawIFR unchecked-transfer). CI gate: 0 unreviewed
  High, 0 Critical on 21 production sources (PR #77).
- **Mythril** (`audit/mythril-config.json`): v0.24.8, bounded (2 tx / 30s exec / 10s solver),
  17 concrete contracts; 4 clean runs 04.09.2026 claimed; weekly CI gate.
- **Accepted risks** (`AUDIT_SCOPE.md`): ~21,000 IFR pre-FeeRouter pool fees on Deployer EOA
  (deliberately not re-routed); proposals #1–#3 cancelled as guardian tests.
- **Earlier internal results** (distinct from Skywalker): `AUDIT_SCOPE.md` "8 PASS, 2 WARN,
  0 FAIL"; `docs/SECURITY_AUDIT_REPORT.md` (10.06.2026): 0 critical / 5 Medium / 8 Low / 6 Info;
  bootstrap review (13.03.2026): 11/14 secure, 3 low, 0 critical.
- **External/community**: GROK audit (md+pdf in `audit/`); CHATGPT_AUDIT_V3–V5; **OKComputer
  community audit (27.07.2026, German, SHA-256 pinned in repo)** — most adversarial document:
  verdict "no classic scam, but massively overloaded one-person project, no real adoption, grave
  legal deficiencies (no Impressum/privacy/terms — §5 DDG/DSGVO/MiCA), ~$570 pool liquidity,
  LendingVault manual-oracle risk, 'fully audited' marketing without external audit". Several
  findings drove repo corrections (`docs/community-audits/README.md`).
- **Security contact**: GitHub Private Vulnerability Reporting only; **no bug bounty** (planned
  "Phase 5"); `docs/AUDIT_SUBMISSION.md` preps Code4rena/Sherlock (9 contracts, 1,697 SLOC).

## On-chain reads every audit run should perform (examples)

```bash
RPC=https://eth.llamarpc.com   # or any trusted mainnet RPC; record the block number
cast call 0xc43d48E7FDA576C5022d0670B652A622E8caD041 "delay()(uint256)" --rpc-url $RPC
cast call 0xc43d48E7FDA576C5022d0670B652A622E8caD041 "owner()(address)" --rpc-url $RPC
cast call 0x1e0547D50005A4Af66AbD5e6915ebfAA2d711F7c "owner()(address)" --rpc-url $RPC   # BuybackController: EOA or Governance?
cast call 0x974305Ab0EC905172e697271C3d7d385194EB9DF "ifrPriceWei()(uint256)" --rpc-url $RPC
cast call 0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3 "priceOracle()(address)" --rpc-url $RPC
cast call 0x77e99917Eca8539c62F509ED1193ac36580A6e7B "feeExempt(address)(bool)" 0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3 --rpc-url $RPC
cast call 0x77e99917Eca8539c62F509ED1193ac36580A6e7B "feeExempt(address)(bool)" 0x974305Ab0EC905172e697271C3d7d385194EB9DF --rpc-url $RPC
cast call 0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b "getThreshold()(uint256)" --rpc-url $RPC
cast call 0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b "getOwners()(address[])" --rpc-url $RPC
cast call 0xdc0309804803b3A105154f6073061E3185018f64 "maxWithdrawPerPeriod()(uint256)" --rpc-url $RPC
```

Compare against: documented invariant snapshot at block 25900438 (CommitmentVault
47,952,476.871794375 IFR; LendingVault 52,155,440.952845656 IFR, totalLent 0) and the repo's
4-hour vault-invariant monitor workflow (`vault-invariant-monitor.yml`).
