import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import harness from './api-harness.cjs';

const source = await readFile(new URL('../server/index.ts', import.meta.url), 'utf8');
const route = source.match(/app\.get\("\/api\/health"[\s\S]*?\n\}\);/)?.[0];
assert.ok(route, 'GET /api/health must exist');
for (const forbidden of ['apiKeySet', 'etherscanKeySet', 'version', 'process.env']) {
  assert.ok(!route.includes(forbidden), `health must not disclose ${forbidden}`);
}
const response = await harness.request(harness.loadApp(), 'GET', '/api/health');
assert.equal(response.status, 200);
assert.deepEqual(JSON.parse(response.body), { status: 'ok' });
console.log('Data API health-shape regression passed (shipping handler, no listener).');
