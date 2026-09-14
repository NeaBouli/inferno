---
name: web-content-coherence-audit
description: >-
  Editorial coherence audit of a Web3 project's public content surfaces — landing pages, wikis,
  docs pages, shop/marketing copy. Not "is the code safe" and not "is the wiring correct" but
  "is what the project SAYS true, consistent, and still current". Use this skill whenever the
  user asks whether the website/wiki/README/shop copy is coherent (kohärent), consistent
  (stimmig), free of false claims (falsche Behauptungen), contradictory across pages, or stale
  versus the actual contracts/chain state. Trigger for phrases like "Seiten auf Kohärenz
  prüfen", "stimmt das Wiki noch", "content audit", "docs consistency audit", "false claims
  check". Complements `web3-contract-deep-audit` (code truth) and `web3-integration-audit`
  (wiring truth): this one proves statement truth. For the IFR project pair with the inventory
  from `collateral-web3-audit`.
compatibility: "Claude Code (~/.claude/skills/), Kimi Code, Cowork"
---

# Web Content Coherence Audit — every sentence earns its place

A security audit asks "can this be exploited?" An integration audit asks "does it work?" A
content coherence audit asks "is what the project tells the public actually true — and does it
say the same thing everywhere?" The failure modes are different: a test count that drifted, a
tier table that exists in four divergent copies, a date that is impossible, a fee-flow diagram
describing a mechanism the deployed contracts cannot perform, a "verified on Etherscan" claim
that predates a redeploy. Every claim in the report must be backed by a quoted sentence, its
file:line, and the contradicting or confirming source of truth — never by "the page looks fine".

## Evidence rules

1. **Truth has a hierarchy.** For every extracted claim, name the source of truth it is checked
   against: (a) on-chain state at the pinned block, (b) compiled/deployed contract behavior,
   (c) repository source at the pinned commit, (d) CI-attested runs. Marketing copy is never a
   source of truth; neither is another content page.
2. **Quote, don't paraphrase.** Each finding quotes the exact sentence(s) with file path (and
   live URL where applicable). A coherence report without verbatim quotes is a summary, not an
   audit.
3. **Same fact, one value.** When the same quantity (supply, fee %, test count, tier threshold,
   date, address) appears on multiple pages, all occurrences go into a consistency matrix — one
   row per fact, one column per location. Divergence is a finding even when one of them is
   right.
4. **Staleness is a finding class of its own.** A statement that WAS true at the pinned commit
   but is false at the live baseline (or vice versa) must be labeled with its direction of
   drift — "fixed in source, page predates fix" reads differently from "page overstates source".
5. **Absence of substantiation is reportable but not a defect.** A claim with no checkable
   source (unverifiable marketing) is Informational; a claim contradicted by the source of
   truth is a defect. Never inflate the first into the second.
6. Read-only: public GETs and local repo reads only. No logins, no form submissions, no
   interactions with live backends beyond what a browser visitor triggers.

## Method

### Phase A — Surface inventory

Enumerate every content page in scope and pin its source:
- Repo-served pages (GitHub Pages, docs/, wiki/): file paths at the pinned commit.
- App-rendered copy (shop, dApp labels): the source files that hold the strings
  (i18n files, JSX/TSX literals, config JSON).
- Live URLs corresponding to each page; record whether live == pinned commit (deploy drift).
- Produce the page list as a table: page · source file · live URL · byte size · primary topic.

### Phase B — Claim extraction

Per page, extract every checkable statement into a claims ledger:
- quantities: token amounts, percentages, counts (tests, contracts, pages), thresholds, dates
- addresses and tx hashes (must match the deployment map exactly, per chain)
- mechanism descriptions ("fees flow into buyback and burn", "tranches unlock at price X")
- status claims ("audited", "verified", "live", "0 open findings", "CI-gated")
- structural claims (navigation targets, download links, "see page Y")
Tag each claim with its source-of-truth class (chain / code / CI / none). Skip pure opinion
and vision statements — they are not auditable.

### Phase C — Verification against sources of truth

Verify each ledger entry:
1. Chain-backed claims: `cast call` at the pinned block; cite the command and result.
2. Code-backed claims: file:line at the pinned commit.
3. CI-backed claims: workflow run id + conclusion at/around the pinned commit.
4. Unverifiable claims: mark `no source` and move on — do not spend budget trying.
Reuse prior audit evidence where it exists (chain-read logs, selector tables); re-run only
when the claim targets state that may have moved since that evidence was captured.

### Phase D — Cross-page consistency matrix

Build the matrix for every repeated fact (Phase B ledger, grouped by fact). Flag:
- divergent values for the same fact (classic: four tier tables, three test counts)
- contradicting mechanism descriptions (one page's "automatic" vs another's "governance-set")
- asymmetric updates (fix documented on page A, stale wording left on page B)
- orphan statements: references to pages/features/roadmap items that no longer exist

### Phase E — Link and structure integrity

- Extract every internal href/src from every page; verify each resolves (file exists at pinned
  commit; live HEAD 200 for absolute URLs; anchor exists where `#fragment` is used).
- Navigation coherence: every page reachable from the index/nav; no page linking to a removed
  or renamed sibling.
- Asset integrity: referenced images/badges/downloads exist; external badges show what their
  alt text claims.

## Output format

```markdown
# <Project> — Content Coherence Audit
> Scope: <N pages> · Commit: <sha> · Chain baseline: <block> · Result: COHERENT / DRIFT FOUND

## 1. Executive summary (is the public story true and self-consistent?)
## 2. Surface inventory (page table with sources and deploy-drift status)
## 3. Claims ledger summary (counts by class: verified / contradicted / stale / no-source)
## 4. Consistency matrix (repeated facts × locations, divergences highlighted)
## 5. Findings (severity · verbatim quote · file:line + URL · source of truth · fix direction)
## 6. Link & structure integrity results
## 7. Verified strengths (what was checked and held — equally citable)
## 8. Honest limitations (pages not reachable, languages not covered, etc.)
```

Severity guidance: Critical/High = false statements that can drive financial decisions (supply,
fees, yields, "audited" status, contract behavior guarantees). Medium = contradicted
quantities/dates/mechanisms with real reader impact, or the same core fact diverging across
pages. Low = stale counts, typos with factual effect, minor asymmetric updates. Info =
unverifiable marketing, dead links, structural hygiene.

## Boundaries

Content audit is report-only: propose corrected wording, never edit the audited pages. No
claims about code security beyond citing the security audits — this skill checks what pages
SAY, not what code DOES. All verification read-only; live interaction limited to what a
first-time anonymous browser visitor would receive.
