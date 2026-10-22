# BuilderRegistry Review

## Post-deploy source review — 22 October 2026

Scope: [BuilderRegistry.sol](../contracts/BuilderRegistry.sol), its
[ABI](../abi/BuilderRegistry.json), [deployment manifest](../deployments/mainnet.json),
[deployment documentation](DEPLOYMENTS.md) and
[Wiki contract entry](wiki/contracts.html#builder-registry). This is an offline
source review, not a fresh assertion about deployed bytecode, current ownership
or builder counts. No contract changes or on-chain calls were made.

### Roles and mutating functions

The constructor passes `governance_` to OpenZeppelin `Ownable`. There are no
separate builder, registrar or guardian roles in this contract. Every mutation
requires the current owner; a builder cannot edit its own metadata. The docs
describe Governance as the owner. If that remains true, calls originate from
[Governance.execute](../contracts/governance/Governance.sol) after its proposal
delay; BuilderRegistry itself does not enforce a timelock. Current `owner()`,
Governance owner/guardian and delay need a separately authorized live check.

| Function | Caller and effect | Event |
| --- | --- | --- |
| `registerBuilder(wallet, name, url, category)` | Owner only. Requires nonzero wallet, currently unregistered status, nonempty name and one of `creator`, `integration`, `tooling`, `dao`. Sets both membership/active flags, replaces metadata/timestamp and appends to the list. | `BuilderRegistered(wallet, name, category, timestamp)`; URL is not included. |
| `removeBuilder(wallet)` | Owner only; requires active membership. Clears membership and active flags but retains metadata and list entries. | `BuilderRemoved(wallet, timestamp)` |
| `updateBuilder(wallet, name, url, category)` | Owner only; requires active membership, nonempty name and valid category. Changes metadata, preserving registration time. | `BuilderUpdated(wallet, name, url, category)` |
| Inherited `transferOwnership(newOwner)` | Current owner only; nonzero successor; immediate single-step transfer. | `OwnershipTransferred(previousOwner, newOwner)` |
| Inherited `renounceOwnership()` | Current owner only; sets owner to zero, disabling future owner mutations. | `OwnershipTransferred(previousOwner, address(0))` |

### Risks and integration boundaries

- Ownership transfer can remove Governance/timelock protection; renunciation
  permanently freezes registry administration. The registry has no pause,
  upgrade, token custody or reward-payment path.
- Remove followed by register for the same wallet appends a second historical
  list entry. `getActiveBuilders()` checks current membership for each entry,
  so reactivation can return duplicate active addresses. `getBuilderCount()`
  counts registrations, not unique wallets. Both enumeration passes grow with
  the unbounded history; consumers should deduplicate and avoid assuming a
  bounded on-chain enumeration cost.
- Names and URLs have no size limit or URL-scheme validation. Treat all
  metadata as untrusted display input and avoid blindly rendering links.
  Removed entries retain their public metadata; removal is not erasure.
- The [Telegram reader](../apps/telegram/telegram-bot/src/services/onChainReader.js)
  checks membership only when `BUILDER_REGISTRY_ADDR` is configured and also
  accepts a configured builder whitelist. Registry state alone therefore does
  not determine every bot permission. [PartnerVault](../contracts/partner/PartnerVault.sol)
  has no BuilderRegistry call: registry registration does not itself register
  a reward partner, allocate tokens or record a milestone.

### Recommended monitoring

Track all three builder events and `OwnershipTransferred` from a confirmed
deployment block, with reorg-aware indexing. Reconcile event results against
`owner()`, `isBuilder(wallet)` and `getBuilderInfo(wallet)`; retrieve the URL
after registration because that event omits it. Alert on unexpected ownership
changes, zero ownership, repeated wallet registrations and large list growth.
Monitor Governance proposals/executions targeting the registry, including
ownership calls, plus Governance owner/guardian/delay changes. Check Telegram's
configured registry address and whitelist separately, and verify PartnerVault
activation independently before describing a builder as reward-enabled.
