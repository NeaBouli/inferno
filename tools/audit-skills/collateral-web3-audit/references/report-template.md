# Collateral Web3 Open Audits — Report Template

Use this skeleton verbatim for the IFR Protocol audit report. Fill every section; mark
non-applicable sections "Not applicable, reason: …" instead of deleting them. Findings are
ordered Critical → Informational and numbered `CWA-01…`. Keep the tally honest: an area that was
reviewed and is clean gets an explicit "No findings" line so the reader knows it was examined.

---

```markdown
# IFR Protocol (Inferno / IFR) — Security Audit Report

**Auditor:** Collateral Web3 Open Audits
**Client:** NeaBouli / Inferno Protocol (ifrunit.tech)
**Date:** <YYYY-MM-DD>
**Scope baseline:** repo `NeaBouli/inferno` @ commit `<sha>` · Ethereum mainnet block `<n>` ·
web surfaces as of <date>
**Report version:** 1.0

---

## 1. Executive Summary

<5–8 sentences: what was reviewed, overall security posture, the single most important finding,
the single most important strength, and the bottom-line recommendation.>

**Verdict overview:**

| Area | Result | Findings |
|---|---|---|
| Smart contracts (14 mainnet) | <PASS / PASS w/ findings / FAIL> | C:– H:– M:– L:– I:– |
| On-chain state & roles | … | |
| Web surfaces (apex, web3, shop, wiki) | … | |
| APIs (copilot, points, verify, shop) | … | |
| Repository & supply chain | … | |
| Documentation & claims consistency | … | |
| Governance & centralization | … | |

## 2. Scope and Methodology

**In scope:** <table: every contract+address, every web surface, every API, repo areas>
**Out of scope:** <explicit list — e.g. Sepolia beyond spot-checks, patches/ archive,
third-party services, placeholder apps>
**Methods:** manual source review at pinned commit; read-only on-chain calls (`cast call`,
block `<n>`); public GET endpoint observation; security-header inspection; static-analysis
review/re-run (Slither 0.11.5, Mythril 0.24.8 where reproducible); CI/workflow and branch-
protection inspection via GitHub API; documentation cross-consistency analysis.
**Limitations:** <what was NOT done — no active probing, no authenticated API tests, no load
testing, no formal verification, no review of private infrastructure (Hetzner hosts, Telegram
bot runtime) beyond its public surface>

## 3. System Overview

<1–2 pages max: architecture — token with fee-on-transfer burn, governance timelock + 3-of-5
Safes, lock-to-access (IFRLock), vaults (Commitment, Lending, Partner, Buyback, LiquidityReserve,
Vesting, BurnReserve), FeeRouter, BuilderRegistry, BootstrapVaultV3 (finalized); web surfaces;
backend APIs. Roles diagram in table form: role → address → powers → delay/threshold.>

## 4. Findings

### Critical
<findings or "None">

### High
…

### Medium
…

### Low
…

### Informational
…

<!-- Finding format:
### [CWA-NN] Title
- **Severity:** …  ·  **Likelihood:** …  ·  **Status:** Open / Acknowledged / Accepted / Fixed
- **Component:** <file/contract/surface + address>
- **Cross-refs:** <W-/OPS-/external refs or "none — new finding">
- **Description:** …
- **Impact / exploit path:** <concrete, numbered steps, with numbers>
- **Evidence:** <file:line @ commit; chain read @ block, command + output; HTTP observation>
- **Recommendation:** …
-->

## 5. Known-Issues Verification

<Table over the project's own register — for each: Still open / Mitigated / Fixed /
Accepted risk — verified, with the evidence. Cover W1–W21 highlights, OPS-001/002/005,
the 6 Slither-baselined High signals, and the documented accepted risks (stranded LP,
vesting fee loss, deployer-held pool fees). Any known issue whose on-chain state diverges
from its documented state is escalated into §4 as a new finding.>

## 6. Documentation & Claims Consistency

<Results table over the claims register: each claim Confirmed / Diverged / Unverifiable with
evidence. Include the verdict on the "governed by 48h timelock" umbrella claim and the
test-count/coverage figures actually reproduced.>

## 7. Governance & Centralization Risk

<Verified roles matrix — who can burn / pause / set fees / set price / set guardian / set owner /
execute proposals / withdraw reserves, under which delay and threshold. Signer-set analysis
(5 pseudonymous signers shared across 3 Safes, expansion status, donation-address overlap).
Scenario analysis: what a single malicious proposal, a compromised guardian EOA, or a
compromised voucher-signer key can do, concretely.>

## 8. Web & API Security

<Per-surface results: transport-header matrix vs. baseline; address-integrity check results;
dApp client-side findings; per-API findings (info disclosure, CORS, validation, rate limits);
API-vs-chain number consistency.>

## 9. Repository & Supply Chain

<Secrets scan result, dependency audit at pinned commit, workflow pinning/permissions,
branch-protection assessment (incl. "no required status checks / enforce_admins=false" impact),
license consistency.>

## 10. Recommendations

<Prioritized remediation list mapping findings → smallest correct fixes → suggested order.
Include "accept with monitoring" rationales where remediation is impossible (e.g. stranded LP).>

## 11. Conclusion

<Overall assessment in the context of the project's own stated posture ("professional audit
pending"): does this report confirm, adjust, or contradict the self-assessment?>

## 12. Disclaimer

This report is a point-in-time security review limited to the scope and baselines stated above.
It is based on read-only analysis of public source code, public on-chain state, and public web
surfaces. It does not guarantee the absence of vulnerabilities, does not cover private
infrastructure or operational security, and does not constitute financial advice, an endorsement,
or a legal compliance opinion. On-chain state changes with every block; readers must re-verify
roles and balances before relying on them.

## Appendix A — Address & endpoint inventory
<full verified tables from references/contract-map.md and references/project-surface.md,
annotated with verification results>

## Appendix B — Tooling
<exact versions: Slither, Mythril, solc, node, cast/foundry, gitleaks; CI run IDs relied upon>

## Appendix C — Verification commands
<the exact commands whose output the report cites, so any third party can reproduce>
```
