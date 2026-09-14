# IFR Protocol — Web3 Integration Audit (wallets, wiring, interfaces)

**Auditor:** Collateral Web3 Open Audits
**Client:** NeaBouli / Inferno Protocol (ifrunit.tech)
**Date:** 2026-09-14
**Baselines:** repo `NeaBouli/inferno` @ `eb538a355001b042b343bfb19221af2407a96e63` · mainnet
block 25971217 · Playwright @repo version (chromium-headless-shell v1228) · Foundry 1.7.1
**Method skill:** `web3-integration-audit` (function & wiring, proven)
**Companion documents:** full-scope audit (CWA-01…24, PR #90), contract deep audit +
surfaces supplement (CWA-25…45, PR #91)
**Report version:** 1.0

This audit answers a different question than the security reviews: **is everything correctly
wired, and does it actually work?** Scope: the `/web3/` dApp (identical on apex and
web3.ifrunit.tech), the `shop.ifrunit.tech` Benefits frontend, the Benefits wallet prototype,
the wiki verify flow, and the API wiring that serves them.

**Verdict: WORKS — with findings.** Every contract call path in the dApp is selector-exact, the
repo's own browser suites pass 44/44 locally, chain enforcement is fail-closed, and the
write flows use exact-amount approvals with confirmation-gated success messages. Three findings:
a mislabeled loan-struct decoder in the copilot API (CWA-46), a runtime third-party script
dependency on the signing page (CWA-47), and a wrong-by-default offline fallback in the state
reader (CWA-48).

## 1. Executive summary

The wallet and contract layer is well built: EIP-6963 discovery with legacy fallback, deliberate
WalletConnect v2 setup (pinned version, minimal method surface, mainnet-only), exact-amount
approvals, `tx.wait()` before any success claim, consistent 9-decimal handling everywhere, and
the lending borrow UI is correctly disabled while the price oracle is unset (matches chain
state). The repo's Playwright suites (20 wallet-connect + 24 web3-write tests) reproduce green
in a clean environment.

The findings are integration-accuracy issues, not security holes: one API decodes the loan
struct wrong (harmless today — zero loans — but wrong as-coded), one runtime CDN dependency
weakens the otherwise fully self-hosted signing page, and one fallback path presents wrong
bootstrap state instead of an honest error when RPCs fail.

**Findings: 0 Critical · 0 High · 1 Medium · 2 Low · 2 Informational (CWA-46 … CWA-50)**

## 2. Touchpoint inventory

**`/web3/` dApp** (static page; identical bytes on apex and web3.ifrunit.tech — verified):
- Scripts: vendored `ethers-6.17.0.umd.min.js` (self-hosted, integrity-positive), then
  `web3-wallet-core.js` (IFRWallet v4.3) and `assets/ifr-state.js` (IFRState).
- Wallet layer: EIP-6963 `announceProvider`/`requestProvider` + legacy multi-provider handling;
  WalletConnect v2 via `@walletconnect/ethereum-provider@2.17.3` with
  `methods: ["eth_sendTransaction", "personal_sign"]` only, `chains: [1]`, real project ID,
  QR on desktop, URI handoff + 30 s recovery polling on mobile; MetaMask deeplink helper;
  EIP-747 `wallet_watchAsset` with canonical token metadata (decimals 9).
- Contracts called: InfernoToken, IFRLock, CommitmentVault, LendingVault (write flows);
  BootstrapVaultV3 (status reads).
- Signatures: none in the dApp itself (no `personal_sign` usage found on a write path — the WC
  method list is just capability declaration).
- Reads: `eth.llamarpc.com` fallback provider; 60 s auto-refresh in IFRState.

**`shop.ifrunit.tech` (Benefits frontend, Next.js 15 + wagmi):**
- Connectors: `injected()`, `injected({target:'phantom'})`, `coinbaseWallet`, and
  `walletConnect` **only when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set** — a missing ID
  hides the connector instead of presenting a broken one (matches the "not configured yet"
  docs; correct gating).
- Chains: mainnet by default, Sepolia only via `NEXT_PUBLIC_CHAIN_ID`; RPC overridable via env
  with publicnode fallback.
- Contracts: token / IFRLock / CommitmentVault with minimal ABIs (verified below), IFR_DECIMALS
  = 9 enforced in `formatIFR` via bigint arithmetic (no float rounding of base units).
- Signature flows (server-challenge based) live in the backend and were reviewed in the
  surfaces supplement (CWA-35/36); the SDK's benefits client byte-for-byte validates the
  challenge template before signing.

**Benefits wallet prototype:** deliberately capability-free (Sepolia-only, no transfer/approval
paths, CDP export with `skipMfa={false}`) — nothing to mis-wire.

**Wiki verify page:** client-side EIP-191 signing against the Telegram verify API; the crypto
check is correct server-side (recovered address compared to claimed wallet); the server-side
weaknesses are CWA-31…34.

## 3. Wiring verification (selector-precise)

Method: canonical 4-byte selectors computed from the compiled artifacts at the pinned commit vs.
every human-readable ABI fragment embedded in the dApp page (script: `evidence/selector-check.mjs`).

**Result: 31/31 MATCH, 0 problems** (`evidence/selector-check.txt`) — every function the dApp
calls exists on the deployed contracts with the exact signature used:

- InfernoToken: `balanceOf` `allowance` `approve`
- IFRLock: `lock` `lockWithType` `unlock` `lockedBalance` `lockInfo`
- CommitmentVault: `lock(uint256,uint8,uint256,uint256)` `unlock(address,uint256)`
  `lockedBalance` `getTrancheCount` `getTranche` `isConditionMet` `priceOracle`
- LendingVault: `createOffer` `increaseOffer` `withdrawOffer` `borrow` `repay`
  `topUpCollateral` `hasOffer` `lenderOfferIndex` `ifrPriceWei` `getRequiredCollateral`
  `getInterestRate` `getOfferCount` `getOffer` `getLoanCount` `getLoan` `calculateInterest`
  `getCollateralRatio`

Struct decoding order verified manually against the contracts: `Tranche` (amount, cType,
unlockTime, p0Multiplier, unlocked, conditionMetAt) and `Loan` (borrower, offerId, ifrAmount,
ethCollateral, startTime, duration, monthlyRateBps, active) match the page's tuple definitions
exactly; the shop frontend's `getTranches` components match as well. Bootstrap status tuple
(`active, _finalised, totalETH, timeRemaining, contributorCount`) matches `getBootstrapStatus`.

Write-flow mechanics verified in source (`docs/web3/index.html` script block):
- **Lock:** reads `balanceOf` + `allowance` first, honest insufficient-balance error naming the
  exact amounts, **exact-amount approve only when allowance insufficient**, waits for the
  approval receipt, then `lock`/`lockWithType(amount, bytes32(lockType))`, success text only
  after `tx.wait()`. Unlock path: `unlock()` + confirmation, no re-approval needed (suite
  "existing IFRLock balance can be unlocked without another approval" passes).
- **Commitment:** `approve(totalAmount)` then per-tranche `lock(amount, cType, unlockTime,
  p0Multiplier)`; the UI's condition-type selector maps to the contract enum with correct
  ordinals (0=TIME_ONLY … 3=TIME_AND_PRICE) — note the contract-side permanence risk for price
  types is CWA-03, and the page correctly does not hide that price conditions are unavailable.
- **Lending:** `createOffer`/`increaseOffer` with exact approve; `borrow(offerId, amount,
  durationDays, {value: collateral})` with collateral preview from `getRequiredCollateral` —
  and the whole borrow path is **transaction-disabled while `ifrPriceWei == 0`** (UI label
  "Disabled"; proven by the suite). `repay` approves principal + interest; `topUpCollateral`
  payable top-up.
- All amounts handled in base units via `parseUnits(..., 9)`/`formatUnits(..., 9)` — no float
  rounding of IFR values (the repo AGENTS.md rule is honored).

## 4. Configuration findings

| Check | Result |
|---|---|
| dApp chain enforcement | mainnet enforced at connect (hex/decimal/zero-padded chain IDs all parsed; rejection throws `WRONG_NETWORK` before any state) — fail-closed, suite-proven |
| Chain-change handling | full page reload on `chainChanged`; account change re-derives signer and re-reads state; disconnect cleans localStorage |
| dApp addresses | all 4 + bootstrap + pair match the verified deployment map (block 25971217) |
| Shop env defaults | mainnet-first (`NEXT_PUBLIC_CHAIN_ID || 1`); mainnet addresses only default when chainId=1, empty string otherwise (fail-closed) |
| WalletConnect config | real project ID, mainnet-only, minimal methods — correct; project ID is public by design (Info: restrict allowed origins in the Reown dashboard) |
| RPC endpoints | llamarpc (dApp), publicnode fallback (shop/liquidity calculator); public RPCs see user IPs — disclosed in the wiki liquidity page |
| ethers.js delivery | **self-hosted** UMD build (v6.17.0) — the right pattern; contrast CWA-47 |

## 5. Dynamic execution results

- **Playwright suites at the pinned commit: 44/44 PASS (29.4 s)** — 20 wallet-connect + 24
  web3-write tests (`evidence/playwright-run.log`). Environment note: the first run failed
  40/44 purely because the repo-pinned Playwright browser build (chromium-headless-shell v1228)
  was not installed on this machine; after `npx playwright install chromium` all 44 passed.
  Nothing in the app caused the initial failures.
  Highlights among the proven behaviors: wrong-chain rejection fails closed *before* any
  connected state; WalletConnect-style numeric and zero-padded-hex mainnet IDs connect without
  false errors; EIP-6963 dedup; exact-approve + typed lock only on mainnet; IFR base units
  preserved through CommitmentVault/LendingVault writes; borrowing stays disabled at price 0;
  self-hosted ethers asset enforced; service-worker offline shell bounded.
- **Benefits wiring battery: 13/13 suites PASS** — the project's own `test:benefits-*` and
  routing/wiki suites (money math, service worker, offline shell, wallet asset, pass UI,
  discovery UI, wallet UI incl. negative scenarios, CSP gate, fullstack e2e with production
  Next.js build, bundle budget, doc consistency, surface routing, wiki head integrity).
  Environment notes (`evidence/benefits-suites-exitcodes.txt`, `benefits-suites-round2.txt`):
  the apps carry their own lockfiles, so a root-only `npm ci` leaves
  `apps/benefits-network/*/node_modules` empty and 8 suites fail on missing dependencies —
  after per-app `npm ci` (the CI recipe) they pass; the CSP gate additionally requires a
  running frontend (`BENEFITS_BASE_URL`, default `127.0.0.1:3000`) and passes once it is
  started (`CSP compatibility gate passed`). No product failure was found in either round.
- Fork-level write simulation against an anvil mainnet fork was not needed for a verdict: the
  contract logic itself is fuzz-proven in the deep audit, and the dApp's flows are
  selector-exact with suite-proven UX. No live transactions were sent (read-only policy).

## 6. Findings

### Medium

#### [CWA-46] copilot-api decodes the LendingVault `Loan` struct with a shifted ABI
- **Severity:** Medium (dormant today) · **Likelihood:** certain once loans exist · **Status:** Open
- **Component:** `apps/ai-copilot/server/index.ts:1571-1575` (`LV_LOAN_ABI`)
- **Description:** the API's `getLoan` ABI declares
  `tuple(address borrower, uint256 ifrAmount, uint256 ethCollateral, uint256 startTime, uint256 duration, uint256 monthlyRateBps, uint256 repaidAt, bool active)`.
  The deployed struct is `(borrower, offerId, ifrAmount, ethCollateral, startTime, duration,
  monthlyRateBps, active)`. The API fragment **omits `offerId` and invents `repaidAt`**, so every
  uint256 field after `borrower` is read from the wrong slot: `ifrAmount` actually returns the
  offer ID, `ethCollateral` returns the IFR amount, `startTime` returns the collateral, and so
  on. Affects `/api/lending/loans/:address` and `/api/lending/health/:loanId` field values.
- **Impact:** today zero — `getLoanCount() = 0` on-chain (verified, block 25971217). From the
  first real loan onward, users and the AI copilot would see/serve wrong amounts and dates.
- **Evidence:** contract struct `contracts/vault/LendingVault.sol:51-60`; the dApp page's own
  (correct) tuple for contrast. Selector `0x504006ca` is unaffected — the bug is decoding-side.
- **Recommendation:** fix the ABI to the real struct order and add a decoding test against a
  known mainnet loan fixture before lending activation.

### Low

#### [CWA-47] WalletConnect provider is imported from the esm.sh CDN at runtime
- **Severity:** Low · **Likelihood:** low · **Status:** Open
- **Component:** `docs/web3-wallet-core.js:47,283-346`
- **Description:** `import("https://esm.sh/@walletconnect/ethereum-provider@2.17.3")` executes
  third-party-hosted code at runtime on the page that handles signing sessions. The version is
  pinned and the choice is documented (jsdelivr bundling broke), but there is no integrity
  mechanism for ESM imports and no fallback; combined with the missing CSP on web3.ifrunit.tech
  (CWA-10), a compromised/unreachable esm.sh silently breaks or could alter the connect flow.
- **Recommendation:** self-host a bundled WC provider (same pattern as the vendored ethers UMD)
  or add a CSP `script-src` allowlist once headers ship on the nginx host.

#### [CWA-48] IFRState's last-resort fallback presents wrong bootstrap state as fact
- **Severity:** Low · **Likelihood:** low (requires both RPC paths failing) · **Status:** Open
- **Component:** `docs/assets/ifr-state.js:113-122`
- **Description:** if the aggregated and individual bootstrap reads both fail, the state object
  falls back to hardcoded defaults claiming `finalized: false` and `totalETHRaised: "0.0"` —
  while the chain truth (verified) is `finalised = true`, 0.03 ETH, 3 contributors. The failure
  direction is funds-safe (no false "claim now" affordance), but the UI states a wrong fact
  instead of saying "unknown".
- **Recommendation:** surface an explicit "status unavailable" state instead of defaults; if
  defaults are kept, at least set `finalized: true` and label the values as cached/unknown.

### Informational

- **[CWA-49] WalletConnect project ID is hardcoded and public** (`web3-wallet-core.js:38`) —
  by design for client-side IDs, but the Reown dashboard should have origin restrictions set;
  not verifiable from outside.
- **[CWA-50] ifr-state reads cover token/lock/bootstrap only** — CommitmentVault/LendingVault
  numbers on the site come from the copilot API instead of direct reads; consistent with the
  architecture, but it makes CWA-46-class API decoding bugs user-visible. Prefer direct chain
  reads (the pattern exists in the liquidity calculator) for money-critical numbers.

## 7. Honest limitations

No real-device wallet testing (MetaMask/Trust/Coinbase mobile flows are mock-level only, via the
project's own suites); the WalletConnect QR handshake was not executed end-to-end with a live
relay; no write transactions on live networks (read-only policy); shop frontend reviewed at
config/library level plus backend-covered flows, not pixel-level. The initial Playwright
environment failure was tooling, not product — stated here because the report's credibility
depends on that distinction.

— Collateral Web3 Open Audits, 2026-09-14
