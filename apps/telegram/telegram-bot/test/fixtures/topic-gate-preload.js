'use strict';

// Preloaded into an isolated child process by topic-gate-admin.test.js.
// Boots src/index.js with Telegraf, dotenv, moderation and the on-chain reader
// stubbed so no network, polling or chain access happens. The stub bot records
// middleware registrations in order and dispatches synthetic updates through
// them with Telegraf-like next() semantics. Controlled by the parent over IPC.
// Env (BOT_TOKEN, ADMIN_USER_IDS, WALLET_MAP_PATH) is provided by the parent.
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
  throw new Error('Network access is forbidden during the topic gate admin test');
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
dns.lookup = rejectNetworkCall;
dns.resolve = rejectNetworkCall;
global.fetch = rejectNetworkCall;

const botRoot = path.resolve(__dirname, '../..');
const express = require(require.resolve('express', { paths: [botRoot] }));
const telegraf = require(require.resolve('telegraf', { paths: [botRoot] }));

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

// Deterministic tier source: every wallet reads as community (deny-by-default).
const onChainReaderStub = {
  determineTier: async () => 'community',
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

// ── The verify API must not bind a real port in this harness ─────────────────
express.application.listen = function listen(_port, callback) {
  if (callback) process.nextTick(callback);
  return { once: () => {}, address: () => ({ port: 0 }), close: () => {} };
};

// ── Synthetic update dispatch with Telegraf-like middleware chaining ────────
function matches(reg, update) {
  if (reg.kind === 'use') return true;
  if (reg.kind === 'on') {
    if (reg.event === 'channel_post') return update.isChannelPost === true;
    if (reg.event === 'message') return update.isChannelPost !== true;
    if (reg.event === 'text') return update.isChannelPost !== true && typeof update.text === 'string';
    return false;
  }
  if (reg.kind === 'command') {
    return update.isChannelPost !== true && typeof update.text === 'string' && (
      update.text === `/${reg.name}` ||
      update.text.startsWith(`/${reg.name} `) ||
      update.text.startsWith(`/${reg.name}@`)
    );
  }
  return false;
}

async function dispatch(update) {
  const calls = { replies: [], deleted: 0, telegram: [] };
  const message = {
    message_id: 77,
    text: update.text,
    message_thread_id: update.threadId,
  };
  const ctx = {
    message,
    chat: { id: update.chatId, type: 'supergroup' },
    from: { id: update.userId, first_name: 'Fixture', username: 'fixture' },
    updateType: 'message',
    reply: async (text) => { calls.replies.push(text); return { message_id: 78 }; },
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
  if (update.isChannelPost) {
    ctx.channelPost = update.channelPost;
    ctx.updateType = 'channel_post';
  }

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
    if (msg.type === 'registrations') {
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

// ── Boot the real entry point under the stubs ────────────────────────────────
require(path.join(botRoot, 'src/index.js'));
process.send({ type: 'ready' });
