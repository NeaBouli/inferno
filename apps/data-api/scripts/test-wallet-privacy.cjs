// Exercise shipping routes with synthetic wallets and injected upstreams; never open a listener.
const assert = require('node:assert/strict');
const ethers = require('ethers');
const { loadApp, request } = require('./api-harness.cjs');

const wallet = '0x1234567890abcdef1234567890abcdef1234abcd';
const contract = '0x1111111111111111111111111111111111111111';
const lookups = [
  [`/api/builders/check/${wallet}`, { address: ethers.getAddress(wallet), isBuilder: true }, 'Builder registry unavailable'],
  [`/api/commitment/tranches/${wallet}`, {
    wallet, trancheCount: 0, tranches: [], totalLocked: '0', p0Set: false, p0ETH: null,
  }, 'Failed to fetch tranches'],
  [`/api/commitment/status/${wallet}`, {
    wallet, isLocked: false, totalLocked: '0.0', tier: 0, tierName: 'None',
  }, 'Failed to fetch status'],
  [`/api/lending/loans/${wallet}`, { wallet, activeLoans: [] }, 'Failed to fetch loans'],
  [`/api/lending/lender/${wallet}`, { wallet, hasOffer: false }, 'Failed to fetch lender data'],
  [`/api/ifr/check?wallet=${wallet}`, {
    hasAccess: true, balance: '1000.0', locked: '0.0', total: '1000.0', required: 1000,
    tier: 0, tierName: 'None', tierBasis: 'locked',
  }, 'Failed to check access'],
];

function fixture({ failure, code = 'CALL_EXCEPTION', env = {} } = {}) {
  const logs = [];
  const privateError = Object.assign(new Error(`lookup ${wallet}; https://rpc.example.test/secret-key`), {
    code, data: `0xabcdef${wallet.slice(2)}`, transaction: { from: wallet },
    request: { headers: { authorization: 'secret-auth' }, body: 'secret-signature' },
  });
  class Contract {
    constructor() { if (failure) throw privateError; }
    async getTranches() { return []; }
    async p0Set() { return false; }
    async lockedBalance() { return 0n; }
    async hasActiveLock() { return false; }
    async getLoanCount() { return 0n; }
    async hasOffer() { return false; }
    async balanceOf() { return 1000n * 10n ** 9n; }
  }
  const app = loadApp({
    env: { BUILDER_REGISTRY_ADDR: contract, COMMITMENT_VAULT_ADDR: contract, LENDING_VAULT_ADDR: contract, ...env },
    modules: {
      ethers: { ...ethers, ethers: { ...ethers.ethers, Contract } },
      './rpc.js': {
        getRpcProvider: () => ({}),
        ethCall: async () => { if (failure) throw privateError; return `0x${'0'.repeat(63)}1`; },
      },
    },
    fetch: async () => {
      if (failure) throw privateError;
      return { json: async () => ({ status: '1', result: [] }) };
    },
    console: { log() {}, warn() {}, error(...args) { logs.push(args); } },
  });
  return { app, logs };
}

function noStore(response) {
  assert.match(response.headers['cache-control'], /(?:^|,\s*)no-store(?:,|$)/);
  assert.ok(!response.headers['cache-control'].includes('public'));
}

(async () => {
  const success = fixture();
  for (const [url, expected] of lookups) {
    const response = await request(success.app, 'GET', url);
    assert.equal(response.status, 200, url);
    noStore(response);
    assert.deepEqual(JSON.parse(response.body), expected, `${url}: existing response contract`);
    if (!url.includes('?')) {
      const invalid = await request(success.app, 'GET', url.replace(wallet, 'invalid'));
      assert.equal(invalid.status, 400, url);
      noStore(invalid);
      assert.deepEqual(JSON.parse(invalid.body), { error: 'Invalid address' });
    }
  }
  const invalidWallet = await request(success.app, 'GET', '/api/ifr/check?wallet=invalid');
  assert.equal(invalidWallet.status, 400);
  noStore(invalidWallet);
  assert.deepEqual(JSON.parse(invalidWallet.body), { error: 'Invalid wallet address' });
  const invalidRequired = await request(success.app, 'GET', `/api/ifr/check?wallet=${wallet}&required=invalid`);
  assert.equal(invalidRequired.status, 400);
  noStore(invalidRequired);
  assert.deepEqual(JSON.parse(invalidRequired.body), { error: 'Invalid required IFR amount' });

  // Partial addresses, duplicate parameters, array syntax, case and trailing slashes stay private.
  for (const url of [
    `/api/locks/events?q=${wallet}`, '/api/locks/events?q=0x1234',
    `/api/locks/events?q=${wallet}&q=other`, `/api/locks/events?q[]=${wallet}`,
    `/API/LOCKS/EVENTS/?q=${wallet}`, '/api/locks/events?q=',
  ]) {
    const response = await request(success.app, 'GET', url);
    assert.equal(response.status, 200, url);
    noStore(response);
    const { timestamp, ...body } = JSON.parse(response.body);
    assert.equal(typeof timestamp, 'string');
    assert.deepEqual(body, { events: [], page: 1, limit: 5, hasMore: false });
  }
  const invalidSearch = await request(success.app, 'GET', `/api/locks/events?q=${wallet}&type=invalid`);
  assert.equal(invalidSearch.status, 400);
  noStore(invalidSearch);
  assert.deepEqual(JSON.parse(invalidSearch.body), { error: 'Unknown lock event type' });
  assert.equal((await request(success.app, 'GET', '/api/locks/events')).headers['cache-control'], 'public, max-age=30');
  const head = await request(success.app, 'HEAD', `/api/builders/check/${wallet}`);
  assert.equal(head.status, 200);
  noStore(head);

  const failure = fixture({ failure: true });
  const failureLookups = [...lookups, ['/api/lending/health/0', undefined, 'Failed to fetch loan health']];
  for (const [url, , message] of failureLookups) {
    const response = await request(failure.app, 'GET', url);
    assert.equal(response.status, 502, url);
    noStore(response);
    assert.deepEqual(JSON.parse(response.body), { error: message });
  }
  const searchFailure = await request(failure.app, 'GET', `/api/locks/events?q=${wallet}`);
  assert.equal(searchFailure.status, 502);
  noStore(searchFailure);
  assert.deepEqual(JSON.parse(searchFailure.body), { error: 'Failed to fetch lock events' });
  assert.equal(failure.logs.length, failureLookups.length + 1);
  for (const [operation, fields] of failure.logs) {
    assert.equal(typeof operation, 'string');
    assert.deepEqual(JSON.parse(JSON.stringify(fields)), { code: operation === 'Lock events error:' ? 'UNKNOWN_ERROR' : 'CALL_EXCEPTION' });
  }
  const logged = JSON.stringify(failure.logs);
  for (const sensitive of [wallet, wallet.slice(2), 'secret-key', 'secret-auth', 'secret-signature', 'transaction', 'stack']) {
    assert.ok(!logged.includes(sensitive), `logs must omit ${sensitive}`);
  }
  for (const code of [wallet, `NETWORK_ERROR ${wallet}`, { address: wallet }, -32000, null]) {
    const unknown = fixture({ failure: true, code });
    await request(unknown.app, 'GET', lookups[0][0]);
    assert.deepEqual(JSON.parse(JSON.stringify(unknown.logs[0][1])), { code: 'UNKNOWN_ERROR' });
  }

  const limited = fixture({ env: { DATA_API_FEED_PER_MINUTE: '1' } }).app;
  await request(limited, 'GET', `/api/locks/events?q=${wallet}`);
  const denied = await request(limited, 'GET', `/api/locks/events?q=${wallet}`);
  assert.equal(denied.status, 429);
  noStore(denied);
  const disabled = await request(loadApp(), 'GET', `/api/builders/check/${wallet}`);
  assert.equal(disabled.status, 404);
  noStore(disabled);
  const parserError = await request(success.app, 'POST', `/api/ifr/check?wallet=${wallet}`, '{');
  assert.equal(parserError.status, 400);
  noStore(parserError);
  console.log('[wallet-privacy] PASS success, validation, upstream errors, safe logs, searches, HEAD, 404, 429 and parser errors; no listener/network');
})().catch(error => { console.error(error); process.exitCode = 1; });
