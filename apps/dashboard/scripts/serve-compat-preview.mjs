// Serves an existing build with a test-only bootstrap; never edits dist or app source.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rpcResponse } from './compat-rpc-fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = await realpath(path.join(root, 'dist'));
const port = Number(process.env.IFR_COMPAT_PREVIEW_PORT || 4178);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local preview port');
const origin = `http://127.0.0.1:${port}`;
async function assetHashes(directory, prefix = '') {
  const result = {};
  for (const item of (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    if (item.isSymbolicLink()) throw new Error('Build symlinks are not served');
    const name = prefix + item.name;
    if (item.isDirectory()) Object.assign(result, await assetHashes(path.join(directory, item.name), name + '/'));
    else if (item.isFile()) result[name] = createHash('sha256')
      .update(await readFile(path.join(directory, item.name))).digest('hex');
  }
  return result;
}
const buildAssets = await assetHashes(dist);
const buildSha256 = createHash('sha256').update(JSON.stringify(buildAssets)).digest('hex');
const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
  const headers = {
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'",
    'x-content-type-options': 'nosniff',
  };
  const finish = (code, body, type = 'application/json') => {
    response.writeHead(code, { ...headers, 'content-type': type });
    response.end(body);
  };
  try {
    if (request.headers.host !== `127.0.0.1:${port}` ||
        (request.headers.origin && request.headers.origin !== origin)) {
      return finish(403, JSON.stringify({ error: 'Loopback preview origin required' }));
    }
    const url = new URL(request.url, origin);
    if (url.pathname === '/__compat__/rpc' && request.method === 'POST') {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 65536) return finish(413, JSON.stringify({ error: 'Synthetic RPC body too large' }));
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const state = url.searchParams.get('fixture') || 'connected';
      if (state === 'loading') await new Promise((resolve) => setTimeout(resolve, 10000));
      const result = Array.isArray(body) ? body.map((call) => rpcResponse(call, state)) : rpcResponse(body, state);
      return finish(200, JSON.stringify(result));
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return finish(405, '{}');
    if (url.pathname === '/__compat__/wallet-fixture.js') {
      return finish(200, await readFile(new URL('./compat-wallet-fixture.js', import.meta.url)), 'text/javascript');
    }
    const decoded = decodeURIComponent(url.pathname);
    const resolved = await realpath(path.join(dist, decoded === '/' ? 'index.html' : decoded));
    if (!resolved.startsWith(dist + path.sep)) return finish(403, '{}');
    let body = await readFile(resolved);
    if (path.extname(resolved) === '.html') {
      if (!body.toString().includes('<head>')) throw new Error('Fixture bootstrap insertion point missing');
      body = Buffer.from(body.toString().replace('<head>', '<head><script src="/__compat__/wallet-fixture.js"></script>'));
    }
    return finish(200, request.method === 'HEAD' ? '' : body, contentTypes[path.extname(resolved)] || 'application/octet-stream');
  } catch (error) {
    return finish(error.code === 'ENOENT' ? 404 : 400, JSON.stringify({ error: 'Invalid preview request' }));
  }
});
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({
  url: origin + '/?fixture=disconnected', syntheticOnly: true, outboundRpc: false,
  realWalletPairing: false, buildDirectory: dist, buildSha256, buildAssets,
})));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
