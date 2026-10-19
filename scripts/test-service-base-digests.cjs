const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dockerfiles = [
  'apps/data-api/Dockerfile',
  'apps/points-backend/Dockerfile',
  'apps/telegram/telegram-bot/Dockerfile',
  'apps/benefits-network/backend/Dockerfile',
  'apps/benefits-network/frontend/Dockerfile',
];
const baseImages = new Set();

for (const file of dockerfiles) {
  const dockerfile = fs.readFileSync(path.join(root, file), 'utf8');
  const fromLines = dockerfile.split(/\r?\n/).filter((line) => /^\s*FROM\b/i.test(line));
  assert.ok(fromLines.length > 0, `${file} must contain a FROM line`);
  for (const line of fromLines) {
    const image = line.trim().split(/\s+/)[1] || '';
    assert.match(
      image,
      /^node:22-alpine@sha256:[0-9a-f]{64}$/,
      `${file}: every FROM line must use a digest-pinned node:22-alpine (${line.trim()})`
    );
    baseImages.add(image);
  }
}

assert.equal(baseImages.size, 1, 'All five service Dockerfiles must share one pinned base image digest');
console.log('Service base image digests OK (5 Dockerfiles, one shared digest)');
