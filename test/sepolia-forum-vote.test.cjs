const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { ethers } = require("ethers");
const { castVotes } = require("../scripts/sepolia-forum-vote");
const { loadBallot, verifyVote } = require("../apps/telegram/telegram-bot/src/forum/ballot");

const fixtures = path.join(__dirname, "../apps/telegram/telegram-bot/test/fixtures/forum-ballots");
const ballot = loadBallot(fixtures, "FB-TEST-0001");
const now = ballot.manifest.window.opensAt + 60;
const keys = { voters: [1, 2, 3].map(() => {
  const w = ethers.Wallet.createRandom();
  return { address: w.address, privateKey: w.privateKey };
}) };

function server({ manifest = ballot.manifest, hash = ballot.manifestHash } = {}) {
  const received = [];
  async function fetchImpl(url, options = {}) {
    if (!options.method) {
      return { ok: true, status: 200, json: async () => ({ manifest, manifestHash: hash, proposalText: ballot.proposalText }) };
    }
    const body = JSON.parse(options.body);
    const result = verifyVote({ ballot, ...body, now });
    received.push(body);
    return result.ok
      ? { ok: true, status: 201, json: async () => ({ receiptOrder: received.length }) }
      : { ok: false, status: 400, json: async () => ({ error: result.reason }) };
  }
  return { fetchImpl, received };
}

test("signs one valid vote per throwaway voter and posts it", async () => {
  const s = server();
  const results = await castVotes({ ballotId: "FB-TEST-0001", choices: ["yes", "no", "abstain"], keys,
    fetchImpl: s.fetchImpl, now: () => now, log: () => {} });
  assert.deepEqual(results.map((r) => r.receiptOrder), [1, 2, 3]);
  assert.deepEqual(s.received.map((v) => v.wallet), keys.voters.map((v) => v.address));
  assert.deepEqual(s.received.map((v) => v.choice), ["yes", "no", "abstain"]);
});

test("refuses a server-asserted manifest hash that does not match", async () => {
  const s = server({ hash: `0x${"11".repeat(32)}` });
  await assert.rejects(castVotes({ ballotId: "FB-TEST-0001", choices: ["yes", "no", "abstain"], keys,
    fetchImpl: s.fetchImpl, now: () => now, log: () => {} }), /manifestHash does not match/);
  assert.equal(s.received.length, 0);
});

test("refuses any non-Sepolia ballot before signing", async () => {
  const s = server({ manifest: { ...ballot.manifest, chainId: 1 } });
  await assert.rejects(castVotes({ ballotId: "FB-TEST-0001", choices: ["yes", "no", "abstain"], keys,
    fetchImpl: s.fetchImpl, now: () => now, log: () => {} }), /Sepolia only/);
  assert.equal(s.received.length, 0);
});

test("refuses an unknown choice locally without posting", async () => {
  const s = server();
  await assert.rejects(castVotes({ ballotId: "FB-TEST-0001", choices: ["maybe", "no", "abstain"], keys,
    fetchImpl: s.fetchImpl, now: () => now, log: () => {} }), /Unknown choice/);
  assert.equal(s.received.length, 0);
});
