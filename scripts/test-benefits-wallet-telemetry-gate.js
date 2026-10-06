#!/usr/bin/env node
// T-280: self-test for the wallet telemetry gate. Serves small fixture pages
// and proves the gate FAILS on late telemetry (>10 s), on broken, unhydrated
// or empty pages and on invalid observation durations, and passes a working
// fixture page. No wallet, no real third-party request (telemetry is aborted).

const assert = require('node:assert/strict');
const http = require('node:http');
const { runGate, parseObserveMs, MIN_OBSERVE_MS } = require('./test-benefits-wallet-telemetry.js');

// Mirrors React's hydration marker so the fixture counts as hydrated.
const HYDRATED = `<script>document.querySelector('main').__reactFiber$fixture = {};</script>`;
const PAGES = {
  '/ok': `<main><h1>Fixture working page</h1></main>${HYDRATED}`,
  '/late-telemetry': `<main><h1>Fixture working page</h1></main>${HYDRATED}
    <script>setTimeout(() => fetch('https://pulse.walletconnect.org/batch?fixture=late', { method: 'POST', mode: 'no-cors', body: '{}' }).catch(() => {}), 11000);</script>`,
  '/broken': `<main></main><script>throw new Error('fixture runtime failure');</script>`,
  '/unhydrated': `<main><h1>Fixture working page</h1></main>`,
  '/empty': ``,
  '/error-boundary': `<main><h1 id="root-error-title">Something went wrong</h1><h1>Fixture working page</h1></main>${HYDRATED}`,
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const body = PAGES[new URL(req.url, 'http://x').pathname];
      res.writeHead(body === undefined ? 404 : 200, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html><html><head><title>fixture</title></head><body>${body ?? 'missing'}</body></html>`);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  // Invalid observation windows are rejected instead of silently shortening.
  assert.equal(parseObserveMs(undefined), MIN_OBSERVE_MS);
  assert.equal(parseObserveMs(''), MIN_OBSERVE_MS);
  assert.equal(parseObserveMs('20000'), 20000);
  for (const bad of ['abc', 'NaN', 'Infinity', '-1', '5000', '14999', '1.5e4', '16000.5']) {
    assert.throws(() => parseObserveMs(bad), /finite integer/, `duration "${bad}" must be rejected`);
  }

  const server = await serve();
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const viewports = [{ name: 'desktop 1440x1000', viewport: { width: 1440, height: 1000 }, isMobile: false, hasTouch: false }];
  const headings = [/Fixture working page/];
  const cases = [
    { path: '/ok', expect: null },
    { path: '/late-telemetry', expect: /telemetry POST https:\/\/pulse\.walletconnect\.org/ },
    { path: '/broken', expect: /page error: fixture runtime failure/ },
    { path: '/unhydrated', expect: /React did not hydrate/ },
    { path: '/empty', expect: /expected heading .* not visible/ },
    { path: '/error-boundary', expect: /error boundary rendered/ },
    { path: '/missing', expect: /HTTP 404/ },
  ];
  try {
    const { failures, passes } = await runGate({
      baseUrl,
      routes: cases.map(({ path }) => ({ path, headings })),
      viewports,
      observeMs: MIN_OBSERVE_MS,
    });
    for (const { path, expect } of cases) {
      const mine = failures.filter((f) => f.includes(`] ${path} ->`));
      if (expect === null) {
        assert.deepEqual(mine, [], `${path} must pass: ${mine.join('; ')}`);
        assert.ok(passes.some((p) => p.includes(`] ${path} `)), `${path} must be reported as a pass`);
      } else {
        assert.ok(mine.some((f) => expect.test(f)), `${path} must fail with ${expect}; got: ${mine.join('; ') || 'PASS'}`);
      }
    }
    console.log(`[benefits-wallet-telemetry-gate] PASS - gate fails on late telemetry, page error, unhydrated, empty, error-boundary and HTTP 404 fixtures, rejects invalid durations, passes a working page`);
  } finally {
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
