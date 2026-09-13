'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { moderationMiddleware, checkMessage, checkLinks } = require('../src/services/moderation');

function context(message = {}, status = 'member') {
  const calls = [];
  return { calls, chat: { id: -1, type: 'supergroup' }, from: { id: 7, first_name: 'IFR Fan' },
    message: { message_id: 10, text: 'Hello', ...message },
    telegram: {
      getChatMember: async () => ({ status }),
      deleteMessage: async (...args) => calls.push(args),
    } };
}
test('ordinary questions, warnings, addresses and IFR names are not punished', async () => {
  for (const text of ['Never share your seed phrase', 'How do I connect your wallet?', 'Is guaranteed profit a scam?', 'My address is 0x1234567890123456789012345678901234567890', 'Criticism of IFR is welcome']) {
    const ctx = context({ text }); let passed = false;
    await moderationMiddleware()(ctx, async () => { passed = true; });
    assert.equal(passed, true, text); assert.equal(ctx.calls.length, 0);
  }
});
test('solicitations are detected without blanket keyword blocking', () => {
  assert.equal(checkMessage('Send me your seed phrase').isSpam, true);
  assert.equal(checkMessage('Claim your free tokens').isSpam, true);
  assert.equal(checkMessage('We offer guaranteed profit').isSpam, true);
  assert.equal(checkMessage('Never send your seed phrase').isSpam, false);
});
test('introductory punctuation cannot hide solicitations, while warnings remain allowed', async () => {
  for (const text of ['Hi, send me your seed phrase', 'Attention: claim your free tokens']) {
    assert.equal(checkMessage(text).isSpam, true);
    const ctx = context({ text: undefined, caption: text });
    await moderationMiddleware()(ctx, async () => assert.fail('solicitation passed'));
    assert.equal(ctx.calls.length, 1);
  }
  for (const text of ['Never send your seed phrase', 'Is guaranteed profit a scam?', 'Reminder: never send your seed phrase', 'Hi, how do I connect my wallet?']) {
    assert.equal(checkMessage(text).isSpam, false, text);
  }
});
test('compact and underscore staff names are checked only with solicitation and non-admin role', async () => {
  for (const name of ['IFR_Support', 'IFRSupport', 'inferno-admin', 'SupportIFR']) {
    const ctx = context({ text: 'DM me' }); ctx.from.first_name = name;
    await moderationMiddleware()(ctx, async () => assert.fail('impersonation passed'));
    assert.equal(ctx.calls.length, 1, name);
    const admin = context({ text: 'DM me' }, 'administrator'); admin.from.first_name = name;
    let passed = false; await moderationMiddleware()(admin, async () => { passed = true; });
    assert.equal(passed, true);
    const ordinary = context({ text: 'Hello everyone' }); ordinary.from.first_name = name;
    passed = false; await moderationMiddleware()(ordinary, async () => { passed = true; });
    assert.equal(passed, true);
  }
});
test('hidden URLs and caption/edited/command links cannot bypass moderation', async () => {
  const cases = [
    { text: '/ask https://evil.example' },
    { text: undefined, caption: 'https://evil.example' },
    { text: 'help', entities: [{ type: 'text_link', url: 'https://evil.example' }] },
    { text: undefined, caption: 'help', caption_entities: [{ type: 'text_link', url: 'https://evil.example' }] },
    { text: 'evil.example', entities: [{ type: 'url', offset: 0, length: 12 }] },
  ];
  for (const message of cases) {
    const ctx = context(message);
    await moderationMiddleware()(ctx, async () => assert.fail('must not pass'));
    assert.deepEqual(ctx.calls, [[-1, 10]]);
  }
  const ctx = context({ text: 'https://evil.example' });
  ctx.editedMessage = ctx.message; delete ctx.message;
  await moderationMiddleware()(ctx, async () => assert.fail('edit must not pass'));
  assert.equal(ctx.calls.length, 1);
});
test('allowlisted text cannot hide another target', () => {
  assert.equal(checkLinks('https://ifrunit.tech', [{ type: 'text_link', url: 'https://evil.example' }]).hasUnallowed, true);
});
test('sentence punctuation does not turn official links into spam', () => {
  for (const text of ['See https://ifrunit.tech.', 'Here: https://github.com/NeaBouli.', '(https://ifrunit.tech)', 'https://ifrunit.tech/wiki/liquidity.html!']) {
    assert.equal(checkLinks(text).hasUnallowed, false, text);
  }
  assert.equal(checkLinks('https://ifrunit.tech.evil.example.').hasUnallowed, true);
});
test('flood includes commands and uncaptioned media, is chat scoped and expires', async () => {
  let clock = 0; const run = moderationMiddleware({ now: () => clock });
  for (let i = 0; i < 5; i++) await run(context({ text: '/help' }), async () => {});
  const blocked = context({ text: undefined, photo: [{}] });
  await run(blocked, async () => assert.fail('flood passed')); assert.equal(blocked.calls.length, 1);
  const other = context(); other.chat.id = -2; let passed = false;
  await run(other, async () => { passed = true; }); assert.equal(passed, true);
  clock = 10_001; passed = false;
  await run(context(), async () => { passed = true; }); assert.equal(passed, true);
});
test('Telegram admins exempt; impersonating a name is not admin authorization', async () => {
  const ctx = context({ text: 'https://evil.example' }, 'administrator'); let passed = false;
  await moderationMiddleware()(ctx, async () => { passed = true; }); assert.equal(passed, true);
  const fake = context({ text: 'DM me' }); fake.from.first_name = 'IFR Support';
  await moderationMiddleware()(fake, async () => assert.fail()); assert.equal(fake.calls.length, 1);
});
test('role failure and deletion failure never trigger bans or crash', async () => {
  const ctx = context({ text: 'https://evil.example' });
  ctx.telegram.getChatMember = async () => { throw Error('offline'); };
  await moderationMiddleware()(ctx, async () => assert.fail()); assert.equal(ctx.calls.length, 0);
  ctx.telegram.getChatMember = async () => ({ status: 'member' });
  ctx.telegram.deleteMessage = async () => { throw Error('no permission'); };
  await assert.doesNotReject(moderationMiddleware()(ctx, async () => assert.fail()));
});
