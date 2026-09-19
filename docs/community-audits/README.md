# IFR Protocol Community Audits

This directory preserves security and project reviews submitted by community
members. Community audits are published for transparency. They are not
professional third-party certifications, and publication does not mean that
IFR Protocol accepts every factual, legal, economic or technical conclusion.

## Current CWA remediation status

The September Collateral Web3 Open Audits series covers **CWA-01…CWA-82**.
Publication and remediation are separate: at the current repository baseline,
no CWA finding has both an integrated remediation and the required verification
evidence. The authoritative status is maintained in the
[finding-by-finding remediation register](CWA_REMEDIATION_REGISTER.md).

- Disposition: **0 fixed and verified / 11 governance or owner gated / 2
  accepted or monitored / 58 open actionable / 11 informational**.
- Corrected severity aggregate: **0 Critical / 3 High / 29 Medium / 34 Low /
  16 Informational**.
- [Download the consolidated 55-page CWA report
  (PDF)](IFR_Protocol_CWA_Consolidated_Audit_Report_2026-09-14.pdf).
- Corrected PDF SHA-256:
  `c174d7dccd1233e45d79fc09f8974470c19b12b6346690f583484c6764a3605d`.

The PDF and two source-report summaries contain an explicit editorial
correction dated 19 September 2026. It fixes aggregate arithmetic only: CWA-64
was already labeled Low, and CWA-25…CWA-27 contain one Informational finding.
No finding text, severity label or technical conclusion was changed.

## OKComputer Community Audit — 27 July 2026

- Original report:
  [IFR_Protocol_Audit_2026-07-27.md](IFR_Protocol_Audit_2026-07-27.md)
- Original SHA-256:
  `ec7f99b0b74c51e04091727a0b69f49f67c36409a52c9ea7b55ba545b6b3e375`
- Publication status: preserved unchanged as submitted
- Review type: community-submitted project and security review
- Certification status: not an independent professional third-party audit

### Editorial status note — 28 July 2026

The report is a dated snapshot. Several findings were useful and have already
driven repository corrections:

- Mainnet LP custody is now described consistently: Team.Finance was disabled,
  the LP tokens remain in BootstrapVaultV3, and that vault exposes no LP
  withdrawal or recovery function.
- Public operational TODO files were removed from the website deployment.
- Audit claims now identify full internal audits and state that a professional
  third-party audit remains pending.
- Access language now states that access continues while the required IFR
  remains locked and the relevant integration remains available.
- Burn, vesting, Bootstrap allocation and Telegram descriptions were aligned
  across active public surfaces.

Some snapshot claims were already outdated when the report was reviewed:

- LendingVault had three offers rather than zero.
- CommitmentVault and IFRLock already held live user locks.
- The LP was not waiting for a Team.Finance transaction; its actual custody
  follows from the deployed BootstrapVaultV3 configuration and bytecode.

Legal statements in the submitted report are the contributor's assessment,
not legal advice or a confirmed regulatory determination. Legal texts,
operator disclosures, lending design and regulatory classification require
qualified German/EU legal review.

Open high-risk recommendations involving immutable contracts, lending,
governance or Mainnet roles are not implemented directly from this report.
They require separate architecture, tests, independent review and an
authorized governance process.

## Collateral Web3 Open Audits — 14 September 2026

- Original report:
  [CWA_IFR_Protocol_Audit_2026-09-14.md](CWA_IFR_Protocol_Audit_2026-09-14.md)
- Original SHA-256 (as delivered):
  `86d9ef68f270df799436f0207146d1430817737f7f64f51a26d1a6a335dfce0b`
- Current SHA-256 (after the corrections noted below):
  `a0d5b454e91a790af174bbfc29c823c08c3766591ffc8265cf7c5c1cd74e2e96`
- Publication status: corrected 2026-09-14 after independent PR review — three
  factual fixes, no change to any finding classification or severity:
  (1) CWA-01 collateral example figure (≈104,310,881 wei at X = 1 wei);
  (2) totals summary states 6 Medium, matching the classified CWA-02…CWA-07;
  (3) conclusion now qualifies the no-funds-at-risk statement for new
  price-conditioned CommitmentVault locks (CWA-03).
- Review type: independent AI-assisted full-scope security review (Kimi K2,
  executed with the project's `collateral-web3-audit` skill); read-only
  evidence at repo commit `eb538a355001b042b343bfb19221af2407a96e63` and
  Ethereum mainnet block 25971217
- Certification status: first external review of the project; not a formal
  certification. Publication does not mean that IFR Protocol accepts every
  factual or technical conclusion.

Result summary: 0 Critical, 1 High (dormant LendingVault single-price
activation risk; currently fail-closed and verified on-chain), 6 Medium,
12 Low, plus a documentation-drift cluster. Known-issues register (W1–W21,
OPS) verified item by item; several documentation values diverge from chain
state in both directions and are listed in the report's §6.

Remediation of report findings follows the normal governance path: timelock
proposals, tests, and independent review per finding. No finding is
implemented directly from this report.

## Collateral Web3 Open Audits — Contract Deep Audit — 14 September 2026

- Original report:
  [CWA_IFR_Contracts_Deep_Audit_2026-09-14.md](CWA_IFR_Contracts_Deep_Audit_2026-09-14.md)
- Original SHA-256:
  `ef301821fa2e1bb4afe361c956c541f29e8be5cee574130a7b54399870d7802d`
- Current SHA-256 after the disclosed aggregate correction:
  `ff16962322b59ea596eeacee48955e1e60918edb7837da6cc5cc68cc357588a3`
- Fuzz harness (evidence artifact):
  [CWA_IFR_DeepAudit_FuzzHarness_2026-09-14.t.sol](CWA_IFR_DeepAudit_FuzzHarness_2026-09-14.t.sol)
  · SHA-256 `5f155ef0c5a8898ce32efda99c6d62a7489f6c28a5a70b5779f10840a472f933`
- Publication status: editorial aggregate correction on 2026-09-19; finding
  text, labels and conclusions unchanged
- Review type: independent AI-assisted deep audit (Kimi K2,
  `web3-contract-deep-audit` skill): reproduced Slither/Mythril gates locally,
  Foundry invariant fuzzing (14/14), bytecode-vs-source comparison, dual-explorer
  verification sweep, block-pinned chain reads (block 25971217)
- Certification status: not a formal certification

Result summary: 0 Critical / 0 High / 1 Medium / 1 Low / 1 Informational.
Key correction: W1 (Governance `setOwner`) and W3 (BuybackVault `setParams`
bounds) are fixed in repository source only — the deployed mainnet bytecode
predates both fixes (proven by live probe, bytecode diff, commit diff, and
era-source diff). No new vulnerability in deployed contract logic.

## Collateral Web3 Open Audits — Surfaces Supplement — 14 September 2026

- Original report:
  [CWA_IFR_Surfaces_Supplement_2026-09-14.md](CWA_IFR_Surfaces_Supplement_2026-09-14.md)
- Original SHA-256:
  `492a37de8ae32e0640ad8ccb90e8a5a8ff73961288e0f47961b13d8caa336f3b`
- Publication status: preserved unchanged as delivered
- Review type: independent AI-assisted static source review (Kimi K2 with an
  independent review pass) of creator-gateway, Telegram bot, Benefits backend,
  SDK and dashboards at commit `eb538a355001b042b343bfb19221af2407a96e63`;
  no dynamic testing, no live-deployment probing
- Certification status: not a formal certification

Result summary: 2 High / 5 Medium / 8 Low / 3 Informational (CWA-28…CWA-45).
The two High findings are both in creator-gateway (attacker-chosen JWT wallet
claim via legacy `/auth/wallet` and via the Google OAuth flow); exploitability
depends on the service's deployment status, which was not publicly observable.

## Collateral Web3 Open Audits — README Audit — 14 September 2026

- Original report:
  [CWA_IFR_README_Audit_2026-09-14.md](CWA_IFR_README_Audit_2026-09-14.md)
- Original SHA-256:
  `fe1a233884665f4a03ef9bd3e28d7a1d3e8daa4652a3c799f62cc3ef014fe590`
- Publication status: preserved unchanged as delivered
- Review type: independent AI-assisted claim-by-claim consistency review of the
  repository README against pinned chain state (block 25971217), reproduced tool
  runs, and source review at commit `eb538a355001b042b343bfb19221af2407a96e63`
- Certification status: not a formal certification

Result summary: 0 Critical / 0 High / 2 Medium / 1 Low / 3 Informational
(CWA-51…CWA-56). Key findings: allocation-table custody rows diverge from chain
state (Treasury Safe holds 0 IFR; aggregation into LP Reserve Safe undocumented
in the README), and the "BuybackVault/BurnReserve accumulate from the 1% pool
fee" sentence contradicts chain reality (see CWA-02). The README's dated-snapshot
and disclaimer patterns are exemplary and were verified as honest.

## Collateral Web3 Open Audits — Web3 Integration Audit — 14 September 2026

- Original report:
  [CWA_IFR_Web3_Integration_Audit_2026-09-14.md](CWA_IFR_Web3_Integration_Audit_2026-09-14.md)
- Original SHA-256:
  `5bf20c4ba92d8214f10e139f5f99b98b5276eda556bd086686aa5d15ee1465ee`
- Publication status: preserved unchanged as delivered
- Review type: independent AI-assisted functional/wiring audit (Kimi K2,
  `web3-integration-audit` skill): selector-level ABI verification (31/31 match),
  the repo's own Playwright suites reproduced locally (44/44), the benefits
  `test:benefits-*` battery (13/13 with documented preconditions), configuration
  review of both wallet layers
- Certification status: not a formal certification

Result summary: verdict WORKS — 0 Critical / 0 High / 1 Medium / 2 Low /
2 Informational (CWA-46…CWA-50). Key finding: copilot-api decodes the
LendingVault `Loan` struct with a shifted ABI (CWA-46, dormant while zero loans
exist). WalletConnect, chain enforcement, approval discipline and decimals
handling verified correct.

## Collateral Web3 Open Audits — Content Coherence Audit — 14 September 2026

- Original report:
  [CWA_IFR_Content_Coherence_Audit_2026-09-14.md](CWA_IFR_Content_Coherence_Audit_2026-09-14.md)
- Original SHA-256:
  `859946780fea9595d388bfa1185f9f43b8baad27934bf176d7d595cff9080b48`
- Current SHA-256 after the disclosed aggregate correction:
  `78c884bd1f79c7cb6f31f35100420324c6ea864558b1ea41e33ac21370ee3902`
- Link/structure integrity script (evidence artifact):
  [CWA_IFR_ContentCoherence_LinkCheck_2026-09-14.py](CWA_IFR_ContentCoherence_LinkCheck_2026-09-14.py)
  · SHA-256 `65879186c5f9951a93c9764b5045770a8e99ff682e5195c9385f79e670983b39`
- Publication status: editorial aggregate correction on 2026-09-19; finding
  text, labels and conclusions unchanged
- Review type: independent AI-assisted editorial coherence audit (Kimi K2,
  `web3-content-coherence-audit` skill) of all public content pages — landing,
  wallet dApp copy, all 36 wiki pages, Benefits Network PWA copy — ~500
  extracted claims verified against block-pinned chain reads (block 25974493)
  and source at commit `e8cf1ece8c40c0fa19f18344fe25593304ef5c26` (content
  pages byte-identical to audit baseline `eb538a35`)
- Certification status: not a formal certification

Result summary: 0 Critical / 0 High / 10 Medium / 7 Low / 1 Informational
(CWA-57…CWA-74). Every contract address on every page verified correct; the
shop copy is fully accurate (83/83 claims). Defects concentrate in governance
history (proposal #1/#3/#6 log entries contradicted by chain-decode), the
protocol-plan buyback section (describes machinery that does not exist), a
wrong-network Sepolia address column on the contracts page, the transparency
supply table (rows sum to ~80% against a 100% total), and the lp-strategy
page's liquidity arithmetic.
## Collateral Web3 Open Audits — AI Readiness Audit — 14 September 2026

- Original report:
  [CWA_IFR_AI_Readiness_Audit_2026-09-14.md](CWA_IFR_AI_Readiness_Audit_2026-09-14.md)
- Original SHA-256:
  `e1c5c23f710791dfd847546bcce6ae1da35a2b741df92d14fefc83dcda520d16`
- Publication status: preserved unchanged as delivered
- Review type: independent AI-assisted AI-readiness audit (Kimi K2,
  `ai-readiness-audit` skill) of the IFR Copilot knowledge path (static knowledge,
  local wiki RAG, live wiki fetch, safety rails, endpoint answer sources) and the
  external AI/search anchor layer (robots.txt, sitemap.xml, llms.txt, ai.txt,
  JSON-LD, meta/canonical) on apex, web3 and shop — at commit
  `e8cf1ece8c40c0fa19f18344fe25593304ef5c26`, chain baseline block 25974493,
  live anchor checks 2026-09-14
- Certification status: not a formal certification

Result summary: verdict READY w/ gaps — 0 Critical / 0 High / 4 Medium / 3 Low /
1 Informational (CWA-75…CWA-82). Copilot core knowledge verified accurate; key
findings: live-wiki fetch wipes last-good cache on failure and refetches inside
every chat request (CWA-75), off-origin `.html` links are followed into the
system prompt (CWA-76), the bot teaches a tier table contradicting its own API
(CWA-77), and the advertised premium on-chain-context feature is not implemented
(CWA-78). The anchor layer is strong: llms.txt/ai.txt/robots/sitemap on all
hosts, explicit AI-crawler policy, complete sitemap (39/39), valid JSON-LD on
38/39 pages; defects listed in CWA-81.
