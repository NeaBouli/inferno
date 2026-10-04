#!/usr/bin/env node
// Verifies docs/data/council-votes.json: every vote signature recovers to its eligible Safe signer,
// every non-abstention vote signs exactly the published ballot text of its choice, abstentions are
// hash-only, one vote per signer per ballot, and the tallies derived here are the published status.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { hashMessage, recoverAddress, getAddress } = require("ethers");

const root = path.join(__dirname, "..");
const data = JSON.parse(fs.readFileSync(path.join(root, "docs", "data", "council-votes.json"), "utf8"));

function tally(ballot, votes) {
  const counts = Object.fromEntries(Object.keys(ballot.options).map((option) => [option, 0]));
  let abstain = 0;
  for (const vote of votes) {
    if (vote.abstention) abstain += 1;
    else counts[vote.choice] += 1;
  }
  const passed = Object.entries(counts).find(([option, n]) => n >= ballot.passThreshold && option !== "NO");
  const rejected = counts.NO !== undefined && counts.NO > ballot.eligible.length - ballot.passThreshold;
  return { counts, abstain, status: passed ? `approved: ${passed[0]}` : rejected ? "rejected" : "open" };
}

function verify(data) {
  const signers = new Map(data.eligibleSigners.map((s) => [s.initials, getAddress(s.address)]));
  assert.ok(signers.size >= 3, "eligible signer snapshot required");
  const ballots = new Map(data.ballots.map((b) => [b.id, b]));
  const seen = new Set();
  for (const vote of data.votes) {
    const ballot = ballots.get(vote.ballot);
    assert.ok(ballot, `${vote.ballot}: unknown ballot`);
    assert.ok(ballot.eligible.includes(vote.signer), `${vote.ballot}: ${vote.signer} not eligible`);
    assert.equal(getAddress(vote.address), signers.get(vote.signer), `${vote.ballot}: ${vote.signer} address mismatch`);
    const key = `${vote.ballot}/${vote.signer}`;
    assert.ok(!seen.has(key), `${key}: more than one vote`);
    seen.add(key);
    if (vote.linkWithheld) assert.equal(vote.etherscan, undefined, `${key}: withheld link must be absent`);
    else assert.match(vote.etherscan, /^https:\/\/etherscan\.io\/verifySig\/\d+$/, `${key}: Etherscan link`);
    assert.equal(getAddress(recoverAddress(vote.messageHash, vote.signature)), signers.get(vote.signer), `${key}: signature does not recover to the signer`);
    if (vote.abstention) {
      assert.equal(vote.choice, "ABSTAIN", `${key}: abstention must be ABSTAIN`);
      assert.equal(vote.message, undefined, `${key}: abstention text is not republished`);
    } else {
      const text = ballot.options[vote.choice];
      assert.ok(text, `${key}: choice ${vote.choice} is not a ballot option`);
      assert.equal(hashMessage(text), vote.messageHash, `${key}: signed text differs from the published ${vote.choice} text`);
    }
  }
  const result = {};
  for (const ballot of data.ballots) result[ballot.id] = tally(ballot, data.votes.filter((v) => v.ballot === ballot.id));
  return result;
}

module.exports = { verify, tally };

if (require.main === module) {
  const result = verify(data);
  for (const [id, t] of Object.entries(result)) {
    const counts = Object.entries(t.counts).map(([o, n]) => `${o} ${n}`).join(", ");
    console.log(`[council-votes] ${id}: ${counts}, abstain ${t.abstain} -> ${t.status}`);
  }
  console.log(`[council-votes] PASS - ${data.votes.length} signatures verified against ${data.eligibleSigners.length} eligible signers`);
}
