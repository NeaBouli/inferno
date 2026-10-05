#!/usr/bin/env node
// Verifies docs/data/council-votes.json. Every counted vote (including every counted abstention)
// must carry a signature over the exact published text of its choice on its own ballot: the text is
// looked up from the ballot (options[choice], or abstainText for ABSTAIN), its EIP-191 hash must equal
// the recorded messageHash, and ethers.verifyMessage(text, signature) must return the listed address.
// Every ballot text names its own ballot id and no text is shared between ballots, so a signature for
// ballot A can never verify for ballot B. A vote record without a signature over a published
// ballot-bound text is "unverified": it is shown as such and never counted. Signer addresses are the
// ones listed in this record; this checker does not verify Safe ownership on-chain.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { hashMessage, verifyMessage, getAddress } = require("ethers");

const root = path.join(__dirname, "..");
const dataPath = path.join(root, "docs", "data", "council-votes.json");

const ABSTAIN = "ABSTAIN";

function ballotText(ballot, choice) {
  if (choice === ABSTAIN) return ballot.abstainText;
  return Object.prototype.hasOwnProperty.call(ballot.options, choice) ? ballot.options[choice] : undefined;
}

function checkBallotTexts(ballots) {
  const owner = new Map();
  for (const ballot of ballots) {
    assert.ok(!Object.prototype.hasOwnProperty.call(ballot.options, ABSTAIN), `${ballot.id}: ABSTAIN belongs in abstainText, not options`);
    const texts = Object.entries(ballot.options);
    if (ballot.abstainText !== undefined) texts.push([ABSTAIN, ballot.abstainText]);
    for (const [choice, text] of texts) {
      assert.equal(typeof text, "string", `${ballot.id}/${choice}: ballot text must be a string`);
      assert.ok(text.split("\n")[0].endsWith(` ${ballot.id}`), `${ballot.id}/${choice}: first line must name the ballot id`);
      assert.ok(text.includes(`\nVote: ${choice}\n`), `${ballot.id}/${choice}: text must state "Vote: ${choice}"`);
      const hash = hashMessage(text);
      assert.ok(!owner.has(hash), `${ballot.id}/${choice}: text is shared with ${owner.get(hash)}`);
      owner.set(hash, `${ballot.id}/${choice}`);
    }
  }
}

// Returns "verified" or "unverified"; throws on any inconsistent or forged record.
function checkVote(ballot, vote, address, key) {
  const text = ballotText(ballot, vote.choice);
  if (vote.choice !== ABSTAIN) assert.ok(text !== undefined, `${key}: choice ${vote.choice} is not a ballot option`);
  if (vote.signature === undefined) {
    assert.equal(vote.messageHash, undefined, `${key}: unverified record must not carry a message hash`);
    assert.equal(vote.etherscan, undefined, `${key}: unverified record must not carry a proof link`);
    return "unverified";
  }
  assert.ok(text !== undefined, `${key}: signed ${vote.choice} has no published ballot-bound text on ${ballot.id}`);
  assert.equal(vote.messageHash, hashMessage(text), `${key}: signed message is not the published ${ballot.id} ${vote.choice} text`);
  assert.equal(getAddress(verifyMessage(text, vote.signature)), address, `${key}: signature over the ${ballot.id} ${vote.choice} text does not recover to the signer`);
  assert.match(vote.etherscan ?? "", /^https:\/\/etherscan\.io\/verifySig\/\d+$/, `${key}: Etherscan verifySig link`);
  return "verified";
}

function tally(ballot, votes) {
  const counts = Object.fromEntries(Object.keys(ballot.options).map((option) => [option, 0]));
  let abstain = 0;
  let unverified = 0;
  for (const vote of votes) {
    if (vote.status !== "verified") unverified += 1;
    else if (vote.choice === ABSTAIN) abstain += 1;
    else counts[vote.choice] += 1;
  }
  const passed = Object.entries(counts).find(([option, n]) => n >= ballot.passThreshold && option !== "NO");
  const rejected = counts.NO !== undefined && counts.NO > ballot.eligible.length - ballot.passThreshold;
  return { counts, abstain, unverified, status: passed ? `approved: ${passed[0]}` : rejected ? "rejected" : "open" };
}

// Returns { tallies, votes } where each vote carries status "verified" | "unverified".
function verify(data) {
  const signers = new Map(data.eligibleSigners.map((s) => [s.initials, getAddress(s.address)]));
  assert.ok(signers.size >= 3, "listed signer set required");
  checkBallotTexts(data.ballots);
  const ballots = new Map(data.ballots.map((b) => [b.id, b]));
  const seen = new Set();
  const votes = [];
  for (const vote of data.votes) {
    const ballot = ballots.get(vote.ballot);
    assert.ok(ballot, `${vote.ballot}: unknown ballot`);
    const key = `${vote.ballot}/${vote.signer}`;
    assert.ok(ballot.eligible.includes(vote.signer), `${key}: signer not listed for this ballot`);
    const address = signers.get(vote.signer);
    assert.equal(getAddress(vote.address), address, `${key}: address mismatch`);
    assert.ok(!seen.has(key), `${key}: more than one vote`);
    seen.add(key);
    votes.push({ ...vote, status: checkVote(ballot, vote, address, key) });
  }
  const tallies = {};
  for (const ballot of data.ballots) tallies[ballot.id] = tally(ballot, votes.filter((v) => v.ballot === ballot.id));
  return { tallies, votes };
}

module.exports = { verify, tally, ballotText };

if (require.main === module) {
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const { tallies, votes } = verify(data);
  for (const [id, t] of Object.entries(tallies)) {
    const counts = Object.entries(t.counts).map(([o, n]) => `${o} ${n}`).join(", ");
    console.log(`[council-votes] ${id}: ${counts}, abstain ${t.abstain}, unverified (not counted) ${t.unverified} -> ${t.status}`);
  }
  const verified = votes.filter((v) => v.status === "verified").length;
  console.log(`[council-votes] PASS - ${verified} signatures verified against their exact ballot texts; ${votes.length - verified} unverified record(s) not counted`);
}
