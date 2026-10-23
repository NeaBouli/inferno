// Execute the shipping Express app without a network listener or background jobs.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { IncomingMessage, ServerResponse } = require('node:http');
const { Duplex } = require('node:stream');
const ts = require('typescript');
const nativeRequire = createRequire(path.join(__dirname, '../server/index.ts'));

function loadApp(options = {}) {
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    let source = fs.readFileSync(file, 'utf8');
    if (file.endsWith('/server/index.ts')) {
      source = source.slice(0, source.indexOf('const PORT =')) + '\nmodule.exports = app;';
    }
    const code = ts.transpileModule(source, {
      compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const requireModule = (specifier) => {
      if (specifier === 'dotenv/config') return {};
      if (options.modules && Object.hasOwn(options.modules, specifier)) return options.modules[specifier];
      if (specifier.startsWith('.')) {
        return load(path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.ts')));
      }
      return nativeRequire(specifier);
    };
    vm.runInNewContext(code, {
      module, exports: module.exports, require: requireModule, Buffer, URL,
      console: options.console || { log() {}, error() {}, warn() {} },
      process: { env: { NODE_ENV: 'test', BOOTSTRAP_VOTES: 'e30=', ...options.env } },
      setTimeout, clearTimeout, setInterval() { throw new Error('unexpected background job'); },
      fetch: options.fetch || (() => { throw new Error('unexpected external request'); }), AbortController,
    }, { filename: file });
    return module.exports;
  }
  return load(path.resolve(__dirname, '../server/index.ts'));
}

function request(app, method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const socket = new Duplex({ read() {}, write(_chunk, _encoding, done) { done(); } });
    Object.defineProperty(socket, 'remoteAddress', { value: '127.0.0.1' });
    const req = new IncomingMessage(socket);
    req.method = method;
    req.url = url;
    req.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    if (body !== undefined) {
      req.headers['content-type'] = 'application/json';
      req.headers['content-length'] = String(Buffer.byteLength(body));
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
      socket.destroy(); reject(new Error(`in-process request timed out: ${method} ${url}`));
    }, 3000);
    res.on('finish', () => {
      clearTimeout(timeout); socket.destroy();
      resolve({ status: res.statusCode, headers: res.getHeaders(), body: responseBody });
    });
    app.handle(req, res);
    if (body !== undefined) req.push(body);
    req.push(null);
  });
}
module.exports = { loadApp, request };
