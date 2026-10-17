#!/usr/bin/env node

// Run the shipping middleware in Express without opening a network listener.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { IncomingMessage, ServerResponse } = require('node:http');
const { Duplex } = require('node:stream');
const express = require('express');
const ts = require('typescript');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const source = read('server/index.ts');
const context = { app: express(), exports: {} };
vm.runInNewContext(compile(read('server/security-headers.ts')), context);
context.securityHeaders = context.exports.securityHeaders;
const headerStart = source.indexOf('app.disable("x-powered-by")');
const headerEnd = source.indexOf('app.set("trust proxy"');
assert.ok(headerStart > 0 && headerEnd > headerStart);
vm.runInNewContext(source.slice(headerStart, headerEnd), context);

context.app.use(express.json({ limit: '50kb' }));
context.app.get('/ok', (_req, res) => res.json({ ok: true }));
context.app.get('/throw', () => { throw new Error('private-test-detail'); });
const finalStart = source.indexOf('app.use((_req, res) => {\n  res.status(404)');
const finalEnd = source.indexOf('const PORT =', finalStart);
assert.ok(finalStart > 0 && finalEnd > finalStart, 'missing final response handlers');
vm.runInNewContext(compile(source.slice(finalStart, finalEnd)), context);

function request(url, body) {
  return new Promise((resolve, reject) => {
    const socket = new Duplex({ read() {}, write(_chunk, _encoding, done) { done(); } });
    const req = new IncomingMessage(socket);
    req.method = body === undefined ? 'GET' : 'POST';
    req.url = url;
    if (body !== undefined) {
      req.headers = { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) };
    }
    const res = new ServerResponse(req);
    res.assignSocket(socket);
    let responseBody = '';
    const originalEnd = res.end;
    res.end = function (chunk, ...args) {
      if (chunk) responseBody += chunk;
      return originalEnd.call(this, chunk, ...args);
    };
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('in-process HTTP timeout'));
    }, 3000);
    res.on('finish', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve({ status: res.statusCode, headers: res.getHeaders(), body: responseBody });
    });
    context.app.handle(req, res);
    if (body !== undefined) req.push(body);
    req.push(null);
  });
}

(async () => {
  for (const [url, body, expected] of [
    ['/ok', undefined, 200], ['/missing', undefined, 404], ['/throw', undefined, 500],
    ['/bad-json', '{', 400], ['/large', JSON.stringify('x'.repeat(52000)), 413],
  ]) {
    const response = await request(url, body);
    assert.equal(response.status, expected, url);
    for (const [key, value] of Object.entries(context.securityHeaders)) {
      assert.equal(response.headers[key.toLowerCase()], value, `${url}: ${key}`);
    }
    assert.equal(response.headers['x-frame-options'], 'DENY');
    assert.equal(response.headers['x-powered-by'], undefined);
    assert.ok(!response.body.includes('private-test-detail'));
  }
  console.log('[data-api-security-headers] PASS (200, 400, 404, 413, 500; no network listener)');
})().catch((error) => { console.error(error); process.exitCode = 1; });
