const assert = require('node:assert/strict');
const { loadApp, request } = require('./api-harness.cjs');
(async () => {
  const app = loadApp();
  const root = await request(app, 'GET', '/');
  assert.equal(root.status, 200);
  assert.match(root.headers['content-type'], /application\/json/);
  const listing = JSON.parse(root.body);
  assert.equal(listing.service, 'ifr-data-api');
  assert.equal(listing.endpoints.length, 24);
  assert.equal(new Set(listing.endpoints).size, 24);
  assert.ok(listing.endpoints.includes('POST /api/builder/generate'));
  assert.ok(listing.endpoints.includes('GET /api/builders/count'));
  for (const body of [undefined, '{', JSON.stringify({ messages: [{ role: 'user', content: 'help' }] })]) {
    const response = await request(app, 'POST', '/api/chat', body);
    assert.equal(response.status, 410);
    assert.deepEqual(JSON.parse(response.body), { error: 'chat retired' });
    assert.equal(response.headers['x-frame-options'], 'DENY');
    assert.match(response.headers['content-security-policy'], /default-src 'none'; frame-ancestors 'none'/);
  }
  const vote = await request(app, 'POST', '/api/bootstrap/vote', '{}');
  assert.equal(vote.status, 410);
  assert.equal(JSON.parse(vote.body).code, 'bootstrap_vote_closed');
  assert.equal(vote.headers['cache-control'], 'no-store');
  const archive = await request(app, 'GET', '/api/bootstrap/votes');
  assert.deepEqual(JSON.parse(archive.body), { totalVoted: '0.0000', finaliseETH: '0.0000', refundETH: '0.0000', voteCount: 0, recentVotes: [] });
  const missing = await request(app, 'GET', '/missing');
  assert.equal(missing.status, 404);
  const malformed = await request(app, 'POST', '/api/builder/generate', '{');
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers['x-frame-options'], 'DENY');
  console.log('[data-api-retirement] PASS root, 24 route inventory, 410 tombstone, archive, errors and headers; no listener/provider requests');
})().catch(error => { console.error(error); process.exitCode = 1; });
