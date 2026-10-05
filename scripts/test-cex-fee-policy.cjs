'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

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
  'No CEX address activated as of 26 August 2026',
  'Open Council Agenda: Exchange Participation',
  'no proposer attribution or personal name',
  'These figures are agenda ceilings, not allocations',
  'no exchange voting seat',
  'signer or execution access in return for listing'
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
  'The IFR/WETH pair is fee-exempt; the Uniswap V2 router is not',
  'governance.html#council-agenda'
]);

requireText('docs/wiki/governance.html', [
  'id="council-agenda"',
  'Status: EX-01 approved on 4 October 2026; EX-02 open.',
  'council-votes.html',
  'Agenda entries contain no proposer attribution or personal name',
  'No IFR is allocated',
  'proposed agenda ceilings, not allocations',
  'no voting seat and no TreasurySafe signer or execution access',
  'EIP-1271',
  'Open and secret ballots are separate modes',
  'one-time nullifiers',
  'retain no source IP',
  'cannot honestly promise that an IP address is never seen',
  'Future signer onboarding must obtain explicit consent',
  'Separate TreasurySafe 3-of-5 action after Timelock',
  'No key custody, no backend executor and no automatic TreasurySafe/Governance action'
]);

requireText('docs/GOVERNANCE_SIGNER_EXPANSION_PLAN.md', [
  'Publication consent',
  'initials-to-wallet mapping'
]);

requireText('docs/wiki/community-signer-expansion.html', [
  'Publication consent',
  'initials may be linked publicly to the signer wallet',
  'Safe ownership remains public on-chain regardless'
]);

requireText('docs/OFFCHAIN_SECURITY.md', [
  'Council secret-ballot portal is a separate privacy domain',
  'retain no source IP, user-agent, request body, ballot or',
  'wallet providers may still process connection',
  'metadata transiently'
]);

requireText('docs/social/telegram-council-exchange-agenda.md', [
  'undated discussion draft',
  'Agenda entries contain no proposer attribution or personal name',
  'No vote is open, no IFR is allocated',
  '0 voting seats and 0 TreasurySafe signer rights',
  'Social cashtag: $IFRp'
]);

const forbiddenAttributionPatterns = [
  /\b(?:proposed|submitted|prepared|written|authored)\s+by\b/i,
  /^\s*(?:author|proposer|submitter)\s*:/im,
  /\bcodex\b/i,
  /\bkimi\b/i,
  /\bclaude\b/i
];

// Personal names are matched by SHA-256 of lowercase words and word pairs so the
// names themselves never appear in the repository.
const FORBIDDEN_NAME_HASHES = new Set([
  'a7addf2c6e799b2417259e5ea4d6f0b4bc0012da6a37d20058258a61a63e45fb',
  'd5bdd6d052dfcb41386fc253d1c2b3ca379412dfedfae0ee06c215362d1dadf8'
]);

function containsForbiddenName(text) {
  const words = String(text).toLowerCase().match(/[a-z]+/g) || [];
  for (let i = 0; i < words.length; i += 1) {
    const candidates = [words[i]];
    if (i + 1 < words.length) candidates.push(`${words[i]} ${words[i + 1]}`);
    for (const candidate of candidates) {
      const digest = require('node:crypto').createHash('sha256').update(candidate).digest('hex');
      if (FORBIDDEN_NAME_HASHES.has(digest)) return true;
    }
  }
  return false;
}

function assertNoAttribution(file, source) {
  for (const pattern of forbiddenAttributionPatterns) {
    if (pattern.test(source)) {
      throw new Error(`${file} attributes a Council agenda proposal: ${pattern}`);
    }
  }
  if (containsForbiddenName(source)) {
    throw new Error(`${file} names a person in a Council agenda proposal`);
  }
}

const agendaSources = {
  'docs/EXCHANGE_FEE_EXEMPTION_POLICY.md': read('docs/EXCHANGE_FEE_EXEMPTION_POLICY.md').split('## Open Council Agenda:')[1],
  'docs/wiki/governance.html': read('docs/wiki/governance.html').split('id="council-agenda"')[1].split('id="participating"')[0],
  'docs/social/telegram-council-exchange-agenda.md': read('docs/social/telegram-council-exchange-agenda.md')
};
for (const [file, source] of Object.entries(agendaSources)) {
  assertNoAttribution(file, source);
}

for (const fixture of [
  'pRoPoSeD bY Example Person',
  'AUTHOR: Example Person',
  'Prepared by Example Person',
  'submitted BY Example Person'
]) {
  assert.throws(
    () => assertNoAttribution('fixture', fixture),
    /attributes a Council agenda proposal/
  );
}
// Personal names are hash-matched; the fixture is built from char codes so no name is stored.
assert.throws(
  () => assertNoAttribution('fixture', `Council note from ${String.fromCharCode(71,105,111,32,77,97,114,105,111)}`),
  /names a person/
);

requireText('docs/GOVERNANCE_CONSTITUTION.md', [
  'Governance Constitution v1.1',
  'senderBurnBps',
  'recipientBurnBps',
  'TreasurySafe 3-of-5',
  'Governance owner calls `governance.propose(target, data)`',
  'can call `cancel(proposalId)` until the proposal',
  '4-of-7 community signer expansion is planned, not active'
]);

for (const obsolete of [
  'Burn rate, max fee, supply are never changeable',
  'After ETA: anyone can call `execute()` (permissionless)',
  '### Owner Multisig (4-of-7)'
]) {
  if (read('docs/GOVERNANCE_CONSTITUTION.md').includes(obsolete)) {
    throw new Error(`docs/GOVERNANCE_CONSTITUTION.md still contains obsolete governance text: ${obsolete}`);
  }
}

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
  'docs/FEE_DESIGN.md',
  'docs/ROADMAP.md',
  'docs/web3/index.html',
  'docs/wiki/faq.html',
  'docs/wiki/fee-design.html',
  'docs/wiki/roadmap.html',
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

function hasObsoleteSlippageGuidance(source) {
  return source.split(/\r?\n/).some((line) => {
    const plain = line.replace(/<[^>]+>/g, ' ');
    if (/\b(?:no|not)\s+(?:fixed\s+)?4%/i.test(plain)) return false;
    return /4%[^\n]{0,100}3\.5%[^\n]{0,30}fee/i.test(plain)
      || /3\.5%[^\n]{0,30}fee[^\n]{0,100}4%[^\n]{0,30}slippage/i.test(plain);
  });
}

assert.equal(hasObsoleteSlippageGuidance('Set 4% because of the 3.5% fee.'), true);
assert.equal(hasObsoleteSlippageGuidance('The 3.5% fee requires 4% slippage.'), true);
assert.equal(hasObsoleteSlippageGuidance('There is no fixed 4% token-fee minimum.'), false);

for (const file of ['docs/FEE_DESIGN.md', 'docs/wiki/fee-design.html', 'docs/wiki/faq.html']) {
  if (hasObsoleteSlippageGuidance(read(file))) {
    throw new Error(`${file} still derives a 4% Uniswap slippage setting from the 3.5% token fee`);
  }
}

console.log('CEX fee-exemption policy consistency: PASS');
