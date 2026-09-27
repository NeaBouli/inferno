// Preloaded into an isolated child process by verify-api-flow.test.js.
// Boots src/index.js with Telegraf, dotenv, moderation and the on-chain reader
// stubbed so no network, polling or chain access happens. The stub bot records
// middleware registrations in order and dispatches synthetic updates through
// them with Telegraf-like next() semantics. Controlled by the parent over IPC.
// Never loaded by production code.

const Module = require('node:module');
const path = require('node:path');

// ── Block all outbound network (mirrors test/import-smoke.js) ────────────────
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const dgram = require('node:dgram');
const dns = require('node:dns');

function rejectNetworkCall() {
  throw new Error('Network access is forbidden during the verify API flow test');
}
http.get = rejectNetworkCall;
http.request = rejectNetworkCall;
https.get = rejectNetworkCall;
https.request = rejectNetworkCall;
net.connect = rejectNetworkCall;
net.createConnection = rejectNetworkCall;
net.Socket.prototype.connect = rejectNetworkCall;
tls.connect = rejectNetworkCall;
dgram.createSocket = rejectNetworkCall;
// server.listen() on a loopback literal still calls dns.lookup — allow only
// loopback hostnames so the fixture server can bind, reject everything else.
dns.lookup = function lookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'function' ? {} : options;
  if (hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost') {
    const address = hostname === '::1' ? '::1' : '127.0.0.1';
    const family = address === '::1' ? 6 : 4;
    if (opts && opts.all) return process.nextTick(cb, null, [{ address, family }]);
    return process.nextTick(cb, null, address, family);
  }
  return process.nextTick(cb, new Error('DNS resolution is forbidden during the verify API flow test'));
};
dns.resolve = rejectNetworkCall;
global.fetch = rejectNetworkCall;

const botRoot = path.resolve(__dirname, '../..');
const express = require(require.resolve('express', { paths: [botRoot] }));
const telegraf = require(require.resolve('telegraf', { paths: [botRoot] }));
const store = require(path.join(botRoot, 'src/services/verificationStore'));
const nonceStore = require(path.join(botRoot, 'src/services/nonceStore'));

// ── Recording stub bot ───────────────────────────────────────────────────────
const registrations = [];

const bot = {
  use: (mw) => registrations.push({ kind: 'use', mw }),
  on: (event, mw) => registrations.push({ kind: 'on', event, mw }),
  command: (name, ...mws) => registrations.push({ kind: 'command', name, mws }),
  action: (regex, mw) => registrations.push({ kind: 'action', regex, mw }),
  catch: () => {},
  launch: () => Promise.resolve(),
  stop: () => {},
};

const telegrafStub = { ...telegraf, Telegraf: function Telegraf() { return bot; } };

// Deterministic tier source, controlled by the parent test.
const tiers = new Map(); // wallet(lowercase) -> tier
let failNextTier = false; // one-shot downstream failure injection (fail-closed tests)
const onChainReaderStub = {
  determineTier: async (wallet) => {
    if (failNextTier) {
      failNextTier = false;
      throw new Error('fixture: tier lookup failed');
    }
    return tiers.get(wallet.toLowerCase()) || 'community';
  },
  getSignerWallets: async () => [],
  getLockedBalance: async () => 0,
  isBuilderOnChain: async () => false,
};

const moderationStub = { moderationMiddleware: () => async (_ctx, next) => next() };

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'telegraf') return telegrafStub;
  if (request === 'dotenv') return { config: () => ({}) };
  if (/services\/moderation$/.test(request)) return moderationStub;
  if (/onChainReader$/.test(request)) return onChainReaderStub;
  return originalLoad.call(this, request, parent, isMain);
};

// ── Bind the verify API to an ephemeral loopback port and report it ─────────
const originalListen = express.application.listen;
express.application.listen = function listen(_port, callback) {
  const server = originalListen.call(this, 0, '127.0.0.1', callback);
  server.once('listening', () => process.send({ type: 'ready', port: server.address().port }));
  server.once('error', (err) => process.send({ type: 'error', error: err.message }));
  return server;
};

// ── Synthetic update dispatch with Telegraf-like middleware chaining ────────
function matches(reg, update) {
  if (reg.kind === 'use') return true;
  if (reg.kind === 'on') {
    if (reg.event === 'message') return true;
    return reg.event === 'text' && typeof update.text === 'string';
  }
  if (reg.kind === 'command') {
    return typeof update.text === 'string' && (
      update.text === `/${reg.name}` ||
      update.text.startsWith(`/${reg.name} `) ||
      update.text.startsWith(`/${reg.name}@`)
    );
  }
  return false;
}

async function dispatch(update) {
  const calls = { replies: [], deleted: 0, telegram: [] };
  const ctx = {
    message: { message_id: 77, text: update.text, message_thread_id: update.threadId },
    chat: { id: update.chatId, type: 'supergroup' },
    from: { id: update.userId, first_name: 'Fixture', username: 'fixture' },
    updateType: 'message',
    reply: async (text) => { calls.replies.push(text); return { message_id: 78 }; },
    replyWithMarkdown: async (text) => { calls.replies.push(text); return { message_id: 78 }; },
    replyWithMarkdownV2: async (text) => { calls.replies.push(text); return { message_id: 78 }; },
    deleteMessage: async () => { calls.deleted += 1; },
    telegram: new Proxy({}, {
      get(_target, prop) {
        return (...args) => {
          calls.telegram.push({ method: String(prop), args });
          if (prop === 'getChatMember') return Promise.resolve({ status: 'member' });
          return Promise.resolve({ message_id: 79 });
        };
      },
    }),
  };

  async function runFrom(index) {
    if (index >= registrations.length) return;
    const reg = registrations[index];
    if (!matches(reg, update)) return runFrom(index + 1);
    const mws = reg.kind === 'command' ? reg.mws : [reg.mw];
    let j = -1;
    async function step() {
      j += 1;
      if (j < mws.length) return mws[j](ctx, step);
      return runFrom(index + 1);
    }
    await step();
  }

  await runFrom(0);
  return calls;
}

// ── IPC command channel ──────────────────────────────────────────────────────
process.on('message', (msg) => {
  (async () => {
    if (msg.type === 'setTier') {
      tiers.set(msg.wallet.toLowerCase(), msg.tier);
      process.send({ type: 'ack', id: msg.id });
    } else if (msg.type === 'failNextTier') {
      failNextTier = true;
      process.send({ type: 'ack', id: msg.id });
    } else if (msg.type === 'makeNonce') {
      process.send({ type: 'nonce', id: msg.id, nonce: nonceStore.createNonce(msg.userId, 'fixture') });
    } else if (msg.type === 'bindUser') {
      store.setVerified(msg.userId, msg.wallet, msg.tier);
      process.send({ type: 'ack', id: msg.id });
    } else if (msg.type === 'isVerified') {
      process.send({ type: 'verified', id: msg.id, value: store.isVerified(msg.userId) });
    } else if (msg.type === 'registrations') {
      process.send({
        type: 'registrations',
        id: msg.id,
        list: registrations.map((r) => ({ kind: r.kind, event: r.event, name: r.name })),
      });
    } else if (msg.type === 'dispatch') {
      const calls = await dispatch(msg.update);
      process.send({ type: 'dispatchResult', id: msg.id, calls });
    }
  })().catch((err) => process.send({ type: 'error', id: msg.id, error: err.message }));
});

process.on('disconnect', () => process.exit(0));
