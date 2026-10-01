const test = require('node:test');
const assert = require('node:assert/strict');

const GROUP = '-1003833113414';

function load() {
  delete require.cache[require.resolve('../src/handlers/joinRequest')];
  return require('../src/handlers/joinRequest');
}

function fakeCtx({ chatId = GROUP, isBot = false, fail = false } = {}) {
  const calls = [];
  const op = (name) => async (...args) => {
    calls.push([name, ...args]);
    if (fail) throw new Error('Bad Request: not enough rights');
  };
  return {
    calls,
    chatJoinRequest: { chat: { id: Number(chatId) }, from: { id: 42, is_bot: isBot } },
    telegram: { approveChatJoinRequest: op('approve'), declineChatJoinRequest: op('decline') },
  };
}

test('approves human join requests for the configured community group', async () => {
  process.env.TELEGRAM_GROUP_ID = GROUP;
  const ctx = fakeCtx();
  await load().onJoinRequest(ctx);
  assert.deepEqual(ctx.calls, [['approve', GROUP, 42]]);
});

test('declines join requests from bot accounts', async () => {
  process.env.TELEGRAM_GROUP_ID = GROUP;
  const ctx = fakeCtx({ isBot: true });
  await load().onJoinRequest(ctx);
  assert.deepEqual(ctx.calls, [['decline', GROUP, 42]]);
});

test('leaves requests for other chats to admins', async () => {
  process.env.TELEGRAM_GROUP_ID = GROUP;
  const ctx = fakeCtx({ chatId: '-100999' });
  await load().onJoinRequest(ctx);
  assert.deepEqual(ctx.calls, []);
});

test('fails closed when the community group is not configured', async () => {
  for (const value of [undefined, '', '@IFRtoken', 'abc']) {
    if (value === undefined) delete process.env.TELEGRAM_GROUP_ID;
    else process.env.TELEGRAM_GROUP_ID = value;
    const ctx = fakeCtx();
    await load().onJoinRequest(ctx);
    assert.deepEqual(ctx.calls, [], `approved with TELEGRAM_GROUP_ID=${value}`);
  }
});

test('a missing admin right is logged, not thrown', async () => {
  process.env.TELEGRAM_GROUP_ID = GROUP;
  const ctx = fakeCtx({ fail: true });
  await assert.doesNotReject(() => load().onJoinRequest(ctx));
});

test('launch subscribes to join requests and every update type the bot handles', () => {
  const { ALLOWED_UPDATES } = load();
  for (const type of ['message', 'callback_query', 'channel_post', 'chat_join_request']) {
    assert.ok(ALLOWED_UPDATES.includes(type), `${type} missing from allowed updates`);
  }
  const index = require('node:fs').readFileSync(require.resolve('../src/index.js'), 'utf8');
  assert.match(index, /bot\.on\('chat_join_request', onJoinRequest\)/);
  assert.match(index, /bot\.launch\(\{ allowedUpdates: ALLOWED_UPDATES \}\)/);
  // Every bot.on() update type must be delivered by Telegram.
  const delivered = { text: 'message', new_chat_members: 'message', message: 'message' };
  for (const [, type] of index.matchAll(/bot\.on\('([a-z_]+)'/g)) {
    assert.ok(ALLOWED_UPDATES.includes(delivered[type] || type), `bot.on('${type}') is not in allowed updates`);
  }
});
