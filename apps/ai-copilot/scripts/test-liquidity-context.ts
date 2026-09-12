import assert from 'node:assert/strict';
import { loadWikiDocs, buildSystemPrompt } from '../server/wiki-rag';
import { getIFRKnowledge } from '../src/context/ifr-knowledge';
const docs = loadWikiDocs('../../../docs/wiki');
for (const mode of ['explorer', 'user', 'dev', 'customer', 'partner', 'developer']) {
  const prompt = buildSystemPrompt('Base policy', mode, docs);
  assert.ok(prompt.includes('wiki/liquidity'), mode);
  assert.ok(prompt.includes('source page(s) that actually support each claim'), mode);
  assert.ok(prompt.includes('Do not automatically cite the first document'), mode);
  assert.ok(!prompt.includes('cite the specific wiki page: "Source:'), mode);
  for (const risk of ['impermanent loss', 'router', 'read-only']) assert.ok(prompt.includes(risk), mode + ': ' + risk);
}
const knowledge = getIFRKnowledge().userProvidedLiquidity;
assert.ok(knowledge.guide.endsWith('/wiki/liquidity.html'));
assert.ok(knowledge.execution.includes('Approval alone is not a deposit'));
assert.ok(knowledge.withdrawal.includes('second hop may be taxed'));
console.log('PASS: liquidity context is present across all six Copilot modes; no model calls');
