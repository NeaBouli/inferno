const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadBallot } = require('../src/forum/ballot');

const appDir = path.resolve(__dirname, '..');
const ballotsDir = path.join(appDir, 'forum-ballots');

test('every bundled ballot manifest loads with a matching proposal text hash', () => {
  const ids = fs.readdirSync(ballotsDir).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5));
  for (const id of ids) {
    const ballot = loadBallot(ballotsDir, id);
    assert.equal(ballot.manifest.ballotId, id);
    assert.notEqual(ballot.manifest.snapshot.height, 0, `${id}: snapshot height must be real chain evidence`);
    assert.ok(fs.existsSync(path.join(ballotsDir, `${id}.md`)), `${id}: proposal text must be bundled`);
  }
});

test('the image bundles both reviewed ballots and reviewed results', () => {
  const dockerfile = fs.readFileSync(path.join(appDir, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /^COPY forum-ballots\/ \.\/forum-ballots\/$/m);
  assert.match(dockerfile, /^COPY forum-results\/ \.\/forum-results\/$/m);
  assert.ok(fs.existsSync(path.join(appDir, 'forum-results')), 'forum-results must exist for the COPY');
});
