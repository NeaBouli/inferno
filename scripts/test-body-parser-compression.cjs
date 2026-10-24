#!/usr/bin/env node
'use strict';

// Boundary regression only: never import application entrypoints or configuration.
// Reference: expressjs/body-parser commit 1260c3845f54502a05a87594f09a334786bb34d7.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { realpathSync } = require('node:fs');
const http = require('node:http');
const { createRequire } = require('node:module');
const path = require('node:path');
const { brotliCompressSync, deflateSync, gzipSync } = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const APPS = Object.freeze({
  benefits: { directory: 'apps/benefits-network/backend', limit: '10kb' },
  'creator-gateway': { directory: 'apps/creator-gateway', limit: '10kb' },
  'data-api': { directory: 'apps/data-api', limit: '50kb' },
  'points-backend': { directory: 'apps/points-backend', limit: '10kb' },
  'telegram-bot': { directory: 'apps/telegram/telegram-bot', limit: '100kb' },
});
const HOST = '127.0.0.1';
const REQUEST_MS = 4000;
const CHILD_MS = 25000;
const OUTPUT_BYTES = 32 * 1024;
const RESPONSE_BYTES = 4096;
const VALUE = Object.freeze({ a: 1 });
const JSON_BODY = Buffer.from(JSON.stringify(VALUE));

function triggers(parserMajor) {
  return ['deflate-end', 'deflate-hash', 'gzip-trailing',
    ...(parserMajor === 2 ? ['br-trailing'] : [])];
}

function checkNames(parserMajor) {
  const controls = ['plain-json', 'valid-gzip', ...(parserMajor === 2 ? ['valid-br'] : [])];
  return [...controls, ...triggers(parserMajor).flatMap((name) => [
    name, `${name}:health`, ...controls.map((control) => `${name}:${control}`),
  ])];
}

function emit(record) {
  process.stdout.write(`${JSON.stringify({ protocol: 1, ...record })}\n`);
}

function inside(directory, file) {
  const relative = path.relative(realpathSync(directory), realpathSync(file));
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative), 'Dependency must resolve inside this app node_modules');
}

function dependencies(alias) {
  assert.ok([20, 22].includes(Number(process.versions.node.split('.')[0])),
    'Unsupported Node version: this fixture supports the CI Node 20 and 22 runtimes');
  const appDirectory = path.join(ROOT, APPS[alias].directory);
  const appRequire = createRequire(path.join(appDirectory, 'package.json'));
  const expressEntry = appRequire.resolve('express');
  inside(path.join(appDirectory, 'node_modules'), expressEntry);
  const expressRequire = createRequire(expressEntry);
  const parserEntry = expressRequire.resolve('body-parser');
  inside(path.join(appDirectory, 'node_modules'), parserEntry);
  const expressVersion = appRequire('express/package.json').version;
  const parserVersion = expressRequire('body-parser/package.json').version;
  emit({ event: 'dependencies', app: alias, pid: process.pid, node: process.versions.node,
    express: expressVersion, bodyParser: parserVersion,
    expressEntry: path.relative(ROOT, expressEntry),
    parserEntry: path.relative(ROOT, parserEntry) });
  assert.match(expressVersion, /^[45]\.\d+\.\d+$/, 'Unsupported Express version');
  assert.match(parserVersion, /^[12]\.\d+\.\d+$/, 'Unsupported body-parser version');
  assert.equal(Number(expressVersion[0]) - 3, Number(parserVersion[0]),
    'Unsupported Express/body-parser major pairing');
  const express = appRequire('express');
  assert.equal(express.json, expressRequire('body-parser').json,
    'Exercise the parser actually used by installed Express');
  // Old supported releases reach the triggers: patch versions are metadata, not a red oracle.
  return { express, parserMajor: Number(parserVersion[0]) };
}

async function fixture(alias) {
  const { express, parserMajor } = dependencies(alias);
  const checks = checkNames(parserMajor);
  const app = express();
  app.disable('x-powered-by');
  const parser = express.json({ limit: APPS[alias].limit });
  const handshakes = new Map();
  const clients = new Set();
  const sockets = new Set();
  const hashes = new Set();
  const passed = [];
  const gzip = gzipSync(JSON_BODY);
  const deflate = deflateSync(JSON_BODY);
  const brotli = parserMajor === 2 ? brotliCompressSync(JSON_BODY) : null;

  app.get('/health', (req, res) => res.json({ ok: true, pid: process.pid }));
  for (const endpoint of ['/json', ...triggers(parserMajor).map((name) => `/${name}`)]) {
    app.post(endpoint, (req, res, next) => {
      assert.equal(req.httpVersion, '1.1', 'Unsupported HTTP protocol');
      let rawDigest = Promise.resolve(null);
      if (endpoint === '/deflate-hash') {
        const hash = createHash('sha256');
        hashes.add(hash);
        rawDigest = new Promise((resolve, reject) => {
          hash.once('error', reject);
          hash.once('finish', () => {
            hashes.delete(hash);
            resolve(hash.read().toString('hex'));
          });
        });
        req.pipe(hash);
      }
      parser(req, res, (error) => {
        if (error) return next(error);
        const handshake = handshakes.get(endpoint);
        const early = !req.complete && !req.readableEnded;
        // Merely responding early can hide the bug. Downstream must await HTTP end,
        // without resuming the stream on behalf of the parser under test.
        const ended = req.readableEnded ? Promise.resolve() : new Promise((resolve, reject) => {
          req.once('end', resolve);
          req.once('aborted', () => reject(new Error('HTTP body aborted')));
          req.once('error', reject);
        });
        Promise.all([ended, rawDigest]).then(([, digest]) => {
          assert.equal(req.complete, true, 'HTTP request must complete');
          res.json({ body: req.body, pid: process.pid, early, ended: req.readableEnded, digest });
        }).catch(next);
        if (endpoint.startsWith('/deflate-') || endpoint === '/br-trailing') {
          assert.ok(handshake, 'Missing parser-callback handshake');
          assert.ok(early, 'Parser must finish before the promised HTTP tail');
          handshake();
        }
      });
    });
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status || 500).json({ error: error.type || 'fixture.failure' });
  });

  const server = http.createServer(app);
  server.maxConnections = 4;
  server.maxHeadersCount = 16;
  server.requestTimeout = REQUEST_MS;
  server.headersTimeout = REQUEST_MS;
  server.keepAliveTimeout = 1;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  async function exchange(endpoint, first, encoding = 'identity', tail = null) {
    assert.ok(['identity', 'gzip', 'deflate', ...(parserMajor === 2 ? ['br'] : [])]
      .includes(encoding), 'Unsupported encoding');
    let request;
    let timer;
    let released = false;
    try {
      return await new Promise((resolve, reject) => {
        const health = endpoint === '/health';
        request = http.request({ host: HOST, port: server.address().port,
          path: endpoint, method: health ? 'GET' : 'POST', agent: false,
          headers: health ? { Connection: 'close' } : {
            Connection: 'close', 'Content-Type': 'application/json',
            'Content-Encoding': encoding, 'Content-Length': first.length + (tail ? tail.length : 0),
          } }, (response) => {
          const chunks = [];
          let bytes = 0;
          response.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > RESPONSE_BYTES) {
              request.destroy(new Error('Fixture response exceeded output bound'));
              return;
            }
            chunks.push(chunk);
          });
          response.once('error', reject);
          response.once('aborted', () => reject(new Error('Fixture response aborted')));
          response.once('end', () => {
            try {
              assert.equal(response.statusCode, 200, `${endpoint}: parser must accept the body`);
              assert.equal(response.complete, true, 'Incomplete HTTP response');
              const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              assert.equal(result.pid, process.pid, 'Controls must use the SAME child process');
              if (tail) assert.equal(released, true, 'Tail must follow the parser callback');
              resolve(result);
            } catch (error) {
              reject(error);
            }
          });
        });
        clients.add(request);
        request.once('error', reject);
        timer = setTimeout(() => {
          request.destroy(new Error(`${endpoint}: request/parser-callback deadline exceeded`));
        }, REQUEST_MS);
        if (tail) {
          assert.equal(handshakes.has(endpoint), false, 'Duplicate handshake');
          handshakes.set(endpoint, () => {
            assert.equal(released, false, 'Parser callback must release the tail exactly once');
            released = true;
            request.end(tail);
          });
          request.write(first);
        } else {
          request.end(first);
        }
      });
    } finally {
      clearTimeout(timer);
      handshakes.delete(endpoint);
      if (request) {
        request.destroy();
        clients.delete(request);
      }
    }
  }

  async function check(name, test) {
    emit({ event: 'start', check: name });
    await test();
    passed.push(name);
    emit({ event: 'pass', check: name });
  }

  async function control(name, encoding, body) {
    await check(name, async () => {
      const result = await exchange('/json', body, encoding);
      assert.deepEqual(result.body, VALUE, 'Valid supported representations must remain accepted');
      assert.equal(result.ended, true);
    });
  }

  async function controls(prefix = '') {
    await control(`${prefix}plain-json`, 'identity', JSON_BODY);
    await control(`${prefix}valid-gzip`, 'gzip', gzip);
    if (parserMajor === 2) await control(`${prefix}valid-br`, 'br', brotli);
  }

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, HOST, resolve);
    });
    await controls();
    for (const name of triggers(parserMajor)) {
      await check(name, async () => {
        const encoding = name === 'gzip-trailing' ? 'gzip' : name === 'br-trailing' ? 'br' : 'deflate';
        const compressed = encoding === 'gzip' ? gzip : encoding === 'br' ? brotli : deflate;
        const first = Buffer.concat([compressed, Buffer.from([0])]);
        const tail = name === 'gzip-trailing' ? Buffer.alloc(100 * 1024, 0x58) : Buffer.alloc(1024);
        const result = name === 'gzip-trailing'
          ? await exchange(`/${name}`, Buffer.concat([first, tail]), encoding)
          : await exchange(`/${name}`, first, encoding, tail);
        assert.deepEqual(result.body, VALUE);
        assert.equal(result.ended, true, 'Downstream must observe HTTP end');
        if (name !== 'gzip-trailing') assert.equal(result.early, true);
        if (name === 'deflate-hash') {
          assert.equal(result.digest, createHash('sha256').update(first).update(tail).digest('hex'),
            'Selective decoder unpipe must preserve every byte for the second piped consumer');
        }
      });
      await check(`${name}:health`, async () => {
        const result = await exchange('/health', Buffer.alloc(0));
        assert.equal(result.ok, true);
      });
      await controls(`${name}:`);
    }
    assert.deepEqual(passed, checks);
  } finally {
    for (const request of clients) request.destroy();
    for (const socket of sockets) socket.destroy();
    for (const hash of hashes) hash.destroy();
    if (server.listening) {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
  // Only emitted after cleanup; the parent also requires a clean child exit.
  emit({ event: 'complete', app: alias, checks: passed });
}

async function supervise(alias) {
  const child = spawn(process.execPath, [
    '--max-old-space-size=128', '--unhandled-rejections=strict', __filename, '--fixture', alias,
  ], {
    cwd: ROOT,
    env: { NODE_ENV: 'test', TZ: 'UTC' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  let bytes = 0;
  let failure;
  let spawnError;
  const collect = (target) => (chunk) => {
    bytes += chunk.length;
    if (bytes > OUTPUT_BYTES) {
      failure = 'Child output exceeded 32 KiB bound';
      child.kill('SIGKILL');
    } else {
      target.push(chunk);
    }
  };
  child.stdout.on('data', collect(stdout));
  child.stderr.on('data', collect(stderr));
  child.once('error', (error) => { spawnError = error; });
  const closed = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
  const timer = setTimeout(() => {
    failure = 'Child deadline exceeded (25 seconds): crash/hang regression failed';
    child.kill('SIGKILL');
  }, CHILD_MS);
  const interrupt = () => {
    failure = 'Regression interrupted';
    child.kill('SIGKILL');
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const { code, signal } = await closed;
    const output = Buffer.concat(stdout).toString('utf8');
    const errors = Buffer.concat(stderr).toString('utf8');
    const diagnostics = `exit=${code}, signal=${signal || 'none'}\n${output}${errors}`;
    assert.ok(!failure && !spawnError && code === 0 && signal === null,
      `${failure || (spawnError && spawnError.message) || 'Child crashed or failed'}\n${diagnostics}`);
    assert.equal(errors, '', `Unexpected child stderr\n${diagnostics}`);
    const records = output.trim().split('\n').map((line) => JSON.parse(line));
    assert.ok(records.every((record) => record.protocol === 1), 'Unsupported fixture protocol');
    const info = records.shift();
    assert.equal(info.event, 'dependencies');
    assert.equal(info.app, alias);
    assert.equal(info.pid, child.pid);
    assert.match(info.bodyParser, /^[12]\.\d+\.\d+$/, 'Unsupported body-parser version');
    const checks = checkNames(Number(info.bodyParser[0]));
    assert.equal(records.length, checks.length * 2 + 1, 'Incomplete fixture protocol');
    const complete = records.pop();
    assert.deepEqual(complete, { protocol: 1, event: 'complete', app: alias, checks });
    assert.deepEqual(records, checks.flatMap((check) => [
      { protocol: 1, event: 'start', check }, { protocol: 1, event: 'pass', check },
    ]));
    console.log(`[body-parser-compression] PASS ${alias}: ${checks.length} behavioral checks; `
      + `Node ${info.node}, Express ${info.express}, body-parser ${info.bodyParser} (metadata only)`);
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await closed;
    }
    child.stdout.destroy();
    child.stderr.destroy();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const childMode = args.length === 2 && args[0] === '--fixture';
  const alias = childMode ? args[1] : args[0];
  assert.ok((childMode || args.length === 1) && Object.hasOwn(APPS, alias),
    `Usage: node scripts/test-body-parser-compression.cjs <${Object.keys(APPS).join('|')}>`);
  if (childMode) await fixture(alias);
  else await supervise(alias);
}

main().catch((error) => {
  console.error(`[body-parser-compression] FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
