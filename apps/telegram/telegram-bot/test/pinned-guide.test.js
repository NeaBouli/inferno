'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ensurePinnedGuide, VERIFY_GUIDE_TEXT } = require('../src/services/pinnedGuide');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinned-guide-'));
  const sends = [];
  const pins = [];
  const telegram = {
    async pinChatMessage(chatId, messageId, opts) { pins.push({ chatId, messageId, opts }); },
  };
  const send = async (tg, chatId, category, text, extra) => {
    sends.push({ chatId, category, text, extra });
    return { message_id: 4242 };
  };
  return { dir, markerPath: path.join(dir, 'pinned-guides.json'), sends, pins, telegram, send };
}

test('posts the guide to General once, pins it silently and records the marker', async () => {
  const f = fixture();
  const opts = { chatId: '-100123', markerPath: f.markerPath, send: f.send };
  assert.equal(await ensurePinnedGuide(f.telegram, opts), 'posted');
  assert.equal(f.sends.length, 1);
  assert.equal(f.sends[0].category, 'general');
  assert.equal(f.sends[0].text, VERIFY_GUIDE_TEXT);
  assert.equal(f.sends[0].extra.parse_mode, undefined, 'plain text, no parse_mode');
  assert.deepEqual(f.pins, [{ chatId: '-100123', messageId: 4242, opts: { disable_notification: true } }]);
  const marker = JSON.parse(fs.readFileSync(f.markerPath, 'utf8'));
  assert.equal(marker['verify-guide-v1'].messageId, 4242);
  assert.equal(marker['verify-guide-v1'].pinned, true);
  assert.equal(fs.statSync(f.markerPath).mode & 0o777, 0o600);

  // Restart: nothing is posted again.
  assert.equal(await ensurePinnedGuide(f.telegram, opts), 'already-posted');
  assert.equal(f.sends.length, 1);
  assert.equal(f.pins.length, 1);
});

test('missing chat id or non-writable marker dir posts nothing', async () => {
  const f = fixture();
  assert.equal(await ensurePinnedGuide(f.telegram, { chatId: '', markerPath: f.markerPath, send: f.send }), 'skipped');
  const missingDir = path.join(f.dir, 'does-not-exist', 'pinned-guides.json');
  assert.equal(await ensurePinnedGuide(f.telegram, { chatId: '-100123', markerPath: missingDir, send: f.send }), 'skipped');
  assert.equal(f.sends.length, 0);
});

test('a pin failure still records the post, so it is never reposted', async () => {
  const f = fixture();
  f.telegram.pinChatMessage = async () => { const e = new Error('no rights'); e.response = { error_code: 400 }; throw e; };
  const opts = { chatId: '-100123', markerPath: f.markerPath, send: f.send };
  assert.equal(await ensurePinnedGuide(f.telegram, opts), 'posted');
  assert.equal(JSON.parse(fs.readFileSync(f.markerPath, 'utf8'))['verify-guide-v1'].pinned, false);
  assert.equal(await ensurePinnedGuide(f.telegram, opts), 'already-posted');
  assert.equal(f.sends.length, 1);
});

test('a send failure leaves no marker and never throws', async () => {
  const f = fixture();
  const send = async () => { const e = new Error('boom'); e.response = { error_code: 500 }; throw e; };
  assert.equal(await ensurePinnedGuide(f.telegram, { chatId: '-100123', markerPath: f.markerPath, send }), 'skipped');
  assert.equal(fs.existsSync(f.markerPath), false);
});

test('a corrupt marker file posts nothing', async () => {
  const f = fixture();
  fs.writeFileSync(f.markerPath, '{not json');
  assert.equal(await ensurePinnedGuide(f.telegram, { chatId: '-100123', markerPath: f.markerPath, send: f.send }), 'skipped');
  assert.equal(f.sends.length, 0);
});

test('guide text stays within Telegram limits and only links allowed hosts', () => {
  assert.ok(VERIFY_GUIDE_TEXT.length < 4096);
  const urls = VERIFY_GUIDE_TEXT.match(/https?:\/\/[^\s]+/g) || [];
  assert.deepEqual(urls, ['https://ifrunit.tech/wiki/verify.html']);
});
