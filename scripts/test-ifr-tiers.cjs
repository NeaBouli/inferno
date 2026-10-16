#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const canonical = JSON.parse(read('docs/specs/ifr-benefits-tiers.v1.json'));
const expected = canonical.tiers.map((tier) => [tier.label.toLowerCase(), tier.minIFR]);

// Read only the declared data literal, without booting apps, providers or wallet flows.
function literal(file, name, context = {}, object = false) {
  const body = object ? '(\\{[\\s\\S]*?\\n\\})' : '(\\[[\\s\\S]*?\\])';
  const match = read(file).match(new RegExp(`\\b${name}[^=;\\n]*=\\s*(?:Object.freeze\\()?${body}(?:\\))?(?:\\s+as const)?;`));
  assert.ok(match, `${file}: cannot find ${name}; update the tier consistency reader if its format changed`);
  return JSON.parse(JSON.stringify(vm.runInNewContext(`(${match[1].replace(/\s+as const\b/g, '')})`, context, { timeout: 1000 })));
}

function checkPreset(file, tiers, label, amount) {
  assert.deepEqual(tiers.map((tier) => [tier[label].toLowerCase(), String(tier[amount])]), expected, file);
  if (tiers.every((tier) => typeof tier.key === 'string')) {
    assert.deepEqual(tiers.map((tier) => tier.key.toLowerCase()), canonical.tiers.map((tier) => tier.key.toLowerCase()), `${file}: tier keys`);
  }
}

function checkTable(file) {
  const source = read(file);
  const rows = file.endsWith('.html')
    ? [...source.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((row) =>
      [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cell[1].replace(/<[^>]*>/g, '').trim()))
    : source.split('\n').filter((row) => row.startsWith('|')).map((row) =>
      row.split('|').slice(1, -1).map((cell) => cell.replace(/`/g, '').trim()));
  const tiers = rows.filter((cells) => /^(bronze|silver|gold|platinum)$/i.test(cells[0]));
  assert.equal(tiers.length, expected.length, `${file}: tier table is missing or has extra rows`);
  assert.deepEqual(tiers.map((cells) => {
    const amount = cells.find((cell) => /^[\d,]+(?:\s|$)/.test(cell));
    assert.ok(amount, `${file}: missing tier threshold`);
    return [cells[0].toLowerCase(), amount.match(/^[\d,]+/)[0].replaceAll(',', '')];
  }), expected, file);
  for (const [index, cells] of tiers.entries()) {
    const baseUnitColumn = file === 'docs/wiki/integration.html' ? 2
      : file === 'docs/specs/ifr-benefits-verify-1.md' ? 3 : null;
    if (baseUnitColumn !== null) {
      assert.equal(cells[baseUnitColumn], canonical.tiers[index].minBaseUnits, `${file}: base units`);
    }
  }
}

function checkInline(file, source = read(file)) {
  for (const tier of canonical.tiers) {
    const matches = [...source.matchAll(new RegExp(`\\b${tier.label}\\s+([\\d,]+)\\b`, 'gi'))];
    assert.ok(matches.length, `${file}: missing ${tier.label} threshold`);
    for (const match of matches) assert.equal(match[1].replaceAll(',', ''), tier.minIFR, `${file}: ${tier.label}`);
  }
}

async function main() {
  assert.equal(canonical.decimals, 9);
  let previous = 0n;
  for (const tier of canonical.tiers) {
    assert.match(tier.minIFR, /^[1-9]\d*$/);
    const raw = BigInt(tier.minBaseUnits);
    assert.equal(raw, BigInt(tier.minIFR) * 10n ** 9n);
    assert.ok(raw > previous, 'canonical thresholds must strictly increase');
    previous = raw;
  }
  execFileSync(process.execPath, [path.join(__dirname, 'sync-ifr-tiers.cjs')], { stdio: 'pipe' });

  assert.deepEqual(literal('apps/benefits-verify/src/index.ts', 'TIER_FILE_V1', { SPEC_ID: canonical.spec }, true), canonical);
  assert.deepEqual(literal('apps/benefits-verify/dist/index.js', 'TIER_FILE_V1', { exports: { SPEC_ID: canonical.spec } }, true), canonical);
  const digest = crypto.createHash('sha256').update(read('docs/specs/ifr-benefits-tiers.v1.json')).digest('hex');
  for (const file of ['apps/benefits-verify/src/index.ts', 'apps/benefits-verify/dist/index.js']) {
    assert.equal(literal(file, 'TIER_FILE_SHA256', {}, true)[1], digest, `${file}: published hash`);
  }
  checkPreset('SDK source', literal('apps/sdk/src/index.ts', 'DEFAULT_TIERS'), 'name', 'minLocked');
  checkPreset('SDK dist', literal('apps/sdk/dist/index.js', 'DEFAULT_TIERS'), 'name', 'minLocked');
  checkPreset('Copilot policy', literal('apps/ai-copilot/src/context/copilot-policy.ts', 'ACCESS_TIERS'), 'name', 'minIFR');
  checkPreset('dashboard', literal('apps/dashboard/src/components/LockPanel.jsx', 'TIERS'), 'name', 'min');
  checkPreset('wallet guide', literal('apps/benefits-network/frontend/src/components/WalletStatus.tsx', 'BENEFIT_TIERS'), 'label', 'amount');
  checkPreset('widget', literal('docs/widget/ifr-benefits-widget.js', 'TIER_PRESETS'), 'label', 'amount');

  const { benefitTierDefaults } = await import(pathToFileURL(path.join(root, 'apps/benefits-network/frontend/src/lib/benefitTierDefaults.mjs')));
  checkPreset('Benefits form defaults', benefitTierDefaults, 'label', 'minLocked');
  const seller = 'apps/benefits-network/frontend/src/components/SellerRuleBuilder.tsx';
  checkPreset('Benefits starter templates', literal(seller, 'ruleTemplates', { benefitTierDefaults }), 'label', 'minLocked');
  const draft = literal(seller, 'DEFAULT_RULE_DRAFT', { benefitTierDefaults, categories: ['Coffee'] }, true);
  assert.equal(draft.label, canonical.tiers[0].label);
  assert.equal(String(draft.minLocked), canonical.tiers[0].minIFR);
  assert.match(read(seller), /Your changes are partner overrides/);

  for (const file of [
    'docs/wiki/business-onboarding.html', 'docs/wiki/lock-mechanism.html',
    'docs/wiki/integration.html', 'docs/wiki/press-kit.html',
    'docs/BUSINESS_ONBOARDING.md', 'docs/BENEFITS_NETWORK_TEST.md',
    'docs/TOKENOMICS_MODEL.md', 'docs/PRESS_KIT.md',
    'docs/specs/ifr-benefits-verify-1.md', 'apps/benefits-verify/README.md',
  ]) checkTable(file);
  checkPreset('SDK quickstart', Object.values(literal('docs/SDK_QUICKSTART.md', 'TIERS', {}, true)), 'label', 'minIFR');
  for (const file of ['apps/sdk/README.md', 'docs/llms.txt', 'docs/wiki/integrate-benefits.html', 'docs/IFR_TIERS.md']) checkInline(file);
  for (const tier of canonical.tiers) {
    assert.ok(read('docs/WHITEPAPER.md').includes(`${tier.label}: ${BigInt(tier.minIFR).toLocaleString('en-US')} IFR`));
  }
  const knowledge = read('apps/ai-copilot/src/context/ifr-knowledge.ts');
  assert.match(knowledge, /import \{ ACCESS_TIERS, ACCESS_TIER_SUMMARY \} from "\.\/copilot-policy"/);
  assert.match(knowledge, /\[bronzeTier, silverTier, goldTier, platinumTier\] = ACCESS_TIERS/);
  for (const name of ['bronze', 'silver', 'gold', 'platinum']) {
    assert.ok(knowledge.includes(`minIFR: ${name}Tier.minIFR, level: ${name}Tier.name`), `Copilot knowledge must derive ${name} from policy`);
  }
  const prompts = read('apps/ai-copilot/src/context/system-prompts.ts');
  assert.match(prompts, /import \{ ACCESS_TIER_SUMMARY \} from "\.\/copilot-policy"/);
  assert.ok(prompts.includes('${ACCESS_TIER_SUMMARY}'), 'Copilot prompts must use the derived summary');
  const rag = JSON.parse(read('apps/ai-copilot/src/context/wiki-content.json'));
  const integrationGuide = rag.find((page) => page.slug === 'integrate-benefits');
  assert.ok(integrationGuide, 'Copilot RAG must include the Benefits integration guide');
  checkInline('Copilot RAG integrate-benefits', integrationGuide.content);
  const tierPages = rag.filter((page) => /\bBronze\s+[\d,]+\b/i.test(page.content));
  assert.ok(tierPages.length, 'Copilot RAG must include tier documentation');
  for (const page of tierPages) checkInline(`Copilot RAG ${page.slug}`, page.content);
  // Telegram roles, legacy SDK/Builder tiers and the unresolved wizard conflict are inventoried
  // in docs/IFR_TIERS.md. They are separate policies, not copies of this Benefits preset.
  console.log('[ifr-tiers] PASS canonical data, app/package copies, starter defaults, Wiki, docs and Copilot RAG');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
