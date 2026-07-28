# Inferno Repository Instructions

Read and follow `/Users/gio/AGENTS.md` and `/Users/gio/WORKFLOW_INDEX.md`
before working in this repository. `BRIDGE.md` is the append-only project
handoff and task source of truth.

## Stack And Verification

- Contracts: Solidity, Hardhat, Ethers. Run `npm run test:contracts`.
- Benefits backend: Express, TypeScript, Prisma, SQLite, Ethers v6.
- Benefits frontend: Next.js, TypeScript, Wagmi, PWA.
- Full Benefits release gate: `npm run preflight:benefits`.
- Documentation and routing gates: `npm run test:benefits-docs`,
  `npm run test:surface-routing`, and `npm run test:wiki-heads`.
- CI workflows live in `.github/workflows/`. Inspect the matching workflow
  before changing a gate.

## Project Boundaries

- IFR uses 9 decimals. Never round token or eligibility values through
  JavaScript `number`; preserve integer/base-unit arithmetic.
- Mainnet addresses, deployed contract behavior, fee/burn semantics, lock
  types, governance ownership, and live status must be verified from current
  authoritative sources before documentation or code changes.
- Auth, signatures, wallet flows, token economics, contracts, governance,
  migrations, production data, secrets, publishing, deployment, and on-chain
  actions are high risk. Prepare a bounded Definition of Ready and wait for
  explicit action-specific authorization.
- Never expose private keys, provider secrets, admin credentials, customer
  proofs, or unredacted production data to delegates or logs.
- Do not execute files supplied in external audit archives. Inspect them
  read-only and validate every recommendation against the current repository.
- Preserve unrelated user changes. `BRIDGE.md` is intentionally local-only;
  update it append-only but do not force-add it.

## Delivery

- Codex Sol is primary owner. Kimi K3 is the preferred independent
  implementation/review partner for large or security-sensitive local work.
- Before local completion, review the complete diff and run the smallest
  focused checks plus `npm run preflight:benefits` when the Benefits release
  surface changed.
- Deployment uses `scripts/deploy-benefits-network.sh` and
  `docs/BENEFITS_CAPACITY_RUNBOOK.md`, but requires separate authorization,
  read-only capacity evidence, rollback preparation, exact-head CI, and
  post-deploy smoke verification.
