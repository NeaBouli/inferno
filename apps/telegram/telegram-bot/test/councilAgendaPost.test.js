'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { confirmationCode, publish, validateText } = require('../scripts/post-council-agenda');

const TEXT = 'COUNCIL AGENDA\n\nOption A: no Safe rights.\nOption B: advisory role only.';

test('validates anonymous bounded text', () => {
  assert.doesNotThrow(() => validateText(TEXT));
  assert.throws(() => validateText('Proposed by Alice'), /proposer attribution/);
  assert.throws(() => validateText('pRoPoSeD bY Alice'), /proposer attribution/);
  assert.throws(() => validateText('AUTHOR: Alice'), /proposer attribution/);
  assert.throws(() => validateText('x'.repeat(4097)), /4096-character limit/);
});

test('defaults to dry-run without network access', async () => {
  const result = await publish({
    text: TEXT,
    env: {},
    fetchImpl: async () => { throw new Error('network must not be called'); }
  });
  assert.deepEqual(result, {
    live: false,
    confirmation: confirmationCode(TEXT),
    length: TEXT.length
  });
});

test('requires exact confirmation before a live post', async () => {
  await assert.rejects(
    publish({
      text: TEXT,
      env: {
        TELEGRAM_ALLOW_LIVE: 'true',
        BOT_TOKEN: 'test-token',
        TELEGRAM_GROUP_ID: '-1001',
        TELEGRAM_COUNCIL_TOPIC_ID: '21',
        TELEGRAM_POST_CONFIRM: 'wrong'
      }
    }),
    /Exact text confirmation required/
  );
});

test('targets only the configured Council thread', async () => {
  let request;
  const result = await publish({
    text: TEXT,
    env: {
      TELEGRAM_ALLOW_LIVE: 'true',
      BOT_TOKEN: 'test-token',
      TELEGRAM_GROUP_ID: '-1001',
      TELEGRAM_COUNCIL_TOPIC_ID: '21',
      TELEGRAM_POST_CONFIRM: confirmationCode(TEXT)
    },
    fetchImpl: async (url, options) => {
      request = { url, body: JSON.parse(options.body) };
      return {
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 42 } })
      };
    }
  });

  assert.equal(request.body.chat_id, '-1001');
  assert.equal(request.body.message_thread_id, 21);
  assert.equal(request.body.text, TEXT);
  assert.match(request.url, /^https:\/\/api\.telegram\.org\/bottest-token\/sendMessage$/);
  assert.equal(result.messageId, 42);
  assert.equal(result.topicId, 21);
});
