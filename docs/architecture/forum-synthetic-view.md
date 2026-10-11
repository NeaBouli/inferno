# Disabled Forum Synthetic View

## Boundary And Render Map

This extends only the proposed disabled render node in the parent's accepted
`FORUM-DISABLED-VIEW-MAP-20261010.md`. The source construction base is
`d50d952464fb8b9cb23601028563b185cb58e2ff`. The following hop is recorded before
the implementation diff; it is not execution evidence.

| Module | Entry / hop | Evidence state |
| --- | --- | --- |
| Existing synthetic verifier | `scripts/verify-forum-votes.cjs::verifyFixture(fixture, trustedEvidence)` -> exact result | Unchanged source; execution NOT RUN here |
| Disabled synthetic renderer | `scripts/build-forum-synthetic-view.cjs::renderSyntheticView` -> HTML string with `#proposal`, `#ballot`, `#result` | New source; execution NOT RUN |
| Renderer regression source | `scripts/test-forum-synthetic-view.cjs::run` -> inert dummy fixture recipe -> renderer assertions | New source; tests NOT RUN |

Wiring: separately supplied synthetic evidence and a fixture are copied as inert
data, then passed as separate arguments to the existing verifier. Only a fresh
successful synthetic result permits proposal, choices, policy and weights to be
displayed. There is no second signature, selection, quorum or tally engine.
Optional presentation data are equality-checked against these inputs and the
fresh result; they are never used as an independent display source.

Only these three new files belong to this slice. Existing verifier/tests,
Council data/pages, fixtures, generated previews, package/lock files,
CI/workflows/drivers, metadata, architecture inventories, PLAN and BRIDGE remain
untouched. The parent owns the CI diagnostic file. No generated HTML or
signatures are retained. The parent reports that third hosted admission
`38015347883` terminated `REFUSED98` at
`acquire-preflight-process-rlimits`, before any fixture execution. All hosted
execution is stopped; there is no fourth run or push. Local execution remains
prohibited. The parent's separately identified proc row-padding incompatibility
is outside this render hop; this slice does not change CI or its assertions.

## API Contract

`renderSyntheticView(fixture, trustedEvidence, presentation?)` is a synchronous
Node API returning a complete, self-contained HTML string. It does not read or
write files, accept paths, fetch data, sign messages, or open a browser.
The existing verifier is loaded only for a supplied fixture/evidence pair.
Its dependency failures retain the verifier's rejection behavior; failure to
load the verifier itself gives the constant unavailable state.

Inputs must be ordinary inert JSON-shaped records/arrays, not executable
objects or Proxies. The bounded snapshot rejects accessors without calling
them, symbols, custom prototypes, aliases/cycles, sparse arrays, numbers and
extra array fields. It permits null only as data; the verifier still decides
the fixture schema. Combined fixture/evidence/presentation limits are depth
12, 24000 nodes, 4000000 string characters, 65536 characters per string,
512 array entries, 32 object keys and 64 characters per key.

When supplied, `presentation` has exactly `proposal`, `choices`, `result`.
`proposal` and `choices` must equal the copied manifest values (including
choice order); `result` must equal the fresh complete verifier result.
Object key order is immaterial. An extra field, profile override, stale report,
edited proposal/label/weight/hash/policy or omitted report field rejects the
whole display. Additional positional arguments also reject. Callers needing
no comparison should omit `presentation`, not supply an arbitrary report.

| Input / outcome | Display state | Proposal / totals / winner |
| --- | --- | --- |
| Both arguments omitted/undefined, no presentation | `pending`, NOT RUN | None |
| Either artifact null/undefined, no presentation | `unavailable`, ARTIFACT_UNAVAILABLE | None |
| Verifier module unavailable | `unavailable`, ARTIFACT_UNAVAILABLE | None |
| Malformed input/presentation, mismatch, verifier rejection | `rejected`, FIXTURE_REJECTED | None; no exception or partial data |
| Verified pair; tie, zero cast weight or unmet gate | `verified-synthetic-fixture` | Exact fixture totals; no fixture winner |
| Verified pair with a unique qualifying choice | `verified-synthetic-fixture` | Exact totals; fixture-only winner label |

Direct CLI entry refuses with `OFFLINE_API_ONLY`, fixed synthetic markers and
exit code 1. It neither renders HTML nor imports the verifier. This is source
behavior, not an observed CLI result.

## Presentation And Inertness

Every state visibly retains `ADVISORY`, `synthetic-only`,
`productionReady=false` and `chainEvidenceVerified=false`. These markers are
constants, not configurable values. Successful results also identify trust as
`injected-synthetic-assertions-only`. No live Council records, adopted, funded
or executed state is supplied by this API.

Proposal and choice strings are escaped as HTML text, including quotes and
apostrophes. They never become URLs, markup, CSS, IDs or handler attributes.
Weights come directly from the verifier as canonical base-unit strings.
The IFR column only inserts a decimal point nine places from the right,
retaining all nine fractional digits; no Number conversion, rounding,
scientific notation or approximate percentage is used. Hashes are displayed
in full and wrap; policy fractions and denominators remain exact strings.

The document uses system fonts and a fixed inline stylesheet, unframed
reading sections, 6px fieldset corners, wrapping text and contained table
scrolling. It does not import the Wiki skin's remote fonts or active shell.
CSP denies scripts, connections, frames, objects, forms, base URLs, workers,
fonts, images and media. Inline static styles are the sole allowed resource.
Navigation is fixed fragment links; disclosure uses native details/summary.
All radio/button controls are natively disabled, with no form, file input,
wallet, intake, storage, signing, provider or external-link path. No client
JavaScript or ethers is embedded in the HTML.

## Authored Checks And Deferred Evidence

The regression source reuses the existing public dummy-scalar fixture recipe
without importing the executable fixture test. Signing code exists only inside
the new test's explicit `run` function for a later separately approved confined
runner; no workstation signing is performed in this task. There is no
top-level test import/signing side effect and no mock verifier bypass.

Authored assertions cover hostile proposal/choice strings, stale/malformed
presentation and profile overrides, omitted/rejected artifacts, unique fixture
winner, tie, no cast weight, both unmet gates, exact large and fractional IFR
weights, hashes, policy denominators, native disabled controls, fragment-only
links and forbidden resources. These assertions have NOT RUN.

The frontend-visual-release-gate is deferred, not waived. A later parent-approved
exercise would require pending/unavailable/rejected/no-winner/winner states at
320x568, 390x844, 768x1024 and 1440x900, 200% zoom and JavaScript disabled;
no document horizontal overflow or intersections; full wrapping; table overflow
contained in its scroller; 44px touch targets; constant markers; inert controls;
zero off-device/resource/provider/sign/post/upload requests; screenshots opened
by the parent. No browser, screenshot, computed-layout or runtime evidence is
produced here. This document makes no renderer, fixture, runtime, visual,
integration, activation or governance-readiness claim. Parent source review
and any later execution are separate decisions.
