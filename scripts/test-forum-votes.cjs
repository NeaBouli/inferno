"use strict";

// Run ONLY in the parent's confined Linux runner with the readonly cached closure.
// All principals are derived from public dummy scalars; no accounts or providers.
function run() {
  const assert = require("node:assert/strict");
  const ethers = require("ethers");
  const { verifyFixture } = require("./verify-forum-votes.cjs");
  assert.equal(ethers.version, "6.17.0");
  const keys = [1n, 2n, 3n, 4n].map((n) => new ethers.SigningKey(ethers.toBeHex(n, 32)));
  const wallets = keys.map((key) => ethers.computeAddress(key.publicKey).toLowerCase());
  const contract = `0x${"a1".repeat(20)}`;
  const otherContract = `0x${"b2".repeat(20)}`;
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

  // Independent recipe implementation: sorted JSON object keys, not verifier internals.
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
    const { domain, signature, ...value } = vote;
    return ethers.TypedDataEncoder.hash(domain, types, value);
  }

  function build(options = {}) {
    const weights = options.weights || ["9007199254740993", "1", "2"];
    const snapshot = { chainId: "31337", height: "123", blockHash: bytes32(123) };
    const locks = weights.map((weight, i) => ({
      claimId: bytes32(i + 1), contract, owner: wallets[i], weight,
    }));
    if (options.locks) options.locks(locks);
    locks.sort((a, b) => a.claimId < b.claimId ? -1 : a.claimId > b.claimId ? 1 : 0);
    const plans = options.votes || [[0, "YES"], [1, "NO"], [2, "ABSTAIN"]];
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
      proposal: { id: "DUMMY_PROPOSAL", version: "1", title: "Synthetic only", text: "Dummy full proposal.\nNo governance authority." },
      choices: [{ id: "ABSTAIN", label: "Abstain" }, { id: "NO", label: "No" }, { id: "YES", label: "Yes" }],
      snapshot: clone(snapshot), approvedContracts: [contract, otherContract].sort(),
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
      const vote = {
        domain: clone(manifest.domain), manifestHash, ballotId: manifest.ballotId,
        proposalHash: hashJSON(manifest.proposal), chainId: snapshot.chainId,
        snapshotHeight: snapshot.height, snapshotHash: snapshot.blockHash,
        wallet: wallets[i], kind: options.smart && i === 0 ? "EIP1271" : "EOA", choice,
        messageId: bytes32(100 + index), nonce: nonce.toString(),
        order: (BigInt(policy.start) + BigInt(index)).toString(),
      };
      vote.signature = keys[i].sign(ethers.TypedDataEncoder.hash(vote.domain, types, {
        manifestHash: vote.manifestHash, ballotId: vote.ballotId, proposalHash: vote.proposalHash,
        chainId: vote.chainId, snapshotHeight: vote.snapshotHeight, snapshotHash: vote.snapshotHash,
        wallet: vote.wallet, kind: vote.kind, choice: vote.choice, messageId: vote.messageId,
        nonce: vote.nonce, order: vote.order,
      })).serialized;
      return vote;
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

  let failures = 0;
  function test(body) {
    try { body(); } catch { failures += 1; }
  }
  function trust(result) {
    assert.equal(result.profile, "synthetic-only");
    assert.equal(result.authority, "ADVISORY");
    assert.equal(result.productionReady, false);
    assert.equal(result.chainEvidenceVerified, false);
  }
  function verify(pair) { return verifyFixture(pair.fixture, pair.evidence); }
  function accepted(pair) {
    const result = verify(pair);
    trust(result);
    assert.equal(result.status, "verified-synthetic-fixture");
    return result;
  }
  function rejected(pair) {
    const result = verify(pair);
    trust(result);
    assert.deepEqual(result, { profile: "synthetic-only", authority: "ADVISORY",
      productionReady: false, chainEvidenceVerified: false, status: "rejected", error: "FIXTURE_REJECTED" });
  }
  function tamper(change, options) {
    test(() => { const pair = build(options); change(pair); rejected(pair); });
  }
  const weightOf = (result, choice) => result.tallies.find((item) => item.choice === choice).weight;

  test(() => {
    const pair = build();
    const before = JSON.stringify(pair);
    const result = accepted(pair);
    assert.equal(result.eligibleWeight, "9007199254740996");
    assert.equal(result.castWeight, "9007199254740996");
    assert.equal(weightOf(result, "YES"), "9007199254740993");
    assert.equal(weightOf(result, "NO"), "1");
    assert.equal(weightOf(result, "ABSTAIN"), "2");
    assert.equal(result.fixtureWinner, "YES");
    assert.equal(JSON.stringify(pair), before);
    assert.deepEqual(verify(pair), result);
  });
  test(() => {
    const pair = build({ weights: ["1"], votes: [[0, "YES"]] });
    const result = accepted(pair);
    assert.equal(result.castWeight, "1");
    assert.equal(result.fixtureWinner, "YES");
  });
  test(() => {
    const pair = build({ weights: ["1"], votes: [[0, "YES"], [0, "NO"]],
      policy: (p) => { p.start = "9007199254740993"; p.cutoff = "9007199254740995"; p.selection = "last-valid"; } });
    assert.equal(accepted(pair).finalVotes[0].order, "9007199254740994");
  });
  for (const numerator of ["4", "5", "6"]) {
    test(() => {
      const result = accepted(build({ weights: ["5", "5"], votes: [[0, "YES"], [1, "ABSTAIN"]],
        policy: (p) => { p.threshold.numerator = numerator; p.threshold.denominator = "10";
          p.threshold.comparison = "gte"; p.abstain.threshold = "include"; } }));
      assert.equal(result.thresholdMet, numerator !== "6");
    });
  }
  test(() => {
    const maximum = ((1n << 256n) - 1n).toString();
    const pair = build({ weights: [maximum, maximum], votes: [[0, "YES"], [1, "YES"]],
      policy: (p) => { p.quorum.basis = "explicit-weight"; p.quorum.weight = maximum; } });
    assert.equal(accepted(pair).castWeight, (2n * BigInt(maximum)).toString());
  });
  test(() => {
    const pair = build();
    const expected = accepted(pair);
    pair.fixture.votes.reverse(); pair.evidence.receipts.reverse(); pair.evidence.locks.reverse();
    pair.fixture.manifest.voters.reverse(); pair.fixture.manifest.choices.reverse();
    pair.fixture.manifest.approvedContracts.reverse();
    assert.deepEqual(accepted(pair), expected);
  });
  test(() => {
    const pair = build();
    const expected = accepted(pair);
    pair.fixture.votes[0].wallet = ethers.getAddress(pair.fixture.votes[0].wallet);
    pair.evidence.locks[0].owner = ethers.getAddress(pair.evidence.locks[0].owner);
    assert.deepEqual(accepted(pair), expected);
  });
  test(() => {
    const merged = accepted(build());
    const split = accepted(build({ locks: (locks) => {
      locks[0].weight = "9007199254740992";
      locks.push({ claimId: bytes32(44), contract: otherContract, owner: wallets[0], weight: "1" });
    } }));
    assert.deepEqual(split.tallies, merged.tallies);
    assert.equal(split.castWeight, merged.castWeight);
    assert.equal(split.fixtureWinner, merged.fixtureWinner);
  });
  for (const selection of ["first-only", "last-valid"]) {
    test(() => {
      const result = accepted(build({ weights: ["7"], votes: [[0, "YES"], [0, "NO"]],
        policy: (p) => { p.selection = selection; } }));
      assert.equal(result.finalVotes.length, 1);
      assert.equal(result.castWeight, "7");
      assert.equal(result.finalVotes[0].choice, selection === "first-only" ? "YES" : "NO");
      assert.equal(result.finalVotes[0].order, selection === "first-only" ? "10" : "11");
    });
  }
  for (const comparison of ["gte", "gt"]) {
    test(() => {
      const result = accepted(build({ weights: ["1", "1"], votes: [[0, "YES"]],
        policy: (p) => { p.quorum.numerator = "1"; p.quorum.denominator = "2"; p.quorum.comparison = comparison; } }));
      assert.equal(result.quorumMet, comparison === "gte");
    });
    test(() => {
      const result = accepted(build({ weights: ["1", "1"], votes: [[0, "YES"], [1, "ABSTAIN"]],
        policy: (p) => { p.threshold.comparison = comparison; p.abstain.threshold = "include"; } }));
      assert.equal(result.thresholdMet, comparison === "gte");
      assert.equal(result.fixtureWinner, comparison === "gte" ? "YES" : null);
    });
  }
  for (const treatment of ["include", "exclude"]) {
    test(() => {
      const result = accepted(build({ weights: ["1", "1"], votes: [[0, "YES"], [1, "ABSTAIN"]],
        policy: (p) => { p.abstain.quorum = treatment; } }));
      assert.equal(result.quorumMet, treatment === "include");
    });
  }
  test(() => {
    const result = accepted(build({ weights: ["1", "1"], votes: [[0, "YES"], [1, "NO"]],
      policy: (p) => { p.threshold.comparison = "gte"; } }));
    assert.equal(result.fixtureWinner, null);
    assert.equal(result.thresholdMet, true);
  });
  test(() => {
    const result = accepted(build({ votes: [] }));
    assert.equal(result.castWeight, "0");
    assert.equal(result.fixtureWinner, null);
    assert.equal(result.quorumMet, false);
    assert.equal(result.thresholdMet, false);
  });
  test(() => {
    const result = accepted(build({ weights: ["1"], votes: [[0, "ABSTAIN"]],
      policy: (p) => { p.quorum.numerator = "0"; p.threshold.numerator = "0"; } }));
    assert.equal(result.fixtureWinner, null);
    assert.equal(result.thresholdMet, false);
  });

  // Every typed binding is checked; update the trusted receipt to reach recovery.
  const voteMutations = [
    (v) => { v.manifestHash = bytes32(8); }, (v) => { v.ballotId = "OTHER"; },
    (v) => { v.proposalHash = bytes32(8); }, (v) => { v.chainId = "1"; },
    (v) => { v.snapshotHeight = "124"; }, (v) => { v.snapshotHash = bytes32(8); },
    (v) => { v.wallet = wallets[1]; }, (v) => { v.kind = "EIP1271"; },
    (v) => { v.choice = "UNKNOWN"; }, (v) => { v.choice = "NO"; },
    (v) => { v.messageId = bytes32(8); }, (v) => { v.nonce = "1"; },
    (v) => { v.order = "9"; }, (v) => { v.order = "13"; },
    (v) => { v.domain.name = "Other"; }, (v) => { v.domain.version = "2"; },
    (v) => { v.domain.chainId = "1"; }, (v) => { v.domain.salt = bytes32(8); },
    (v) => { v.domain.verifyingContract = otherContract; },
  ];
  for (const mutation of voteMutations) {
    tamper((pair) => {
      mutation(pair.fixture.votes[0]);
      pair.evidence.receipts[0] = { order: pair.fixture.votes[0].order,
        messageId: pair.fixture.votes[0].messageId, digest: digest(pair.fixture.votes[0]) };
    });
  }
  const manifestMutations = [
    (m) => { m.proposal.text += " changed"; }, (m) => { m.proposal.title = "Changed"; },
    (m) => { m.proposal.id = "OTHER"; }, (m) => { m.proposal.version = "2"; },
    (m) => { m.choices[0].label = "Changed"; }, (m) => { m.choices[0].id = "OTHER"; },
    (m) => { m.ballotId = "OTHER"; }, (m) => { m.schema = "other"; },
    (m) => { m.snapshot.height = "124"; }, (m) => { m.snapshot.chainId = "1"; },
    (m) => { m.snapshot.blockHash = bytes32(8); }, (m) => { m.domain.salt = bytes32(8); },
    (m) => { m.voters[0].kind = "EIP1271"; }, (m) => { m.approvedContracts.pop(); },
    (m) => { m.lockEvidenceHash = bytes32(8); }, (m) => { m.policy.selection = "last-valid"; },
    (m) => { m.policy.quorum.numerator = "0"; }, (m) => { m.policy.threshold.comparison = "gte"; },
    (m) => { m.policy.abstain.quorum = "exclude"; }, (m) => { m.policy.cutoff = "14"; },
  ];
  for (const mutation of manifestMutations) {
    tamper((pair) => {
      mutation(pair.fixture.manifest);
      pair.evidence.manifestHash = hashJSON(pair.fixture.manifest);
    });
  }
  tamper((pair) => { pair.fixture.profile = "live"; });
  tamper((pair) => { pair.evidence.profile = "live"; });
  tamper((pair) => { pair.fixture.votes[0].signature = `0x${"00".repeat(65)}`; });
  tamper((pair) => { pair.fixture.votes[0].signature = pair.fixture.votes[1].signature; });
  tamper((pair) => { pair.fixture.votes.push(clone(pair.fixture.votes[0])); });
  tamper((pair) => { pair.fixture.votes[1].messageId = pair.fixture.votes[0].messageId; });
  tamper((pair) => { pair.fixture.votes[1].order = pair.fixture.votes[0].order; });
  tamper((pair) => { pair.fixture.votes[1].nonce = "0"; }, { weights: ["1"], votes: [[0, "YES"], [0, "NO"]] });
  tamper((pair) => { pair.fixture.votes[1].nonce = "2"; }, { weights: ["1"], votes: [[0, "YES"], [0, "NO"]] });
  tamper((pair) => { pair.fixture.votes[1].signature = "0x00"; }, { weights: ["1"], votes: [[0, "YES"], [0, "NO"]] });
  tamper((pair) => { pair.evidence.cutoff.complete = false; });
  tamper((pair) => { delete pair.evidence.cutoff.complete; });
  tamper((pair) => { pair.evidence.cutoff.start = "9"; });
  tamper((pair) => { pair.evidence.cutoff.end = "14"; });
  tamper((pair) => { pair.evidence.cutoff.count = "4"; });
  tamper((pair) => { pair.evidence.cutoff.kind = "real-chain-proof"; });
  tamper((pair) => { pair.evidence.receipts.pop(); });
  tamper((pair) => { pair.evidence.receipts[1].order = "99"; });
  tamper((pair) => { pair.evidence.receipts[1].digest = pair.evidence.receipts[0].digest; });
  tamper((pair) => { pair.evidence.receipts[0].messageId = bytes32(8); });
  tamper((pair) => { pair.evidence.snapshot.blockHash = bytes32(8); });
  tamper((pair) => { pair.evidence.snapshot.height = "124"; });
  tamper((pair) => { pair.evidence.snapshot.chainId = "1"; });
  tamper((pair) => { pair.evidence.manifestHash = bytes32(8); });
  tamper((pair) => { pair.evidence.locks[0].weight = "1"; });
  tamper(() => {}, { locks: (locks) => { locks.push({ ...locks[0], contract: otherContract }); } });
  tamper(() => {}, { locks: (locks) => { locks[0].contract = wallets[3]; } });
  tamper(() => {}, { locks: (locks) => { locks[0].owner = wallets[3]; } });
  tamper(() => {}, { manifest: (m) => { m.voters.push(clone(m.voters[0])); } });
  tamper(() => {}, { manifest: (m) => { m.approvedContracts.push(m.approvedContracts[0]); } });
  tamper(() => {}, { manifest: (m) => { m.choices.push(clone(m.choices[0])); } });
  tamper(() => {}, { policy: (p) => { p.quorum.weight = "1"; } });
  tamper(() => {}, { policy: (p) => { p.selection = "latest"; } });
  tamper(() => {}, { policy: (p) => { p.order = "timestamp"; } });
  tamper(() => {}, { policy: (p) => { p.tie = "lexical"; } });
  tamper(() => {}, { policy: (p) => { p.delegation = "enabled"; } });
  tamper(() => {}, { policy: (p) => { p.abstain.choice = "UNKNOWN"; } });
  tamper(() => {}, { policy: (p) => { p.quorum.denominator = "0"; } });
  tamper(() => {}, { policy: (p) => { p.threshold.numerator = "3"; } });
  for (const field of ["selection", "order", "start", "cutoff", "delegation", "tie", "quorum", "threshold", "abstain"]) {
    tamper((pair) => { delete pair.fixture.manifest.policy[field]; });
  }

  test(() => {
    const pair = build({ smart: true });
    const result = accepted(pair);
    assert.equal(result.finalVotes.find((vote) => vote.wallet === wallets[0]).signatureEvidence,
      "synthetic-eip1271-attestation-only");
    pair.fixture.votes.reverse(); pair.evidence.receipts.reverse(); pair.evidence.contractAttestations.reverse();
    assert.deepEqual(accepted(pair), result);
  });
  test(() => {
    const pair = build({ smart: true });
    pair.fixture.votes[0].signature = "0x1234";
    pair.evidence.contractAttestations[0].signatureHash = ethers.keccak256("0x1234");
    assert.equal(accepted(pair).chainEvidenceVerified, false);
  });
  // This smart-account fixture has a recoverable dummy EOA signature: no fallback.
  tamper((pair) => { pair.evidence.contractAttestations = []; }, { smart: true });
  const attestationMutations = [
    (a) => { a.kind = "chain-verified"; }, (a) => { a.wallet = wallets[1]; },
    (a) => { a.chainId = "1"; }, (a) => { a.height = "124"; },
    (a) => { a.blockHash = bytes32(8); }, (a) => { a.digest = bytes32(8); },
    (a) => { a.signatureHash = bytes32(8); }, (a) => { a.magicValue = "0xffffffff"; },
  ];
  for (const mutation of attestationMutations) tamper((pair) => mutation(pair.evidence.contractAttestations[0]), { smart: true });
  tamper((pair) => { pair.evidence.contractAttestations.push(clone(pair.evidence.contractAttestations[0])); }, { smart: true });
  tamper((pair) => { pair.fixture.votes[0].signature = "0x1234"; }, { smart: true });
  tamper((pair) => { pair.evidence.contractAttestations[0].digest = digest(pair.fixture.votes[1]); }, { smart: true });

  for (const malformed of [1, 1n, "01", "-1", "+1", "1.0", "1e3", " 1", "1 ", "", "9".repeat(79)]) {
    tamper((pair) => { pair.evidence.locks[0].weight = malformed; });
    tamper((pair) => { pair.fixture.votes[0].nonce = malformed; });
  }
  tamper((pair) => { pair.evidence.locks[0].weight = "0"; });
  tamper((pair) => { pair.fixture.votes[0].snapshotHash = "0xAA".repeat(32); });
  tamper((pair) => { pair.fixture.manifest.proposal.text = "x".repeat(32769); });
  tamper((pair) => { pair.fixture.manifest.proposal.text = "non-ascii-\u00e9"; });
  tamper((pair) => { pair.fixture.votes[0].signature = `0x${"00".repeat(4097)}`; });
  tamper((pair) => { pair.fixture.votes = Array(257).fill(pair.fixture.votes[0]); });
  tamper((pair) => { pair.evidence.locks = Array(513).fill(pair.evidence.locks[0]); });
  tamper((pair) => { pair.fixture.manifest.policy.start = ((1n << 256n)).toString(); });
  tamper((pair) => { pair.fixture.extra = "unknown"; });
  tamper((pair) => { pair.fixture.votes[0].extra = "unknown"; });
  tamper((pair) => { pair.evidence.extra = "unknown"; });
  tamper((pair) => { delete pair.fixture.votes[0]; });
  tamper((pair) => { Object.setPrototypeOf(pair.fixture, { injected: true }); });
  tamper((pair) => { pair.fixture[Symbol("extra")] = true; });
  test(() => {
    const pair = build();
    let called = false;
    Object.defineProperty(pair.fixture, "profile", { enumerable: true, get() { called = true; throw new Error("NO"); } });
    rejected(pair);
    assert.equal(called, false);
  });
  test(() => { trust(verifyFixture()); assert.equal(verifyFixture().error, "FIXTURE_REJECTED"); });
  test(() => { const pair = build(); assert.equal(verifyFixture(pair.fixture).error, "FIXTURE_REJECTED"); });
  test(() => {
    const pair = build(); pair.fixture.extra = pair.fixture;
    rejected(pair);
  });
  test(() => {
    const pair = build(); pair.fixture.extra = new Date();
    rejected(pair);
  });
  test(() => {
    const pair = build(); pair.fixture.votes[0].choice = "UNKNOWN";
    const expected = verify(pair);
    pair.fixture.votes.reverse(); pair.evidence.receipts.reverse();
    assert.deepEqual(verify(pair), expected);
  });
  return failures === 0;
}

let passed = false;
try { passed = run(); } catch { /* Never print fixture data, keys or exceptions. */ }
process.stdout.write(passed
  ? "FORUM_FIXTURE_TESTS_PASS synthetic-only ADVISORY productionReady=false chainEvidenceVerified=false\n"
  : "FORUM_FIXTURE_TESTS_FAIL TEST_ASSERTION_FAILED synthetic-only ADVISORY productionReady=false chainEvidenceVerified=false\n");
process.exitCode = passed ? 0 : 1;
