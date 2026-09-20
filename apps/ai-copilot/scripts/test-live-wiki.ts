import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import {
  LiveWikiRefresher,
  normalizeAllowedOrigin,
  isAllowedWikiUrl,
  resolveAllowedWikiUrl,
  extractWikiText,
  buildLiveWikiSection,
  loadLiveWikiConfigFromEnv,
  DEFAULT_LIVE_WIKI_CONFIG,
  type LiveWikiConfig,
} from '../server/live-wiki';

// CWA-24 / CWA-75 / CWA-76: deterministic tests against local HTTP fixtures.
// No internet access: every crawl target is a 127.0.0.1 fixture server.

const IFR_ORIGINS = ['https://ifrunit.tech'] as const;

// ── Origin allowlist parsing ──────────────────────────────────────────
assert.equal(normalizeAllowedOrigin('https://ifrunit.tech'), 'https://ifrunit.tech');
assert.equal(normalizeAllowedOrigin('https://ifrunit.tech/'), 'https://ifrunit.tech');
assert.equal(normalizeAllowedOrigin('http://127.0.0.1:8080'), 'http://127.0.0.1:8080', 'loopback http allowed for fixtures');
assert.equal(normalizeAllowedOrigin('http://localhost:3000'), 'http://localhost:3000');
for (const bad of [
  'not-a-url',
  'ftp://ifrunit.tech',
  'file:///etc/passwd',
  'http://ifrunit.tech',                 // downgrade: non-loopback plain HTTP
  'https://user:pass@ifrunit.tech',      // credential-bearing
  'https://ifrunit.tech/wiki/index.html',// path, not a bare origin
  'https://ifrunit.tech/?x=1',
]) {
  assert.throws(() => normalizeAllowedOrigin(bad), Error, `origin must be rejected: ${bad}`);
}

// ── loadLiveWikiConfigFromEnv ─────────────────────────────────────────
assert.deepEqual(loadLiveWikiConfigFromEnv({}).allowedOrigins, ['https://ifrunit.tech'], 'production default is the canonical IFR origin');
assert.deepEqual(loadLiveWikiConfigFromEnv({ COPILOT_WIKI_ALLOWED_ORIGINS: '' }).allowedOrigins, ['https://ifrunit.tech']);
assert.deepEqual(
  loadLiveWikiConfigFromEnv({ COPILOT_WIKI_ALLOWED_ORIGINS: 'https://ifrunit.tech, https://www.ifrunit.tech' }).allowedOrigins,
  ['https://ifrunit.tech', 'https://www.ifrunit.tech'],
);
assert.throws(
  () => loadLiveWikiConfigFromEnv({ COPILOT_WIKI_ALLOWED_ORIGINS: 'https://ifrunit.tech,http://evil.example' }),
  Error,
  'one invalid entry fails the whole allowlist (fail-closed)',
);
assert.throws(
  () => loadLiveWikiConfigFromEnv({ COPILOT_WIKI_ALLOWED_ORIGINS: 'https://evil.example' }),
  Error,
  'runtime configuration cannot widen the compiled IFR origin allowlist',
);
assert.throws(
  () => loadLiveWikiConfigFromEnv({ COPILOT_WIKI_ALLOWED_ORIGINS: 'http://127.0.0.1:8080' }),
  Error,
  'loopback origins are available only through direct test configuration',
);

// ── URL trust boundary (index, links, redirect hops, pages) ───────────
const allowed = (raw: string) => isAllowedWikiUrl(new URL(raw), IFR_ORIGINS);
assert.equal(allowed('https://ifrunit.tech/wiki/index.html'), true);
assert.equal(allowed('https://ifrunit.tech/wiki/tokenomics.html'), true);
assert.equal(allowed('https://ifrunit.tech/index.html'), true);
assert.equal(allowed('https://ifrunit.tech/'), true);
for (const rejected of [
  'http://ifrunit.tech/wiki/index.html',        // downgrade
  'https://www.ifrunit.tech/wiki/index.html',   // not allowlisted
  'https://ifrunit.tech.evil.com/wiki/x.html',  // lookalike suffix host
  'https://evil-ifrunit.tech/wiki/x.html',      // lookalike prefix host
  'https://user:pass@ifrunit.tech/wiki/x.html', // credentials
  'https://ifrunit.tech:8443/wiki/x.html',      // port mismatch
  'https://ifrunit.tech/api/data.json',         // path outside policy
  'https://ifrunit.tech/wiki/',                 // directory, not a page
  'https://ifrunit.tech/wiki/x.html?draft=1',   // query variant, not the static canonical page
  'https://ifrunit.tech/wiki/x.html#section',   // fragment variant, not a canonical fetch target
  'https://ifrunit.tech/wiki/../secret.html',   // traversal (normalized outside /wiki/)
  'https://ifrunit.tech/wiki/%2e%2e/x.html',    // encoded traversal
  'https://ifrunit.tech/assets/app.js',         // non-HTML asset
  'ftp://ifrunit.tech/wiki/x.html',             // non-HTTP(S)
]) {
  assert.equal(allowed(rejected), false, `must be rejected: ${rejected}`);
}
assert.equal(isAllowedWikiUrl(new URL('https://www.ifrunit.tech/wiki/x.html'), ['https://ifrunit.tech', 'https://www.ifrunit.tech']), true, 'explicitly allowlisted second origin passes');

// ── Relative link resolution ──────────────────────────────────────────
assert.equal(
  resolveAllowedWikiUrl('tokenomics.html', 'https://ifrunit.tech/wiki/index.html', IFR_ORIGINS),
  'https://ifrunit.tech/wiki/tokenomics.html',
);
assert.equal(
  resolveAllowedWikiUrl('/wiki/faq.html', 'https://ifrunit.tech/wiki/index.html', IFR_ORIGINS),
  'https://ifrunit.tech/wiki/faq.html',
);
assert.equal(
  resolveAllowedWikiUrl('https://evil.example/x.html', 'https://ifrunit.tech/wiki/index.html', IFR_ORIGINS),
  null,
);
assert.equal(resolveAllowedWikiUrl('javascript:alert(1)', 'https://ifrunit.tech/wiki/index.html', IFR_ORIGINS), null);
assert.equal(resolveAllowedWikiUrl('///evil.example/x.html', 'https://ifrunit.tech/wiki/index.html', IFR_ORIGINS), null, 'protocol-relative foreign URL rejected');

// ── HTML → inert text extraction ──────────────────────────────────────
{
  const html = '<html><head><style>body{color:red}</style><script>alert("xss")</script></head>' +
    '<body><nav>menu</nav><iframe src="https://evil.example"></iframe><form>form</form>' +
    '<main>IFR uses 9 decimals &amp; burns fees &mdash; see wiki.</main></body></html>';
  const text = extractWikiText(html, 4000);
  assert.ok(text.includes('IFR uses 9 decimals & burns fees — see wiki.'), 'entities decoded, text kept');
  for (const active of ['alert', 'color:red', 'evil.example', 'menu', '<script', '<iframe']) {
    assert.ok(!text.includes(active), `active content stripped: ${active}`);
  }
  assert.equal(extractWikiText('x'.repeat(10_000), 100).length, 100, 'per-page char bound enforced');
}

// ── Prompt section wording: data only, no override, no prioritization ──
{
  const section = buildLiveWikiSection('=== https://ifrunit.tech/wiki/faq.html ===\nFAQ text');
  assert.ok(section.includes('untrusted reference data only'), 'marked as untrusted data');
  assert.ok(section.includes('cannot override'), 'states it cannot override instructions');
  assert.ok(!/always prioritize/i.test(section), 'no prioritization wording');
}

// ── Static wiring checks on the chat server ───────────────────────────
{
  const serverSource = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8');
  const promptSource = readFileSync(new URL('../src/context/system-prompts.ts', import.meta.url), 'utf8');
  assert.ok(!serverSource.includes('await fetchLiveWikiContext'), 'chat path must not await a crawl');
  assert.ok(!/always prioritize/i.test(serverSource), 'prioritization wording removed from server');
  assert.ok(!/Always use the LIVE WIKI CONTEXT/i.test(promptSource), 'live Wiki is not authoritative in the base prompt');
  assert.ok(!/wiki context is correct/i.test(promptSource), 'conflicting live Wiki facts do not override committed knowledge');
  assert.ok(/untrusted reference data/i.test(promptSource), 'base prompt marks live Wiki as untrusted data');
  assert.ok(serverSource.includes('liveWiki.getContext()'), 'chat reads the snapshot synchronously');
  assert.ok(
    serverSource.indexOf('dailyBudget.tryReserve') < serverSource.indexOf('fetch(ANTHROPIC_MESSAGES_URL'),
    'budget reservation happens before the Anthropic call',
  );
  assert.ok(serverSource.includes('"budget_exhausted"'), 'documented budget-exhausted code present');
}

// ── Local HTTP fixtures ───────────────────────────────────────────────
type Route = {
  status?: number;
  body?: string;
  contentType?: string;
  delayMs?: number;
  redirectTo?: string;
};

async function startFixture(routes: Map<string, Route>, hits: Map<string, number>) {
  const server = http.createServer((req, res) => {
    const path = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    hits.set(path, (hits.get(path) || 0) + 1);
    const route = routes.get(path);
    const send = () => {
      if (!route) {
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end('<h1>not found</h1>');
        return;
      }
      if (route.redirectTo) {
        res.writeHead(302, { location: route.redirectTo });
        res.end();
        return;
      }
      res.writeHead(route.status ?? 200, { 'content-type': route.contentType ?? 'text/html' });
      res.end(route.body ?? '');
    };
    if (route?.delayMs) setTimeout(send, route.delayMs);
    else send();
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture has no port');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

function testConfig(origin: string, overrides: Partial<LiveWikiConfig> = {}): LiveWikiConfig {
  return {
    ...DEFAULT_LIVE_WIKI_CONFIG,
    allowedOrigins: [origin],
    discoveryTimeoutMs: 500,
    fetchTimeoutMs: 300,
    refreshIntervalMs: 60_000,
    ...overrides,
  };
}

function pageBody(marker: string): string {
  return `<html><head><title>${marker}</title><script>alert("injected-${marker}")</script></head>` +
    `<body><nav>navigation</nav><main>${marker} IFR protocol reference content with enough characters to be a real page.</main></body></html>`;
}

function indexBody(links: string[]): string {
  return `<html><body>${links.map((href) => `<a href="${href}">link</a>`).join('')}</body></html>`;
}

const closers: http.Server[] = [];
try {
  // Foreign origin fixture: tracks whether anything ever fetches from it.
  const foreignRoutes = new Map<string, Route>([
    ['/landing.html', { body: pageBody('FOREIGN-CONTENT') }],
    ['/evil.html', { body: pageBody('EVIL-CONTENT') }],
  ]);
  const foreignHits = new Map<string, number>();
  const foreign = await startFixture(foreignRoutes, foreignHits);
  closers.push(foreign.server);

  // ── Same-origin success + off-origin links + foreign redirect ──────
  {
    const routes = new Map<string, Route>();
    const hits = new Map<string, number>();
    const fixture = await startFixture(routes, hits);
    closers.push(fixture.server);
    const origin = fixture.origin;

    routes.set('/wiki/index.html', {
      body: indexBody([
        'a.html',                          // relative same-origin
        '/wiki/b.html',                    // root-relative same-origin
        `${origin}/wiki/c.html`,           // absolute same-origin
        `${foreign.origin}/evil.html`,     // off-origin absolute → must be skipped
        `${origin}/wiki/redir.html`,       // redirects to foreign origin → must be skipped
        'https://fonts.googleapis.com',    // foreign HTTPS → must be skipped
      ]),
    });
    routes.set('/wiki/a.html', { body: pageBody('PAGE-A') });
    routes.set('/wiki/b.html', { body: pageBody('PAGE-B') });
    routes.set('/wiki/c.html', { body: pageBody('PAGE-C') });
    routes.set('/wiki/redir.html', { redirectTo: `${foreign.origin}/landing.html` });
    routes.set('/index.html', { body: pageBody('LANDING') });

    const refresher = new LiveWikiRefresher(testConfig(origin));
    const result = await refresher.refresh();
    // Attempted: a, b, c, redir (foreign skipped at discovery) + landing seed = 5
    // Succeeded: a, b, c, landing = 4 >= ceil(5 * 0.5) = 3 → refresh accepted
    assert.equal(result.ok, true, 'refresh succeeds despite skipped foreign content');
    assert.equal(result.pages, 4);
    const context = refresher.getContext();
    for (const marker of ['PAGE-A', 'PAGE-B', 'PAGE-C', 'LANDING']) {
      assert.ok(context.includes(marker), `context contains ${marker}`);
    }
    assert.ok(!context.includes('injected-'), 'script content never reaches the prompt');
    assert.equal(foreignHits.size, 0, 'off-origin link and foreign redirect were never fetched');
    assert.equal(hits.get('/wiki/redir.html'), 1, 'redirecting page was attempted once');
    refresher.stop();

    // ── Single-flight: concurrent refreshes share one crawl ──────────
    {
      hits.clear();
      routes.set('/wiki/index.html', { body: indexBody(['a.html']), delayMs: 120 });
      const slowRefresher = new LiveWikiRefresher(testConfig(origin));
      const [r1, r2, r3] = await Promise.all([slowRefresher.refresh(), slowRefresher.refresh(), slowRefresher.refresh()]);
      assert.equal(r1.ok && r2.ok && r3.ok, true);
      assert.equal(hits.get('/wiki/index.html'), 1, 'one refresh in flight at a time');
      const r4 = await slowRefresher.refresh();
      assert.equal(r4.ok, true);
      assert.equal(hits.get('/wiki/index.html'), 2, 'next refresh after completion crawls again');
      slowRefresher.stop();
    }
  }

  // ── Same-origin redirect chain: allowed, but bounded ───────────────
  {
    const routes = new Map<string, Route>();
    const hits = new Map<string, number>();
    const fixture = await startFixture(routes, hits);
    closers.push(fixture.server);
    const origin = fixture.origin;
    routes.set('/wiki/index.html', { body: indexBody(['old.html', 'loop1.html']) });
    routes.set('/wiki/old.html', { redirectTo: '/wiki/new.html' });
    routes.set('/wiki/new.html', { body: pageBody('REDIRECT-TARGET') });
    routes.set('/wiki/loop1.html', { redirectTo: '/wiki/loop2.html' });
    routes.set('/wiki/loop2.html', { redirectTo: '/wiki/loop3.html' });
    routes.set('/wiki/loop3.html', { redirectTo: '/wiki/loop4.html' });
    routes.set('/wiki/loop4.html', { body: pageBody('LOOP-END') });
    routes.set('/index.html', { body: pageBody('LANDING') });

    const refresher = new LiveWikiRefresher(testConfig(origin, { maxRedirects: 2 }));
    const result = await refresher.refresh();
    // Attempted: old, loop1, landing = 3; succeeded: old→new + landing = 2 >= ceil(3*0.5)=2
    assert.equal(result.ok, true);
    const context = refresher.getContext();
    assert.ok(context.includes('REDIRECT-TARGET'), 'same-origin redirect hop is followed');
    assert.ok(!context.includes('LOOP-END'), 'redirect chain beyond maxRedirects is rejected');
    refresher.stop();
  }

  // ── Status + content-type validation + per-response byte bound ─────
  {
    const routes = new Map<string, Route>();
    const hits = new Map<string, number>();
    const fixture = await startFixture(routes, hits);
    closers.push(fixture.server);
    const origin = fixture.origin;
    routes.set('/wiki/index.html', { body: indexBody(['good.html', 'missing.html', 'plain.html', 'big.html']) });
    routes.set('/wiki/good.html', { body: pageBody('GOOD-PAGE') });
    // missing.html intentionally absent → 404
    routes.set('/wiki/plain.html', { body: pageBody('PLAIN-TEXT'), contentType: 'text/plain' });
    routes.set('/wiki/big.html', { body: pageBody('BIG-PAGE') + 'y'.repeat(8_192) });
    routes.set('/index.html', { body: pageBody('LANDING') });

    const refresher = new LiveWikiRefresher(testConfig(origin, { maxBytesPerResponse: 4_096 }));
    const result = await refresher.refresh();
    // Attempted: good, missing, plain, big, landing = 5; succeeded: good, landing = 2 < ceil(5*0.5)=3 → insufficient
    assert.equal(result.ok, false, 'only 2/5 pages valid → refresh rejected');
    assert.equal(result.reason, 'insufficient-pages');
    assert.equal(refresher.getContext(), '', 'failed refresh never installs partial content');
    assert.equal(hits.get('/wiki/big.html'), 1, 'oversize page attempted but aborted on byte budget');
    refresher.stop();
  }

  // ── Stale-if-error: discovery failure, page outage, timeouts ───────
  {
    const routes = new Map<string, Route>();
    const hits = new Map<string, number>();
    const fixture = await startFixture(routes, hits);
    closers.push(fixture.server);
    const origin = fixture.origin;
    const goodIndex = () => routes.set('/wiki/index.html', { body: indexBody(['a.html', 'b.html']) });
    goodIndex();
    routes.set('/wiki/a.html', { body: pageBody('STABLE-A') });
    routes.set('/wiki/b.html', { body: pageBody('STABLE-B') });
    routes.set('/index.html', { body: pageBody('STABLE-LANDING') });

    const refresher = new LiveWikiRefresher(testConfig(origin));
    const first = await refresher.refresh();
    assert.equal(first.ok, true);
    const goodContext = refresher.getContext();
    assert.ok(goodContext.includes('STABLE-A'));

    // Discovery outage → last good retained
    routes.set('/wiki/index.html', { status: 500, body: 'boom' });
    const outage = await refresher.refresh();
    assert.equal(outage.ok, false);
    assert.equal(outage.reason, 'discovery-failed');
    assert.equal(outage.keptLastGood, true);
    assert.equal(refresher.getContext(), goodContext, 'last good snapshot survives a discovery outage');

    // Discovery timeout → last good retained
    routes.set('/wiki/index.html', { body: indexBody(['a.html']), delayMs: 2_000 });
    const timeout = await refresher.refresh();
    assert.equal(timeout.ok, false);
    assert.equal(timeout.reason, 'discovery-failed');
    assert.equal(refresher.getContext(), goodContext, 'last good snapshot survives a discovery timeout');

    // Page outage (all 3 pages time out) → last good retained
    goodIndex();
    routes.set('/wiki/a.html', { body: pageBody('STABLE-A'), delayMs: 2_000 });
    routes.set('/wiki/b.html', { body: pageBody('STABLE-B'), delayMs: 2_000 });
    routes.set('/index.html', { body: pageBody('STABLE-LANDING'), delayMs: 2_000 });
    const partial = await refresher.refresh();
    assert.equal(partial.ok, false);
    assert.equal(partial.reason, 'insufficient-pages');
    assert.equal(refresher.getContext(), goodContext, 'partial/timeout refresh keeps last good');

    // Recovery: healthy again → snapshot refreshes
    routes.set('/wiki/a.html', { body: pageBody('RECOVERED-A') });
    routes.set('/wiki/b.html', { body: pageBody('STABLE-B') });
    routes.set('/index.html', { body: pageBody('STABLE-LANDING') });
    const recovered = await refresher.refresh();
    assert.equal(recovered.ok, true);
    assert.ok(refresher.getContext().includes('RECOVERED-A'), 'refresh recovers after the outage ends');
    refresher.stop();
  }

  // ── Synchronous chat-path read: getContext never crawls ────────────
  {
    const routes = new Map<string, Route>();
    const hits = new Map<string, number>();
    const fixture = await startFixture(routes, hits);
    closers.push(fixture.server);
    const refresher = new LiveWikiRefresher(testConfig(fixture.origin));
    const before = hits.get('/wiki/index.html') || 0;
    const context = refresher.getContext();
    assert.equal(typeof context, 'string', 'getContext returns synchronously');
    assert.equal(context, '');
    assert.equal(hits.get('/wiki/index.html') || 0, before, 'getContext performs no network access');
    refresher.stop();
  }
} finally {
  for (const server of closers) {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
}

console.log('PASS: live wiki — trust boundary, redirects, bounds, stale-if-error, single-flight, sync read; fixtures only, no internet');
