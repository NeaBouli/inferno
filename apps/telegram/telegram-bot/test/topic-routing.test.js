'use strict';

// T-286: every bot-initiated community post is routed to a forum topic by
// category; unknown categories and failed topic sends fall back to General;
// replies to user commands stay in the thread the command came from.

const assert = require('node:assert/strict');
const test = require('node:test');
const { Context } = require('telegraf');

const {
  TOPIC_ROUTES, resolveTopicId, threadOptions, isTopicError, sendToGroup,
} = require('../src/services/topicRouter');
const { announceNewProposal, _resetAnnounced } = require('../src/services/voteAnnouncement');
const { handleChannelPost } = require('../src/handlers/channelSync');

// Stub burn stats before the daily handlers destructure getBurnStats.
const onchain = require('../src/services/onchain');
onchain.getBurnStats = async () => ({
  totalSupply: '990000000', burned: '10000000', burnedPercent: 1, source: 'railway',
});
const { sendDailyBurnReport } = require('../src/handlers/dailyReport');
const { sendDailyWelcome } = require('../src/handlers/dailyWelcome');

const TOPIC_ENV_KEYS = [...new Set(Object.values(TOPIC_ROUTES).map((r) => r.env))];

function withCleanTopicEnv(fn) {
  return async () => {
    const saved = {};
    for (const key of TOPIC_ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    try {
      await fn();
    } finally {
      for (const key of TOPIC_ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  };
}

function telegramError(description, code = 400) {
  const err = new Error(`${code}: ${description} (https://api.telegram.org/botSECRET/sendMessage)`);
  err.response = { ok: false, error_code: code, description };
  return err;
}

function fakeTelegram({ failThreads = [], failWith } = {}) {
  const sent = [];
  return {
    sent,
    sendMessage: async (chatId, text, opts) => {
      sent.push({ chatId, text, opts });
      const thread = opts.message_thread_id ?? null;
      if (failWith) throw failWith;
      if (failThreads.includes(thread)) throw telegramError('Bad Request: message thread not found');
      return { message_id: sent.length };
    },
    pinChatMessage: async () => {},
  };
}

// ── Routing map ──────────────────────────────────────────────────────────────

const EXPECTED_DEFAULTS = {
  announcements: 1,
  general: 5,
  burns: 7,
  dev: 11,
  release: 11,
  council: 21,
  governance: 21,
  vote: 23,
  coredev: 58,
};

test('each category resolves to its documented default topic', () => {
  for (const [category, id] of Object.entries(EXPECTED_DEFAULTS)) {
    assert.equal(resolveTopicId(category, {}), id, category);
  }
  assert.deepEqual(Object.keys(TOPIC_ROUTES).sort(), Object.keys(EXPECTED_DEFAULTS).sort());
});

test('env overrides the default; empty or invalid values keep the default', () => {
  assert.equal(resolveTopicId('dev', { TELEGRAM_DEV_BUILDER_TOPIC_ID: '99' }), 99);
  assert.equal(resolveTopicId('council', { TELEGRAM_COUNCIL_TOPIC_ID: ' 42 ' }), 42);
  for (const bad of ['', 'abc', '-3', '0', '1.5', '12abc']) {
    assert.equal(resolveTopicId('dev', { TELEGRAM_DEV_BUILDER_TOPIC_ID: bad }), 11, `value ${bad}`);
  }
});

test('unknown categories fall back to General', () => {
  assert.equal(resolveTopicId('memes', {}), 5);
  assert.equal(resolveTopicId(undefined, {}), 5);
  assert.equal(resolveTopicId('memes', { TELEGRAM_GENERAL_TOPIC_ID: '77' }), 77);
});

test('thread 1 is sent without message_thread_id', () => {
  assert.deepEqual(threadOptions(1), {});
  assert.deepEqual(threadOptions(null), {});
  assert.deepEqual(threadOptions(11), { message_thread_id: 11 });
});

test('sendToGroup posts each category into its topic', async () => {
  for (const [category, id] of Object.entries(EXPECTED_DEFAULTS)) {
    const telegram = fakeTelegram();
    await sendToGroup(telegram, '-100999', category, 'hi', { parse_mode: 'Markdown' }, {});
    assert.equal(telegram.sent.length, 1);
    assert.equal(telegram.sent[0].chatId, '-100999');
    assert.equal(telegram.sent[0].opts.parse_mode, 'Markdown');
    assert.equal(telegram.sent[0].opts.message_thread_id, id > 1 ? id : undefined, category);
  }
});

// ── Fallback ─────────────────────────────────────────────────────────────────

test('deleted/closed topic falls back to General', async () => {
  const telegram = fakeTelegram({ failThreads: [11] });
  const result = await sendToGroup(telegram, '-100999', 'dev', 'build log', {}, {});
  assert.equal(result.message_id, 2);
  assert.deepEqual(telegram.sent.map((s) => s.opts.message_thread_id), [11, 5]);
});

test('if General also rejects, the post goes out without a thread id', async () => {
  const telegram = fakeTelegram({ failThreads: [21, 5] });
  await sendToGroup(telegram, '-100999', 'council', 'proposal', {}, {});
  assert.deepEqual(telegram.sent.map((s) => s.opts.message_thread_id), [21, 5, undefined]);
});

test('non-topic errors are not retried', async () => {
  const telegram = fakeTelegram({ failWith: telegramError("Bad Request: can't parse entities") });
  await assert.rejects(sendToGroup(telegram, '-100999', 'dev', 'x', {}, {}), /parse entities/);
  assert.equal(telegram.sent.length, 1);
});

test('topic error detection matches Telegram topic descriptions only', () => {
  assert.ok(isTopicError(telegramError('Bad Request: message thread not found')));
  assert.ok(isTopicError(telegramError('Bad Request: TOPIC_CLOSED')));
  assert.ok(isTopicError(telegramError('Bad Request: TOPIC_DELETED')));
  assert.ok(!isTopicError(telegramError('Forbidden: bot was kicked', 403)));
});

// ── Callers use the router ───────────────────────────────────────────────────

test('governance proposal announcements go to the Council topic', withCleanTopicEnv(async () => {
  const savedGroup = process.env.TELEGRAM_GROUP_ID;
  const savedChannel = process.env.TELEGRAM_CHANNEL_ID;
  process.env.TELEGRAM_GROUP_ID = '-100999';
  delete process.env.TELEGRAM_CHANNEL_ID;
  try {
    _resetAnnounced();
    const telegram = fakeTelegram();
    await announceNewProposal({ telegram }, 7, {
      target: '0x0000000000000000000000000000000000000001', data: '0xb3ab15fb', eta: 1,
    }, '0x0');
    assert.equal(telegram.sent.length, 1);
    assert.equal(telegram.sent[0].chatId, '-100999');
    assert.equal(telegram.sent[0].opts.message_thread_id, 21);
  } finally {
    _resetAnnounced();
    if (savedGroup === undefined) delete process.env.TELEGRAM_GROUP_ID;
    else process.env.TELEGRAM_GROUP_ID = savedGroup;
    if (savedChannel === undefined) delete process.env.TELEGRAM_CHANNEL_ID;
    else process.env.TELEGRAM_CHANNEL_ID = savedChannel;
  }
}));

test('channel sync reposts into the Announcements topic (thread 1, no thread id)', withCleanTopicEnv(async () => {
  const savedGroup = process.env.TELEGRAM_GROUP_ID;
  const savedChannel = process.env.TELEGRAM_CHANNEL_ID;
  process.env.TELEGRAM_GROUP_ID = '-100999';
  process.env.TELEGRAM_CHANNEL_ID = '-1001234567890';
  try {
    const telegram = fakeTelegram();
    const chat = { id: -1001234567890, type: 'channel' };
    await handleChannelPost({ telegram, channelPost: { chat, sender_chat: chat, message_id: 1, text: 'hi' } });
    assert.equal(telegram.sent.length, 1);
    assert.equal(telegram.sent[0].opts.message_thread_id, undefined);
  } finally {
    if (savedGroup === undefined) delete process.env.TELEGRAM_GROUP_ID;
    else process.env.TELEGRAM_GROUP_ID = savedGroup;
    if (savedChannel === undefined) delete process.env.TELEGRAM_CHANNEL_ID;
    else process.env.TELEGRAM_CHANNEL_ID = savedChannel;
  }
}));

test('daily burn report goes to Burns, daily welcome to General', withCleanTopicEnv(async () => {
  const telegram = fakeTelegram();
  await sendDailyBurnReport({ telegram }, '-100999');
  await sendDailyWelcome({ telegram }, '-100999');
  assert.deepEqual(telegram.sent.map((s) => s.opts.message_thread_id), [7, 5]);
}));

test('daily burn report honors a configured Burns topic', withCleanTopicEnv(async () => {
  process.env.TELEGRAM_BURNS_TOPIC_ID = '70';
  const telegram = fakeTelegram();
  await sendDailyBurnReport({ telegram }, '-100999');
  assert.equal(telegram.sent[0].opts.message_thread_id, 70);
}));

// ── Command replies keep their thread ────────────────────────────────────────

function commandContext({ threadId, isTopic }) {
  const sent = [];
  const telegram = {
    sendMessage: async (chatId, text, opts) => {
      sent.push({ chatId, text, opts });
      return { message_id: 1 };
    },
  };
  const message = {
    message_id: 10,
    date: 1700000000, // date 0 marks an inaccessible message in Telegraf
    chat: { id: -100999, type: 'supergroup', is_forum: true },
    from: { id: 1, is_bot: false, first_name: 'U' },
    text: '/burns',
    ...(isTopic ? { message_thread_id: threadId, is_topic_message: true } : {}),
  };
  const ctx = new Context({ update_id: 1, message }, telegram, { id: 2, is_bot: true, username: 'b' });
  return { ctx, sent };
}

test('command replies stay in the thread the command came from', async () => {
  for (const threadId of [11, 21, 23, 58, 7]) {
    const { ctx, sent } = commandContext({ threadId, isTopic: true });
    await ctx.reply('answer');
    assert.equal(sent[0].opts.message_thread_id, threadId);
  }
});

test('command replies outside a topic carry no thread id', async () => {
  const { ctx, sent } = commandContext({ isTopic: false });
  await ctx.reply('answer');
  assert.equal(sent[0].opts.message_thread_id, undefined);
});
