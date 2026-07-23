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
const businessLogo = read('src', 'components', 'BusinessLogo.tsx');
const sellerRuleBuilder = read('src', 'components', 'SellerRuleBuilder.tsx');
const sellerCatalogManager = read('src', 'components', 'SellerCatalogManager.tsx');
const apiClient = read('src', 'lib', 'api.ts');
const shell = read('src', 'components', 'AppShell.tsx');
const widget = read('src', 'components', 'CopilotWidget.tsx');
const guide = read('src', 'app', 'guide', 'page.tsx');
const sellerConsole = read('src', 'app', 'b', '[businessId]', 'page.tsx');
const customerPass = read('src', 'app', 'p', '[passId]', 'page.tsx');
const checkoutProof = read('src', 'app', 'r', '[sessionId]', 'page.tsx');
const sellerCatalog = read('src', 'app', 's', '[businessId]', 'page.tsx');
const sellerCatalogClient = read('src', 'app', 's', '[businessId]', 'SellerCatalogClient.tsx');
const customerCheckoutPass = read('src', 'components', 'CustomerCheckoutPass.tsx');
const walletStatus = read('src', 'components', 'WalletStatus.tsx');
const businessSlug = read('src', 'lib', 'businessSlug.ts');
const nextConfig = read('next.config.js');

assert.ok(layout.includes("'@type': 'WebApplication'"), 'Shop WebApplication structured data is missing');
assert.ok(layout.includes('Contextual IFR Copilot help'), 'Structured data must describe contextual help');
assert.ok(robots.includes("disallow: ['/api/', '/b/', '/p/', '/r/']"), 'Private routes must stay out of crawler results');
assert.ok(sitemap.includes("const siteOrigin = 'https://shop.ifrunit.tech'"), 'Sitemap origin must remain canonical');
for (const route of ['`${siteOrigin}/`', '`${siteOrigin}/guide`', '`${siteOrigin}/scan`']) {
  assert.ok(sitemap.includes(route), `Public sitemap route missing: ${route}`);
}
assert.ok(sitemap.includes('/api/businesses/catalog-index'), 'Sitemap must load the bounded public catalog index');
assert.ok(sitemap.includes("export const revalidate = 3600"), 'Dynamic catalog sitemap must use bounded revalidation');
assert.ok(sitemap.includes("export const dynamic = 'force-dynamic'"), 'Catalog sitemap must resolve against the runtime backend');
assert.ok(sitemap.includes('encodeURIComponent(businessRef)'), 'Stable catalog references must be encoded in sitemap URLs');
assert.ok(sitemap.includes('return staticRoutes'), 'Sitemap must fail open to static public routes');
assert.ok(home.includes("'#integrate'"), 'Seller code-generator deep link must select seller mode');
assert.ok(home.includes("'#seller-session-history'"), 'Seller history deep link must select seller mode');
assert.ok(home.includes("window.setTimeout(scrollToTarget, 700)"), 'Deep links must retry after asynchronous layout settles');
assert.ok(!home.includes('document.querySelector(window.location.hash)'), 'Untrusted URL hashes must not be used as CSS selectors');
assert.ok(home.includes('onOpenSellerTools={openSellerTools}'), 'Empty public network must route into seller setup');
assert.ok(home.includes('Benefit rule ID'), 'Generator must request the exact rule ID instead of a display label');
assert.ok(home.includes('IFRBenefitsClient'), 'POS generator must use the challenge-validating repository SDK');
assert.ok(home.includes('Never inline a key or seed phrase.'), 'POS output must preserve the signer security boundary');
assert.ok(home.includes('integration-generator-validation'), 'Disabled generator actions need an accessible validation reason');
assert.ok(!home.includes("useState('Bronze 10%')"), 'Generator must not substitute a display label for a rule ID');
for (const threshold of [1000, 2500, 5000, 10000]) {
  assert.ok(walletStatus.includes(`amount: ${threshold}`), `Wallet tier guide missing documented ${threshold} IFR example`);
}
assert.ok(!walletStatus.includes('amount: 25000'), 'Wallet must not present an undocumented 25,000 IFR global tier');
assert.ok(walletStatus.includes('Sellers define each real rule'), 'Wallet tier guide must state that seller rules are authoritative');
assert.ok(offerDiscovery.includes('No active offer is being hidden or replaced with demo data.'), 'Empty network must not imply demo or hidden offers');
assert.ok(offerDiscovery.includes('No offers match these filters'), 'Filtered empty results need a distinct explanation');
assert.ok(offerDiscovery.includes('onClick={clearFilters}'), 'Filtered empty results must provide a one-action reset');
assert.ok(offerDiscovery.includes('&offer=${encodeURIComponent(offer.id)}#customer-pass'), 'Discovery offers need a contextual checkout handoff');
assert.ok(offerDiscovery.includes('<BusinessLogo'), 'Discovery offers must render the seller identity');
assert.ok(sellerCatalogClient.includes('<BusinessLogo'), 'Public catalogs must render the seller identity');
assert.ok(customerCheckoutPass.includes('<BusinessLogo'), 'Checkout confirmation must render the seller identity');
assert.ok(businessLogo.includes('referrerPolicy="no-referrer"'), 'External seller logos must suppress the Shop referrer');
assert.ok(businessLogo.includes('onError={() => setFailed(true)}'), 'Broken seller logos need a local fallback');
assert.ok(businessLogo.includes("parsed.protocol === 'https:'"), 'Seller logo rendering must reject non-HTTPS URLs defensively');
assert.ok(customerCheckoutPass.includes('useSearchParams()'), 'Offer context must react to same-route query changes');
assert.ok(customerCheckoutPass.includes('status.checkout.benefitRuleId !== selectedOffer.rule.id'), 'Checkout confirmation must detect a selected-offer mismatch');
assert.ok(customerCheckoutPass.includes('!selectedOfferMismatch'), 'A mismatched selected offer must block silent confirmation');
assert.ok(businessSlug.includes("parsed.origin !== SHOP_ORIGIN"), 'Seller URL parsing must reject foreign origins');
assert.ok(businessSlug.includes("parsed.search"), 'Seller URL parsing must reject query-bearing references');
assert.ok(
  businessSlug.includes('const match = parsed.pathname.match(') && businessSlug.includes('[bs]'),
  'Seller URL parsing must accept only scanner or catalog paths'
);
assert.ok(apiClient.includes('businessId?: string'), 'Public discovery must accept an exact Business ID filter');
assert.ok(apiClient.includes("query.set('businessId', filters.businessId)"), 'Business ID must be sent as an encoded query parameter');
assert.ok(apiClient.includes('claimSellerBusinessSlug'), 'Seller API must expose the owner-signed permanent URL claim');
assert.ok(sellerRuleBuilder.includes("'business:slug'"), 'Seller URL claims must use their dedicated signed action');
assert.ok(sellerRuleBuilder.includes('Permanent seller URL'), 'Seller onboarding must expose its stable public URL');
assert.ok(sellerRuleBuilder.includes('async function verifyPublicListing'), 'Seller launch must verify its public discovery result');
assert.ok(sellerRuleBuilder.includes('getBusinessRules(targetBusinessId)'), 'Seller launch must verify exact rules beyond the first discovery page');
assert.ok(sellerRuleBuilder.includes('Rule saved and verified in public discovery.'), 'Rule save must report authoritative public verification');
assert.ok(sellerRuleBuilder.includes('4 required checks'), 'Seller launch must expose required-check progress');
assert.ok(sellerRuleBuilder.includes('id="seller-launch"'), 'Seller launch status needs a stable navigation target');
assert.ok(sellerCatalogManager.includes('onUseProduct(product)'), 'A new catalog item must flow directly into rule authoring');
assert.ok(sellerCatalogManager.includes('activeBusinessIdRef.current !== requestBusinessId'), 'Catalog writes must ignore stale seller-context responses');
assert.ok(sellerCatalogManager.includes('id="seller-catalog"'), 'Seller catalog needs a stable onboarding target');
assert.ok(
  sellerCatalogManager.includes('href={`/s/${encodeURIComponent(publicBusinessRef)}`}'),
  'Seller catalog manager must prefer the stable public seller reference'
);
assert.ok(
  sellerRuleBuilder.includes('publicBusinessRef={publicBusinessRef}'),
  'Seller onboarding must pass the stable public reference without replacing the internal mutation ID'
);
assert.ok(guide.includes('https://shop.ifrunit.tech/guide'), 'Guide must publish its own canonical URL');
for (const [label, source] of [['seller console', sellerConsole], ['customer pass', customerPass], ['checkout proof', checkoutProof]]) {
  assert.ok(source.includes('index: false, follow: false'), `${label} must remain noindex/nofollow`);
}
assert.ok(sellerCatalog.includes('encodeURIComponent(canonicalRef)'), 'Public seller catalog canonical must prefer its stable seller reference');
assert.ok(sellerCatalog.includes('permanentRedirect'), 'Legacy catalog IDs must redirect to the canonical seller URL');
assert.ok(sellerCatalogClient.includes('getBusinessRules(businessId, controller.signal)'), 'Seller catalog must load active standalone benefit rules');
assert.ok(sellerCatalogClient.includes('Other member benefits'), 'Product-less public rules need a truthful catalog section');
assert.ok(sellerCatalogClient.includes('&offer=${encodeURIComponent(rule.id)}#customer-pass'), 'Catalog rules need a contextual checkout handoff');
assert.ok(sellerCatalogClient.includes('categories.length === 0 && standaloneRules.length === 0'), 'Catalog empty state must account for standalone rules');
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
