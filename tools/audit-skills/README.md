# Audit Skills (CWA)

Reusable agent skills created and used by **Collateral Web3 Open Audits** for the IFR Protocol
audit series (reports: PR #90 and PR #91, `docs/community-audits/`).

These are prompt/method skills for coding agents (Claude Code, Kimi Code, Cowork). To use them
as live skills, copy the desired directory into the agent's skills location (e.g.
`~/.claude/skills/`); they also work as plain process documentation when read directly.

## Skills

### `collateral-web3-audit/`
Full-scope IFR Protocol audit: website + subdomains + all 36 wiki pages + this repository + the
14 deployed mainnet contracts, producing a "Collateral Web3 Open Audits" report.
- `references/contract-map.md` — verified deployment/roles map + known-issues register (W1–W21,
  OPS) + on-chain verification command set
- `references/project-surface.md` — URL/subdomain inventory, API endpoint map, security-header
  baselines, web oddities
- `references/claims-register.md` — every public claim with its dated source and how to verify it
- `references/report-template.md` — the mandatory report skeleton

### `web3-contract-deep-audit/`
Contract-focused deep audit method for any EVM/Solidity repo: manual review by vulnerability
class → Slither → Mythril → Foundry invariant fuzzing → bytecode-vs-source verification →
block-pinned on-chain state audit. Includes the evidence rules (baseline pinning, reproduce-don't
-quote, concrete traces) and the report format used in the CWA deep audit.

## Provenance

AI-assisted (Kimi K2), applied 2026-09-13/14 against commit `eb538a35` and mainnet block
25971217. The skills encode the project inventory as of that date — re-verify before reuse, the
chain and docs move.
