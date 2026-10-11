# Forum Chain Evidence Observation Library

## Purpose And Status

This is the explicit-input library hop accepted by the Stage0 map on 2026-10-10.
It observes public IFRLock owner slots and separately supplied EIP-1271 requests.
The caller supplies all policy, identities, snapshot, voters, context and budgets.
The library has no transport, ballot intake, tally, voter discovery or signer.
Every result remains ADVISORY, production-disabled and RPC-observations only.
An observation hash is a reproducible content commitment, not consensus proof.
Source delivery does not establish test success, eligibility approval or activation.

Base: `d1b3732edbb3012391554771d8e37bc3c76dc3d0`. The separate accepted synthetic
verifier at `b99c3df9f67beb9e87381d8d0a076d674ab71e45` is not modified, imported or
called. Real observations must never be repackaged as its `trustedEvidence`.
All parser/import/target/test/RPC/install/CI execution is **NOT RUN** in Stage1.

## Module And Trace

| Module | Entry | State |
| --- | --- | --- |
| Forum chain observations | `scripts/forum-chain-evidence.cjs::{collectLockEvidence,collect1271Evidence}` | Source implemented; NOT RUN |
| Dummy assertions | `scripts/test-forum-chain-evidence.cjs::runDummyTests` | Source only; NOT RUN |
| Real-evidence consumer, authenticated state, intake completeness | No entry in this slice | OPEN |

1. Public API -> `prepare`: bounded inert copy, explicit schema validation,
   ethers version/ABI setup, normalized deep freeze and provider-method capture.
2. `collect` -> `checkSnapshot`: exact chain and height/hash, before any contract read.
3. `collect` -> `identities`: hash-pinned token code/decimals, each IFRLock code/token,
   and each declared voter kind/code hash.
4. `collect` -> `call`: either every contract/voter aggregate `lockedBalance`, or
   each separate frozen digest/signature `isValidSignature` request; never both.
5. `collect` -> `checkSnapshot`: chain and height/hash again after all reads.
6. `collect` -> canonical content hashes and deep-frozen observed envelope; any
   failure -> constant rejection envelope with no observations or call transcript.

Every RPC edge uses the captured caller-owned `provider.request` capability.
Contract/code reads use `{blockHash, requireCanonical:true}`, never a numeric tag.
Only header lookup uses the explicitly supplied height. No retry, fallback or cache.
This trace is documented here only; existing MAP/PlantUML files remain untouched.

## Complete Public API

Only these two functions are exported from the library:

```text
collectLockEvidence(input, provider) -> Promise<Observed | Rejected>
collect1271Evidence(inputWithRequests, provider) -> Promise<Observed | Rejected>
```

`provider` is a trusted caller-owned capability with an **own data-property**
`request` function accepting `{method, params}` and returning a result/promise.
It is invoked with the original provider as `this`; its function is captured
before awaits, but its internal state/environment is NOT sandboxed or frozen.
Inherited/accessor `request` properties are rejected. No provider URL or credential
is accepted/resolved by the library. `providerId` is a public label, not an endpoint.
No API discovers, downloads or independently authenticates the provider.

Input and RPC data must be ordinary inert objects/arrays, not executable objects
or Proxies. Copies reject getters, setters, symbols, nonenumerable data, custom
prototypes, sparse arrays, cycles and repeated object aliases. Plain objects may
have Object.prototype or null prototypes. Arrays require Array.prototype.
All fields below are mandatory, and all schema objects reject extra fields.
Policy values outside the enumerated supported semantics fail closed.

### Scalar Grammar

`uint` is a canonical unsigned decimal **string**, at most uint256: no Number,
BigInt input, signs, leading zeroes, exponents, fractions or whitespace.
`hash` is exactly lowercase `0x` plus 64 hex digits.
`address` is a nonzero 20-byte hex string, validated by ethers getAddress and
normalized lowercase. Invalid mixed-case checksums reject; duplicates are checked
after normalization. `id` is `[A-Za-z0-9_-]{1,64}` (ASCII).
`signature` is nonempty, even-length hex bytes, normalized lowercase; case changes
do not change bytes. Empty signatures are unsupported by this v1 schema.
All copied strings/keys are printable ASCII. Keys have 1..64 characters.
Copied scalar data is limited to null, booleans and strings; numeric RPC header
metadata is unsupported too. Contract numeric returns arrive as ABI hex, not Numbers.
Format ceilings: depth 16, nodes 30000, array/own-key count 30000, input cumulative
key/string characters 4194304. These are hard format bounds, not policy defaults.

### Exact Input Schema

```text
input = {
  schema: "forum-chain-evidence-input-v1",
  policy: {
    schema: "forum-eligibility-input-v1", approval: "not-established",
    chainId: uint,
    token: { address, codeHash: hash, decimals: "9" },
    contracts: [{ address, type: "IFRLOCK", codeHash: hash,
                  ownerSlot: "wallet-aggregate" }],
    condition: "recorded-balance-at-snapshot",
    ownerAttribution: "supplied-wallet",
    aggregation: "no-cross-slot-total", overlap: "reject-duplicate-slots",
    finality: { basis: "caller-selected-unverified", reference: id },
    callContext: { from: address, gasLimit: uint },
    limits: {
      maxCalls: uint, maxVoters: uint, maxContracts: uint, maxSignatures: uint,
      maxRequestBytes: uint, maxTotalRequestBytes: uint, maxResponseBytes: uint,
      maxTotalResponseBytes: uint, maxEvidenceBytes: uint,
      maxSignatureBytes: uint, requestTimeoutMs: uint, totalTimeoutMs: uint
    }
  },
  snapshot: { chainId: uint, height: uint, blockHash: hash },
  voters: [{ wallet: address, kind: "EOA" | "EIP1271", codeHash: hash }],
  providerId: id
}
inputWithRequests = { ...input,
  requests: [{ wallet: address, digest: hash, signature, contextHash: hash }]
}
```

The lock API rejects `requests`; the 1271 API requires them. Policy/snapshot
chains must agree and be positive. Height zero is allowed; latest/height-only is
not. At least one contract and voter is required. Token/contract addresses must
be distinct; contract addresses and voter wallets must be unique. Requests must
name a supplied EIP1271 voter; duplicate `(wallet,digest)` rejects even if signatures
or contexts differ. An EOA codeHash must equal ethers.keccak256("0x").
Other wallet modes, age/condition rules, custody attribution, delegation, vault
types and aggregation rules are unsupported, not silently omitted/defaulted.
The caller's IFRLOCK type and codeHash are expectations, not approved eligibility
or proof that arbitrary bytecode faithfully implements the supplied source.

Each request's digest and contextHash are opaque caller-frozen commitments.
The library does not compute or authenticate ballot/domain/intake semantics.
1271 success means only that the RPC-reported wallet execution returned the exact
magic for those digest/signature bytes at that snapshot and explicit call context.
Lock observations can be frozen before callers produce signing requests; there
is no circular manifest hash and no new voting/signing schema here.

### Resource Limits

Every limit must be a positive `uint` at or below its hard ceiling; none defaults.
Collections are bounded by their supplied limits before RPC. Required call count
is checked against maxCalls before the first await.

| Limit | Hard Ceiling |
| --- | ---: |
| maxCalls | 2048 |
| maxVoters / maxContracts / maxSignatures | 128 / 32 / 256 |
| maxRequestBytes / maxTotalRequestBytes | 32768 / 4194304 |
| maxResponseBytes / maxTotalResponseBytes | 131072 / 4194304 |
| maxEvidenceBytes | 8388608 |
| maxSignatureBytes | 4096 |
| requestTimeoutMs / totalTimeoutMs | 10000 / 120000 |
| callContext.gasLimit | 10000000 |

Required calls are `6 + 2*contracts + voters + contracts*voters` for locks and
`6 + 2*contracts + voters + requests` for 1271. All requests are serial; there are
no retries. Byte budgets count canonical JSON ASCII bytes, not network envelopes.
Signature limits count actual bytes. Response budgets include the copied full
header before projection; evidence budget includes the final evidenceHash field.
Total deadline starts after synchronous input preparation; per-call deadlines
include request invocation through settlement, with elapsed checks after return.
There is no attempt to preempt a provider's synchronous CPU work or abort an
EIP-1193 request. Timeout rejects without further calls/partial result; a trusted
provider may still finish an outstanding call. Late settlement is not consumed.
The provider/approved execution environment must bound transport allocations,
network bytes, CPU and outstanding calls; result-size checks cannot undo a prior
allocation. These are review/admission blockers, not a claim of OS confinement.

## Exact Reads And Output Schema

The only methods are eth_chainId, eth_getBlockByNumber, eth_getCode and eth_call.
Both APIs check all policy contract identities; only the lock API reads weights.
Each eth_call transaction has exactly `{to,from,gas,value:"0x0",data}`, with explicit
from and gasLimit converted to hex and ethers-encoded ABI data. eth_getCode and
eth_call receive EIP-1898 hash identifiers with requireCanonical true.
Chain quantities/header numbers are canonical lowercase hex quantities; headers
must match BOTH the input height and hash before and after all reads. Extra inert
header fields are size-checked but not attested or retained; number/hash are kept.
Code/result hex is byte-aligned; code hashes must match the supplied identities.
EOA code must be empty, EIP1271/token/IFRLock code nonempty. Token decimals must be
9 and each lock's token() must match the supplied token address.
ABI return bytes must round-trip exactly through ethers decode/encode (no trailing
or short data); 1271 must return bytes4 magic `0x1626ba7e`. Wrong magic/revert rejects
the entire call batch, without EOA recovery, latest lookup or partial evidence.

```text
Observed = {
  schema: "forum-chain-evidence-v1",
  kind: "lock-observations" | "eip1271-observations", status: "observed",
  authority: "ADVISORY", productionReady: false, chainEvidenceVerified: false,
  trust: "rpc-observations", policyApproval: "not-established",
  snapshotFinality: "not-established", eligibleSupply: "unknown", intakeOrdering: "unknown",
  inputHash: hash, policyHash: hash, policy: normalizedInputPolicy,
  snapshot: normalizedInputSnapshot, providerId: id,
  coverage: { scope: "supplied-voters-only", voters: normalizedInputVoters,
              contracts: normalizedInputContracts, signatureRequests: uint },
  observations: [LockObservation] | [SignatureObservation],
  calls: [{ method, params: exactFrozenRequestParams, result: RecordedResult }],
  evidenceHash: hash
}
LockObservation = {
  claimId: hash, chainId: uint, blockHash: hash, contract: address,
  owner: address, ownerSlot: "wallet-aggregate", weight: uint, state: "zero" | "positive"
}
SignatureObservation = {
  wallet: address, digest: hash, signatureHash: hash, contextHash: hash,
  magicValue: "0x1626ba7e", snapshot: normalizedInputSnapshot
}
Rejected = {
  schema: "forum-chain-evidence-v1", kind, status: "rejected",
  authority: "ADVISORY", productionReady: false, chainEvidenceVerified: false,
  trust: "rpc-observations", policyApproval: "not-established",
  snapshotFinality: "not-established", eligibleSupply: "unknown", intakeOrdering: "unknown",
  error: ConstantCategory
}
```

RecordedResult is a raw chain quantity, code or ABI hex string, or the header
projection `{number:hexQuantity,hash}`. eth_call params retain exact digest/signature
bytes and from/gas context. Calls are recorded in deterministic execution order,
without elapsed times, timestamps, endpoints, exception text or retries.
Successful objects are deeply frozen. No partial output is exposed on rejection.
A successful zero weight is explicit and different from unknown/failed RPC state.

Canonical JSON recursively sorts object keys with ASCII lexical ordering,
preserves array order, uses JSON.stringify scalar escaping and no whitespace.
Contracts sort by address, voters by wallet, requests by wallet then digest, and
lock observations by claimId. Hashes use ethers keccak256/UTF-8, never custom crypto.
policyHash hashes normalized policy; inputHash hashes the full normalized endpoint
input, including signature bytes/context when present. claimId hashes exactly
`{chainId,blockHash,contract,owner,ownerSlot}`. signatureHash hashes signature bytes.
evidenceHash hashes the complete Observed object EXCEPT its evidenceHash field.
Input permutations produce identical results for the same RPC transcript; changes
in actual provider results/byte casing remain visible in transcript/evidenceHash.
There is no sum, quorum denominator, supply enumeration, intake receipt or outcome.

ConstantCategory is one of INPUT_INVALID, POLICY_UNSUPPORTED, LIMIT_EXCEEDED,
DEPENDENCY_UNAVAILABLE, PROVIDER_INVALID, RPC_FAILURE, RPC_TIMEOUT,
RPC_RESPONSE_INVALID, CHAIN_MISMATCH, SNAPSHOT_MISMATCH, IDENTITY_MISMATCH,
CONTRACT_RESPONSE_INVALID, SIGNATURE_INVALID, INTERNAL_FAILURE.
Provider exceptions are not inspected/echoed; unsupported EIP-1898/reverts become
RPC_FAILURE. Copy/shape errors become RPC_RESPONSE_INVALID; measured size budget
excess becomes LIMIT_EXCEEDED. Missing/incorrect headers become SNAPSHOT_MISMATCH.

## Reuse, Gaps And Review Gates

ethers 6.17.0 is loaded lazily only on API invocation and version-checked; no new
dependency or SDK edit. The base SDK lock pin is apps/sdk/package-lock.json:66-69.
Reused source pattern: apps/benefits-verify/src/index.ts:198-203,253-310,367-383,
417-430,479-483 (EIP-1193, EIP-1898, code/token checks, pre/post snapshot checks).
Those private tier helpers are not imported or wrapped. ABI semantics come from
contracts/lock/IFRLock.sol:21-34,76-95,115-125: one recorded owner aggregate, not one
claim per event/tag. No deployed identity is inferred from repository source.

Runtime code hashes do not prove proxy implementation/storage identity, correct
wallet-kind semantics, token custody/beneficial ownership or honest node execution.
Voter/code/policy inputs are caller assertions; no proposed contract is approved.
Provider pre/post agreement and requireCanonical are node claims, not independent
consensus/finality authentication. Both total eligible supply and intake completeness
stay unknown. Public signatures/call transcripts need separate privacy admission.

Dummy test source exports only runDummyTests; it has no automatic invocation,
console output, live provider, wallet/key generation, dependency acquisition or
generic runner. Assertions cover exact params/hash pinning, mutation capture,
duplicates/permutations, >2^53 weights, zero versus unknown, reorg/chain/code/token
drift, malformed/oversized/reverted/unsupported responses, budgets/timeouts,
1271 byte/hash/magic/context/snapshot binding, no fallbacks and disabled markers.
No assertion/import/parser has actually executed in this source delivery.

Next: independent security/schema review of these three new files, then separately
authorized first confined dummy-test admission with the approved immutable ethers
closure. No push before those gates. Caller-selected identities/eligibility/finality,
O1/O2, ratified vote policy/denominator, complete eligible universe, authenticated
state and intake/cutoff/privacy/consumer integration remain owner-controlled OPEN
hops. Existing264/267/DIP stopped-path budgets and source/runtime holds are unchanged.
No extra diagram files, existing MAP, source, dependencies, reports, PLAN or BRIDGE
are modified by this implementation; SDK/operator/267 and all live actions remain
with the parent. No worker integration, main merge, activation or publication here.
