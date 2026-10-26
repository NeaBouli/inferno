const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pages = ['docs/index.html', 'docs/web3/index.html', ...fs.readdirSync(path.join(root, 'docs/wiki')).filter(file => file.endsWith('.html')).map(file => `docs/wiki/${file}`)];
for (const file of pages) {
  const source = read(file);
  assert.doesNotMatch(source, /#ifr-btn\b|#ifr-panel\b|id=["']ifr-(?:btn|panel)|copilot-launcher|copilot-panel|data-copilot|CoPilot\.jpg|embedded=1/i, file);
  assert.doesNotMatch(source.replace(/copilot-api\.ifrunit\.tech/g, ''), /copilot|chatbot|AI assistant/i, `${file}: retired capability claim`);
}
for (const file of ['docs/assets/redesign-skin.css', 'apps/benefits-network/frontend/src/app/globals.css']) {
  assert.doesNotMatch(read(file), /#ifr-(?:btn|panel)|shop-copilot|shop-launcher/, file);
}
assert.ok(!fs.existsSync(path.join(root, 'apps/ai-copilot')));
for (const file of ['apps/benefits-network/frontend/src/components/CopilotWidget.tsx', 'apps/benefits-network/frontend/public/copilot-avatar.jpg', 'docs/assets/CoPilot.jpg', 'scripts/build-wiki-rag.js', '.github/workflows/railway-copilot-release.yml']) {
  assert.ok(!fs.existsSync(path.join(root, file)), `retired path: ${file}`);
}
for (const file of fs.readdirSync(path.join(root, 'apps/data-api/server'))) {
  assert.doesNotMatch(read(`apps/data-api/server/${file}`), /ANTHROPIC_API_KEY|api\.anthropic|SYSTEM_PROMPTS|recordPointsEvent|IFR_KNOWLEDGE|wiki-rag|live-wiki/, file);
}
for (const file of ['infra/web3/web3-security-headers.conf', 'apps/benefits-network/frontend/next.config.js']) {
  const policies = read(file).match(/frame-src[^;\n]*/g);
  assert.ok(policies.length);
  for (const policy of policies) {
    assert.ok(!policy.includes('copilot-api'));
    assert.ok(policy.includes('verify.walletconnect.com'));
  }
}
assert.match(read('apps/benefits-network/frontend/public/sw.js'), /CACHE_NAME = 'ifr-benefits-v26'/);
assert.doesNotMatch(read('apps/benefits-network/frontend/public/sw.js'), /copilot-avatar/);
assert.match(read('docs/web3-sw.js'), /CACHE_NAME = "ifr-web3-v23"/);
for (const file of pages.filter(file => read(file).includes('redesign-skin.css'))) {
  const skinVersion = file === 'docs/wiki/multisig.html' ? '20261026-continuity-anchor-v2' : '20261023-p1';
  assert.ok(read(file).includes(`redesign-skin.css?v=${skinVersion}`), `${file}: versioned skin required`);
  assert.ok(read(file).includes('page-motion.js?v=20261023-p1'), `${file}: matching motion asset required`);
}
console.log(`[data-api-retirement] PASS ${pages.length} pages, runtime modules, CSP frames, deleted assets and cache revision`);
