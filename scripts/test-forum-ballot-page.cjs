#!/usr/bin/env node

// Offline source-contract checks and execution with mocked DOM, wallet and fetch.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { keccak256, toUtf8Bytes, TypedDataEncoder } = require('ethers');
const { voteTypedData } = require('../apps/telegram/telegram-bot/src/forum/ballot.js');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'docs/wiki/forum-ballot.html'), 'utf8');
const schemaBlock = source.match(/<script type="application\/json" id="forum-vote-schema">([\s\S]*?)<\/script>/);
assert.ok(schemaBlock, 'page must embed the vote schema as JSON');
const schema = JSON.parse(schemaBlock[1]);
const scripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 1, 'one inline runtime script expected');
const runtime = scripts[0][1];
const API = 'https://verify-api.ifrunit.tech/api/forum';
const ADDRESS = `0x${'12'.repeat(20)}`;
const SIGNATURE = `0x${'ab'.repeat(65)}`;
const NOW = 1792100000;
const clone = (value) => JSON.parse(JSON.stringify(value));
const fixture = {
  manifest: {
    ballotId: 'FB-TEST', chainId: 11155111,
    proposal: { title: '<img src=x onerror=alert(1)> Advisory proposal', textHash: `0x${'34'.repeat(32)}` },
    snapshot: { height: Number.MAX_SAFE_INTEGER },
    window: { opensAt: NOW - 3600, closesAt: NOW + 3600 },
  },
  manifestHash: `0x${'56'.repeat(32)}`,
  proposalText: '# Frozen proposal\n<script>alert("plain text only")</script>',
};
const expected = voteTypedData(fixture, 'yes', NOW);
assert.deepEqual(schema.domain, {
  name: expected.domain.name, version: expected.domain.version, salt: expected.domain.salt,
});
assert.equal(schema.domain.salt, keccak256(toUtf8Bytes('ifrunit.tech/forum/v1')));
assert.equal(schema.primaryType, 'IFRForumVote');
const { EIP712Domain, ...voteTypes } = schema.types;
assert.deepEqual(voteTypes, expected.types, 'vote names, types and field order must match ballot.js');
assert.deepEqual(EIP712Domain,
  TypedDataEncoder.getPayload(expected.domain, expected.types, expected.value).types.EIP712Domain,
  'domain fields and order must include salt and omit verifyingContract');

const patternSource = runtime.match(/const BALLOT_ID_PATTERN = (\/\^FB-[^\n]+\/);/);
assert.ok(patternSource, 'ballot ID regex must be explicit');
const pattern = vm.runInNewContext(patternSource[1]);
assert.equal(pattern.source, '^FB-[A-Z0-9-]{1,32}$');
assert.match(runtime, /const FORUM_API = 'https:\/\/verify-api\.ifrunit\.tech\/api\/forum';/);
assert.match(runtime, /document\.querySelector\('meta\[name="ifr-forum-api"\]'\)/);
assert.ok(source.includes('Sepolia test ballot — results are advisory'));
assert.doesNotMatch(source, /<script\b[^>]*\bsrc\s*=/i, 'no external scripts, including local assets');
assert.doesNotMatch(runtime, /\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b|document\.write\s*\(/, 'server content must only be rendered as text');
assert.doesNotMatch(runtime, /\b(?:localStorage|sessionStorage|indexedDB|sendBeacon)\b|document\.cookie/, 'no wallet persistence or analytics');
assert.match(source, /<noscript>[\s\S]*JavaScript is required[\s\S]*<\/noscript>/);
assert.match(source, /last valid vote before closing counts/);
assert.match(source, /Votes, wallet addresses and signatures are published/);
for (const choice of ['yes', 'no', 'abstain']) {
  assert.ok(source.includes(`<label for="choice-${choice}">`));
  assert.ok(source.includes(`id="choice-${choice}" type="radio" name="choice" value="${choice}" required`));
}

function assertTypedData(actual, ballot, choice) {
  const core = voteTypedData(ballot, choice, NOW);
  assert.deepEqual(actual.domain, core.domain);
  assert.deepEqual(Object.keys(actual.domain), Object.keys(core.domain));
  assert.equal(actual.primaryType, 'IFRForumVote');
  assert.deepEqual(actual.types, { EIP712Domain, ...core.types });
  assert.deepEqual(actual.message, core.value, 'all dynamic fields must come from the frozen ballot');
  assert.deepEqual(Object.keys(actual.message), Object.keys(core.value));
  assert.equal(TypedDataEncoder.hash(actual.domain, core.types, actual.message),
    TypedDataEncoder.hash(core.domain, core.types, core.value));
}

async function mount(options = {}) {
  const ballot = clone(options.ballot || fixture);
  const base = options.meta || API;
  const url = `${base.replace(/\/+$/, '')}/ballots/${ballot.manifest.ballotId}`;
  const requests = [];
  const walletCalls = [];
  const events = new Map();
  const nodes = new Map([...source.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)].map(([tag, id]) => [id, {
    textContent: id === 'forum-vote-schema' ? schemaBlock[1] : '',
    hidden: /\bhidden\b/.test(tag), disabled: /\bdisabled\b/.test(tag), dataset: {}, listeners: {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
  }]));
  let chain = options.chain || `0x${ballot.manifest.chainId.toString(16)}`;
  let accounts = [ADDRESS];
  const provider = {
    on(event, callback) { events.set(event, callback); },
    async request(request) {
      walletCalls.push(clone(request));
      if (request.method === 'eth_requestAccounts' && options.rejectConnect) throw new Error('User rejected the request.');
      if (request.method === 'eth_requestAccounts' || request.method === 'eth_accounts') return accounts.slice();
      if (request.method === 'eth_chainId') return chain;
      if (request.method === 'wallet_switchEthereumChain') {
        chain = request.params[0].chainId;
        events.get('chainChanged')?.(chain);
        return null;
      }
      if (request.method === 'eth_signTypedData_v4') {
        if (options.changeDuringSign) {
          accounts = [`0x${'98'.repeat(20)}`];
          events.get('accountsChanged')?.(accounts);
        }
        return SIGNATURE;
      }
      assert.fail(`Unexpected wallet method: ${request.method}`);
    },
  };
  const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => clone(data) });
  const context = {
    URL, URLSearchParams,
    Date: class extends Date { static now() { return NOW * 1000 + 987; } },
    window: { location: { search: options.search ?? '?ballot=FB-TEST' }, ethereum: options.noProvider ? undefined : provider },
    document: {
      getElementById(id) { assert.ok(nodes.has(id), `unknown element: ${id}`); return nodes.get(id); },
      querySelector(selector) {
        if (selector === 'meta[name="ifr-forum-api"]') return options.meta ? { content: options.meta } : null;
        if (selector === 'input[name="choice"]:checked') return options.choice === null ? null : { value: options.choice || 'yes' };
        assert.fail(`Unexpected selector: ${selector}`);
      },
    },
    async fetch(target, init) {
      requests.push({ url: target, ...clone(init) });
      assert.equal(init.credentials, 'omit');
      assert.equal(init.referrerPolicy, 'no-referrer');
      if (target === url) return response(options.loadStatus || 200, options.loadError ? { error: options.loadError } : ballot);
      if (target === `${url}/votes` && init.method === 'POST') {
        return response(options.postStatus || 201, options.postError ? { error: options.postError } : { receiptOrder: 4 });
      }
      assert.ok(target.startsWith(`${url}/votes?`), `unexpected URL: ${target}`);
      if (options.countError) return response(503, { error: options.countError });
      const after = new URL(target).searchParams.get('after');
      const pages = {
        0: { records: [{ receiptOrder: 1 }, { receiptOrder: 2 }], next: 2 },
        2: { records: [{ receiptOrder: 3 }], next: 3 },
        3: { records: [], next: null },
      };
      assert.ok(Object.hasOwn(pages, after), `unexpected pagination cursor: ${after}`);
      return response(200, pages[after]);
    },
  };
  await vm.runInNewContext(runtime, context, { timeout: 1000 });
  return {
    nodes, requests, walletCalls,
    node: (id) => nodes.get(id),
    click: (id) => nodes.get(id).listeners.click(),
    submit: () => nodes.get('vote-form').listeners.submit({ preventDefault() {} }),
    changeAccount() { accounts = [`0x${'76'.repeat(20)}`]; },
    changeChain() { chain = '0x1'; },
  };
}

async function main() {
  for (const search of ['', '?ballot=', '?ballot=FB-', '?ballot=fb-TEST', '?ballot=FB-A%0A',
    '?ballot=FB-../TEST', `?ballot=FB-${'A'.repeat(33)}`, '?ballot=FB-A%20']) {
    const invalid = await mount({ search });
    assert.equal(invalid.requests.length, 0, `invalid ID must not reach collector: ${search}`);
    assert.match(invalid.node('load-status').textContent, /invalid ballot ID/);
  }
  const app = await mount({ search: '?ballot=FB-TEST&api=https://ignored.invalid' });
  assert.equal(app.node('proposal-text').textContent, fixture.proposalText);
  assert.equal(app.node('ballot-title').textContent, fixture.manifest.proposal.title);
  assert.equal(app.node('proposal-hash').textContent, fixture.manifest.proposal.textHash);
  assert.equal(app.node('manifest-hash').textContent, fixture.manifestHash);
  assert.equal(app.node('snapshot-height').textContent, String(Number.MAX_SAFE_INTEGER));
  assert.match(app.node('opens-at').textContent, / UTC$/);
  assert.match(app.node('closes-at').textContent, / UTC$/);
  assert.equal(app.node('sepolia-banner').hidden, false);
  assert.equal(app.node('vote-count').textContent, '3');
  assert.deepEqual(app.requests.slice(1).map((request) => new URL(request.url).searchParams.get('after')), ['0', '2', '3']);
  assert.equal(app.node('raw-votes').href, `${API}/ballots/FB-TEST/votes?after=0&limit=1000`);
  assert.equal(app.walletCalls.length, 0, 'loading a ballot must not connect a wallet');
  await app.click('connect-wallet');
  assert.equal(app.node('submit-vote').disabled, false);
  await app.submit();
  const sign = app.walletCalls.find((request) => request.method === 'eth_signTypedData_v4');
  assert.equal(sign.params[0], ADDRESS);
  assertTypedData(JSON.parse(sign.params[1]), fixture, 'yes');
  assert.deepEqual(JSON.parse(app.requests.find((request) => request.method === 'POST').body), {
    wallet: ADDRESS, choice: 'yes', issuedAt: NOW, signature: SIGNATURE,
  });
  assert.equal(app.node('vote-status').textContent, 'Vote recorded (receipt 4)');

  const wrongChain = await mount({ chain: '0x1' });
  await wrongChain.click('connect-wallet');
  assert.equal(wrongChain.node('submit-vote').disabled, true);
  assert.equal(wrongChain.node('switch-chain').hidden, false);
  assert.match(wrongChain.node('wallet-status').textContent, /requires chain 11155111/);
  await wrongChain.submit();
  assert.ok(!wrongChain.walletCalls.some((request) => request.method === 'eth_signTypedData_v4'));
  await wrongChain.click('switch-chain');
  assert.equal(wrongChain.node('submit-vote').disabled, false);
  assert.deepEqual(wrongChain.walletCalls.find((request) => request.method === 'wallet_switchEthereumChain').params,
    [{ chainId: '0xaa36a7' }]);

  for (const choice of ['no', 'abstain']) {
    const otherBallot = clone(fixture);
    otherBallot.manifest.chainId = 31337;
    const other = await mount({ ballot: otherBallot, choice, meta: 'https://staging.invalid/api/forum/' });
    assert.equal(other.node('sepolia-banner').hidden, true);
    assert.ok(other.requests.every((request) => request.url.startsWith('https://staging.invalid/api/forum/')));
    await other.click('connect-wallet');
    await other.submit();
    assertTypedData(JSON.parse(other.walletCalls.find((request) => request.method === 'eth_signTypedData_v4').params[1]), otherBallot, choice);
  }
  for (const options of [{}, { changeDuringSign: true }, { changedChain: true }]) {
    const changed = await mount(options);
    await changed.click('connect-wallet');
    if (options.changedChain) changed.changeChain();
    else if (!options.changeDuringSign) changed.changeAccount();
    await changed.submit();
    assert.ok(!changed.requests.some((request) => request.method === 'POST'), 'changed wallet or network must not submit');
  }
  for (const options of [
    { postStatus: 200, expected: 'Already recorded' },
    { postStatus: 400, postError: 'Ballot not open', expected: 'Ballot not open' },
    { postStatus: 429, postError: 'Wallet vote limit reached', expected: 'Wallet vote limit reached' },
    { postStatus: 503, postError: '<b>Vote store unavailable</b>', expected: '<b>Vote store unavailable</b>' },
  ]) {
    const result = await mount(options);
    await result.click('connect-wallet');
    await result.submit();
    assert.equal(result.node('vote-status').textContent, options.expected);
  }
  const failedLoad = await mount({ loadStatus: 503, loadError: 'Forum vote storage not configured' });
  assert.equal(failedLoad.node('load-status').textContent, 'Forum vote storage not configured');
  assert.equal(failedLoad.node('voting').hidden, true);
  const failedCount = await mount({ countError: 'IP rate limit exceeded' });
  assert.equal(failedCount.node('vote-count').textContent, 'Unavailable');
  assert.equal(failedCount.node('count-status').textContent, 'IP rate limit exceeded');
  for (const options of [{ noProvider: true }, { rejectConnect: true }]) {
    const unavailable = await mount(options);
    await unavailable.click('connect-wallet');
    assert.match(unavailable.node('vote-status').textContent, options.noProvider ? /No injected wallet found/ : /User rejected/);
    assert.equal(unavailable.node('submit-vote').disabled, true);
  }
  console.log('[forum-ballot-page] PASS — core domain/types/order/salt, safe rendering, pagination and offline wallet flows');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
