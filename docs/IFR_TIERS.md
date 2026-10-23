# IFR tier sources

The canonical published Benefits preset is
[`specs/ifr-benefits-tiers.v1.json`](specs/ifr-benefits-tiers.v1.json):
**Bronze 1,000 / Silver 2,500 / Gold 5,000 / Platinum 10,000 IFR** (9 decimals).
Its whole-IFR and base-unit amounts are decimal strings. Version 1 and its published
SHA-256 are unchanged by this consolidation; a protocol preset change needs a new version.

This is a verification preset, not a mandatory tier ladder in the token or IFRLock
contract. The repository's IFRLock implementation accepts a caller-supplied threshold.
Partners can choose their own thresholds, discounts, held-IFR requirements and supported
lock sources. Those choices are **partner overrides**, not new protocol tiers. The
data API and SDK default access preset uses IFRLock only; verification specs and seller
rules separately define which lock sources qualify. Threshold equality does not make
those source policies interchangeable.

## Source map

In the table, **B/S/G/P** means Bronze/Silver/Gold/Platinum at
**1,000 / 2,500 / 5,000 / 10,000 IFR**, respectively. Paths are relative to the repository.
The inventory includes runtime definitions, published copies and explanatory examples;
test fixtures and historical audit/change records do not define current policy.

| Source file(s) | Tier names and thresholds (IFR) | Authority / purpose |
| --- | --- | --- |
| `docs/specs/ifr-benefits-tiers.v1.json` | B/S/G/P | Canonical versioned protocol verification preset |
| `apps/benefits-verify/tiers.v1.json` | B/S/G/P | Byte-identical package copy of canonical preset |
| `apps/benefits-verify/src/index.ts`, `apps/benefits-verify/dist/index.js` | B/S/G/P | Published verifier constants; must match canonical preset |
| `docs/specs/ifr-benefits-verify-1.md`, `apps/benefits-verify/README.md` | B/S/G/P | Published preset tables; `/2` reuses the tier file |
| `apps/sdk/src/index.ts`, `apps/sdk/dist/index.js`, `apps/sdk/README.md` | B/S/G/P (`DEFAULT_TIERS`) | Canonical preset copy; callers may pass partner overrides |
| `apps/data-api/server/access-tiers.ts` | B/S/G/P (`ACCESS_TIERS`) | Canonical preset copy for summaries and API checks |
| `docs/wiki/business-onboarding.html`, `docs/wiki/lock-mechanism.html` | B/S/G/P | Partner-configurable recommendations matching the preset |
| `docs/wiki/integration.html`, `docs/wiki/integrate-benefits.html` | B/S/G/P | Public verification preset and widget integration guidance |
| `docs/wiki/press-kit.html`, `docs/wiki/one-pager.html` | B/S/G/P; one-pager names only | Public description of the preset, not a universal partner entitlement |
| `docs/widget/ifr-benefits-widget.js` | B/S/G/P (`TIER_PRESETS`) | Generic IFRLock display preset; business-specific rules override it |
| `apps/dashboard/src/components/LockPanel.jsx` | B/S/G/P | First-party IFRLock display preset |
| `apps/benefits-network/frontend/src/components/WalletStatus.tsx` | B/S/G/P | First-party guide/display preset; real seller rules remain authoritative |
| `apps/benefits-network/frontend/src/lib/ifr-tiers.v1.json`, `benefitTierDefaults.mjs` in the same directory | B/S/G/P | Generated canonical copy and exact whole-token form adapter |
| `apps/benefits-network/frontend/src/components/SellerRuleBuilder.tsx` | Welcome → Bronze 1,000; Member → Silver 2,500; Premium → Gold 5,000; Event → Platinum 10,000 | Partner-configurable starter defaults derived from canonical data; existing saved rules are unaffected |
| `docs/BUSINESS_ONBOARDING.md`, `docs/BENEFITS_NETWORK_TEST.md`, `docs/WHITEPAPER.md` | B/S/G/P | Recommended partner defaults / examples |
| `docs/SDK_QUICKSTART.md`, `docs/TOKENOMICS_MODEL.md`, `docs/PRESS_KIT.md`, `docs/llms.txt` | B/S/G/P | Public examples / descriptions of the preset |
| `apps/points-backend/src/middleware/lockProof.ts`, `docs/TESTNET_GUIDE.md`, `docs/PARTNER_REWARDS_SPEC.md` | Bronze 1,000 or Gold 5,000 examples | Single-threshold product policy / examples, not another ladder |
| `apps/sdk/src/index.ts`, `apps/sdk/dist/index.js`, `apps/sdk/dist/index.d.ts` | None 0; Basic 500; Premium 2,000; Pro 10,000 | Explicitly deprecated hold+lock API; compatibility values preserved |
| `contracts/library/TierModule.sol` | None 0; Basic 500; Premium 2,000; Pro 10,000 | Separate configurable Builder library defaults; uses `_tierBalance`, not the Benefits preset |
| `apps/builder/engine/ConfigValidator.ts`, `apps/builder/engine/CodeGenerator.ts`, `apps/data-api/server/index.ts`, `docs/builder.html` | Tier 1/2/3: 500 / 2,000 / 10,000 | Configurable Builder defaults / generated examples; preserved |
| `apps/data-api/server/builder-score.ts` | Recommends a minimum of 500; no tier ladder | Builder scoring guidance, not protocol Benefits tiers |
| `apps/telegram/telegram-bot/src/services/onChainReader.js`, `verificationStore.js` in the same directory; `src/commands/verify.js`; `docs/wiki/verify.html` | Signer: Safe owner; Council: allowlist; Builder: registry/allowlist; Voter: locked IFR > 0; Community: fallback | Telegram authorization roles, not monetary Benefits tiers; preserved |
| `contracts/partner/PartnerVault.sol`, `docs/PARTNER_INTEGRATION_SPEC.md` | `uint8 tier` (0–255); no locked-IFR threshold | Governance-assigned partner metadata, not customer Benefits tiers |
| `docs/wizard/lock.html` | Bronze 1,000 / Silver 2,500 / Gold 5,000 / Platinum 10,000 | Public lock wizard; aligned with the Benefits preset (owner decision 2026-10-17); checked by `scripts/test-ifr-tiers.cjs` |

## Conflicts and owner decisions

- **Shop starter drift (T-231; closed; #301, commit `9aac1409`):** Welcome/Member/Premium/Event previously used
  500 / 1,000 / 5,000 / 10,000 and labels Welcome/Member/Premium/Event pass. New drafts
  now use B/S/G/P from the published preset. Discount percentages and other template
  choices remain partner defaults; editing and saving a custom threshold is allowed.
- **Wizard policy (closed 2026-10-17; #306, commit `c1b4e2d2`):** the owner decided to align `docs/wizard/lock.html`
  with the Benefits preset. It previously advertised Basic/Premium/Pro at 500 / 2,000 / 10,000
  with voting, fee and feature promises; it now shows Bronze/Silver/Gold/Platinum, locks in
  IFRLock, states that partners define benefits, and makes no fee, support or governance-right
  claims. The tier consistency test covers it.
- **CWA-77 history:** `docs/community-audits/cwa-remediation-register.json` and its
  generated Markdown retain historical verification text naming the retired tier ladder.
  The current data API policy, SDK README and verification spec describe the B/S/G/P default (the policy cites the owner decision
  of 2026-10-03). The historical audit evidence is preserved; it is not current policy.
- All inventoried current copies of the published four-tier preset agree. Legacy SDK
  APIs, Builder defaults and Telegram roles remain separate policies. The former
  wizard product promises were removed in #306; partners define the actual benefits.

## Keeping copies consistent

Edit the published versioned specification through its normal owner process. Run
`node scripts/sync-ifr-tiers.cjs --write` to refresh the package and frontend JSON copies.
The frontend copy keeps the existing isolated Docker build context self-contained;
it is not an independently editable configuration file. The form adapter accepts only
positive whole-token values representable exactly by the existing numeric form/API;
base-unit thresholds and eligibility checks remain integer arithmetic.

Run `npm run test:ifr-tiers` (also included in `npm run test:benefits-docs`). It checks
the canonical amounts and pinned hash, package/source/dist copies, data API policy,
Wiki/Markdown copies, widget/dashboard/wallet guides, all four
starter templates and the initial draft. Existing SDK and verifier unit suites cover
eligibility boundaries separately. Known separate policies above are excluded
from preset equality, so this guard does not silently rewrite their meaning.
