const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// Isolated persistence path must be set before the store module is loaded.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ifr-cmd-'));
process.env.WALLET_MAP_PATH = path.join(tempDir, 'wallet-map.json');
test.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

const { handleVerify, handleUnverify } = require('../src/commands/verify');
const store = require('../src/services/verificationStore');
const nonceStore = require('../src/services/nonceStore');
const rateLimit = require('../src/middleware/rateLimit');

const WALLET = '0xDdDDddDDddDDddDDddDDddDDddDDddDDddDDddDD';

function fakeCtx({ chatType = 'private', userId = 1234 } = {}) {
  const replies = [];
  return {
    replies,
    chat: { id: chatType === 'private' ? userId : -1009999, type: chatType },
    from: { id: userId, username: 'tester', first_name: 'Tester' },
    reply: async (text) => { replies.push(text); return { message_id: 1 }; },
  };
}

// Negative: /verify in a group must not mint a nonce — a code posted in a group
// is a public bearer token (CWA-32).
test('/verify in a group chat issues no nonce', async () => {
  // Behavioral proof without touching store internals: mint a nonce in private
  // first — a group attempt that reached createNonce would rotate (invalidate)
  // it, so survival of the private nonce proves the group path minted nothing.
  const setup = fakeCtx({ chatType: 'private', userId: 3001 });
  await handleVerify(setup);
  const existing = setup.replies[0].match(/IFR-[0-9A-F]{16}/)[0];

  const ctx = fakeCtx({ chatType: 'group', userId: 3001 });
  await handleVerify(ctx);
  assert.equal(ctx.replies.length, 1);
  assert.match(ctx.replies[0], /private chat/);
  assert.ok(!ctx.replies[0].includes('IFR-'), 'no verification code leaks into the group');
  assert.ok(nonceStore.claimNonce(existing), 'private nonce survived the group attempt');
});

test('/verify in a private chat issues a stored nonce', async () => {
  const ctx = fakeCtx({ chatType: 'private', userId: 3002 });
  await handleVerify(ctx);
  const match = ctx.replies[0].match(/IFR-[0-9A-F]{16}/);
  assert.ok(match, 'nonce present in the DM');
  const data = nonceStore.claimNonce(match[0]);
  assert.ok(data, 'nonce stored');
  assert.equal(data.userId, '3002');
});

// Negative: a different account cannot unbind the victim's wallet (CWA-32).
test('/unverify only affects the caller, never another account', async () => {
  store.setVerified('3003', WALLET, 'voter');

  const attacker = fakeCtx({ userId: 3004 });
  await handleUnverify(attacker);
  assert.match(attacker.replies[0], /No linked wallet/);
  assert.equal(store.isVerified('3003'), true, 'victim binding untouched');

  const owner = fakeCtx({ userId: 3003 });
  await handleUnverify(owner);
  assert.match(owner.replies[0], /unlinked/);
  assert.equal(store.isVerified('3003'), false);
});

// Negative: verification commands are throttled per Telegram-authenticated
// user id, so one account cannot farm nonces (CWA-31).
test('rateLimit blocks after the per-user maximum', async () => {
  const mw = rateLimit('verify'); // 5 per 60s
  let nextCalls = 0;
  const next = async () => { nextCalls += 1; };
  for (let i = 0; i < 5; i += 1) {
    await mw({ from: { id: 3005 }, reply: async () => {} }, next);
  }
  assert.equal(nextCalls, 5);

  let blockedReply = null;
  await mw(
    { from: { id: 3005 }, reply: async (text) => { blockedReply = text; } },
    next
  );
  assert.equal(nextCalls, 5, 'sixth attempt is blocked');
  assert.match(blockedReply, /Too many requests/);

  // A different user id is not affected by the first user's budget.
  await mw({ from: { id: 3006 }, reply: async () => {} }, next);
  assert.equal(nextCalls, 6);
});
