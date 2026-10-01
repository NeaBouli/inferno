#!/usr/bin/env node
// Owner policy (2026-09-30): the repository carries one MIT license, and no
// company branding of the operator or personal data (names, private contact
// address) appears in any tracked text file. Forbidden terms are matched by
// SHA-256 of lowercase words and word pairs so this test never stores them.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const FORBIDDEN_HASHES = new Set([
  'df5132aa044e960e746fe824c4a9b7f4eeb4b7171b12eabd0c0a112f40d9504a',
  '6858a5b04beaaed333ae5b1344db767ab2ac5fd326e9e788a1042ad9a05791bf',
  '280001de12ad8327eef2e6f4cdb048817c01601a50ca5327d501d3402def7c45',
  'a7addf2c6e799b2417259e5ea4d6f0b4bc0012da6a37d20058258a61a63e45fb',
  'd5bdd6d052dfcb41386fc253d1c2b3ca379412dfedfae0ee06c215362d1dadf8',
  'd4831988b3d5d36d68f38e4f286621de1070480852d5b1c58764b65fd347262a',
  '453b66711d20016239503350819c1c8e0b619f2f841658b47b64d6b968e81cc8'
]);
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

// --- license consistency (CWA-21) ---------------------------------------------
const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
assert.match(license, /^MIT License\n/, 'LICENSE must be the MIT License');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
assert.match(readme, /\[MIT License\]\(LICENSE\)/, 'README must point to the MIT LICENSE');
for (const file of ['README.md', 'docs/index.html', 'docs/web3/index.html']) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  assert.ok(!/all rights reserved/i.test(text), `${file} contradicts the MIT license`);
}
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
for (const file of tracked.filter((f) => f.endsWith('.sol'))) {
  const spdx = fs.readFileSync(path.join(root, file), 'utf8').match(/SPDX-License-Identifier:\s*(\S+)/);
  assert.ok(spdx && spdx[1] === 'MIT', `${file} must declare SPDX MIT`);
}

// --- no operator branding or personal data --------------------------------------
const hits = [];
for (const file of tracked) {
  const full = path.join(root, file);
  let stat;
  try { stat = fs.lstatSync(full); } catch { continue; }
  if (!stat.isFile() || stat.size > 5 * 1024 * 1024) continue;
  const buf = fs.readFileSync(full);
  if (buf.includes(0)) continue; // binary
  const words = buf.toString('utf8').toLowerCase().match(/[a-z]+/g) || [];
  for (let i = 0; i < words.length; i += 1) {
    if (FORBIDDEN_HASHES.has(sha(words[i])) ||
        (i + 1 < words.length && FORBIDDEN_HASHES.has(sha(`${words[i]} ${words[i + 1]}`)))) {
      hits.push(file);
      break;
    }
  }
}
assert.deepEqual(hits, [], `operator branding or personal data found in: ${hits.join(', ')}`);

// --- footer contact is click-to-reveal only -------------------------------------
const landing = fs.readFileSync(path.join(root, 'docs/index.html'), 'utf8');
assert.ok(/id="ifr-core-contact"[^>]*>Core Dev Contact</.test(landing), 'footer shows only "Core Dev Contact"');
assert.ok(/data-nosnippet/.test(landing), 'footer contact paragraph is excluded from search snippets');
assert.ok(!/mailto:[^"'\s]+@/.test(landing), 'no literal mailto address in the Landing source');

console.log(`[license-privacy] PASS - MIT license consistent; ${tracked.length} tracked files free of operator branding and personal data`);
