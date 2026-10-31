#!/usr/bin/env node
'use strict';

// Standard CLI comparison; also Playwright's post-webServer identity hook.
// Runtime qualification is Linux-only. This module never installs dependencies.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const ROOT = path.resolve(__dirname, '..');
const BODY_LIMIT = 8 * 1024 * 1024;
const WORK_MS = 165000; // Reserve the remainder of 180s for owned teardown.
let activeCase = null; // Fixed test-case identifier only; never a response/error string.
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (code) => { throw Object.assign(new Error(code), { contractCode: code }); };
const check = (value, code) => { if (!value) fail(code); };
const remaining = (deadline) => {
  const ms = Math.floor(deadline - performance.now());
  check(ms > 0, 'DEADLINE');
  return ms;
};
function fixedError(error) {
  return error?.contractCode && /^[A-Z_]+$/.test(error.contractCode)
    ? error.contractCode : 'UNEXPECTED_FAILURE';
}
function regular(file) {
  const st = fs.lstatSync(file);
  check(st.isFile() && st.nlink === 1, 'REGULAR_FILE_REQUIRED');
  return fs.readFileSync(file);
}
function writeReceipt(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}
function media(headers) {
  return String(headers['content-type'] || '').split(';')[0].trim().toLowerCase();
}
function mimeAllowed(type, extension) {
  return ({ html: ['text/html'], js: ['text/javascript', 'application/javascript'],
    css: ['text/css'], json: ['application/json'], txt: ['text/plain'],
    png: ['image/png'] })[extension].includes(type);
}
function publicCases() {
  return [
    ['root', '/', 'index.html', 'html'],
    ['web3-directory', '/web3/', 'web3/index.html', 'html'],
    ['web3-index', '/web3/index.html', 'web3/index.html', 'html'],
    ['wiki-directory', '/wiki/', 'wiki/index.html', 'html'],
    ['wiki-explicit', '/wiki/wallet-guide.html', 'wiki/wallet-guide.html', 'html'],
    ['wiki-extensionless', '/wiki/wallet-guide', 'wiki/wallet-guide.html', 'html'],
    ['wiki-query', '/wiki/wallet-guide.html?contract=1', 'wiki/wallet-guide.html', 'html'],
    ['wallet-js', '/web3-wallet-core.js?contract=1', 'web3-wallet-core.js', 'js'],
    ['relative-js', '/assets/wallet-core.js', 'assets/wallet-core.js', 'js'],
    ['relative-css', '/assets/redesign-skin.css?v=20261023-p1', 'assets/redesign-skin.css', 'css'],
    ['json', '/token-list.json?contract=1', 'token-list.json', 'json'],
    ['widget-js', '/widget/ifr-benefits-widget.js', 'widget/ifr-benefits-widget.js', 'js'],
    ['text', '/robots.txt', 'robots.txt', 'txt'],
    ['relative-icon', '/assets/ifr_icon_64.png', 'assets/ifr_icon_64.png', 'png'],
  ].map(([name, url, file, extension]) => ({ name, url, file, extension }));
}
function request(host, port, target, method, deadline) {
  check(target.startsWith('/') && !target.startsWith('//'), 'REQUEST_PATH');
  return new Promise((resolve, reject) => {
    const requestMs = Math.min(3000, remaining(deadline));
    let timer;
    const done = (error, value) => {
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const req = http.request({ hostname: host, port, path: target, method, agent: false,
      headers: { 'Accept-Encoding': 'identity', Connection: 'close' },
      timeout: requestMs }, (res) => {
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > BODY_LIMIT) req.destroy(Object.assign(new Error(), { contractCode: 'BODY_LIMIT' }));
        else chunks.push(chunk);
      });
      res.on('end', () => done(null, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', () => done(Object.assign(new Error(), { contractCode: 'RESPONSE_FAILURE' })));
    });
    // An idle timeout alone does not bound a response that keeps streaming.
    timer = setTimeout(() => req.destroy(Object.assign(new Error(), { contractCode: 'REQUEST_TIMEOUT' })), requestMs);
    req.on('timeout', () => req.destroy(Object.assign(new Error(), { contractCode: 'REQUEST_TIMEOUT' })));
    req.on('error', (error) => done(Object.assign(new Error(), { contractCode:
      error.contractCode || (error.code === 'ECONNREFUSED' ? 'CONNECTION_REFUSED' : 'REQUEST_FAILURE') })));
    req.end();
  });
}
async function follow(host, port, target, method, deadline) {
  const redirects = [];
  for (let count = 0; count <= 4; count++) {
    const reply = await request(host, port, target, method, deadline);
    if (![301, 302, 303, 307, 308].includes(reply.status)) return { ...reply, target, redirects };
    check(count < 4 && typeof reply.headers.location === 'string', 'REDIRECT_LIMIT');
    const next = new URL(reply.headers.location, `http://${host}:${port}${target}`);
    check(next.protocol === 'http:' && next.hostname === host && next.port === String(port)
      && !next.username && !next.password, 'REDIRECT_ORIGIN');
    redirects.push({ status: reply.status, path: `${next.pathname}${next.search}` });
    target = `${next.pathname}${next.search}`;
  }
  fail('REDIRECT_LIMIT');
}
async function contentCase(host, port, docs, item, deadline, method = 'GET') {
  activeCase = `${item.name}-${method}`;
  const expected = regular(path.join(docs, item.file));
  const reply = await follow(host, port, item.url, method, deadline);
  check(reply.status === 200, 'CONTENT_STATUS');
  check(mimeAllowed(media(reply.headers), item.extension), 'CONTENT_MIME');
  check(!reply.headers['content-encoding'], 'UNEXPECTED_ENCODING');
  if (method === 'HEAD') {
    check(reply.body.length === 0, 'HEAD_BODY');
    check(Number(reply.headers['content-length']) === expected.length, 'HEAD_LENGTH');
  } else check(reply.body.equals(expected), 'CONTENT_BYTES');
  return { case: item.name, method, status: reply.status, finalPath: reply.target,
    redirects: reply.redirects, mime: media(reply.headers), bytes: expected.length, sha256: sha(expected) };
}
function copyTree(source, destination, budget, deadline) {
  check(fs.lstatSync(source).isDirectory(), 'SOURCE_DIRECTORY');
  fs.mkdirSync(destination, { mode: 0o700 });
  for (const name of fs.readdirSync(source).sort()) {
    remaining(deadline);
    const from = path.join(source, name), to = path.join(destination, name);
    const st = fs.lstatSync(from);
    check(!st.isSymbolicLink(), 'SOURCE_SYMLINK');
    if (st.isDirectory()) copyTree(from, to, budget, deadline);
    else {
      check(st.isFile(), 'SOURCE_SPECIAL_FILE');
      budget.count++; budget.bytes += st.size;
      check(budget.count <= 8192 && budget.bytes <= 128 * 1024 * 1024 && st.size <= BODY_LIMIT, 'SOURCE_LIMIT');
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(to, 0o600);
    }
  }
}
function packageBin(root, name, version, command) {
  const directory = fs.realpathSync(path.join(root, 'node_modules', name));
  const manifest = regular(path.join(directory, 'package.json'));
  const pkg = JSON.parse(manifest);
  check(pkg.name === name && pkg.version === version, 'PACKAGE_IDENTITY');
  const bin = path.resolve(directory, typeof pkg.bin === 'string' ? pkg.bin : pkg.bin[command]);
  check(bin.startsWith(`${directory}${path.sep}`) && fs.realpathSync(bin) === bin, 'PACKAGE_BIN');
  return { bin, name, version, manifestSha256: sha(manifest), binSha256: sha(regular(bin)) };
}
function identity(pid) {
  try {
    const source = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = source.slice(source.lastIndexOf(')') + 2).split(' ');
    return { ticks: fields[19], group: Number(fields[2]), state: fields[0] };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function sameProcess(owner) {
  return identity(owner.child.pid)?.ticks === owner.ticks;
}
function ownedListeners(owner) {
  check(sameProcess(owner), 'CHILD_IDENTITY');
  const sockets = new Set();
  for (const fd of fs.readdirSync(`/proc/${owner.child.pid}/fd`)) {
    try {
      const link = fs.readlinkSync(`/proc/${owner.child.pid}/fd/${fd}`);
      if (/^socket:\[\d+\]$/.test(link)) sockets.add(link.slice(8, -1));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const listeners = [];
  for (const table of ['tcp', 'tcp6']) {
    for (const row of fs.readFileSync(`/proc/net/${table}`, 'utf8').trim().split('\n').slice(1)) {
      const columns = row.trim().split(/\s+/);
      if (columns[3] === '0A' && sockets.has(columns[9])) listeners.push({
        table, inode: columns[9], address: columns[1].split(':')[0], port: parseInt(columns[1].split(':')[1], 16) });
    }
  }
  check(sameProcess(owner), 'CHILD_IDENTITY');
  return listeners;
}
async function freePort(deadline) {
  remaining(deadline);
  const reservation = net.createServer();
  await new Promise((resolve, reject) => reservation.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  return port; // The post-spawn PID/socket/marker checks close this reservation race.
}
async function startServer(pkg, stage, marker, owners, deadline) {
  const port = await freePort(deadline);
  const args = pkg.name === 'serve'
    ? [pkg.bin, stage, '--listen', `tcp://127.0.0.1:${port}`, '--no-clipboard', '--no-port-switching']
    : [pkg.bin, stage, '--host', '127.0.0.1', '--port', String(port)];
  const child = spawn(process.execPath, args, { cwd: stage, detached: true,
    // NO_UPDATE_CHECK is the upstream serve14.2.6 early return, not a CI heuristic.
    env: { PATH: path.dirname(process.execPath), NO_UPDATE_CHECK: '1', CI: '1',
      HOST: '127.0.0.1', PORT: String(port), FORCE_COLOR: '0', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  const owner = { child, port, ticks: null, closed: false, stdoutBytes: 0, stderrBytes: 0 };
  owners.push(owner);
  child.on('error', () => { owner.spawnError = true; });
  child.on('close', () => { owner.closed = true; });
  for (const [stream, key] of [[child.stdout, 'stdoutBytes'], [child.stderr, 'stderrBytes']]) {
    stream.on('data', (chunk) => { owner[key] += chunk.length; });
  }
  const id = identity(child.pid);
  check(id && id.group === child.pid, 'CHILD_GROUP');
  owner.ticks = id.ticks;
  const startup = Math.min(deadline, performance.now() + 10000);
  while (true) {
    remaining(startup);
    check(!owner.closed && !owner.spawnError && sameProcess(owner), 'CHILD_EXITED');
    check(owner.stdoutBytes + owner.stderrBytes <= 128 * 1024, 'CHILD_OUTPUT_LIMIT');
    const listeners = ownedListeners(owner);
    if (listeners.length) {
      owner.listenerInodes = listeners.map((item) => item.inode);
      check(listeners.length === 1 && listeners[0].table === 'tcp'
        && listeners[0].address === '0100007F' && listeners[0].port === port, 'UNEXPECTED_LISTENER');
      const proof = await request('127.0.0.1', port, '/__docs_server_identity.txt', 'GET', startup);
      check(proof.status === 200 && proof.body.equals(marker), 'SERVER_IDENTITY');
      return owner;
    }
    await delay(Math.min(40, remaining(startup)));
  }
}
async function stopServer(owner, deadline) {
  if (!owner.closed && sameProcess(owner)) {
    check(identity(owner.child.pid).group === owner.child.pid, 'CLEANUP_GROUP');
    process.kill(-owner.child.pid, 'SIGTERM');
    const grace = Math.min(deadline, performance.now() + 1500);
    while (!owner.closed && performance.now() < grace) await delay(20);
    if (!owner.closed && sameProcess(owner)) process.kill(-owner.child.pid, 'SIGKILL');
  }
  while (!owner.closed && performance.now() < deadline) await delay(20);
  check(owner.closed && !sameProcess(owner), 'CLEANUP_CHILD');
  const originalSocketsAbsent = !owner.listenerInodes || owner.listenerInodes.every((inode) =>
    ['tcp', 'tcp6'].every((table) => !fs.readFileSync(`/proc/net/${table}`, 'utf8').trim().split('\n')
      .slice(1).some((row) => { const fields = row.trim().split(/\s+/); return fields[3] === '0A' && fields[9] === inode; })));
  check(originalSocketsAbsent, 'CLEANUP_SOCKET');
  // Do not signal a listener that won the reservation race or appeared later.
  return { reaped: true, originalPidAbsent: true, originalSocketsAbsent, port: owner.port };
}
async function contract(owner, docs, marker, deadline) {
  const rows = [];
  for (const item of publicCases()) {
    rows.push(await contentCase('127.0.0.1', owner.port, docs, item, deadline));
    if (['root', 'web3-directory', 'wallet-js', 'json'].includes(item.name))
      rows.push(await contentCase('127.0.0.1', owner.port, docs, item, deadline, 'HEAD'));
  }
  const prefix = '/__docs_server_contract/';
  for (const [name, url, file, extension] of [
    ['fixture-explicit', 'nested/page.html', 'nested/page.html', 'html'],
    ['fixture-extensionless', 'nested/page', 'nested/page.html', 'html'],
    ['fixture-query', 'nested/page.html?contract=1', 'nested/page.html', 'html'],
    ['fixture-json', 'data.json', 'data.json', 'json'],
    ['fixture-text', 'note.txt', 'note.txt', 'txt'],
  ]) rows.push(await contentCase('127.0.0.1', owner.port, docs,
    { name, url: prefix + url, file: `__docs_server_contract/${file}`, extension }, deadline));
  for (const pageName of ['fixture-explicit', 'fixture-extensionless', 'fixture-query']) {
    const page = rows.find((row) => row.case === pageName);
    const html = regular(path.join(docs, '__docs_server_contract/nested/page.html')).toString('utf8');
    for (const match of html.matchAll(/(?:href|src)="(\.\/[^"#]+)"/g)) {
      const next = new URL(match[1], `http://127.0.0.1:${owner.port}${page.finalPath}`);
      const relative = next.pathname.slice(1);
      const extension = path.extname(relative).slice(1);
      rows.push(await contentCase('127.0.0.1', owner.port, docs,
        { name: `${pageName}-relative-${extension}`, url: next.pathname + next.search, file: relative, extension }, deadline));
    }
  }
  // Real wiki's relative resources must work after either canonical URL form.
  for (const name of ['wiki-explicit', 'wiki-extensionless']) {
    const page = rows.find((row) => row.case === name);
    for (const relative of ['../assets/wallet-core.js', '../assets/redesign-skin.css?v=20261023-p1']) {
      check(regular(path.join(docs, 'wiki/wallet-guide.html')).includes(Buffer.from(relative)), 'WIKI_LINK_SOURCE');
      const next = new URL(relative, `http://127.0.0.1:${owner.port}${page.finalPath}`);
      rows.push(await contentCase('127.0.0.1', owner.port, docs, { name: `${name}-relative`,
        url: next.pathname + next.search, file: next.pathname.slice(1), extension: path.extname(next.pathname).slice(1) }, deadline));
    }
  }
  const outside = regular(path.join(path.dirname(docs), 'outside-sentinel.txt'));
  activeCase = 'negative-route';
  for (const target of ['/__docs_server_absent', '/wiki/__docs_server_absent',
    '/../outside-sentinel.txt', '/%2e%2e/outside-sentinel.txt', '/%2e%2e%2foutside-sentinel.txt',
    '/__docs_server_contract/../../outside-sentinel.txt']) {
    const response = await request('127.0.0.1', owner.port, target, 'GET', deadline);
    check([400, 403, 404].includes(response.status) && !response.body.includes(outside)
      && !response.body.equals(regular(path.join(docs, 'index.html'))), 'ROOT_CONFINEMENT_OR_SPA');
    rows.push({ case: 'negative-route', status: response.status, bytes: response.body.length });
  }
  const live = ownedListeners(owner);
  check(live.length === 1 && live[0].port === owner.port && live[0].address === '0100007F', 'LISTENER_DRIFT');
  check(owner.stdoutBytes + owner.stderrBytes <= 128 * 1024, 'CHILD_OUTPUT_LIMIT');
  const proof = await request('127.0.0.1', owner.port, '/__docs_server_identity.txt', 'GET', deadline);
  check(proof.status === 200 && proof.body.equals(marker), 'SERVER_IDENTITY');
  return rows;
}
async function cli() {
  const started = performance.now(), hardDeadline = started + 180000, workDeadline = started + WORK_MS;
  const values = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    check(['--baseline-root', '--candidate-root', '--docs-root', '--output'].includes(key)
      && !values[key] && process.argv[i + 1], 'ARGUMENTS');
    values[key] = path.resolve(process.argv[i + 1]);
  }
  check(Object.keys(values).length === 4 && process.platform === 'linux', 'LINUX_QUALIFICATION_REQUIRED');
  const output = values['--output'];
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  check(fs.lstatSync(output).isDirectory() && !fs.lstatSync(output).isSymbolicLink(), 'OUTPUT_DIRECTORY');
  const receiptPath = path.join(output, 'docs-server-compat.json');
  check(!fs.existsSync(receiptPath), 'RECEIPT_EXISTS');
  const owners = [], receipt = { schema: 1, status: 'FAIL', failureCode: null,
    phase: 'ADMISSION',
    network: { host: '127.0.0.1', updateCheckDisabled: true, clipboardDisabled: true },
    servers: [], cleanup: [] };
  let temporary;
  const abort = () => { receipt.failureCode = 'INTERRUPTED'; for (const owner of owners) {
    if (owner.ticks && sameProcess(owner)) process.kill(-owner.child.pid, 'SIGTERM');
  } };
  const watchdog = setTimeout(abort, WORK_MS);
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try {
    const baseline = packageBin(values['--baseline-root'], 'serve', '14.2.6', 'serve');
    const candidate = packageBin(values['--candidate-root'], 'sirv-cli', '3.0.1', 'sirv');
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'inferno-docs-server-'));
    fs.chmodSync(temporary, 0o700);
    receipt.temporaryDirectory = temporary;
    const docs = path.join(temporary, 'docs'), budget = { count: 0, bytes: 0 };
    copyTree(values['--docs-root'], docs, budget, workDeadline);
    copyTree(path.join(ROOT, 'tests/fixtures/docs-server-compat'), path.join(docs, '__docs_server_contract'), budget, workDeadline);
    const marker = Buffer.from(`${crypto.randomBytes(24).toString('hex')}\n`);
    fs.writeFileSync(path.join(docs, '__docs_server_identity.txt'), marker, { flag: 'wx', mode: 0o600 });
    fs.writeFileSync(path.join(temporary, 'outside-sentinel.txt'), crypto.randomBytes(32), { flag: 'wx', mode: 0o600 });
    receipt.source = { files: budget.count, bytes: budget.bytes,
      identitySha256: sha(marker), cases: publicCases().map((item) => ({ path: item.file,
        sha256: sha(regular(path.join(docs, item.file))) })) };
    for (const pkg of [baseline, candidate]) {
      receipt.phase = pkg.name === 'serve' ? 'BASELINE' : 'CANDIDATE';
      check(!receipt.failureCode, 'INTERRUPTED');
      const owner = await startServer(pkg, docs, marker, owners, workDeadline);
      const rows = await contract(owner, docs, marker, workDeadline);
      receipt.servers.push({ package: pkg.name, version: pkg.version, manifestSha256: pkg.manifestSha256,
        binSha256: pkg.binSha256, chosenPort: owner.port, actualPortVerified: true, rows });
      receipt.cleanup.push(await stopServer(owner, Math.min(hardDeadline, performance.now() + 5000)));
    }
    const [before, after] = receipt.servers;
    check(before.rows.length === after.rows.length, 'COMPARISON_SIZE');
    receipt.redirectDifferences = before.rows.flatMap((row, i) =>
      JSON.stringify(row.redirects) !== JSON.stringify(after.rows[i].redirects)
        ? [{ case: row.case, baseline: row.redirects || [], candidate: after.rows[i].redirects || [] }] : []);
    receipt.mimeDifferences = before.rows.flatMap((row, i) => row.mime !== after.rows[i].mime
      ? [{ case: row.case, baseline: row.mime, candidate: after.rows[i].mime }] : []);
    check(!receipt.failureCode, 'INTERRUPTED');
    receipt.phase = 'COMPLETE';
    receipt.status = 'PASS';
  } catch (error) { receipt.failureCode = fixedError(error); receipt.failedCase = activeCase; }
  finally {
    for (const owner of owners.filter((item) => !item.closed)) {
      try { receipt.cleanup.push(await stopServer(owner, hardDeadline)); }
      catch { receipt.status = 'FAIL'; receipt.failureCode = 'CLEANUP_UNCERTAIN'; }
    }
    process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort);
    clearTimeout(watchdog);
    if (temporary && owners.every((owner) => owner.closed)) {
      try { fs.rmSync(temporary, { recursive: true }); }
      catch { receipt.status = 'FAIL'; receipt.failureCode = 'CLEANUP_UNCERTAIN'; }
    }
    receipt.temporaryRemoved = !temporary || !fs.existsSync(temporary);
    if (performance.now() > hardDeadline) { receipt.status = 'FAIL'; receipt.failureCode ||= 'OUTER_DEADLINE'; }
    receipt.elapsedMs = Math.round(performance.now() - started);
    receipt.ownedProcesses = owners.map((owner) => ({ pid: owner.child.pid || null,
      startTicks: owner.ticks, reaped: owner.closed, stdoutBytes: owner.stdoutBytes, stderrBytes: owner.stderrBytes }));
    writeReceipt(receiptPath, receipt);
    // An uncertain cleanup is a failure with retained stage/identities, not an
    // indefinitely live controller. No foreign process is signalled here.
    if (owners.some((owner) => !owner.closed)) {
      for (const owner of owners) { owner.child.unref(); owner.child.stdout.destroy(); owner.child.stderr.destroy(); }
    }
  }
  process.stdout.write(`docs-server-compat: ${receipt.status}\n`);
  if (receipt.status !== 'PASS') process.exitCode = 1;
}

// Playwright1.64.1 runs webServer plugin setup before this hook. Its port-only
// readiness accepts any occupied socket; this hook never starts/stops a listener.
module.exports = async function docsIdentity(fullConfig) {
  let output;
  try {
    const deadline = performance.now() + 10000;
    const configRoot = path.dirname(fullConfig.configFile);
    check(configRoot === ROOT, 'CONFIG_ROOT');
    check(fullConfig.projects.length > 0 && fullConfig.projects.every((project) =>
      project.use.baseURL === 'http://localhost:8787'), 'PLAYWRIGHT_ORIGIN');
    output = path.resolve(fullConfig.projects[0].outputDir);
    fs.mkdirSync(output, { recursive: true, mode: 0o700 });
    check(!fs.existsSync(path.join(output, 'docs-server-identity.json')), 'RECEIPT_EXISTS');
    const docs = path.join(ROOT, 'docs');
    const rows = [];
    for (const item of publicCases()) rows.push(await contentCase('localhost', 8787, docs, item, deadline));
    const absent = await request('localhost', 8787, '/__docs_server_absent', 'GET', deadline);
    check(absent.status === 404, 'REUSED_SERVER_SPA');
    writeReceipt(path.join(output, 'docs-server-identity.json'), { schema: 1, status: 'PASS',
      origin: 'http://localhost:8787', rows, scope: 'current source-bound docs contract; no listener ownership claim' });
  } catch (error) {
    const code = fixedError(error);
    if (output && !fs.existsSync(path.join(output, 'docs-server-identity.json')))
      writeReceipt(path.join(output, 'docs-server-identity.json'), { schema: 1, status: 'FAIL', failureCode: code, failedCase: activeCase });
    throw new Error(`DOCS_SERVER_IDENTITY_${code}`);
  }
};
if (require.main === module) cli().catch(() => { process.stderr.write('docs-server-compat: FIXED_GATE_FAILURE\n'); process.exitCode = 1; });
