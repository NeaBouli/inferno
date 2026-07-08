# Phase 3 Open Items Status - 2026-07-08

This note records the current state of the six active operational items after the Web3 user-surface audit.

## 1. LendingVault Borrow Activation

Status: prepared, not executed.

- `LendingVault.ifrPriceWei()` is still `0`, so the contract intentionally blocks borrower transactions.
- `scripts/prepare-lending-price-governance.js` dry-runs the full Safe/Governance path.
- Latest dry-run candidate from the thin Uniswap V2 spot pool, rechecked 2026-07-08: `9281498741` wei per IFR.
- Current pool read used by the script: `18,020,208.679814493 IFR` and `0.16725454417891158 ETH`.
- The Safe Transaction Builder payload is written to `/tmp/inferno/lending-price-safe-tx.json`.
- Latest script validation:
  - `node scripts/prepare-lending-price-governance.js --self-test`: PASS
  - `node scripts/prepare-lending-price-governance.js --write-safe-json`: PASS

Open next step: choose a final price policy, submit the Safe transaction to `Governance.propose(LendingVault, setIFRPrice(candidate))`, wait 48 hours, execute, then verify Web3/Wiki borrowing.

Policy note added:

- `docs/LENDING_PRICE_POLICY_20260708.md`

## 2. CommitmentVault Price-Condition Locks

Status: intentionally disabled for price conditions.

- Time-only CommitmentVault locks are live.
- `CommitmentVault.priceOracle()` is currently not a complete activation path.
- The deployed contract's `_getCurrentPrice()` still returns `0`; the TWAP oracle call exists only as a commented Phase 2 placeholder in source.
- Setting a nonzero `priceOracle` address alone would not make price-based unlocks functional.

Open next step: deploy or replace with a compatible oracle-enabled implementation path before enabling price-only, time-or-price, or time-and-price locks in UX.

Design note added:

- `docs/COMMITMENT_PRICE_LOCK_ORACLE_PATH.md`

## 3. Dependency Security Backlog

Status: partially reduced, larger migration remains.

- `npm audit` before safe lockfile update: 62 vulnerabilities.
- Non-forced `npm audit fix --package-lock-only` reduced the current audit to 61 vulnerabilities.
- Remaining critical/high findings are mostly inherited through the Hardhat 2, Ethers v5, Waffle/Ganache, Solc, and Undici toolchain.
- Force-fixing would require breaking migrations such as Hardhat 3 / Ethers 6 or Waffle removal and must be handled as a dedicated engineering branch.

Open next step: plan a separate dependency modernization branch. Do not run `npm audit fix --force` on `main` without full contract test coverage.

## 4. External Listings And Reputation

Status: improved, still has follow-up items.

- Uniswap Default Token List issue #2509 is still open and was updated with Etherscan Neutral plus live metadata/icon links.
- Official token lists are live:
  - `https://ifrunit.tech/token-list.json`
  - `https://ifrunit.tech/.well-known/token-list.json`
- GeckoTerminal pool/profile is visible and includes IFR protocol copy.
- Etherscan token reputation now reads `Neutral`, not `Unknown`.
- MetaMask contract-metadata retry is now open:
  - `https://github.com/MetaMask/contract-metadata/pull/1858`
- MetaMask follow-up comment posted on 2026-07-08 because the PR is waiting for code-owner review:
  - `https://github.com/MetaMask/contract-metadata/pull/1858#issuecomment-4912859782`
- ethereum-lists PR #1036 is still open with no maintainer review/comment:
  - `https://github.com/ethereum-lists/tokens/pull/1036`
- ethereum-lists follow-up comment posted on 2026-07-08:
  - `https://github.com/ethereum-lists/tokens/pull/1036#issuecomment-4912862731`
- Wallet icon distribution status is documented:
  - `docs/WALLET_ICON_DISTRIBUTION_STATUS_20260708.md`
- CMC check script is present, but local `CMC_API_KEY` is not set, so CMC listing status was not queried.

Open next step: resume MetaMask registry submission now that Etherscan is neutral, keep watching Uniswap issue #2509, and run CMC check only with a local key.

## 5. Web3 UX Backlog

Status: borrower UX improved; deeper batch-lock work remains.

- Web3 already supports user actions directly on the page:
  - wallet connect
  - add IFR to wallet
  - buy/track IFR
  - IFRLock access lock/unlock
  - CommitmentVault time-only lock/unlock
  - LendingVault create/increase/withdraw offer
  - LendingVault borrow/repay/top-up flow, gated until `ifrPriceWei` is set
- Added collateral health badges for active borrower loans:
  - `Healthy`
  - `Warning`
  - `Liquidation`
  - `Price not set`
- CommitmentVault batch-lock UX still needs a contract-native path. A helper contract is not clean because the current vault locks by `msg.sender`.

Open next step: design native `lockBatch` / `lockSplit` support or accept the current multi-confirmation UX.

## 6. StealthX / Partner App Tasks

Status: external product-repo work, not safe to implement inside this repository.

- IFR integration specification remains in `docs/STEALTHX_IFR_INTEGRATION.md`.
- Current direction is browser-based IFR balance verification and partner discount flow.
- App-side tasks such as Android first-run permissions, invitation/QR fixes, and in-app purchase repair live outside this repo.

Open next step: keep this repo as the IFR protocol/source-of-truth layer and track StealthX app tasks in the product repositories.
