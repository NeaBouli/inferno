const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const layout = read('src', 'app', 'layout.tsx');
const robots = read('src', 'app', 'robots.ts');
const sitemap = read('src', 'app', 'sitemap.ts');
const home = read('src', 'app', 'page.tsx');
const offerDiscovery = read('src', 'components', 'OfferDiscovery.tsx');
const shell = read('src', 'components', 'AppShell.tsx');
const widget = read('src', 'components', 'CopilotWidget.tsx');
const guide = read('src', 'app', 'guide', 'page.tsx');
const sellerConsole = read('src', 'app', 'b', '[businessId]', 'page.tsx');
const customerPass = read('src', 'app', 'p', '[passId]', 'page.tsx');
const checkoutProof = read('src', 'app', 'r', '[sessionId]', 'page.tsx');
const sellerCatalog = read('src', 'app', 's', '[businessId]', 'page.tsx');
const nextConfig = read('next.config.js');

assert.ok(layout.includes("'@type': 'WebApplication'"), 'Shop WebApplication structured data is missing');
assert.ok(layout.includes('Contextual IFR Copilot help'), 'Structured data must describe contextual help');
assert.ok(robots.includes("disallow: ['/api/', '/b/', '/p/', '/r/']"), 'Private routes must stay out of crawler results');
for (const route of ['https://shop.ifrunit.tech/', 'https://shop.ifrunit.tech/guide', 'https://shop.ifrunit.tech/scan']) {
  assert.ok(sitemap.includes(route), `Public sitemap route missing: ${route}`);
}
assert.ok(home.includes("'#integrate'"), 'Seller code-generator deep link must select seller mode');
assert.ok(home.includes("'#seller-session-history'"), 'Seller history deep link must select seller mode');
assert.ok(home.includes("window.setTimeout(scrollToTarget, 700)"), 'Deep links must retry after asynchronous layout settles');
assert.ok(!home.includes('document.querySelector(window.location.hash)'), 'Untrusted URL hashes must not be used as CSS selectors');
assert.ok(home.includes('onOpenSellerTools={openSellerTools}'), 'Empty public network must route into seller setup');
assert.ok(offerDiscovery.includes('No active offer is being hidden or replaced with demo data.'), 'Empty network must not imply demo or hidden offers');
assert.ok(offerDiscovery.includes('No offers match these filters'), 'Filtered empty results need a distinct explanation');
assert.ok(offerDiscovery.includes('onClick={clearFilters}'), 'Filtered empty results must provide a one-action reset');
assert.ok(guide.includes('https://shop.ifrunit.tech/guide'), 'Guide must publish its own canonical URL');
for (const [label, source] of [['seller console', sellerConsole], ['customer pass', customerPass], ['checkout proof', checkoutProof]]) {
  assert.ok(source.includes('index: false, follow: false'), `${label} must remain noindex/nofollow`);
}
assert.ok(sellerCatalog.includes('encodeURIComponent(businessId)'), 'Public seller catalog canonical must encode its ID');
assert.ok(shell.includes('<CopilotWidget />'), 'Every AppShell route must render the IFR Copilot');
assert.ok(widget.includes('surface=benefits'), 'Shop Copilot must retain Benefits context');
assert.ok(widget.includes('referrerPolicy="no-referrer"'), 'Shop Copilot must suppress referrer data');
assert.ok(nextConfig.includes('poweredByHeader: false'), 'Shop must suppress the Next.js powered-by header');
for (const header of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Strict-Transport-Security']) {
  assert.ok(nextConfig.includes(header), `Shop security header missing from Next config: ${header}`);
}
for (const file of ['llms.txt', 'ai.txt']) {
  assert.ok(fs.statSync(path.join(root, 'public', file)).size > 0, `${file} must be published`);
}

console.log('[benefits-discoverability-test] PASS');
