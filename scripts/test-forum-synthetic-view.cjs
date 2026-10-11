"use strict";

// Source only here. Invoke ONLY after separate parent approval in a confined runner.
// No executable test-file import, providers, workstation keys, or top-level signing.
function run() {
  const assert = require("node:assert/strict");
  const ethers = require("ethers");
  const { verifyFixture } = require("./verify-forum-votes.cjs");
  const { renderSyntheticView } = require("./build-forum-synthetic-view.cjs");
  assert.equal(ethers.version, "6.17.0");
  const keys = [1n, 2n, 3n].map((n) => new ethers.SigningKey(ethers.toBeHex(n, 32)));
  const wallets = keys.map((key) => ethers.computeAddress(key.publicKey).toLowerCase());
  const contract = `0x${"a1".repeat(20)}`;
  const bytes32 = (n) => ethers.toBeHex(BigInt(n), 32);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const types = { SyntheticForumVote: [
    { name: "manifestHash", type: "bytes32" }, { name: "ballotId", type: "string" },
    { name: "proposalHash", type: "bytes32" }, { name: "chainId", type: "uint256" },
    { name: "snapshotHeight", type: "uint256" }, { name: "snapshotHash", type: "bytes32" },
    { name: "wallet", type: "address" }, { name: "kind", type: "string" },
    { name: "choice", type: "string" }, { name: "messageId", type: "bytes32" },
    { name: "nonce", type: "uint256" }, { name: "order", type: "uint256" },
  ] };

  // Inert recipe from test-forum-votes.cjs, not its executable test entry.
  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) =>
        `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }
  const hashJSON = (value) => ethers.keccak256(ethers.toUtf8Bytes(canonical(value)));
  function digest(vote) {
    const { domain, signature, ...payload } = vote;
    return ethers.TypedDataEncoder.hash(domain, types, payload);
  }
  function build(options = {}) {
    const weights = options.weights || ["9007199254740993", "1", "2"];
    const plans = options.votes || [[0, "YES"], [1, "NO"], [2, "ABSTAIN"]];
    const snapshot = { chainId: "31337", height: "123", blockHash: bytes32(123) };
    const locks = weights.map((weight, i) => ({ claimId: bytes32(i + 1), contract, owner: wallets[i], weight }));
    const policy = {
      selection: "first-only", order: "contiguous-receipt-v1", start: "10",
      cutoff: (10n + BigInt(plans.length)).toString(), delegation: "disabled", tie: "no-winner",
      quorum: { basis: "eligible-weight", weight: weights.reduce((sum, item) => sum + BigInt(item), 0n).toString(),
        numerator: "1", denominator: "1", comparison: "gte" },
      threshold: { basis: "cast-weight", numerator: "1", denominator: "2", comparison: "gt" },
      abstain: { choice: "ABSTAIN", quorum: "include", threshold: "exclude" },
    };
    if (options.policy) options.policy(policy);
    const manifest = {
      schema: "forum-fixture-v1",
      domain: { name: "IFR Forum Synthetic Fixture", version: "1", chainId: "31337",
        verifyingContract: `0x${"c3".repeat(20)}`, salt: bytes32(9) },
      ballotId: "SYNTHETIC_BALLOT_1",
      proposal: { id: "DUMMY_PROPOSAL", version: "1", title: "Synthetic only",
        text: "Dummy full proposal.\nNo governance authority." },
      choices: [{ id: "ABSTAIN", label: "Abstain" }, { id: "NO", label: "No" }, { id: "YES", label: "Yes" }],
      snapshot: clone(snapshot), approvedContracts: [contract],
      voters: weights.map((_, i) => ({ wallet: wallets[i], kind: options.smart && i === 0 ? "EIP1271" : "EOA" }))
        .sort((a, b) => a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0),
      lockEvidenceHash: hashJSON({ profile: "synthetic-only", snapshot, locks }), policy,
    };
    if (options.manifest) options.manifest(manifest);
    const manifestHash = hashJSON(manifest);
    const nonces = new Map();
    const votes = plans.map(([i, choice], index) => {
      const nonce = nonces.get(i) || 0n;
      nonces.set(i, nonce + 1n);
      const payload = {
        manifestHash, ballotId: manifest.ballotId, proposalHash: hashJSON(manifest.proposal),
        chainId: snapshot.chainId, snapshotHeight: snapshot.height, snapshotHash: snapshot.blockHash,
        wallet: wallets[i], kind: options.smart && i === 0 ? "EIP1271" : "EOA", choice,
        messageId: bytes32(100 + index), nonce: nonce.toString(), order: (BigInt(policy.start) + BigInt(index)).toString(),
      };
      return { domain: clone(manifest.domain), ...payload,
        signature: keys[i].sign(ethers.TypedDataEncoder.hash(manifest.domain, types, payload)).serialized };
    });
    const evidence = {
      profile: "synthetic-only", manifestHash, snapshot, locks,
      receipts: votes.map((vote) => ({ order: vote.order, messageId: vote.messageId, digest: digest(vote) })),
      cutoff: { kind: "synthetic-complete-order-attestation-v1", complete: true,
        start: policy.start, end: policy.cutoff, count: String(plans.length) },
      contractAttestations: votes.filter((vote) => vote.kind === "EIP1271").map((vote) => ({
        kind: "synthetic-eip1271-attestation-v1", wallet: vote.wallet,
        chainId: snapshot.chainId, height: snapshot.height, blockHash: snapshot.blockHash,
        digest: digest(vote), signatureHash: ethers.keccak256(vote.signature), magicValue: "0x1626ba7e",
      })),
    };
    return { fixture: { profile: "synthetic-only", manifest, votes }, evidence };
  }

  function verified(pair) {
    const result = verifyFixture(pair.fixture, pair.evidence);
    assert.equal(result.status, "verified-synthetic-fixture");
    return result;
  }
  function presentation(pair) {
    return { proposal: clone(pair.fixture.manifest.proposal), choices: clone(pair.fixture.manifest.choices),
      result: clone(verified(pair)) };
  }
  function inert(html) {
    for (const marker of ["ADVISORY", "synthetic-only", "productionReady=false", "chainEvidenceVerified=false"]) {
      assert.ok(html.includes(marker));
    }
    assert.match(html, /<meta http-equiv="Content-Security-Policy"/);
    for (const directive of ["default-src", "script-src", "script-src-attr", "connect-src", "frame-src",
      "child-src", "object-src", "form-action", "base-uri", "worker-src", "manifest-src", "img-src", "font-src", "media-src"]) {
      assert.ok(html.includes(`${directive} &#39;none&#39;`));
    }
    assert.doesNotMatch(html, /<(?:script|iframe|frame|object|embed|form|img|svg|link|base|video|audio)\b/i);
    for (const [tag] of html.matchAll(/<[a-z][^>]*>/gi)) {
      assert.doesNotMatch(tag, /\s(?:on[a-z]+|src|srcset|action|formaction|poster)\s*=/i);
    }
    assert.doesNotMatch(html, /@import|url\s*\(/i);
    const links = [...html.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((match) => match[1]);
    assert.deepEqual(links, ["#proposal", "#ballot", "#result"]);
    assert.match(html, /<fieldset disabled>/);
    const controls = [...html.matchAll(/<(?:input|button)\b[^>]*>/g)].map((match) => match[0]);
    assert.ok(controls.length > 0);
    assert.ok(controls.every((tag) => /\sdisabled(?:\s|>)/.test(tag)));
    assert.ok(controls.every((tag) => /type="(?:radio|button)"/.test(tag)));
    assert.match(html, /overflow-wrap: anywhere/);
    assert.match(html, /white-space: pre-wrap/);
    assert.match(html, /\.table-scroll \{ max-width: 100%; overflow-x: auto; \}/);
    assert.doesNotMatch(html, /overflow-x:\s*(?:hidden|clip)|letter-spacing:\s*-/);
    assert.doesNotMatch(html, /\b(?:Approved|Executed|Funded|Adopted)\b/);
  }
  function absent(html, state) {
    inert(html);
    assert.match(html, new RegExp(`data-state="${state}"`));
    assert.doesNotMatch(html, /<table\b|class="fixture-winner"|class="proposal-text"|<input\b/);
    assert.doesNotMatch(html, /Dummy full proposal|DUMMY_PROPOSAL|9007199254740993/);
  }
  function rendered(pair, view) {
    const before = JSON.stringify(pair);
    const html = renderSyntheticView(pair.fixture, pair.evidence, view);
    inert(html);
    assert.match(html, /data-state="verified-synthetic-fixture"/);
    assert.equal(JSON.stringify(pair), before);
    return html;
  }

  const pending = renderSyntheticView();
  absent(pending, "pending");
  assert.ok(pending.includes("NOT RUN"));
  assert.equal(renderSyntheticView(undefined, undefined), pending);
  for (const args of [[null, null], [undefined, null], [null, {}], [{}, undefined]]) {
    const html = renderSyntheticView(...args);
    absent(html, "unavailable");
    assert.ok(html.includes("ARTIFACT_UNAVAILABLE"));
    assert.equal(html, renderSyntheticView(null, null));
  }
  const rejection = renderSyntheticView({}, {});
  absent(rejection, "rejected");
  assert.ok(rejection.includes("FIXTURE_REJECTED"));
  assert.equal(renderSyntheticView(null, null, { profile: "live" }), rejection);

  const pair = build();
  const result = verified(pair);
  const view = presentation(pair);
  const html = rendered(pair, view);
  assert.equal(rendered(pair), html);
  assert.equal(rendered(pair, clone(view)), html);
  assert.ok(html.includes("Fixture-only winner: Yes (<code>YES</code>)"));
  assert.ok(html.includes("<code>9007199254740993</code>"));
  assert.ok(html.includes("<code>9007199.254740993</code>"));
  assert.ok(html.includes("<code>9007199.254740996</code>"));
  assert.ok(html.includes("<code>0.000000001</code>"));
  assert.ok(html.includes("<code>0.000000002</code>"));
  assert.ok(html.includes("injected-synthetic-assertions-only"));
  for (const value of [result.manifestHash, result.proposalHash, result.evidenceHash,
    pair.fixture.manifest.lockEvidenceHash, pair.fixture.manifest.snapshot.blockHash]) {
    assert.ok(html.includes(`<code class="hash">${value}</code>`));
  }

  const hostile = `</pre><script>alert("x")</script><img src='https://invalid.example/' onerror="x">&`;
  const attack = build({ manifest: (m) => {
    m.proposal.title = hostile;
    m.proposal.text = `${hostile}\n${"X".repeat(16000)}`;
    m.choices.find((choice) => choice.id === "YES").label = hostile;
  } });
  const hostileHTML = rendered(attack, presentation(attack));
  assert.ok(hostileHTML.includes("&lt;/pre&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"));
  assert.ok(hostileHTML.includes("src=&#39;https://invalid.example/&#39;"));
  assert.ok(hostileHTML.includes("&gt;&amp;"));
  assert.ok(hostileHTML.includes("X".repeat(16000)));
  assert.ok(!hostileHTML.includes(hostile));

  const fractional = rendered(build({ weights: ["1234567891", "1", "2"] }));
  assert.ok(fractional.includes("<code>1.234567891</code>"));
  assert.ok(fractional.includes("<code>1.234567894</code>"));
  const maximum = ((1n << 256n) - 1n).toString();
  const largePair = build({ weights: [maximum, maximum], votes: [[0, "YES"], [1, "YES"]],
    policy: (p) => { p.quorum.basis = "explicit-weight"; p.quorum.weight = maximum; } });
  const largeResult = verified(largePair);
  const largeHTML = rendered(largePair);
  assert.equal(largeResult.castWeight, (2n * BigInt(maximum)).toString());
  assert.ok(largeHTML.includes(`<code>${largeResult.castWeight}</code>`));
  assert.doesNotMatch(largeHTML, /[0-9][eE][+-][0-9]/);

  const tie = build({ weights: ["1", "1"], votes: [[0, "YES"], [1, "NO"]],
    policy: (p) => { p.threshold.comparison = "gte"; } });
  assert.equal(verified(tie).thresholdMet, true);
  assert.equal(verified(tie).fixtureWinner, null);
  assert.ok(rendered(tie).includes("No fixture winner"));
  const zero = build({ votes: [] });
  assert.equal(verified(zero).castWeight, "0");
  assert.ok(rendered(zero).includes("No fixture winner"));
  assert.ok(rendered(zero).includes("<code>0.000000000</code>"));
  const quorumFail = build({ weights: ["5", "5"], votes: [[0, "YES"]] });
  assert.equal(verified(quorumFail).quorumMet, false);
  assert.equal(verified(quorumFail).thresholdMet, true);
  assert.ok(rendered(quorumFail).includes("Fixture quorum: unmet. Fixture threshold: met."));
  assert.ok(rendered(quorumFail).includes("No fixture winner"));
  const thresholdFail = build({ weights: ["5", "5"], votes: [[0, "YES"], [1, "ABSTAIN"]],
    policy: (p) => { p.abstain.threshold = "include"; } });
  assert.equal(verified(thresholdFail).quorumMet, true);
  assert.equal(verified(thresholdFail).thresholdMet, false);
  assert.ok(rendered(thresholdFail).includes("Fixture quorum: met. Fixture threshold: unmet."));
  assert.ok(rendered(thresholdFail).includes("No fixture winner"));
  const fractionRule = build({ policy: (p) => {
    p.threshold.numerator = "500000000000000001";
    p.threshold.denominator = "1000000000000000000";
  } });
  const ruleHTML = rendered(fractionRule);
  assert.ok(ruleHTML.includes("<code>500000000000000001</code> / <code>1000000000000000000</code>"));
  rendered(build({ smart: true }));
  for (const selection of ["first-only", "last-valid"]) {
    const repeat = build({ weights: ["7"], votes: [[0, "YES"], [0, "NO"]],
      policy: (p) => { p.selection = selection; } });
    assert.equal(verified(repeat).fixtureWinner, selection === "first-only" ? "YES" : "NO");
    assert.ok(rendered(repeat).includes(`<code>${selection}</code>`));
  }
  const reordered = build();
  reordered.fixture.manifest.choices.reverse();
  rendered(reordered, presentation(reordered));

  const mutations = [
    (v) => { v.proposal.title = "Edited title"; }, (v) => { v.proposal.text += " edited"; },
    (v) => { v.proposal.id = "OTHER"; }, (v) => { v.proposal.version = "2"; },
    (v) => { v.choices[0].label = hostile; }, (v) => { v.choices[0].id = "OTHER"; },
    (v) => { v.choices.pop(); }, (v) => { v.choices.reverse(); },
    (v) => { v.result.tallies[0].weight = "999"; }, (v) => { v.result.tallies[0].choice = "YES"; },
    (v) => { v.result.tallies.push(clone(v.result.tallies[0])); },
    (v) => { v.result.fixtureWinner = "NO"; }, (v) => { v.result.status = "approved"; },
    (v) => { v.result.manifestHash = bytes32(77); }, (v) => { v.result.proposalHash = bytes32(77); },
    (v) => { v.result.evidenceHash = bytes32(77); }, (v) => { v.result.profile = "live"; },
    (v) => { v.result.authority = "BINDING"; }, (v) => { v.result.productionReady = true; },
    (v) => { v.result.chainEvidenceVerified = true; }, (v) => { v.result.trust = "chain"; },
    (v) => { v.result.locks[0].weight = "999"; }, (v) => { v.result.finalVotes[0].weight = "999"; },
    (v) => { delete v.result.finalVotes; }, (v) => { delete v.result.tallies; },
    (v) => { v.profile = "live"; }, (v) => { v.policy = { threshold: "0" }; },
  ];
  for (const field of ["eligibleWeight", "castWeight", "abstainWeight", "quorumWeight", "quorumBasisWeight", "thresholdBasisWeight"]) {
    mutations.push((v) => { v.result[field] = "999"; });
  }
  for (const field of ["quorumMet", "thresholdMet"]) mutations.push((v) => { v.result[field] = !v.result[field]; });
  for (const mutation of mutations) {
    const altered = clone(view);
    mutation(altered);
    assert.equal(renderSyntheticView(pair.fixture, pair.evidence, altered), rejection);
  }
  for (const malformed of [null, [], {}, "synthetic-only", { ...clone(view), extra: "x" }]) {
    assert.equal(renderSyntheticView(pair.fixture, pair.evidence, malformed), rejection);
  }
  assert.equal(renderSyntheticView(pair.fixture, pair.evidence, undefined, { profile: "live" }), rejection);
  const stale = build({ weights: ["1234567891", "1", "2"] });
  assert.equal(renderSyntheticView(stale.fixture, stale.evidence, view), rejection);

  for (const mutation of [
    (p) => { p.fixture.profile = "live"; }, (p) => { p.evidence.profile = "live"; },
    (p) => { p.fixture.manifest.proposal.text += hostile; },
    (p) => { p.fixture.manifest.choices[0].label = hostile; },
    (p) => { p.fixture.manifest.policy.threshold.denominator = "3"; },
    (p) => { p.evidence.locks[0].weight = "9007199254740994"; },
    (p) => { p.fixture.votes[0].signature = "0x00"; },
    (p) => { p.fixture.evidence = clone(p.evidence); },
    (p) => { p.evidence.locks[0].weight = "0.5"; },
    (p) => { p.evidence.locks[0].weight = 1; },
  ]) {
    const invalid = build();
    mutation(invalid);
    assert.equal(renderSyntheticView(invalid.fixture, invalid.evidence), rejection);
  }
  let reads = 0;
  for (const location of ["fixture", "evidence", "presentation"]) {
    const data = build();
    const supplied = presentation(data);
    const record = location === "presentation" ? supplied : data[location];
    Object.defineProperty(record, "profile", { enumerable: true, get() { reads += 1; return "live"; } });
    assert.equal(renderSyntheticView(data.fixture, data.evidence, supplied), rejection);
  }
  assert.equal(reads, 0);
  const cycle = build();
  cycle.fixture.self = cycle.fixture;
  assert.equal(renderSyntheticView(cycle.fixture, cycle.evidence), rejection);
  const symbol = build();
  symbol.fixture[Symbol("profile")] = "live";
  assert.equal(renderSyntheticView(symbol.fixture, symbol.evidence), rejection);
  const sparse = build();
  delete sparse.fixture.manifest.choices[1];
  assert.equal(renderSyntheticView(sparse.fixture, sparse.evidence), rejection);
  const prototype = build();
  Object.setPrototypeOf(prototype.fixture, { profile: "live" });
  assert.equal(renderSyntheticView(prototype.fixture, prototype.evidence), rejection);
  const aliased = build();
  aliased.evidence.snapshot = aliased.fixture.manifest.snapshot;
  assert.equal(renderSyntheticView(aliased.fixture, aliased.evidence), rejection);

  process.stdout.write("[forum-synthetic-view] PASS - disabled synthetic renderer assertions\n");
}

module.exports = { run };
if (require.main === module) run();
