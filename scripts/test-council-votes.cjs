#!/usr/bin/env node
// Regression tests for scripts/verify-council-votes.cjs: votes and abstentions are bound to the exact
// published text of their own ballot; unrelated, reused or missing signatures are never counted.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Wallet, hashMessage } = require("ethers");
const { verify } = require("./verify-council-votes.cjs");

const real = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "data", "council-votes.json"), "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));
let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

// Throwaway in-process test wallets; no real key is used.
const wallets = Array.from({ length: 3 }, () => Wallet.createRandom());
const initials = ["T.A.", "T.B.", "T.C."];
const ballotTexts = (id) => ({
  options: { YES: `IFR Council vote ${id}\nVote: YES\nI approve ${id}.`, NO: `IFR Council vote ${id}\nVote: NO\nI reject ${id}.` },
  abstainText: `IFR Council vote ${id}\nVote: ABSTAIN\nI abstain on ${id}.`
});
function fixture() {
  const ballot = (id) => ({ id, title: id, question: id, openedAt: "2026-10-05", rule: "3 YES", passThreshold: 3, eligible: initials, ...ballotTexts(id) });
  return {
    eligibleSigners: wallets.map((w, i) => ({ initials: initials[i], address: w.address })),
    ballots: [ballot("T-A"), ballot("T-B")],
    votes: []
  };
}
async function signedVote(data, ballotId, i, choice, textOverride) {
  const ballot = data.ballots.find((b) => b.id === ballotId);
  const text = textOverride ?? (choice === "ABSTAIN" ? ballot.abstainText : ballot.options[choice]);
  return {
    ballot: ballotId,
    signer: initials[i],
    address: wallets[i].address,
    choice,
    etherscan: `https://etherscan.io/verifySig/${100 + i}`,
    messageHash: hashMessage(text),
    signature: await wallets[i].signMessage(text)
  };
}

(async () => {
  await test("published record verifies; CV-01 abstention without a ballot-bound signature is unverified and not counted", () => {
    const { tallies, votes } = verify(real);
    const cv01gm = votes.find((v) => v.ballot === "CV-01" && v.signer === "G.M.");
    assert.equal(cv01gm.status, "unverified");
    assert.equal(tallies["CV-01"].abstain, 0);
    assert.equal(tallies["CV-01"].unverified, 1);
    assert.equal(tallies["CV-01"].status, "open");
    assert.equal(tallies["EX-01"].status, "approved: YES");
    assert.equal(tallies["EX-02"].abstain, 3);
    assert.equal(tallies["EX-02"].status, "open");
    assert.ok(votes.filter((v) => v.ballot === "EX-02").every((v) => v.status === "verified"));
  });

  const data = fixture();
  const abstainA = await signedVote(data, "T-A", 0, "ABSTAIN");

  await test("abstention signed for ballot A verifies and counts on ballot A", () => {
    const d = clone(data);
    d.votes = [abstainA];
    const { tallies } = verify(d);
    assert.equal(tallies["T-A"].abstain, 1);
    assert.equal(tallies["T-A"].unverified, 0);
  });

  await test("abstention signed for ballot A cannot be reused for ballot B", () => {
    const d = clone(data);
    d.votes = [{ ...abstainA, ballot: "T-B" }];
    assert.throws(() => verify(d), /T-B\/T\.A\.: signed message is not the published T-B ABSTAIN text/);
  });

  await test("real EX-02 abstention signature cannot be reused for CV-01", () => {
    const d = clone(real);
    const ex02 = d.votes.find((v) => v.ballot === "EX-02" && v.signer === "G.M.");
    d.votes = d.votes.filter((v) => !(v.ballot === "CV-01" && v.signer === "G.M."));
    d.votes.push({ ...ex02, ballot: "CV-01" });
    assert.throws(() => verify(d), /CV-01\/G\.M\.: signed ABSTAIN has no published ballot-bound text on CV-01/);
  });

  await test("valid signer signature over an unrelated message is rejected", async () => {
    const d = clone(data);
    d.votes = [await signedVote(d, "T-A", 1, "ABSTAIN", "unrelated message")];
    assert.throws(() => verify(d), /signed message is not the published T-A ABSTAIN text/);
  });

  await test("signature by a different wallet over the exact text is rejected", async () => {
    const d = clone(data);
    const vote = await signedVote(d, "T-A", 1, "YES");
    d.votes = [{ ...vote, signer: initials[2], address: wallets[2].address }];
    assert.throws(() => verify(d), /does not recover to the signer/);
  });

  await test("missing signature: shown as unverified, not counted", () => {
    const d = clone(data);
    d.votes = [{ ballot: "T-A", signer: initials[1], address: wallets[1].address, choice: "ABSTAIN" }];
    const { tallies, votes } = verify(d);
    assert.equal(votes[0].status, "unverified");
    assert.equal(tallies["T-A"].abstain, 0);
    assert.equal(tallies["T-A"].unverified, 1);
  });

  await test("missing signature on a YES vote does not count toward approval", async () => {
    const d = clone(data);
    d.votes = [await signedVote(d, "T-A", 0, "YES"), await signedVote(d, "T-A", 1, "YES"),
      { ballot: "T-A", signer: initials[2], address: wallets[2].address, choice: "YES" }];
    const { tallies } = verify(d);
    assert.equal(tallies["T-A"].counts.YES, 2);
    assert.equal(tallies["T-A"].status, "open");
  });

  await test("unverified record may not carry a hash or proof link", () => {
    const d = clone(data);
    d.votes = [{ ballot: "T-A", signer: initials[1], address: wallets[1].address, choice: "ABSTAIN", messageHash: hashMessage("x") }];
    assert.throws(() => verify(d), /unverified record must not carry a message hash/);
  });

  await test("ballot texts must name their ballot and must not be shared between ballots", () => {
    const d = clone(data);
    d.ballots[1].abstainText = d.ballots[0].abstainText;
    assert.throws(() => verify(d), /first line must name the ballot id/);
    const e = clone(data);
    e.ballots[1] = clone(e.ballots[0]);
    assert.throws(() => verify(e), /text is shared with T-A/);
  });

  console.log(`[council-votes-test] PASS - ${passed} tests`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
