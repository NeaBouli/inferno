const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Interface, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } = require('ethers');
const { loadBallot, manifestHash, voteTypedData } = require('../src/forum/ballot');
const { tallyBallot } = require('../src/forum/tally');
const { main } = require('../scripts/forum-tally');

// Public Hardhat test keys only; none of these wallets has a provider.
const wallets = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
].map((key) => new Wallet(key));
const ballotsDir = path.resolve(__dirname, 'fixtures/forum-ballots');
const ballot = loadBallot(ballotsDir, 'FB-TEST-0001');
const now = ballot.manifest.window.opensAt + 1000;
const clock = () => now;

async function receipt(index, choice, receiptOrder, options = {}) {
  const activeBallot = options.ballot ?? ballot;
  const issuedAt = options.issuedAt ?? now;
  const data = voteTypedData(activeBallot, choice, issuedAt);
  return {
    receiptOrder, receivedAt: (options.clock ?? clock)(),
    wallet: wallets[index].address, choice, issuedAt,
    signature: await wallets[index].signTypedData(data.domain, data.types, data.value),
  };
}

function fakeReader({ balances = [100n, 0n, 0n], total = 1000n,
  chain = BigInt(ballot.manifest.chainId), hash = ballot.manifest.snapshot.blockHash } = {}) {
  const calls = [];
  const weights = new Map(wallets.map((wallet, index) => [wallet.address.toLowerCase(), balances[index] ?? 0n]));
  return {
    calls,
    async chainId() { calls.push('chainId'); return chain; },
    async blockHash(height) {
      calls.push('blockHash');
      assert.equal(height, ballot.manifest.snapshot.height);
      return hash;
    },
    async lockedBalance(contract, wallet, height) {
      calls.push(`lockedBalance:${wallet.toLowerCase()}`);
      assert.equal(contract, ballot.manifest.weightSource.contract);
      assert.equal(height, ballot.manifest.snapshot.height);
      return weights.get(wallet.toLowerCase());
    },
    async totalLocked(contract, height) {
      calls.push('totalLocked');
      assert.equal(contract, ballot.manifest.weightSource.contract);
      assert.equal(height, ballot.manifest.snapshot.height);
      return total;
    },
  };
}

test('tally exports exact input hashes and lossless decimal totals above Number precision', async () => {
  const votes = [await receipt(0, 'yes', 1), await receipt(1, 'no', 2), await receipt(2, 'abstain', 3)];
  const large = 2n ** 100n + 1n;
  const result = await tallyBallot({ ballot, votes,
    reader: fakeReader({ balances: [large, 3n, 4n], total: large * 2n }) });
  assert.deepEqual(result.totals, {
    yes: large.toString(), no: '3', abstain: '4',
    participating: (large + 7n).toString(), totalLocked: (large * 2n).toString(),
  });
  assert.equal(result.schema, 'forum-tally-v1');
  assert.equal(result.ballotId, ballot.manifest.ballotId);
  assert.equal(result.chainId, ballot.manifest.chainId);
  assert.deepEqual(result.snapshot, ballot.manifest.snapshot);
  assert.equal(result.manifestHash, ballot.manifestHash);
  assert.equal(result.proposalHash, ballot.manifest.proposal.textHash);
  // Independent canonical field order for the published receipt format.
  const canonical = JSON.stringify(votes.map((vote) => ({
    choice: vote.choice, issuedAt: vote.issuedAt, receiptOrder: vote.receiptOrder,
    receivedAt: vote.receivedAt, signature: vote.signature, wallet: vote.wallet,
  })));
  assert.equal(result.voteSetHash, keccak256(toUtf8Bytes(canonical)));
  assert.equal(result.advisory, true);
  assert.equal(result.outcome, 'passed');
  assert.deepEqual(result.quorum, { ...ballot.manifest.policy.quorum, passed: true });
  assert.deepEqual(result.threshold, { ...ballot.manifest.policy.threshold, passed: true });
});

test('wrong chain fails before snapshot or balance reads', async () => {
  const reader = fakeReader({ chain: 1n });
  await assert.rejects(tallyBallot({ ballot, votes: [], reader }), /Chain ID mismatch/);
  assert.deepEqual(reader.calls, ['chainId']);
});

test('wrong or missing snapshot hash fails before balance reads', async () => {
  for (const hash of [`0x${'11'.repeat(32)}`, null]) {
    const reader = fakeReader({ hash });
    await assert.rejects(tallyBallot({ ballot, votes: [], reader }), /Snapshot block hash mismatch/);
    assert.deepEqual(reader.calls, ['chainId', 'blockHash']);
  }
});

test('snapshot hashes compare case-insensitively and preserve the manifest hash in output', async () => {
  const copy = structuredClone(ballot);
  copy.manifest.snapshot.blockHash = `0x${'ab'.repeat(32)}`;
  copy.manifestHash = manifestHash(copy.manifest);
  const result = await tallyBallot({ ballot: copy, votes: [],
    reader: fakeReader({ chain: ballot.manifest.chainId, hash: `0x${'AB'.repeat(32)}` }) });
  assert.deepEqual(result.snapshot, copy.manifest.snapshot);
});

test('every signature is reverified; rejected later votes cannot replace a valid vote', async () => {
  const valid = await receipt(0, 'yes', 1);
  const wrongSigner = { ...await receipt(1, 'no', 2), wallet: wallets[0].address };
  const malformed = { ...await receipt(0, 'abstain', 3), signature: '0x1234' };
  const result = await tallyBallot({ ballot, votes: [valid, wrongSigner, malformed], reader: fakeReader() });
  assert.deepEqual(result.rejected, [
    { receiptOrder: 2, reason: 'Signer mismatch' },
    { receiptOrder: 3, reason: 'Invalid signature' },
  ]);
  assert.deepEqual(result.counted, [{ wallet: wallets[0].address, choice: 'yes', weight: '100', receiptOrder: 1 }]);
});

test('receipt times use an injected clock; opening is inclusive and closing is exclusive', async () => {
  const { opensAt, closesAt } = ballot.manifest.window;
  const votes = [];
  for (const receivedAt of [opensAt - 1, opensAt, closesAt - 1, closesAt, closesAt + 1]) {
    votes.push(await receipt(0, 'yes', votes.length + 1, { issuedAt: opensAt, clock: () => receivedAt }));
  }
  const result = await tallyBallot({ ballot, votes, reader: fakeReader() });
  assert.deepEqual(result.rejected, [1, 4, 5].map((receiptOrder) => ({ receiptOrder, reason: 'Ballot not open' })));
  assert.equal(result.counted[0].receiptOrder, 3);
});

test('issuedAt validity and future skew are checked at receipt time', async () => {
  const votes = [
    await receipt(0, 'yes', 1, { issuedAt: now + 300 }),
    await receipt(0, 'no', 2, { issuedAt: now + 301 }),
    await receipt(0, 'no', 3, { issuedAt: ballot.manifest.window.closesAt }),
  ];
  const result = await tallyBallot({ ballot, votes, reader: fakeReader() });
  assert.deepEqual(result.rejected, [
    { receiptOrder: 2, reason: 'issuedAt too far in future' },
    { receiptOrder: 3, reason: 'issuedAt outside window' },
  ]);
  assert.equal(result.counted[0].receiptOrder, 1);
});

test('last-valid selects greatest issuedAt, then receiptOrder, across wallet casing', async () => {
  const votes = [
    await receipt(0, 'no', 1),
    await receipt(0, 'yes', 2, { issuedAt: now + 10 }),
    await receipt(0, 'abstain', 3, { issuedAt: now - 10 }),
    await receipt(1, 'no', 4),
    await receipt(1, 'yes', 5),
  ];
  votes[1].wallet = votes[1].wallet.toLowerCase();
  votes[4].wallet = `0x${votes[4].wallet.slice(2).toUpperCase()}`;
  const reader = fakeReader({ balances: [60n, 40n, 0n] });
  const result = await tallyBallot({ ballot, votes, reader });
  assert.deepEqual(result.counted.map(({ receiptOrder }) => receiptOrder).sort((a, b) => a - b), [2, 5]);
  assert.equal(result.totals.yes, '100');
  assert.deepEqual(result.rejected, []);
  assert.equal(reader.calls.filter((call) => call.startsWith('lockedBalance:')).length, 2);
});

test('zero-weight wallets are sorted, listed once, and excluded from counted votes', async () => {
  const votes = [await receipt(0, 'yes', 1), await receipt(2, 'no', 2),
    await receipt(1, 'abstain', 3), await receipt(2, 'yes', 4)];
  const result = await tallyBallot({ ballot, votes, reader: fakeReader() });
  const expected = [wallets[1].address, wallets[2].address]
    .sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1);
  assert.deepEqual(result.zeroWeight, expected);
  assert.equal(result.counted.length, 1);
  assert.equal(result.totals.participating, '100');
  assert.equal(result.totals.no, '0');
  assert.equal(result.totals.abstain, '0');
});

for (const [weight, passed] of [[100n, true], [99n, false]]) {
  test(`quorum at ${weight}/1000 ${passed ? 'passes' : 'fails'}`, async () => {
    const result = await tallyBallot({ ballot, votes: [await receipt(0, 'yes', 1)],
      reader: fakeReader({ balances: [weight], total: 1000n }) });
    assert.equal(result.quorum.passed, passed);
    assert.equal(result.threshold.passed, true);
    assert.equal(result.outcome, passed ? 'passed' : 'failed');
  });
}

for (const [yes, no, passed] of [[50n, 50n, false], [51n, 49n, true]]) {
  test(`threshold at ${yes}/${yes + no} ${passed ? 'passes' : 'fails'}`, async () => {
    const result = await tallyBallot({ ballot, votes: [await receipt(0, 'yes', 1), await receipt(1, 'no', 2)],
      reader: fakeReader({ balances: [yes, no], total: 1000n }) });
    assert.equal(result.quorum.passed, true);
    assert.equal(result.threshold.passed, passed);
    assert.equal(result.outcome, passed ? 'passed' : 'failed');
  });
}

test('abstain contributes to quorum while staying outside the threshold denominator', async () => {
  const result = await tallyBallot({ ballot, votes: [await receipt(0, 'yes', 1),
    await receipt(1, 'no', 2), await receipt(2, 'abstain', 3)],
  reader: fakeReader({ balances: [6n, 4n, 90n] }) });
  assert.equal(result.totals.participating, '100');
  assert.equal(result.quorum.passed, true);
  assert.equal(result.threshold.passed, true);
  assert.equal(result.outcome, 'passed');
});

test('abstain-only and empty vote sets fail the threshold even with quorum', async () => {
  for (const votes of [[], [await receipt(0, 'abstain', 1)]]) {
    const result = await tallyBallot({ ballot, votes, reader: fakeReader({ total: 0n }) });
    assert.equal(result.quorum.passed, true);
    assert.equal(result.threshold.passed, false);
    assert.equal(result.outcome, 'failed');
    assert.equal(result.advisory, true);
  }
});

test('non-contiguous, duplicate, reordered and malformed receipt orders throw before reads', async () => {
  const vote = await receipt(0, 'yes', 1);
  for (const orders of [[0], [2], [1, 3], [1, 1], [2, 1], ['1'], [1.5]]) {
    const reader = fakeReader();
    const votes = orders.map((receiptOrder) => ({ ...vote, receiptOrder }));
    await assert.rejects(tallyBallot({ ballot, votes, reader }), /Invalid receiptOrder/);
    assert.deepEqual(reader.calls, []);
  }
  await assert.rejects(tallyBallot({ ballot, votes: [null], reader: fakeReader() }), /Invalid receiptOrder/);
  await assert.rejects(tallyBallot({ ballot, votes: {}, reader: fakeReader() }), /Votes must be a JSON array/);
});

test('snapshot reader errors and invalid weights throw instead of returning a partial tally', async () => {
  const votes = [await receipt(0, 'yes', 1), await receipt(1, 'no', 2)];
  for (const method of ['chainId', 'blockHash', 'totalLocked', 'lockedBalance']) {
    const reader = fakeReader({ balances: [60n, 40n] });
    reader[method] = async () => { throw new Error(`${method} unavailable`); };
    await assert.rejects(tallyBallot({ ballot, votes, reader }), new RegExp(`${method} unavailable`));
  }
  for (const invalid of [1, '100', -1n, undefined]) {
    const reader = fakeReader();
    reader.totalLocked = async () => invalid;
    await assert.rejects(tallyBallot({ ballot, votes, reader }), /Invalid totalLocked/);
    reader.totalLocked = async () => 1000n;
    reader.lockedBalance = async () => invalid;
    await assert.rejects(tallyBallot({ ballot, votes, reader }), /Invalid lockedBalance/);
  }
});

test('repeated tallying has identical JSON, sorted arrays and no input mutation or wall clock', async (t) => {
  const votes = [await receipt(0, 'yes', 1), await receipt(2, 'no', 2), await receipt(1, 'abstain', 3),
    { ...await receipt(1, 'yes', 4), signature: 'invalid' }];
  const before = JSON.stringify(votes);
  for (const vote of votes) Object.freeze(vote);
  Object.freeze(votes);
  t.mock.method(Date, 'now', () => { throw new Error('Wall clock must not be used'); });
  const reader = fakeReader({ balances: [10n, 20n, 30n], total: 100n });
  const first = await tallyBallot({ ballot, votes, reader });
  const second = await tallyBallot({ ballot, votes, reader });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(JSON.stringify(votes), before);
  const addresses = first.counted.map(({ wallet }) => wallet.toLowerCase());
  assert.deepEqual(addresses, [...addresses].sort());
  assert.equal(JSON.stringify(first).includes('receivedAt'), false);
  const reorderedKeys = votes.map((vote) => Object.fromEntries(Object.entries(vote).reverse()));
  assert.equal(JSON.stringify(await tallyBallot({ ballot, votes: reorderedKeys, reader })), JSON.stringify(first));
  const changedReceipt = votes.map((vote, index) => index ? vote : { ...vote, receivedAt: now + 1 });
  assert.notEqual((await tallyBallot({ ballot, votes: changedReceipt, reader })).voteSetHash, first.voteSetHash);
});

const cli = path.resolve(__dirname, '../scripts/forum-tally.js');
const cliArgs = ['--ballot', ballot.manifest.ballotId, '--ballots-dir', ballotsDir,
  '--votes', 'virtual-votes.json', '--rpc', 'https://rpc.invalid'];

test('CLI detects the real static chain and pins contract calls to the snapshot height, offline', async (t) => {
  const votes = [await receipt(0, 'yes', 1)];
  const readFileSync = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...args) => file === 'virtual-votes.json'
    ? JSON.stringify(votes) : readFileSync(file, ...args));
  const abi = new Interface([
    'function lockedBalance(address) view returns (uint256)',
    'function totalLocked() view returns (uint256)',
  ]);
  const calls = [];
  t.mock.method(JsonRpcProvider.prototype, '_send', async function (payload) {
    assert.equal(this._getOption('staticNetwork'), true);
    return (Array.isArray(payload) ? payload : [payload]).map(({ id, method, params }) => {
      calls.push(method);
      let result;
      if (method === 'eth_chainId') result = '0xaa36a7';
      else {
        assert.equal(method, 'eth_call', 'only read-only RPC methods are allowed');
        assert.equal(params[0].to, ballot.manifest.weightSource.contract.toLowerCase());
        assert.equal(params[1], '0x0', 'snapshot height 0 must not become latest');
        const decoded = abi.parseTransaction({ data: params[0].data });
        if (decoded.name === 'lockedBalance') assert.equal(decoded.args[0], wallets[0].address);
        result = abi.encodeFunctionResult(decoded.name, [decoded.name === 'totalLocked' ? 1000n : 100n]);
      }
      return { id, jsonrpc: '2.0', result };
    });
  });
  t.mock.method(JsonRpcProvider.prototype, 'getBlock', async (height) => {
    assert.equal(height, ballot.manifest.snapshot.height);
    return { hash: ballot.manifest.snapshot.blockHash };
  });
  const result = await main(cliArgs);
  assert.equal(result.outcome, 'passed');
  assert.equal(result.totals.yes, '100');
  assert.ok(calls.includes('eth_chainId'));
  assert.equal(calls.filter((method) => method === 'eth_call').length, 2);
});

test('CLI rejects a remote chain mismatch and missing snapshot without network access', async (t) => {
  const readFileSync = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...args) => file === 'virtual-votes.json'
    ? '[]' : readFileSync(file, ...args));
  let chainId = '0x1';
  t.mock.method(JsonRpcProvider.prototype, '_send', async (payload) => {
    assert.equal(payload.method, 'eth_chainId');
    return [{ id: payload.id, jsonrpc: '2.0', result: chainId }];
  });
  t.mock.method(JsonRpcProvider.prototype, 'getBlock', async () => null);
  await assert.rejects(main(cliArgs), /Chain ID mismatch/);
  chainId = '0xaa36a7';
  await assert.rejects(main(cliArgs), /Snapshot block not found/);
});

test('CLI errors exit 1, print only the message to stderr and leave stdout empty', () => {
  const cases = [
    [[], /Missing required argument --ballot/],
    [[...cliArgs.slice(0, -1), 'http://rpc.invalid'], /--rpc must be an HTTPS URL/],
    [[...cliArgs.slice(0, -1), 'invalid'], /--rpc must be an HTTPS URL/],
    [[...cliArgs, '--unknown', 'value'], /Unknown option/],
    [cliArgs.map((arg) => arg === 'virtual-votes.json'
      ? path.join(ballotsDir, `${ballot.manifest.ballotId}.json`) : arg), /Votes must be a JSON array/],
  ];
  for (const [args, message] of cases) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, message);
    assert.equal(result.stderr.trim().split('\n').length, 1);
  }
});
