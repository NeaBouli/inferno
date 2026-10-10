"use strict";

// Offline render API only; verification remains owned by verifyFixture.
function requireValid(condition) {
  if (!condition) throw new Error("FIXTURE_REJECTED");
}

// Snapshot data descriptors so later display cannot read mutable getters.
function inertSnapshot(value) {
  const seen = new WeakSet();
  let nodes = 0;
  let characters = 0;
  function copy(item, depth) {
    requireValid(++nodes <= 24000 && depth <= 12);
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") {
      characters += item.length;
      requireValid(item.length <= 65536 && characters <= 4000000);
      return item;
    }
    requireValid(typeof item === "object" && !seen.has(item));
    seen.add(item);
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    requireValid(array ? prototype === Array.prototype
      : prototype === Object.prototype || prototype === null);
    const keys = Reflect.ownKeys(item);
    requireValid(keys.every((key) => typeof key === "string" && key.length <= 64));
    if (array) {
      const length = Object.getOwnPropertyDescriptor(item, "length").value;
      requireValid(length <= 512 && keys.length === length + 1);
      const result = [];
      for (let i = 0; i < length; i += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
        requireValid(descriptor && "value" in descriptor && descriptor.enumerable);
        result.push(copy(descriptor.value, depth + 1));
      }
      return result;
    }
    requireValid(keys.length <= 32);
    const result = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      requireValid("value" in descriptor && descriptor.enumerable);
      result[key] = copy(descriptor.value, depth + 1);
    }
    return result;
  }
  return copy(value, 0);
}

function escapeText(value) {
  requireValid(typeof value === "string");
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function code(value) { return `<code>${escapeText(value)}</code>`; }
function hash(value) { return `<code class="hash">${escapeText(value)}</code>`; }
function weightCells(value) {
  requireValid(typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value));
  const padded = value.padStart(10, "0");
  return `<td><span class="weight">${code(value)}</span></td><td><span class="weight">`
    + `${code(`${padded.slice(0, -9)}.${padded.slice(-9)}`)}</span></td>`;
}

const CSP = "default-src 'none'; script-src 'none'; script-src-attr 'none'; "
  + "connect-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; "
  + "form-action 'none'; base-uri 'none'; worker-src 'none'; manifest-src 'none'; "
  + "img-src 'none'; font-src 'none'; media-src 'none'; style-src 'unsafe-inline'";

const STYLE = `
* { box-sizing: border-box; }
html { color-scheme: light; background: #f5f6f7; color: #24262a; }
body { margin: 0; font: 16px/1.6 system-ui, sans-serif; letter-spacing: 0; }
header, main, footer { width: 100%; max-width: 1100px; margin: 0 auto; padding: 20px 24px; }
header { border-bottom: 1px solid #c8ccd0; }
h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.2; }
h2 { margin: 0 0 12px; font-size: 22px; line-height: 1.3; }
h3 { margin: 12px 0; font-size: 18px; line-height: 1.4; }
p { margin: 8px 0 16px; }
h1, h2, h3, p, li, dt, dd, label, button, summary, code { overflow-wrap: anywhere; }
.markers { margin: 0; color: #87392d; font-weight: 600; }
.guards { display: flex; flex-wrap: wrap; gap: 4px 20px; margin: 6px 0 12px; }
nav { display: flex; flex-wrap: wrap; gap: 8px 24px; }
a { color: #126255; text-underline-offset: 3px; }
nav a, summary { min-height: 44px; padding: 10px 0; }
section { padding: 20px 0; border-bottom: 1px solid #c8ccd0; min-width: 0; }
dl { display: grid; grid-template-columns: minmax(0, 180px) minmax(0, 1fr); gap: 8px 20px; }
dt { font-weight: 600; }
dd { margin: 0; min-width: 0; }
pre { margin: 12px 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
code { font: 14px/1.6 ui-monospace, monospace; }
.hash, .weight { display: block; max-width: 100%; overflow-wrap: anywhere; }
fieldset { margin: 12px 0; padding: 12px 16px 16px; min-width: 0; border: 1px solid #8f959b; border-radius: 6px; }
legend { max-width: 100%; padding: 0 6px; overflow-wrap: anywhere; }
label { display: flex; align-items: flex-start; gap: 12px; min-height: 44px; padding: 10px 0; }
input { flex: 0 0 auto; width: 20px; height: 20px; margin: 3px 0 0; }
button { min-height: 44px; max-width: 100%; padding: 10px 16px; white-space: normal; font: inherit; }
button:disabled { color: #484e54; background: #e3e6e9; border: 1px solid #8f959b; border-radius: 4px; }
details { margin: 12px 0; }
summary { cursor: pointer; font-weight: 600; }
.table-scroll { max-width: 100%; overflow-x: auto; }
table { width: 100%; min-width: 440px; border-collapse: collapse; table-layout: fixed; }
caption { text-align: left; font-weight: 600; padding: 8px 0; }
th, td { text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid #c8ccd0; overflow-wrap: anywhere; }
th { background: #e9eeed; }
a:focus-visible, summary:focus-visible { outline: 2px solid #126255; outline-offset: 3px; }
@media (max-width: 768px) { header, main, footer { padding: 16px; } dl { grid-template-columns: minmax(0, 1fr); gap: 4px; } dd { margin-bottom: 10px; } }
@media (max-width: 480px) { header, main, footer { padding: 12px; } }
`;

function document(state, content) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeText(CSP)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Forum - disabled synthetic view</title><style>${STYLE}</style></head>
<body data-state="${state}"><header><h1>Forum</h1>
<p class="markers">ADVISORY | synthetic-only</p>
<div class="guards"><code>productionReady=false</code><code>chainEvidenceVerified=false</code></div>
<nav aria-label="Forum sections"><a href="#proposal">Proposal</a><a href="#ballot">Ballot</a><a href="#result">Result</a></nav>
</header><main>${content}</main><footer><p>Unpublished synthetic fixture. No governance authority.</p></footer></body></html>`;
}

function constantState(state) {
  const messages = {
    pending: "NOT RUN", unavailable: "ARTIFACT_UNAVAILABLE", rejected: "FIXTURE_REJECTED",
  };
  return document(state, `<section id="proposal"><h2>Proposal</h2><p>Unavailable</p></section>
<section id="ballot"><h2>Ballot</h2><fieldset disabled><legend>Disabled synthetic ballot</legend>
<button type="button" disabled>Voting disabled</button></fieldset></section>
<section id="result"><h2>Result</h2><p role="status">${messages[state]}</p></section>`);
}

function rule(value) {
  return `${code(value.basis)}; ${code(value.numerator)} / ${code(value.denominator)}; ${code(value.comparison)}`;
}

function verifiedContent(manifest, result) {
  const proposal = manifest.proposal;
  const policy = manifest.policy;
  const choices = manifest.choices;
  const rows = choices.map((choice) => {
    const tally = result.tallies.find((item) => item.choice === choice.id);
    requireValid(tally);
    return `<tr><td>${escapeText(choice.label)} (${code(choice.id)})</td>${weightCells(tally.weight)}</tr>`;
  }).join("\n");
  const metrics = [
    ["Eligible weight", result.eligibleWeight], ["Cast weight", result.castWeight],
    ["Abstain weight", result.abstainWeight], ["Quorum weight", result.quorumWeight],
    ["Quorum basis", result.quorumBasisWeight], ["Threshold basis", result.thresholdBasisWeight],
  ].map(([label, value]) => `<tr><th scope="row">${label}</th>${weightCells(value)}</tr>`).join("\n");
  const winner = result.fixtureWinner === null ? "No fixture winner"
    : `Fixture-only winner: ${escapeText(choices.find((choice) => choice.id === result.fixtureWinner).label)} (${code(result.fixtureWinner)})`;
  return `<section id="proposal"><h2>Proposal</h2><h3>${escapeText(proposal.title)}</h3>
<dl><dt>Proposal ID</dt><dd>${code(proposal.id)}</dd><dt>Version</dt><dd>${code(proposal.version)}</dd>
<dt>Ballot ID</dt><dd>${code(manifest.ballotId)}</dd></dl>
<pre class="proposal-text">${escapeText(proposal.text)}</pre>
<details><summary>Fixture manifest</summary><dl>
<dt>Manifest hash</dt><dd>${hash(result.manifestHash)}</dd><dt>Proposal hash</dt><dd>${hash(result.proposalHash)}</dd>
<dt>Evidence hash</dt><dd>${hash(result.evidenceHash)}</dd><dt>Lock evidence hash</dt><dd>${hash(manifest.lockEvidenceHash)}</dd>
<dt>Snapshot chain</dt><dd>${code(manifest.snapshot.chainId)}</dd><dt>Snapshot height</dt><dd>${code(manifest.snapshot.height)}</dd>
<dt>Snapshot hash</dt><dd>${hash(manifest.snapshot.blockHash)}</dd>
<dt>Domain name</dt><dd>${escapeText(manifest.domain.name)}</dd><dt>Domain version</dt><dd>${code(manifest.domain.version)}</dd>
<dt>Domain chain</dt><dd>${code(manifest.domain.chainId)}</dd><dt>Verifying contract</dt><dd>${code(manifest.domain.verifyingContract)}</dd>
<dt>Domain salt</dt><dd>${hash(manifest.domain.salt)}</dd></dl></details></section>
<section id="ballot"><h2>Ballot</h2><fieldset disabled><legend>Disabled synthetic ballot</legend>
${choices.map((choice) => `<label><input type="radio" name="synthetic-choice" disabled><span>${escapeText(choice.label)} (${code(choice.id)})</span></label>`).join("\n")}
<button type="button" disabled>Voting disabled</button></fieldset>
<details><summary>Fixture policy</summary><dl>
<dt>Selection</dt><dd>${code(policy.selection)}</dd><dt>Order</dt><dd>${code(policy.order)}</dd>
<dt>Start</dt><dd>${code(policy.start)}</dd><dt>Cutoff</dt><dd>${code(policy.cutoff)}</dd>
<dt>Delegation</dt><dd>${code(policy.delegation)}</dd><dt>Tie</dt><dd>${code(policy.tie)}</dd>
<dt>Quorum rule</dt><dd>${rule(policy.quorum)}; weight ${code(policy.quorum.weight)}</dd>
<dt>Threshold rule</dt><dd>${rule(policy.threshold)}</dd>
<dt>Abstain choice</dt><dd>${code(policy.abstain.choice)}</dd>
<dt>Abstain quorum</dt><dd>${code(policy.abstain.quorum)}</dd><dt>Abstain threshold</dt><dd>${code(policy.abstain.threshold)}</dd>
</dl></details></section>
<section id="result"><h2>Result</h2><p role="status">Verified synthetic fixture</p>
<p>${code(result.trust)}</p><p class="fixture-winner">${winner}</p>
<p>Fixture quorum: ${result.quorumMet ? "met" : "unmet"}. Fixture threshold: ${result.thresholdMet ? "met" : "unmet"}.</p>
<div class="table-scroll" tabindex="0" role="region" aria-label="Exact fixture tallies"><table>
<caption>Fixture tallies</caption><thead><tr><th scope="col">Choice</th><th scope="col">Base units</th><th scope="col">IFR</th></tr></thead><tbody>${rows}</tbody></table></div>
<div class="table-scroll" tabindex="0" role="region" aria-label="Exact fixture weight bases"><table>
<caption>Fixture weight bases</caption><thead><tr><th scope="col">Measure</th><th scope="col">Base units</th><th scope="col">IFR</th></tr></thead><tbody>${metrics}</tbody></table></div></section>`;
}

function renderSyntheticView(fixture, trustedEvidence, presentation) {
  if (arguments.length > 3) return constantState("rejected");
  if (presentation === undefined && fixture === undefined && trustedEvidence === undefined) {
    return constantState("pending");
  }
  if (fixture == null || trustedEvidence == null) {
    return constantState(presentation === undefined ? "unavailable" : "rejected");
  }
  try {
    const input = inertSnapshot(presentation === undefined
      ? { fixture, trustedEvidence } : { fixture, trustedEvidence, presentation });
    let verifyFixture;
    try { ({ verifyFixture } = require("./verify-forum-votes.cjs")); }
    catch { return constantState("unavailable"); }
    const result = verifyFixture(input.fixture, input.trustedEvidence);
    requireValid(result.status === "verified-synthetic-fixture"
      && result.profile === "synthetic-only" && result.authority === "ADVISORY"
      && result.productionReady === false && result.chainEvidenceVerified === false
      && result.trust === "injected-synthetic-assertions-only");
    if (presentation !== undefined) {
      const view = input.presentation;
      requireValid(view && !Array.isArray(view) && Object.keys(view).length === 3
        && ["proposal", "choices", "result"].every((key) => Object.hasOwn(view, key)));
      const { isDeepStrictEqual } = require("node:util");
      requireValid(isDeepStrictEqual(view.proposal, input.fixture.manifest.proposal)
        && isDeepStrictEqual(view.choices, input.fixture.manifest.choices)
        && isDeepStrictEqual(view.result, inertSnapshot(result)));
    }
    return document("verified-synthetic-fixture", verifiedContent(input.fixture.manifest, result));
  } catch {
    return constantState("rejected");
  }
}

module.exports = { renderSyntheticView };

if (require.main === module) {
  process.stdout.write(`${JSON.stringify({ profile: "synthetic-only", authority: "ADVISORY",
    productionReady: false, chainEvidenceVerified: false, status: "refused", error: "OFFLINE_API_ONLY" })}\n`);
  process.exitCode = 1;
}
