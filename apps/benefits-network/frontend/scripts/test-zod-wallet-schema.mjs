import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, realpath, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptsDir, '..');

const cdpSchemaPath = path.join(frontendDir, 'node_modules/@coinbase/cdp-sdk/_esm/policies/evmSchema.js');
const reownSchemaPath = path.join(frontendDir, 'node_modules/@reown/appkit-wallet/dist/esm/src/W3mFrameSchema.js');
const reownConstantsPath = path.join(frontendDir, 'node_modules/@reown/appkit-wallet/dist/esm/src/W3mFrameConstants.js');

// --- static pure-closure inspection before any vendor code executes ---
const importSpecifiers = (source) => [...source.matchAll(/^import\s[^'"]*from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
const forbidden = /\bfetch\b|XMLHttpRequest|WebSocket|\beval\s*\(|(?<![\w$.])import\s*\(|require\s*\(/;

const cdpSchemaSource = await readFile(cdpSchemaPath, 'utf8');
const reownSchemaSource = await readFile(reownSchemaPath, 'utf8');
const reownConstantsSource = await readFile(reownConstantsPath, 'utf8');

assert.deepEqual(importSpecifiers(cdpSchemaSource).sort(), ['abitype/zod', 'zod'], 'CDP evmSchema imports only abitype/zod and zod');
assert.deepEqual(importSpecifiers(reownSchemaSource).sort(), ['./W3mFrameConstants.js', 'zod'], 'Reown W3mFrameSchema imports only zod and its constants');
assert.equal(importSpecifiers(reownConstantsSource).length, 0, 'Reown W3mFrameConstants has no imports');
for (const [name, source] of [['cdp evmSchema', cdpSchemaSource], ['reown W3mFrameSchema', reownSchemaSource], ['reown W3mFrameConstants', reownConstantsSource]]) {
  assert.doesNotMatch(source, forbidden, `${name} closure has no network/eval/dynamic-import constructs`);
}

// --- zod 4.6.7 is the version both consumers actually resolve ---
const rootZodPkg = JSON.parse(await readFile(path.join(frontendDir, 'node_modules/zod/package.json'), 'utf8'));
assert.equal(rootZodPkg.version, '4.6.7', 'root node_modules/zod is 4.6.7');
assert.equal(JSON.parse(await readFile(path.join(frontendDir, 'node_modules/@coinbase/cdp-sdk/package.json'), 'utf8')).version, '1.53.0');
assert.equal(JSON.parse(await readFile(path.join(frontendDir, 'node_modules/@reown/appkit-wallet/package.json'), 'utf8')).version, '1.8.19');

const cdpRequire = createRequire(cdpSchemaPath);
const reownRequire = createRequire(reownSchemaPath);
const zodRootReal = await realpath(path.join(frontendDir, 'node_modules/zod'));
for (const [label, req] of [['cdp', cdpRequire], ['reown', reownRequire]]) {
  const resolved = await realpath(req.resolve('zod'));
  assert.ok(resolved.startsWith(zodRootReal + path.sep), `${label} consumer resolves zod into root 4.6.7 tree, got ${resolved}`);
}
assert.equal(existsSync(path.join(frontendDir, 'node_modules/@reown/appkit-wallet/node_modules/zod')), false, 'no nested zod 3.22.4 remains under @reown/appkit-wallet');

const abitypePkgPath = cdpRequire.resolve('abitype/package.json');
const abitypePkg = JSON.parse(await readFile(abitypePkgPath, 'utf8'));
assert.equal(abitypePkg.version, '1.0.6', 'CDP nested abitype stays 1.0.6');
assert.ok(abitypePkgPath.includes(`@coinbase/cdp-sdk${path.sep}node_modules${path.sep}abitype`), 'abitype resolved from the locked nested CDP path');

// --- CDP policy schema: valid input, array-element control, no throw ---
const { SignEvmTypedDataFieldCriterionSchema } = await import(pathToFileURL(cdpSchemaPath).href);
const validCriterion = {
  type: 'evmTypedDataField',
  types: { types: { Message: [{ name: 'message', type: 'string' }] }, primaryType: 'Message' },
  conditions: [{ match: '.*', path: 'message' }],
};
const validResult = SignEvmTypedDataFieldCriterionSchema.safeParse(validCriterion);
assert.equal(validResult.success, true, 'valid CDP typed-data field criterion passes');

let threw = false;
let invalidResult;
try {
  invalidResult = SignEvmTypedDataFieldCriterionSchema.safeParse({
    ...validCriterion,
    types: { ...validCriterion.types, types: { Message: [{ name: 123, type: 'string' }] } },
  });
} catch (error) {
  threw = true;
}
assert.equal(threw, false, 'invalid CDP input is rejected without throwing');
assert.equal(invalidResult.success, false);
const invalidPaths = invalidResult.error.issues.map((issue) => issue.path);
assert.ok(Array.isArray(invalidResult.error.issues), 'safeParse error exposes a plain issues array');
assert.ok(invalidPaths.some((p) => JSON.stringify(p) === JSON.stringify(['types', 'types', 'Message', 0, 'name'])), `name:123 rejected at ['types','types','Message',0,'name'], got ${JSON.stringify(invalidPaths)}`);

const malformedArrayResult = SignEvmTypedDataFieldCriterionSchema.safeParse({
  ...validCriterion,
  types: { ...validCriterion.types, types: { Message: [{ name: 'message' }] } },
});
assert.equal(malformedArrayResult.success, false, 'tiny malformed array element is rejected');
assert.ok(malformedArrayResult.error.issues.some((issue) => JSON.stringify(issue.path) === JSON.stringify(['types', 'types', 'Message', 0, 'type'])), 'malformed array element reports the missing type path');

// --- Reown W3mFrameSchema: offline safeParse use exactly as W3mFrame.js does ---
const { W3mFrameSchema, AppUpdateEmailRequest, AppSyncThemeRequest } = await import(pathToFileURL(reownSchemaPath).href);
const frameOk = W3mFrameSchema.frameEvent.safeParse({ type: '@w3m-frame/SWITCH_NETWORK_ERROR', payload: { message: 'x' } });
assert.equal(frameOk.success, true, 'valid Reown frame event passes');
let frameThrew = false;
let frameBad;
try {
  frameBad = W3mFrameSchema.frameEvent.safeParse({ type: '@w3m-frame/SWITCH_NETWORK_ERROR', payload: { message: 123 } });
} catch (error) {
  frameThrew = true;
}
assert.equal(frameThrew, false, 'malformed Reown frame event is rejected without throwing');
assert.equal(frameBad.success, false);
assert.equal(frameBad.error.issues[0].code, 'invalid_union', 'union rejection is reported as invalid_union');
assert.equal(typeof frameBad.error.message, 'string', 'error.message stays a plain string as used by W3mFrame.js');

const emailBad = AppUpdateEmailRequest.safeParse({ email: 123 });
assert.equal(emailBad.success, false, 'direct Reown schema rejects a wrong-typed field');
assert.deepEqual(emailBad.error.issues.map((issue) => issue.path), [['email']], 'direct Reown schema reports the exact issue path');
const themeOk = AppSyncThemeRequest.safeParse({ themeMode: 'dark', themeVariables: { a: 'b', c: 1 } });
assert.equal(themeOk.success, true, 'two-argument z.record form works under zod 4.6.7');

console.log(`[zod-wallet-schema] PASS zod=${rootZodPkg.version} abitype=${abitypePkg.version} cdp=1.53.0 reown=1.8.19`);

if (process.argv.includes('--bundle')) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(file);
    }
  }
  await visit(path.join(frontendDir, '.next/static/chunks'));
  assert.ok(files.length > 0, 'production client chunks must exist');
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.ok(!source.includes('/v2/policy-engine/policies') && !source.includes('evmTypedDataField'), `unqualified CDP policy implementation in client chunk: ${path.relative(frontendDir, file)}`);
  }
  console.log(`[zod-wallet-schema] PASS policy boundary across ${files.length} client chunks`);
}
