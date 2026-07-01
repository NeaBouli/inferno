# Inferno Protocol - Kaspa Dual-Layer Research Plan

> Status: Open research track
> Last updated: 2026-07-01
> Principle: Ethereum remains the production source of truth until a Kaspa path is proven, audited, and explicitly activated.

## 1. Objective

Inferno should be designed so the project can eventually operate on both:

- Ethereum Mainnet: current production layer for IFR token, locks, lending, governance, liquidity, and live transparency.
- Kaspa: potential second execution/settlement layer once programmability, wallet tooling, indexers, and security assumptions are mature enough.

This document is intentionally theoretical and modular. It does not activate a Kaspa token, bridge, contract, or user-facing fund flow.

## 2. Non-Negotiable Safety Premises

- No user funds on Kaspa until the architecture is reviewed and tested end to end.
- No second live IFR ticker without a clear canonical naming model.
- No bridge without documented lock/mint/burn/redeem rules.
- No production contracts or covenant scripts without independent review.
- No marketing claim that Inferno is live on Kaspa until there is a verified production deployment.
- Ethereum IFR remains canonical unless governance explicitly changes that.
- Every future Kaspa component must be visible in Transparency tracking before public activation.

## 3. Current Understanding of Kaspa Programmability

Kaspa is a proof-of-work blockDAG. The relevant programmability direction is covenant-based and differs fundamentally from Ethereum smart contracts.

Key concepts to track:

- Toccata hardfork: covenant-based base-layer programmability.
- SilverScript: high-level language/compiler for Kaspa covenant scripts.
- Native assets / KRC-style assets: potential base-layer asset path.
- ZK-related primitives: possible future path for verifiable off-chain execution.
- WASM SDK / Rusty Kaspa: current builder and infrastructure surfaces.
- vProgs: research path for verifiable programs.

Important distinction:

- Ethereum uses account-based EVM contracts.
- Kaspa uses UTXO/blockDAG mechanics and covenant-style spending rules.

Therefore, Inferno contracts cannot be copied directly from Solidity to Kaspa. Each module must be redesigned around Kaspa's execution model.

## 4. Target End State

The long-term target is a dual-layer Inferno architecture:

```text
Inferno Protocol
|--- Ethereum Layer
|   |--- Canonical IFR ERC-20
|   |--- IFRLock
|   |--- CommitmentVault
|   |--- LendingVault
|   |--- FeeRouter / Buyback / LP logic
|   `--- Governance + Transparency
|
|--- Kaspa Layer
|   |--- Kaspa wallet integration
|   |--- Kaspa asset representation, if approved
|   |--- Covenant-based access or vault modules
|   |--- Kaspa event/indexer adapter
|   `--- Kaspa transparency feed
|
`--- Cross-Layer Coordination
    |--- Canonical asset policy
    |--- Bridge or proof model
    |--- Unified user identity / wallet linking
    |--- Unified transparency API
    `--- Governance-controlled activation gates
```

## 5. Architecture Options

### Option A - Research-Only / Read-Only Kaspa Integration

Scope:

- Add Kaspa education and status pages.
- Read Kaspa network data.
- Connect/display a Kaspa address if wallet tooling is mature.
- No token, no bridge, no deposits.

Risk:

- Low.

Use:

- Best first step.

### Option B - Kaspa Support Layer Without IFR Movement

Scope:

- Allow users/builders to link Kaspa addresses to Inferno profiles.
- Use Kaspa as an identity, payment, or verification signal.
- Keep all IFR balances and protocol state on Ethereum.

Risk:

- Medium-low.

Use:

- Good second step if wallet tooling is stable.

### Option C - Wrapped / Represented IFR on Kaspa

Scope:

- Lock canonical Ethereum IFR in a bridge vault.
- Mint or issue a Kaspa-side representation such as `kIFR` or another clearly separated name.
- Redeem by burning the Kaspa representation and unlocking Ethereum IFR.

Risk:

- High.

Requirements:

- Bridge design.
- Indexer finality rules.
- Emergency pause.
- Public reserve proof.
- Independent audit.
- Transparency dashboard before launch.

### Option D - Native Kaspa Inferno Modules

Scope:

- Rebuild selected Inferno functions as Kaspa covenant modules.
- Possible targets:
  - Access lock equivalent.
  - Timed/conditional vaults.
  - Builder reward escrow.
  - Proof-based cross-layer actions.

Risk:

- High.

Note:

- Lending and automated market logic should be considered late-stage only.

## 6. Module Compatibility Matrix

| Inferno Module | Ethereum Status | Kaspa Candidate | Portability | Notes |
| --- | --- | --- | --- | --- |
| IFR token | Live ERC-20 | Native/wrapped representation | Medium/High risk | Requires canonical asset policy. |
| IFRLock | Live | Covenant access lock | Medium | First real module candidate after research. |
| CommitmentVault | Live | Timed/conditional covenant vault | High | Needs careful unlock condition modeling. |
| LendingVault | Live | Kaspa-native credit market | Very high | Do not start early. |
| FeeRouterV1 | Live | Fee accounting adapter | High | Depends on asset and transfer model. |
| Buyback/LP | Live | DEX/liquidity adapter | Very high | Depends on Kaspa DeFi maturity. |
| Governance | Live Ethereum timelock | Cross-layer governance relay | High | Governance must remain explicit and transparent. |
| Transparency | Live API/wiki | Kaspa adapter | Medium | Good early integration target. |
| AI Copilot | Live | Dual-layer knowledge/context | Low | Add only verified facts and clear status labels. |

## 7. Monorepo Target Structure

Potential future structure, not yet active:

```text
inferno/
|--- contracts/
|   `--- ethereum/
|       `--- solidity contracts
|
|--- kaspa/
|   |--- research/
|   |   |--- architecture.md
|   |   |--- wallet-tooling.md
|   |   `--- covenant-patterns.md
|   |--- scripts/
|   |   `--- experiments only
|   |--- adapters/
|   |   |--- rpc-client
|   |   `--- indexer-client
|   `--- modules/
|       |--- access-lock
|       |--- vaults
|       `--- bridge
|
|--- apps/
|   |--- ai-copilot/
|   |--- kaspa-lab/
|   `--- dashboard/
|
|--- docs/
|   |--- KASPA_DUAL_LAYER_PLAN.md
|   `--- wiki/
|
`--- scripts/
    |--- verify-ethereum-state
    `--- verify-kaspa-state
```

Rule:

- `kaspa/` starts as research-only. No production build path should depend on it until explicitly activated.

## 8. Step-by-Step Roadmap

### Step 0 - Keep Ethereum Stable

- Do not change canonical IFR tokenomics.
- Do not alter Ethereum contracts for Kaspa assumptions.
- Keep all current live tracking green.

### Step 1 - Research File Set

- Create dedicated research docs.
- Track official Kaspa docs, KIPs, SDKs, wallet support, indexers, and explorers.
- Record uncertainties instead of filling gaps with assumptions.

### Step 2 - Read-Only Prototype

- Build a local-only Kaspa RPC test script.
- Fetch network status, block/DAG info, and address data.
- No wallet signatures.
- No user funds.

### Step 3 - Wallet Compatibility Review

- Identify production-safe Kaspa wallet options.
- Check browser connect/signing APIs.
- Document UX and security limits.
- Decide whether a landing-page wallet UI is safe.

### Step 4 - Transparency Adapter

- Add a Kaspa adapter behind the existing transparency API model.
- Show separate status labels:
  - Ethereum live
  - Kaspa research
  - Kaspa testnet
  - Kaspa production, only after activation

### Step 5 - Asset Policy

- Decide whether a Kaspa-side asset is needed.
- Define naming:
  - canonical Ethereum IFR
  - possible Kaspa representation
  - no confusing ticker collision
- Define reserve proof and redemption rules.

### Step 6 - Covenant Module Design

- Model IFRLock equivalent first.
- Model CommitmentVault second.
- Avoid LendingVault until covenant patterns and liquidity tools are proven.

### Step 7 - Testnet / Sandbox

- Use testnet or isolated sandbox only.
- Add automated tests.
- Add negative tests for stuck funds, replay, double mint, wrong finality, and indexer failure.

### Step 8 - Security Review

- Internal review.
- Public review.
- External audit before any bridge or user funds.
- Update `docs/wiki/security.html` and transparency docs only after review status is clear.

### Step 9 - Governance Activation

- Any production Kaspa activation must be governance-documented.
- Activation checklist:
  - contracts/scripts verified
  - transparency live
  - emergency pause documented
  - naming clear
  - user warning text reviewed
  - audit status public

### Step 10 - Dual-Layer Production

- Ethereum remains canonical.
- Kaspa modules are enabled only for reviewed functions.
- All live values appear in Transparency and AI Copilot context.
- Landing page shows Kaspa only as live when the system is actually active.

## 9. Open Questions

- Is the Kaspa programmability surface fully live on mainnet or still staged by feature?
- Which wallet connector is the safest production option?
- Which explorer/API/indexer can support reliable transparency tracking?
- Can native Kaspa assets represent IFR safely without confusing the market?
- What finality rule should a cross-layer bridge use?
- Can covenant scripts safely model access locks and timed tranches?
- What emergency controls are possible on Kaspa without introducing admin custody risk?
- Which audit firm or independent reviewer understands Kaspa covenants well enough?

## 10. Immediate TODO

- [ ] Track official Kaspa Toccata/Covenants status and source links.
- [ ] Review Kaspa WASM SDK and Rusty Kaspa examples.
- [ ] Create local-only `kaspa/research/` folder when actual experiments begin.
- [ ] Identify wallet connector candidates.
- [ ] Draft canonical asset policy before any token representation.
- [ ] Draft read-only transparency adapter design.
- [ ] Keep this plan separate from live Ethereum production code until implementation is approved.

## 11. Decision Log

- 2026-07-01: Created as an open theoretical research track. No production activation. No bridge. No Kaspa token representation.
