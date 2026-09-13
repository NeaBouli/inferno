---
name: collateral-web3-audit
description: >-
  Full-scope professional security audit of the IFR Protocol / Inferno project — website
  ifrunit.tech with subdomains (web3, shop, copilot-api, points-api, verify-api), all 36 wiki
  pages, the public GitHub repo NeaBouli/inferno, and the 14 deployed Ethereum mainnet contracts —
  producing an audit report issued as "Collateral Web3 Open Audits". Use this skill whenever the
  user asks to audit, security-review, or verify the IFR/Inferno project, ifrunit.tech, the
  NeaBouli/inferno repository, the IFR token, or any of its contracts, vaults, safes, apps, or
  APIs; whenever they mention "Collateral Web3 Open Audits", an IFR audit report, pre-launch or
  pre-listing security review for IFR, or checking whether IFR documentation claims are true; and
  whenever a broad "check the whole project" request targets this ecosystem. The skill ships the
  verified project inventory (contract addresses, API endpoints, known-issues register W1–W21,
  claims-drift list), so the audit starts from established facts instead of re-discovery.
compatibility: "Claude Code (~/.claude/skills/), Kimi Code, Cowork"
---

# Collateral Web3 Open Audits — IFR Protocol full-scope audit

This skill produces a professional, evidence-backed audit report for the IFR Protocol (Inferno,
IFR token, ifrunit.tech). It builds on the method discipline of the generic `code-audit` skill
(trace concrete exploit paths; distinguish "missing" from "wrong"; no silent scope skipping) and
specializes it for this project's real surface, which is already inventoried in `references/`.

The project's own documentation states that an independent third-party audit is **pending** — this
skill exists to produce exactly that review. Treat every comfort claim in the docs as a hypothesis
to verify, never as established fact: this project has a documented history of claims drift
(test counts, "audited" wording, tier tables). That history is why the report's credibility comes
from verification, not from reading.

## Reference files (read them — they are the factual baseline)

- `references/contract-map.md` — every deployed contract with address, roles, key constants,
  per-contract risk notes, the known-issues register (Skywalker W1–W21, OPS-001–005, accepted
  risks), and the Safe/EOA/Sepolia tables.
- `references/project-surface.md` — full URL/subdomain inventory, API endpoint map with observed
  responses, security-header baselines per surface, external links, and the web oddities list.
- `references/claims-register.md` — every public claim that must be verified (test counts, audit
  claims, coverage, Slither/Mythril gates, doc inconsistencies), each with its dated source and
  how to verify it.
- `references/report-template.md` — the mandatory report skeleton with boilerplate sections.

## Hard rules

1. **Baseline lock first.** Before any finding, record: repo commit SHA of `main`
   (`gh api repos/NeaBouli/inferno/branches/main`), the current mainnet block number, and the
   date. Every on-chain statement in the report cites that block; every code statement cites that
   commit. A finding without a pinned baseline is not reproducible.
2. **Chain state is ground truth.** Never cite the website's live widgets or wiki tables as
   evidence. Read contract state directly (`cast call` against a public RPC such as
   `https://eth.llamarpc.com`, or Etherscan's verified-contract read API). Example:
   `cast call 0xc43d48E7FDA576C5022d0670B652A622E8caD041 "delay()(uint256)" --rpc-url https://eth.llamarpc.com`
3. **Dated sources for every doc claim.** When the report mentions a claim ("644 tests",
   "0 FAIL / 20 WARN / 81 PASS"), cite the document AND its date. Where two docs disagree, say so
   explicitly — that disagreement is itself a finding (documentation domain).
4. **Known issues are verified, not re-discovered.** The W1–W21 / OPS register in
   `references/contract-map.md` contains already-documented issues. For each: verify its current
   on-chain/source status and classify it as *Still open / Mitigated / Fixed / Accepted risk —
   verified*. Do not present a documented accepted risk as a new Critical finding; do report it
   prominently if its on-chain state diverges from its documented state.
5. **Read-only, always.** No transactions, no message signing, no POSTs to live APIs beyond what
   the public site itself performs via GET. Source-level review of auth flows (SIWE, JWT, voucher
   signing) happens against the repo, not against the live service. Anything beyond — active
   probing, load tests, authenticated endpoint tests — requires a separate written authorization
   from the project owner and must be declared in the report's methodology section.
6. **Report, don't fix.** The audit proposes remediations; it never edits the audited code.
7. **Honest tally.** Every in-scope item ends with an explicit result. "Not reviewed" must be
   listed openly in the scope section — a silent skip invalidates the report.

## Workflow

### Phase 0 — Scope and baseline

- Pin commit SHA, block number, date (Hard rule 1).
- Build the scope table from `references/contract-map.md` §Addresses and
  `references/project-surface.md` §Inventory: 14 mainnet contracts + LP pair + 3 Gnosis Safes,
  repo areas (`contracts/`, `apps/`, `scripts/`, `.github/workflows/`, `docs/`), web surfaces
  (apex, web3, shop, wiki), APIs (copilot-api, points-api, verify-api, shop `/api`).
- Declare out-of-scope explicitly (default: Sepolia contracts beyond spot-checks, `patches/`
  historical archive, sub-apps marked placeholder, third-party services).

### Phase 1 — Documentation and claims audit

Work through `references/claims-register.md` line by line. For each claim: verify against source
or chain, record *Confirmed / Diverged / Unverifiable* with evidence. Add any new inconsistencies
found along the way. This phase is fast and produces the "Documentation & Claims Consistency"
chapter — it also calibrates how much trust the remaining phases can place in the docs.

### Phase 2 — Smart-contract audit

For each contract in `references/contract-map.md` (core first: InfernoToken, Governance,
IFRLock, CommitmentVault, LendingVault, PartnerVault, FeeRouterV1, BuybackVault,
BuybackController, LiquidityReserve, Vesting, BurnReserve, BootstrapVaultV3, BuilderRegistry):

1. Read the full source at the pinned commit. Walk the per-contract risk notes in the map —
  they point at the historically interesting lines.
2. Run the generic checklist: reentrancy & CEI ordering, access control on every privileged
   function, external-call trust and return-value checks, integer/rounding (9-decimals token,
   bps arithmetic), event coverage for state changes, griefing/DoS vectors, fee-on-transfer
   accounting interactions, time manipulation assumptions.
3. Verify the **feeExempt invariant** specifically: CommitmentVault and LendingVault accounting
   correctness depends on token-level fee exemption. Trace what breaks if `setFeeExempt` removes
   a vault while positions exist. This is the protocol's single most load-bearing operational
   assumption.
4. Verify on-chain state against the map: `owner()`, `guardian()`, `delay()`, `feeExempt(vault)`,
   `ifrPriceWei()`, `priceOracle()`, balances vs. the documented invariant snapshot, Safe
   thresholds and signer sets (`getThreshold()`, `getOwners()`).
5. Re-run the static gates locally if the toolchain allows (Slither 0.11.5, solc 0.8.28,
   Mythril 0.24.8 per `audit/` configs in the repo) or review the committed baselines and CI
   status (`gh run list --repo NeaBouli/inferno`). Report actual results, not README claims.
6. Check the register: every W-/OPS-item's current status (Hard rule 4).

### Phase 3 — Web-surface audit

Baselines and observed states are in `references/project-surface.md`. Verify, don't assume:

- **Transport hardening** per surface: re-check the security-header matrix (CSP, frame
  protection, HSTS, nosniff, Referrer-/Permissions-Policy). The known weak spot is
  `web3.ifrunit.tech` — a wallet-connect dApp previously served with zero hardening headers;
  confirm or refute, and assess impact (clickjacking a signing UI).
- **Address integrity:** every contract address embedded in site/dApp/shop JavaScript must match
  `references/contract-map.md` exactly. A swapped address on a "lock" or "approve" button is a
  Critical finding; check all of them, including `c2Addr` and RPC endpoints.
- **Client-side logic:** `/builder.html` "Security Score", `/web3/` lock/unlock flows, shop
  QR/pass flows — look for trust in client-computed values, missing expiry checks, XSS sinks
  (wallet addresses, tier names, offer data rendered into DOM).
- **Third-party dependencies:** fonts/CDN/RPC endpoints; note privacy and integrity exposure
  (no SRI on cdnjs, public RPCs see user IPs).

### Phase 4 — API audit

Endpoint map and observed responses: `references/project-surface.md` §API. Source code lives in
the repo under `apps/ai-copilot/server/`, `apps/points-backend/`, `apps/benefits-network/backend/`
— audit the source, probe only public GETs:

- Information disclosure (e.g. `/api/health` revealing key-set flags and deploy versions),
  error verbosity, CORS policy (`access-control-allow-origin: *` on verify-api observed),
  rate-limit evidence (60 req/min/IP claimed), input validation on `/api/ifr/check?wallet=`.
- SIWE/JWT flow review at source: nonce generation/expiry, signature verification, JWT lifetime
  (24h claimed), voucher issuance rules (1/wallet/day, 100 pts → 15 bps voucher, single use).
- Cross-check API-reported numbers (supply, balances, locked) against direct chain reads —
  divergence between the API and chain is a finding.

### Phase 5 — Repository and supply chain

- Secrets: run/review gitleaks (config `.gitleaks.toml` exists); confirm no keys in history
  (prior internal claim: none — verify at HEAD at least).
- Dependencies: `npm audit` result at the pinned commit; dependabot PR state (three open at
  recon time); GitHub Actions pinned by SHA (claimed — spot-check all 16 workflows), workflow
  permission hygiene, weekly security cron jobs actually running (`gh run list`).
- Branch protection on `main`: at recon time it required 1 approval + linear history but **no
  required status checks and no enforce_admins** — re-check and assess what that means for the
  "CI gates" narrative (gates that aren't required can be bypassed by admins).
- License consistency: contracts carry `SPDX MIT`, README states "All rights reserved", no
  LICENSE file — report as a legal/consistency finding.

### Phase 6 — Governance and centralization risk

Produce the roles matrix from verified on-chain state (not docs): who can burn, pause, set fees,
set oracle price, set guardian, set owner, execute timelock proposals, withdraw from reserves —
and under which delay/threshold. Explicitly cover the documented exceptions:

- `Governance.setGuardian()` is **not** timelocked (W15) — verify.
- `BuybackController.owner()` was the Deployer EOA, not Governance — verify current state.
- Guardians of IFRLock/Vesting = Deployer EOA (pause-only) — verify; assess impact of compromise.
- `LendingVault.ifrPriceWei` single governance-set price: model the "one proposal can
  liquidate/enable everything" scenario with concrete numbers.
- Signer-set reality check: 5 named pseudonymous signers, 3 Safes sharing the same set;
  donation-address overlap with a signer EOA; expansion 3-of-5 → 4-of-7 is docs-only so far.

### Phase 7 — Report assembly

Use `references/report-template.md` verbatim. Fill every section; delete nothing — mark
non-applicable sections "Not applicable, reason: …". Findings use IDs `CWA-01…` in descending
severity order and cross-reference the project's own register where applicable (e.g.
"extends W19", "confirms OPS-001"). Language: English (professional standard), unless the user
asks for German.

## Severity taxonomy

| Severity | Meaning for this project |
|---|---|
| **Critical** | Direct loss or theft of user/protocol funds; ownership or timelock bypass; unauthorized mint/withdraw; swapped payment/lock address on a live surface. |
| **High** | Funds at risk under realistic conditions; broken core invariant (feeExempt accounting, collateral math); oracle/price manipulation path; privilege outside the timelock that can move value. |
| **Medium** | Gameable parameters within bounds; missing limits; information disclosure with operational impact; doc/chain divergence that could mislead integrators or users. |
| **Low** | Hardening gaps, best-practice deviations, missing events, weak transport headers on non-transactional pages. |
| **Informational** | Doc drift, style, hygiene, process observations. |

Every finding also gets a **likelihood** qualifier (high/medium/low) — a Medium-impact issue with
high likelihood can outrank a High-impact theoretical one in the priority list. Explain the
ranking reasoning in the executive summary.

## Finding format

```markdown
### [CWA-07] Short title
- **Severity:** High  ·  **Likelihood:** Medium  ·  **Status:** Open
- **Component:** LendingVault.sol (`0x9743…EB9DF`) — function `liquidate()`
- **Cross-refs:** extends W4; related OPS-001
- **Description:** what is wrong, in one paragraph.
- **Impact / exploit path:** concrete, step-by-step, with numbers. Who profits, who pays,
  what preconditions hold at the pinned block.
- **Evidence:** file:line at commit <sha>; on-chain read at block <n> (command + output).
- **Recommendation:** smallest correct fix, or explicit "accept with monitoring" rationale.
```

## Boundaries and ethics

This skill audits a project whose owner has requested the audit (recon confirmed public,
read-only surfaces). Stay within read-only access even so: the report's value depends on being
able to state truthfully that no state was altered during review. Never include private keys,
personal data beyond already-published pseudonymous identifiers, or unredacted third-party
customer data in the report. The report must end with the standard disclaimer from
`references/report-template.md` (point-in-time review, no guarantee of absence of
vulnerabilities, no financial advice).
