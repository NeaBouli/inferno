const assert = require('node:assert/strict');
const test = require('node:test');

const apiRateLimit = require('../src/middleware/apiRateLimit');

function fakeReq(ip, xForwardedFor) {
  return {
    ip,
    headers: xForwardedFor ? { 'x-forwarded-for': xForwardedFor } : {},
    socket: { remoteAddress: ip },
  };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    set(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

// Negative: after the per-IP maximum the endpoint answers 429 (CWA-31).
test('allows up to max requests per IP, then 429', () => {
  const limiter = apiRateLimit({ windowMs: 60000, max: 3 });
  for (let i = 0; i < 3; i += 1) {
    const res = fakeRes();
    let called = false;
    limiter(fakeReq('10.0.0.1'), res, () => { called = true; });
    assert.equal(called, true, `request ${i + 1} passes`);
  }
  const res = fakeRes();
  let called = false;
  limiter(fakeReq('10.0.0.1'), res, () => { called = true; });
  assert.equal(called, false, 'fourth request blocked');
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { success: false, error: 'Too many requests' });
  assert.ok(res.headers['Retry-After'], 'Retry-After header set');
});

test('limit is tracked per IP address', () => {
  const limiter = apiRateLimit({ windowMs: 60000, max: 1 });
  limiter(fakeReq('10.0.0.1'), fakeRes(), () => {});
  const blocked = fakeRes();
  limiter(fakeReq('10.0.0.1'), blocked, () => {});
  assert.equal(blocked.statusCode, 429);

  const other = fakeRes();
  let called = false;
  limiter(fakeReq('10.0.0.2'), other, () => { called = true; });
  assert.equal(called, true, 'second IP has its own budget');
});

// Negative: the limiter key is the socket peer, so rotating the spoofable
// X-Forwarded-For header must not reset the budget (CWA-31).
test('attacker-controlled X-Forwarded-For does not bypass the limit', () => {
  const limiter = apiRateLimit({ windowMs: 60000, max: 2 });
  limiter(fakeReq('10.0.0.9', '1.1.1.1'), fakeRes(), () => {});
  limiter(fakeReq('10.0.0.9', '2.2.2.2'), fakeRes(), () => {});

  const res = fakeRes();
  let called = false;
  limiter(fakeReq('10.0.0.9', '3.3.3.3'), res, () => { called = true; });
  assert.equal(called, false, 'spoofed XFF does not reset the budget');
  assert.equal(res.statusCode, 429);
});

test('window resets after it expires', () => {
  const limiter = apiRateLimit({ windowMs: 5, max: 1 });
  limiter(fakeReq('10.0.0.5'), fakeRes(), () => {});
  const blocked = fakeRes();
  limiter(fakeReq('10.0.0.5'), blocked, () => {});
  assert.equal(blocked.statusCode, 429);
  return new Promise((resolve) => setTimeout(resolve, 10)).then(() => {
    const res = fakeRes();
    let called = false;
    limiter(fakeReq('10.0.0.5'), res, () => { called = true; });
    assert.equal(called, true, 'budget available again after the window');
  });
});
