const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Wallet, keccak256, toUtf8Bytes } = require('ethers');
const {
  canonicalJson, manifestHash, validateManifest, loadBallot, voteTypedData, verifyVote,
} = require('../src/forum/ballot');

// Public Hardhat test key. Never connected to a provider or used on a network.
const wallet = new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const exampleDir = path.resolve(__dirname, 'fixtures/forum-ballots');
const ballotId = 'FB-TEST-0001';
const example = JSON.parse(fs.readFileSync(path.join(exampleDir, `${ballotId}.json`), 'utf8'));
const clone = () => JSON.parse(JSON.stringify(example));

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ifr-forum-ballot-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manifest = clone();
  manifest.window = { opensAt: 1000, closesAt: 10000 };
  fs.writeFileSync(path.join(dir, `${ballotId}.json`), JSON.stringify(manifest));
  fs.copyFileSync(path.join(exampleDir, `${ballotId}.md`), path.join(dir, `${ballotId}.md`));
  return { dir, ballot: loadBallot(dir, ballotId) };
}

// Independent signing contract: verification must agree with the published spec,
// including the exact primary type, field order and absence of verifyingContract.
function signingData(ballot, choice = 'yes', issuedAt = 2000) {
  const m = ballot.manifest;
  return {
    domain: { name: 'IFR Forum', version: '1', chainId: m.chainId },
    types: { IFRForumVote: [
      { name: 'manifestHash', type: 'bytes32' },
      { name: 'ballotId', type: 'string' },
      { name: 'proposalHash', type: 'bytes32' },
      { name: 'snapshotHeight', type: 'uint256' },
      { name: 'choice', type: 'string' },
      { name: 'issuedAt', type: 'uint256' },
    ] },
    value: {
      manifestHash: ballot.manifestHash, ballotId: m.ballotId,
      proposalHash: m.proposal.textHash, snapshotHeight: m.snapshot.height,
      choice, issuedAt,
    },
  };
}

async function signedVote(ballot, choice = 'yes', issuedAt = 2000) {
  const { domain, types, value } = signingData(ballot, choice, issuedAt);
  return { ballot, wallet: wallet.address, choice, issuedAt,
    signature: await wallet.signTypedData(domain, types, value), now: 2000 };
}

test('example ballot loads on Sepolia and hashes the exact Markdown bytes', () => {
  const ballot = loadBallot(exampleDir, ballotId);
  assert.equal(ballot.manifest.chainId, 11155111);
  assert.equal(ballot.manifest.proposal.textHash,
    keccak256(fs.readFileSync(path.join(exampleDir, `${ballotId}.md`))));
  assert.equal(ballot.proposalText, fs.readFileSync(path.join(exampleDir, `${ballotId}.md`), 'utf8'));
  assert.equal(ballot.manifestHash, manifestHash(ballot.manifest));
});

const invalid = [
  ['schema', 'forum-ballot-v2'], ['schema', 1], ['ballotId', 'FB-'],
  ['ballotId', 'fb-test'], ['ballotId', `FB-${'A'.repeat(33)}`],
  ['ballotId', 'FB-A/B'], ['ballotId', 'FB-A\n'], ['ballotId', 'FB-A\r'],
  ['ballotId', 123], ['chainId', '11155111'],
  ['chainId', 0], ['chainId', -1], ['chainId', 1.5], ['chainId', Number.MAX_SAFE_INTEGER + 1],
  ['proposal', null], ['proposal', []], ['proposal.title', ' '], ['proposal.title', 12],
  ['proposal.textFile', '../FB-TEST-0001.md'], ['proposal.textFile', 'other.md'],
  ['proposal.textFile', 1], ['proposal.textHash', '0x1234'], ['proposal.textHash', 1],
  ['proposal.textHash', `0x${'gg'.repeat(32)}`], ['proposal.textHash', `0x${'00'.repeat(32)}\n`],
  ['choices', ['yes', 'no']], ['choices', ['no', 'yes', 'abstain']],
  ['choices', ['yes', 'no', 'yes']], ['choices', ['yes', 'no', 'abstain', 'other']],
  ['choices', 'yes/no/abstain'], ['snapshot', null], ['snapshot.height', '0'],
  ['snapshot.height', -1], ['snapshot.height', 0.5],
  ['snapshot.height', Number.MAX_SAFE_INTEGER + 1], ['snapshot.blockHash', '0x00'],
  ['snapshot.blockHash', null], ['snapshot.blockHash', `0x${'00'.repeat(32)}\n`],
  ['weightSource.contract', 'not-an-address'],
  ['weightSource.contract', 1], ['weightSource.method', 'balanceOf(address)'],
  ['window.opensAt', '0'], ['window.opensAt', -1], ['window.opensAt', 0.1],
  ['window.closesAt', 0], ['window.closesAt', example.window.opensAt],
  ['window.closesAt', Number.MAX_SAFE_INTEGER + 1], ['policy', null], ['policy', []],
  ['policy.selection', 'first-valid'], ['policy.quorum.numerator', 11],
  ['policy.quorum.denominator', 10], ['policy.quorum.basis', 'circulating-supply'],
  ['policy.quorum.comparison', 'gt'], ['policy.threshold.numerator', 51],
  ['policy.threshold.denominator', '100'], ['policy.threshold.basis', 'all-votes'],
  ['policy.threshold.comparison', 'gte'], ['policy.abstain.quorum', 'exclude'],
  ['policy.abstain.threshold', 'include'], ['policy.delegation', 'enabled'],
];

for (const [field, value] of invalid) {
  test(`manifest rejects ${field} = ${JSON.stringify(value)}`, () => {
    const manifest = clone();
    const keys = field.split('.');
    const parent = keys.slice(0, -1).reduce((obj, key) => obj[key], manifest);
    parent[keys.at(-1)] = value;
    assert.throws(() => validateManifest(manifest), /Invalid ballot/);
  });
}

for (const field of ['', 'proposal', 'snapshot', 'weightSource', 'window', 'policy',
  'policy.quorum', 'policy.threshold', 'policy.abstain']) {
  for (const change of ['extra', 'missing']) {
    test(`manifest rejects ${change} keys in ${field || 'root'}`, () => {
      const manifest = clone();
      const target = field ? field.split('.').reduce((obj, key) => obj[key], manifest) : manifest;
      if (change === 'extra') target.unexpected = true;
      else delete target[Object.keys(target)[0]];
      assert.throws(() => validateManifest(manifest), /Invalid ballot/);
    });
  }
}

test('manifest root types, safe integer boundaries and ballot ID boundaries', () => {
  for (const value of [null, [], 'manifest', 123]) assert.throws(() => validateManifest(value));
  const manifest = clone();
  manifest.ballotId = `FB-${'A'.repeat(32)}`;
  manifest.proposal.textFile = `${manifest.ballotId}.md`;
  manifest.snapshot.height = Number.MAX_SAFE_INTEGER;
  manifest.window = { opensAt: 0, closesAt: Number.MAX_SAFE_INTEGER };
  assert.equal(validateManifest(manifest), manifest);
});

test('canonical JSON recursively sorts keys, preserves arrays and has no whitespace', (t) => {
  const { ballot, dir } = fixture(t);
  assert.equal(canonicalJson({ z: [{ z: 'a b', a: 2 }], a: { z: 3, a: 1 } }),
    '{"a":{"a":1,"z":3},"z":[{"a":2,"z":"a b"}]}');
  function reverse(value) {
    if (Array.isArray(value)) return value.map(reverse);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reverse(value[key])]));
    }
    return value;
  }
  const reordered = reverse(ballot.manifest);
  fs.writeFileSync(path.join(dir, `${ballotId}.json`), JSON.stringify(reordered, null, 4));
  assert.equal(loadBallot(dir, ballotId).manifestHash, ballot.manifestHash);
  assert.equal(ballot.manifestHash, keccak256(toUtf8Bytes(canonicalJson(reordered))));
  reordered.proposal.title += '!';
  assert.notEqual(manifestHash(reordered), ballot.manifestHash);
});

test('loader rejects text changes including newline changes', (t) => {
  const { dir } = fixture(t);
  const file = path.join(dir, `${ballotId}.md`);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('\n', '\r\n'));
  assert.throws(() => loadBallot(dir, ballotId), /text hash mismatch/);
});

test('loader preserves Unicode and BOM bytes and rejects invalid UTF-8', (t) => {
  const { dir, ballot } = fixture(t);
  const text = '\uFEFF# Proposal — Δ\n';
  fs.writeFileSync(path.join(dir, `${ballotId}.md`), text);
  ballot.manifest.proposal.textHash = keccak256(Buffer.from(text));
  fs.writeFileSync(path.join(dir, `${ballotId}.json`), JSON.stringify(ballot.manifest));
  assert.equal(loadBallot(dir, ballotId).proposalText, text);
  const bytes = Buffer.from([0xff]);
  fs.writeFileSync(path.join(dir, `${ballotId}.md`), bytes);
  ballot.manifest.proposal.textHash = keccak256(bytes);
  fs.writeFileSync(path.join(dir, `${ballotId}.json`), JSON.stringify(ballot.manifest));
  assert.throws(() => loadBallot(dir, ballotId), /UTF-8/);
});

test('loader rejects path traversal, mismatched IDs, invalid JSON and missing files', (t) => {
  const { dir, ballot } = fixture(t);
  for (const id of ['../FB-TEST-0001', 'FB-../secret', 'FB-A\n', 'FB-A\r', '', null]) {
    assert.throws(() => loadBallot(dir, id), /Invalid ballot id/);
  }
  const file = path.join(dir, `${ballotId}.json`);
  ballot.manifest.ballotId = 'FB-OTHER';
  ballot.manifest.proposal.textFile = 'FB-OTHER.md';
  fs.writeFileSync(file, JSON.stringify(ballot.manifest));
  assert.throws(() => loadBallot(dir, ballotId), /id mismatch/);
  fs.writeFileSync(file, '{');
  assert.throws(() => loadBallot(dir, ballotId), SyntaxError);
  fs.unlinkSync(file);
  assert.throws(() => loadBallot(dir, ballotId), { code: 'ENOENT' });
});

test('typed data matches the specified domain and primary type exactly', (t) => {
  const { ballot } = fixture(t);
  assert.deepEqual(voteTypedData(ballot, 'yes', 2000), signingData(ballot));
});

for (const choice of ['yes', 'no', 'abstain']) {
  test(`valid ${choice} vote and case-insensitive wallet forms`, async (t) => {
    const { ballot } = fixture(t);
    const vote = await signedVote(ballot, choice);
    for (const address of [wallet.address, wallet.address.toLowerCase(), `0x${wallet.address.slice(2).toUpperCase()}`]) {
      assert.deepEqual(verifyVote({ ...vote, wallet: address }), { ok: true, reason: null });
    }
  });
}

const rejections = [
  [{ choice: 'YES' }, 'Unknown choice'], [{ choice: null }, 'Unknown choice'],
  [{ now: 999 }, 'Ballot not open'], [{ now: 10000 }, 'Ballot not open'],
  [{ now: 10001 }, 'Ballot not open'], [{ now: NaN }, 'Invalid clock'],
  [{ now: 2000.5 }, 'Invalid clock'], [{ issuedAt: '2000' }, 'Invalid issuedAt'],
  [{ issuedAt: -1 }, 'Invalid issuedAt'], [{ issuedAt: 2000.5 }, 'Invalid issuedAt'],
  [{ issuedAt: Number.MAX_SAFE_INTEGER + 1 }, 'Invalid issuedAt'],
  [{ issuedAt: 999 }, 'issuedAt outside window'], [{ issuedAt: 10000 }, 'issuedAt outside window'],
  [{ issuedAt: 2301 }, 'issuedAt too far in future'], [{ wallet: '0x1234' }, 'Invalid wallet'],
  [{ wallet: null }, 'Invalid wallet'], [{ wallet: 123 }, 'Invalid wallet'],
  [{ wallet: wallet.address.replace('F', 'f') }, 'Invalid wallet'],
  [{ wallet: '0x0000000000000000000000000000000000000001' }, 'Signer mismatch'],
  [{ signature: null }, 'Invalid signature'], [{ signature: {} }, 'Invalid signature'],
  [{ signature: '0x123' }, 'Invalid signature'], [{ signature: `0x${'gg'.repeat(65)}` }, 'Invalid signature'],
  [{ signature: `0x${'00'.repeat(65)}` }, 'Invalid signature'],
];
for (const [changes, reason] of rejections) {
  test(`vote rejects ${JSON.stringify(changes)}: ${reason}`, async (t) => {
    const { ballot } = fixture(t);
    assert.deepEqual(verifyVote({ ...await signedVote(ballot), ...changes }), { ok: false, reason });
  });
}

test('opening instant, last open second and exactly 300 seconds of skew are accepted', async (t) => {
  const { ballot } = fixture(t);
  for (const [now, issuedAt] of [[1000, 1000], [9999, 9999], [2000, 2300]]) {
    assert.deepEqual(verifyVote({ ...await signedVote(ballot, 'yes', issuedAt), now }), { ok: true, reason: null });
  }
});

for (const field of ['manifestHash', 'ballotId', 'proposalHash', 'snapshotHeight', 'choice', 'issuedAt']) {
  test(`signature binds the exact ${field}`, async (t) => {
    const { ballot } = fixture(t);
    const data = signingData(ballot);
    const replacements = {
      manifestHash: `0x${'11'.repeat(32)}`, ballotId: 'FB-OTHER',
      proposalHash: `0x${'22'.repeat(32)}`, snapshotHeight: 1, choice: 'no', issuedAt: 2001,
    };
    data.value[field] = replacements[field];
    const signature = await wallet.signTypedData(data.domain, data.types, data.value);
    assert.deepEqual(verifyVote({ ballot, wallet: wallet.address, choice: 'yes', issuedAt: 2000, signature, now: 2000 }),
      { ok: false, reason: 'Signer mismatch' });
  });
}

test('signature cannot be replayed on another chain or domain', async (t) => {
  const { ballot } = fixture(t);
  for (const change of [{ chainId: 1 }, { name: 'Other Forum' }, { version: '2' }]) {
    const data = signingData(ballot);
    const signature = await wallet.signTypedData({ ...data.domain, ...change }, data.types, data.value);
    assert.deepEqual(verifyVote({ ballot, wallet: wallet.address, choice: 'yes', issuedAt: 2000, signature, now: 2000 }),
      { ok: false, reason: 'Signer mismatch' });
  }
});
