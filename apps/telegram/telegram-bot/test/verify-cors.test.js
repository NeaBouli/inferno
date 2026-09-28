'use strict';

// CWA-39: exact HTTPS origin allowlist for the verify API — every lookalike
// class must fail closed, only the official IFR origins are accepted.

const assert = require('node:assert/strict');
const test = require('node:test');

const express = require('express');

const {
  ALLOWED_ORIGINS, resolveAllowedOrigin, verifyCors,
} = require('../src/middleware/verifyCors');

// ── Positive: official origins ───────────────────────────────────────────────

test('accepts the exact official IFR origins', () => {
  assert.equal(resolveAllowedOrigin('https://ifrunit.tech'), 'https://ifrunit.tech');
  assert.equal(resolveAllowedOrigin('https://www.ifrunit.tech'), 'https://www.ifrunit.tech');
  // URL-normalized equivalents of the same origin stay accepted.
  assert.equal(resolveAllowedOrigin('https://ifrunit.tech/'), 'https://ifrunit.tech');
  assert.equal(resolveAllowedOrigin('HTTPS://IFRUNIT.TECH'), 'https://ifrunit.tech');
  assert.equal(resolveAllowedOrigin('https://ifrunit.tech:443'), 'https://ifrunit.tech');
});

// ── Negative: every lookalike class ──────────────────────────────────────────

test('rejects prefix/suffix and subdomain lookalikes', () => {
  for (const origin of [
    'https://ifrunit.tech.evil.example',
    'https://evil.com/ifrunit.tech',
    'https://evilifrunit.tech',
    'https://ifrunit-tech.com',
    'https://wiki.ifrunit.tech',
    'https://verify-api.ifrunit.tech',
    'https://ifrunit.tech.', // trailing dot is a different host
  ]) {
    assert.equal(resolveAllowedOrigin(origin), null, origin);
  }
});

test('rejects alternate schemes and ports', () => {
  for (const origin of [
    'http://ifrunit.tech',
    'https://ifrunit.tech:8443',
    'https://ifrunit.tech:4433',
    'file://ifrunit.tech',
    'chrome-extension://ifrunit.tech',
  ]) {
    assert.equal(resolveAllowedOrigin(origin), null, origin);
  }
});

test('rejects credentialed and userinfo-confusion URLs', () => {
  for (const origin of [
    'https://user:pass@ifrunit.tech',
    'https://user@ifrunit.tech',
    'https://ifrunit.tech@evil.com',
    'https://evil.com#ifrunit.tech',
    'https://evil.com?q=ifrunit.tech',
  ]) {
    assert.equal(resolveAllowedOrigin(origin), null, origin);
  }
});

test('rejects null, malformed and non-origin values', () => {
  for (const origin of [
    'null',
    '',
    '   ',
    ' https://ifrunit.tech',
    'https://ifrunit.tech ',
    'https://ifrunit.tech, https://evil.com',
    'not-a-url',
    'https://',
    'ifrunit.tech',
    'https://ifrunit.tech/path',
    'https://ifrunit.tech?x=1',
    'https://ifrunit.tech#frag',
  ]) {
    assert.equal(resolveAllowedOrigin(origin), null, JSON.stringify(origin));
  }
  assert.equal(resolveAllowedOrigin(undefined), null);
  assert.equal(resolveAllowedOrigin(null), null);
  assert.equal(resolveAllowedOrigin(42), null);
});

// ── Middleware behavior over a real loopback server ──────────────────────────

async function withServer(run) {
  const app = express();
  app.use(express.json());
  app.use(verifyCors());
  app.post('/api/verify', (req, res) => res.json({ ok: true }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('allowed origin receives the exact echoed origin, never a wildcard', async () => {
  await withServer(async (base) => {
    for (const origin of ALLOWED_ORIGINS) {
      const res = await fetch(`${base}/api/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: '{}',
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), origin);
      assert.notEqual(res.headers.get('access-control-allow-origin'), '*');
      assert.equal(res.headers.get('vary'), 'Origin');
    }
  });
});

test('lookalike origin gets a response without any CORS headers', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://ifrunit.tech.evil.example' },
      body: '{}',
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    assert.equal(res.headers.get('access-control-allow-methods'), null);
  });
});

test('documented no-Origin policy: processed, but no CORS headers', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
});

test('preflight succeeds with headers only for allowlisted origins', async () => {
  await withServer(async (base) => {
    const ok = await fetch(`${base}/api/verify`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://ifrunit.tech', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://ifrunit.tech');
    assert.match(ok.headers.get('access-control-allow-methods'), /POST/);

    const bad = await fetch(`${base}/api/verify`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(bad.status, 200);
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
  });
});
