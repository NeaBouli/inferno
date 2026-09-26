// Preloaded into an isolated child process by verify-api-status-route.test.js.
// Stubs Telegraf and dotenv so src/index.js boots only the Express verify API,
// binds it to an ephemeral loopback port, seeds one verified user and reports
// the port to the parent test over IPC. Never loaded by production code.

const Module = require('node:module');
const path = require('node:path');

const botRoot = path.resolve(__dirname, '../..');
const express = require(require.resolve('express', { paths: [botRoot] }));
const telegraf = require(require.resolve('telegraf', { paths: [botRoot] }));

function inertBot() {
  const handler = {
    get(_target, prop) {
      if (prop === 'telegram') return new Proxy({}, handler);
      return () => Promise.resolve();
    },
  };
  return new Proxy({}, handler);
}

const telegrafStub = { ...telegraf, Telegraf: function Telegraf() { return inertBot(); } };
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'telegraf') return telegrafStub;
  if (request === 'dotenv') return { config: () => ({}) };
  return originalLoad.call(this, request, parent, isMain);
};

const originalListen = express.application.listen;
express.application.listen = function listen(_port, callback) {
  const server = originalListen.call(this, 0, '127.0.0.1', callback);
  server.once('listening', () => process.send({ port: server.address().port }));
  server.once('error', (err) => process.send({ error: err.message }));
  return server;
};

const store = require(path.join(botRoot, 'src/services/verificationStore'));
store.setVerified(process.env.FIXTURE_USER_ID, process.env.FIXTURE_WALLET, process.env.FIXTURE_TIER);

process.on('disconnect', () => process.exit(0));
