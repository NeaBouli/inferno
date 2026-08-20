import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptsDir, '..');
const networkDir = path.resolve(frontendDir, '..');

const [wagmiSource, dockerfile, compose, readme] = await Promise.all([
  readFile(path.join(frontendDir, 'src/lib/wagmi.ts'), 'utf8'),
  readFile(path.join(frontendDir, 'Dockerfile'), 'utf8'),
  readFile(path.join(networkDir, 'docker-compose.production.example.yml'), 'utf8'),
  readFile(path.join(frontendDir, 'README.md'), 'utf8'),
]);

assert.match(wagmiSource, /NEXT_PUBLIC_ETHEREUM_RPC_URL/);
assert.match(wagmiSource, /startsWith\('https:\/\/'\)/);
assert.match(wagmiSource, /https:\/\/ethereum-rpc\.publicnode\.com/);
assert.match(wagmiSource, /https:\/\/ethereum-sepolia-rpc\.publicnode\.com/);
assert.doesNotMatch(wagmiSource, /http\(\)/, 'wallet reads must not fall back to Wagmi generic RPC discovery');
assert.match(dockerfile, /ARG NEXT_PUBLIC_ETHEREUM_RPC_URL=/);
assert.match(dockerfile, /ENV NEXT_PUBLIC_ETHEREUM_RPC_URL=\$\{NEXT_PUBLIC_ETHEREUM_RPC_URL\}/);
assert.match(compose, /NEXT_PUBLIC_ETHEREUM_RPC_URL: "\$\{NEXT_PUBLIC_ETHEREUM_RPC_URL:-\}"/);
assert.match(readme, /browser-safe HTTPS RPC/);

console.log('[wallet-rpc-config] PASS');
