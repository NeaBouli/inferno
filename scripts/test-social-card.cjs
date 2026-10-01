#!/usr/bin/env node
// JUL-20: Landing and Web3 social previews use an optimized 1200x630 card, not
// the 4096px token icon. The official token icon itself stays unchanged.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const CARD = 'docs/assets/ifr_social_card_1200x630.png';
const CARD_URL = 'https://ifrunit.tech/assets/ifr_social_card_1200x630.png';

const png = fs.readFileSync(path.join(root, CARD));
assert.equal(png.toString('ascii', 1, 4), 'PNG', `${CARD} must be a PNG`);
assert.equal(png.readUInt32BE(16), 1200, 'social card width must be 1200');
assert.equal(png.readUInt32BE(20), 630, 'social card height must be 630');
assert.ok(png.length <= 300 * 1024, `social card must stay <= 300 KB (is ${png.length} bytes)`);
assert.ok(fs.existsSync(path.join(root, 'docs/assets/ifr_icon_4096_v2.png')), 'official 4096px token icon must remain');

for (const file of ['docs/index.html', 'docs/web3/index.html']) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  for (const tag of [
    `<meta property="og:image" content="${CARD_URL}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta name="twitter:image" content="${CARD_URL}">`,
    '<meta name="twitter:card" content="summary_large_image">',
  ]) assert.ok(html.includes(tag), `${file} is missing ${tag}`);
  assert.ok(!/(og|twitter):image" content="[^"]*ifr_icon_4096/.test(html), `${file} still previews the 4096px icon`);
}
console.log('[social-card] PASS - 1200x630 card (' + Math.round(png.length / 1024) + ' KB) used by Landing and Web3 previews');
