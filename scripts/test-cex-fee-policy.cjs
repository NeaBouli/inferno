'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function requireText(file, snippets) {
  const source = read(file);
  for (const snippet of snippets) {
    if (!source.includes(snippet)) {
      throw new Error(`${file} is missing required CEX policy text: ${snippet}`);
    }
  }
}

requireText('docs/EXCHANGE_FEE_EXEMPTION_POLICY.md', [
  'No centralized-exchange address is currently',
  '00:17 MET, by a 4-1 vote',
  'TreasurySafe 3-of-5',
  '48-hour timelock',
  'setFeeExempt(exchangeAddress, true)',
  'No CEX address activated as of 26 August 2026'
]);

requireText('docs/index.html', [
  'Exchange fee policy approved',
  '26.08.2026 at 00:17 MET by a 4-1 vote',
  'five-member Core Developer and Keyholder Council',
  'wiki/fee-design.html#cex-fee-policy',
  'No CEX address is currently active'
]);

requireText('docs/wiki/fee-design.html', [
  'id="cex-fee-policy"',
  'CEX Fee-Exemption Policy',
  'approved 26.08.2026 at 00:17 MET by a 4-1 vote',
  'sender or recipient bypasses the complete 3.5% fee',
  'No CEX address is currently fee-exempt on-chain',
  'The IFR/WETH pair is fee-exempt; the Uniswap V2 router is not'
]);

requireText('docs/wiki/faq.html', [
  'Are transfers to and from centralized exchanges burn-free?',
  'official address verification, proof of control',
  'no CEX address is currently active'
]);

requireText('docs/WHITEPAPER.md', [
  'Exchange Fee-Exemption Policy',
  'No CEX address is currently active on-chain'
]);

requireText('apps/ai-copilot/src/context/ifr-knowledge.ts', [
  'exchangeFeePolicy',
  '26 August 2026 at 00:17 MET by a 4-1 vote',
  'No CEX address is currently fee-exempt on-chain'
]);

requireText('docs/social/telegram-cex-fee-policy.md', [
  '26 August 2026 at 00:17 MET',
  '4-1 vote',
  'no CEX address is fee-exempt yet',
  'Social cashtag: $IFRp'
]);

const currentPublicSurfaces = [
  'docs/index.html',
  'docs/WHITEPAPER.md',
  'docs/llms.txt',
  'docs/TOKENOMICS_MODEL.md',
  'docs/ONE-PAGER.md',
  'docs/web3/index.html',
  'docs/wiki/faq.html',
  'docs/wiki/transparency.html',
  'docs/wiki/protocol-plan.html',
  'docs/wiki/press-kit.html',
  'docs/wiki/one-pager.html'
];

for (const file of currentPublicSurfaces) {
  const source = read(file);
  const forbidden = [
    /Every transfer permanently burns/i,
    /Every IFR transfer automatically burns/i,
    /2\.5% of every transfer/i,
    /1% of every transfer/i
  ];
  for (const pattern of forbidden) {
    if (pattern.test(source)) {
      throw new Error(`${file} still presents the transfer fee as universal: ${pattern}`);
    }
  }
}

for (const file of ['docs/FEE_DESIGN.md', 'docs/wiki/fee-design.html', 'docs/wiki/faq.html']) {
  const source = read(file);
  if (/4%[^\n<]{0,80}3\.5% fee/i.test(source)) {
    throw new Error(`${file} still derives a 4% Uniswap slippage setting from the 3.5% token fee`);
  }
}

console.log('CEX fee-exemption policy consistency: PASS');
