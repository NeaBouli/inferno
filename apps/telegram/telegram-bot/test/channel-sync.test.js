'use strict';

// CWA-45: channel → community auto-sync + auto-pin trusts only the explicitly
// configured official channel; unknown, forwarded/spoofed or metadata-less
// sources fail closed, and reposted content goes out as plain text.

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  handleChannelPost, isTrustedChannelPost,
} = require('../src/handlers/channelSync');
const { TELEGRAM_MAX_MESSAGE_LENGTH } = require('../src/services/telegramText');

const OFFICIAL_CHANNEL_ID = '-1001234567890';

function setEnv(overrides) {
  const saved = {};
  const keys = ['TELEGRAM_CHANNEL_ID', 'TELEGRAM_GROUP_ID', 'TELEGRAM_ANNOUNCEMENTS_TOPIC_ID'];
  for (const key of keys) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  return () => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
}

function makeCtx(post, { pinFails = false } = {}) {
  const calls = { sent: [], pinned: [] };
  return {
    calls,
    channelPost: post,
    telegram: {
      sendMessage: async (chatId, text, opts) => {
        calls.sent.push({ chatId, text, opts });
        return { message_id: 4242 };
      },
      pinChatMessage: async (chatId, messageId, opts) => {
        if (pinFails) throw new Error('not enough rights');
        calls.pinned.push({ chatId, messageId, opts });
      },
    },
  };
}

function trustedPost(overrides = {}) {
  return {
    chat: { id: Number(OFFICIAL_CHANNEL_ID), type: 'channel', username: 'IFRtoken' },
    sender_chat: { id: Number(OFFICIAL_CHANNEL_ID), type: 'channel' },
    message_id: 10,
    text: 'Hello community',
    ...overrides,
  };
}

const BASE_ENV = { TELEGRAM_CHANNEL_ID: OFFICIAL_CHANNEL_ID, TELEGRAM_GROUP_ID: '-100999' };

// ── Positive: trusted source reaches the community and gets pinned ───────────

test('trusted channel post (numeric id) is reposted as plain text and pinned', async () => {
  const restore = setEnv(BASE_ENV);
  try {
    const ctx = makeCtx(trustedPost());
    await handleChannelPost(ctx);

    assert.equal(ctx.calls.sent.length, 1);
    const sent = ctx.calls.sent[0];
    assert.equal(sent.chatId, '-100999');
    assert.ok(sent.text.includes('Hello community'));
    assert.equal(sent.opts.parse_mode, undefined);
    assert.equal(sent.opts.disable_web_page_preview, true);

    assert.deepEqual(ctx.calls.pinned, [
      { chatId: '-100999', messageId: 4242, opts: { disable_notification: true } },
    ]);
  } finally {
    restore();
  }
});

test('trusted channel post (@username config, case-insensitive) is accepted', async () => {
  const restore = setEnv({ ...BASE_ENV, TELEGRAM_CHANNEL_ID: '@IFRtoken' });
  try {
    const ctx = makeCtx(trustedPost({
      chat: { id: -100777, type: 'channel', username: 'ifrTOKEN' },
      sender_chat: { id: -100777, type: 'channel' },
    }));
    await handleChannelPost(ctx);
    assert.equal(ctx.calls.sent.length, 1);
    assert.equal(ctx.calls.pinned.length, 1);
  } finally {
    restore();
  }
});

test('caption-only posts sync; topic id is honored when configured', async () => {
  const restore = setEnv({ ...BASE_ENV, TELEGRAM_ANNOUNCEMENTS_TOPIC_ID: '7' });
  try {
    const ctx = makeCtx(trustedPost({ text: undefined, caption: 'Chart release' }));
    await handleChannelPost(ctx);
    assert.equal(ctx.calls.sent.length, 1);
    assert.ok(ctx.calls.sent[0].text.includes('Chart release'));
    assert.equal(ctx.calls.sent[0].opts.message_thread_id, 7);
  } finally {
    restore();
  }
});

// ── Negative: untrusted sources fail closed — no send, no pin ────────────────

test('missing TELEGRAM_CHANNEL_ID or TELEGRAM_GROUP_ID disables sync and pin', async () => {
  for (const env of [
    { TELEGRAM_GROUP_ID: '-100999' }, // channel unset
    { TELEGRAM_CHANNEL_ID: OFFICIAL_CHANNEL_ID }, // group unset
    {}, // both unset
  ]) {
    const restore = setEnv(env);
    try {
      const ctx = makeCtx(trustedPost());
      await handleChannelPost(ctx);
      assert.equal(ctx.calls.sent.length, 0);
      assert.equal(ctx.calls.pinned.length, 0);
    } finally {
      restore();
    }
  }
});

test('unknown channel chat id is dropped', async () => {
  const restore = setEnv(BASE_ENV);
  try {
    const ctx = makeCtx(trustedPost({
      chat: { id: -100666, type: 'channel', username: 'IFRtoken' },
      sender_chat: { id: -100666 },
    }));
    await handleChannelPost(ctx);
    assert.equal(ctx.calls.sent.length, 0);
    assert.equal(ctx.calls.pinned.length, 0);
  } finally {
    restore();
  }
});

test('username spoof does not pass a numeric-id config', async () => {
  const restore = setEnv(BASE_ENV);
  try {
    // Real username of the official channel, but a different chat id: the
    // numeric config must compare ids, never usernames.
    const ctx = makeCtx(trustedPost({
      chat: { id: -100666, type: 'channel', username: 'IFRtoken' },
      sender_chat: { id: -100666, type: 'channel' },
    }));
    await handleChannelPost(ctx);
    assert.equal(ctx.calls.sent.length, 0);
  } finally {
    restore();
  }
});

test('forwarded or relayed posts are dropped', async () => {
  const restore = setEnv(BASE_ENV);
  try {
    for (const marker of [
      { is_automatic_forward: true },
      { forward_origin: { type: 'channel', chat: { id: Number(OFFICIAL_CHANNEL_ID) } } },
      { forward_from_chat: { id: Number(OFFICIAL_CHANNEL_ID) } },
      { forward_from: { id: 123 } },
    ]) {
      const ctx = makeCtx(trustedPost(marker));
      await handleChannelPost(ctx);
      assert.equal(ctx.calls.sent.length, 0, JSON.stringify(marker));
      assert.equal(ctx.calls.pinned.length, 0, JSON.stringify(marker));
    }
  } finally {
    restore();
  }
});

test('posts sent on behalf of a foreign chat are dropped', async () => {
  const restore = setEnv(BASE_ENV);
  try {
    const ctx = makeCtx(trustedPost({ sender_chat: { id: -100555, type: 'channel' } }));
    await handleChannelPost(ctx);
    assert.equal(ctx.calls.sent.length, 0);
    assert.equal(ctx.calls.pinned.length, 0);
  } finally {
    restore();
  }
});

test('missing source metadata fails closed', async () => {
  const restore = setEnv(BASE_ENV);
  try {
    for (const post of [undefined, null, {}, { text: 'hi' }, { chat: {}, text: 'hi' }]) {
      const ctx = makeCtx(post);
      await handleChannelPost(ctx);
      assert.equal(ctx.calls.sent.length, 0, JSON.stringify(post));
      assert.equal(ctx.calls.pinned.length, 0, JSON.stringify(post));
    }
  } finally {
    restore();
  }
});

test('posts without text or caption are ignored', async () => {
  const restore = setEnv(BASE_ENV);
  try {
    const ctx = makeCtx(trustedPost({ text: undefined, caption: undefined }));
    await handleChannelPost(ctx);
    assert.equal(ctx.calls.sent.length, 0);
    assert.equal(ctx.calls.pinned.length, 0);
  } finally {
    restore();
  }
});

// ── Content trust: hostile markup stays literal, length is capped ────────────

test('hostile Markdown/HTML in channel text is reposted verbatim as plain text', async () => {
  const restore = setEnv(BASE_ENV);
  try {
    const hostile = '*IMPORTANT* [claim your airdrop](https://evil.example) <a href="https://evil.example">x</a> @everyone';
    const ctx = makeCtx(trustedPost({ text: hostile }));
    await handleChannelPost(ctx);

    assert.equal(ctx.calls.sent.length, 1);
    const sent = ctx.calls.sent[0];
    assert.ok(sent.text.includes(hostile), 'payload must arrive verbatim');
    assert.equal(sent.opts.parse_mode, undefined);
    assert.equal(ctx.calls.pinned.length, 1);
  } finally {
    restore();
  }
});

test('oversized channel text is truncated within the Telegram limit', async () => {
  const restore = setEnv(BASE_ENV);
  try {
    const longText = 'x'.repeat(TELEGRAM_MAX_MESSAGE_LENGTH + 1000);
    const ctx = makeCtx(trustedPost({ text: longText }));
    await handleChannelPost(ctx);
    assert.equal(ctx.calls.sent.length, 1);
    const sent = ctx.calls.sent[0];
    assert.ok(sent.text.length <= TELEGRAM_MAX_MESSAGE_LENGTH);
    assert.ok(sent.text.includes('…'), 'truncation marker must be present');
    assert.ok(!sent.text.includes(longText), 'payload must be truncated, not verbatim');
  } finally {
    restore();
  }
});

test('a pin failure after a trusted repost is logged, not thrown', async () => {
  const restore = setEnv(BASE_ENV);
  try {
    const ctx = makeCtx(trustedPost(), { pinFails: true });
    await handleChannelPost(ctx);
    assert.equal(ctx.calls.sent.length, 1);
    assert.equal(ctx.calls.pinned.length, 0);
  } finally {
    restore();
  }
});

// ── Pure decision function edge cases ────────────────────────────────────────

test('isTrustedChannelPost matches only the configured chat', () => {
  const post = trustedPost();
  assert.equal(isTrustedChannelPost(post, OFFICIAL_CHANNEL_ID), true);
  assert.equal(isTrustedChannelPost(post, '-100666'), false);
  assert.equal(isTrustedChannelPost(post, ''), false);
  assert.equal(isTrustedChannelPost(post, undefined), false);
  assert.equal(isTrustedChannelPost(null, OFFICIAL_CHANNEL_ID), false);
});
