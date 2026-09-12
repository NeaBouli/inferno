const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const guide = read('docs/wiki/liquidity.html');
assert.match(guide, /redesign-skin.css/);
assert.match(guide, /aria-current="page"/);
assert.match(guide, /liquidity-summary/);
for (const anchor of ['calculator', 'add', 'remove', 'risks', 'questions']) assert.match(guide, new RegExp(`id="${anchor}"`));
for (const file of fs.readdirSync(path.join(root, 'docs/wiki')).filter(x => x.endsWith('.html'))) {
  const html = read('docs/wiki/' + file);
  const sidebar = html.match(/<aside\b[\s\S]*?<\/aside>/)?.[0];
  if (sidebar) assert.match(sidebar, /liquidity.html/, file + ': missing sidebar entry');
}
const landing = read('docs/index.html');
assert.match(landing, /id="liquidity-gauge"/);
assert.match(landing, /not safety, returns or a funding target/);
assert.match(landing, /t:"Provide IFR \/ ETH liquidity"[^\n]+n:"liquidity"/);
for (const anchor of ['calculator', 'add', 'remove', 'risks']) assert.ok(landing.includes('wiki/liquidity.html#' + anchor));
assert.match(read('docs/wiki/faq.html'), /id="user-liquidity"/);
for (const file of ['README.md', 'docs/sitemap.xml', 'docs/llms.txt', 'apps/ai-copilot/src/context/ifr-knowledge.ts']) assert.ok(read(file).includes('liquidity.html'), file);
const rag = JSON.parse(read('apps/ai-copilot/src/context/wiki-content.json')).find(x => x.slug === 'liquidity');
assert.ok(rag);
for (const term of ['read-only', 'impermanent loss', 'router', 'Bootstrap', 'Uniswap']) assert.ok(rag.content.includes(term), 'RAG missing ' + term);
for (const file of ['docs/assets/liquidity-calculator.mjs', 'docs/assets/liquidity-navigation.js', 'docs/assets/liquidity-gauge.mjs']) assert.doesNotMatch(read(file), /eth_requestAccounts|sendTransaction|personal_sign|getSigner|wallet_requestPermissions/);
for (const block of guide.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) assert.equal(JSON.parse(block[1])['@context'], 'https://schema.org');
console.log('PASS: Wiki shell/discovery, first-step wizard, FAQ, README/SEO/AI retrieval and read-only boundary');
