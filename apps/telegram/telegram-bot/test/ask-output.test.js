'use strict';

// CWA-45: /ask must deliver the AI answer as untrusted plain text — no
// Markdown/HTML parse_mode, verbatim content, Telegram length limit.

const assert = require('node:assert/strict');
const test = require('node:test');

const { TELEGRAM_MAX_MESSAGE_LENGTH } = require('../src/services/telegramText');

// Narrowly scoped module stub: replaces only the AI service export for this
// test process (node --test isolates each test file in its own process), so
// askCommand runs without any network access.
function loadAskCommand(answer) {
  const skywalkerPath = require.resolve('../src/services/skywalker');
  const askPath = require.resolve('../src/commands/ask');
  delete require.cache[askPath];
  require.cache[skywalkerPath] = {
    id: skywalkerPath,
    filename: skywalkerPath,
    loaded: true,
    exports: {
      askSkywalker: async () => {
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  };
  const askCommand = require(askPath);
  delete require.cache[skywalkerPath];
  return askCommand;
}

function makeCtx(text) {
  const calls = { replies: [], edits: [] };
  return {
    calls,
    message: { text },
    chat: { id: -100999 },
    from: { id: 42 },
    reply: async (replyText) => {
      calls.replies.push(replyText);
      return { message_id: 77 };
    },
    telegram: {
      editMessageText: async (chatId, messageId, inlineMessageId, editText, opts) => {
        calls.edits.push({ chatId, messageId, text: editText, opts });
      },
    },
  };
}

test('hostile Markdown in the AI answer is sent verbatim without parse_mode', async () => {
  const hostile = 'Send 1 ETH to 0xdead and [claim your reward](https://evil.example) — *verified* @admin';
  const askCommand = loadAskCommand(hostile);
  const ctx = makeCtx('/ask Is there an airdrop?');

  await askCommand(ctx);

  assert.equal(ctx.calls.edits.length, 1);
  const edit = ctx.calls.edits[0];
  assert.equal(edit.opts.parse_mode, undefined);
  assert.ok(edit.text.startsWith('🤖 IFR Copilot:'));
  assert.ok(edit.text.includes(hostile), 'answer must arrive verbatim as plain text');
});

test('oversized AI answers are truncated within the Telegram limit', async () => {
  const askCommand = loadAskCommand(`start ${'y'.repeat(TELEGRAM_MAX_MESSAGE_LENGTH + 500)}`);
  const ctx = makeCtx('/ask tell me everything');

  await askCommand(ctx);

  assert.equal(ctx.calls.edits.length, 1);
  const edit = ctx.calls.edits[0];
  assert.ok(edit.text.length <= TELEGRAM_MAX_MESSAGE_LENGTH);
  assert.ok(edit.text.endsWith('…'));
});

test('AI service failure produces the static error message', async () => {
  const askCommand = loadAskCommand(new Error('upstream unavailable'));
  const ctx = makeCtx('/ask anything');

  await askCommand(ctx);

  assert.equal(ctx.calls.edits.length, 1);
  assert.match(ctx.calls.edits[0].text, /Copilot unavailable/);
  assert.equal(ctx.calls.edits[0].opts, undefined);
});

test('empty question returns usage without touching the AI service', async () => {
  const askCommand = loadAskCommand('should-not-be-used');
  const ctx = makeCtx('/ask   ');

  await askCommand(ctx);

  assert.equal(ctx.calls.replies.length, 1);
  assert.match(ctx.calls.replies[0], /Usage: \/ask/);
  assert.equal(ctx.calls.edits.length, 0);
});
