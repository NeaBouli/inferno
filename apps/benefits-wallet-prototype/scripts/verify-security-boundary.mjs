import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
function collectFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (['node_modules', 'dist', '.git'].includes(name)) return [];
    return statSync(path).isDirectory() ? collectFiles(path) : [path];
  });
}

const expectedExecutableFiles = [
  'index.html',
  'package.json',
  'src/main.tsx',
  'src/styles.css',
  'src/vite-env.d.ts',
  'src/wallet/WalletPrototype.tsx',
  'src/wallet/config.ts',
  'vite.config.ts',
];
const files = collectFiles(root).filter((file) => {
  const relativePath = relative(root, file);
  if (relativePath === 'scripts/verify-security-boundary.mjs') return false;
  return relativePath === 'package.json' || /\.(?:[cm]?[jt]sx?|html|css)$/.test(relativePath);
});
const actualExecutableFiles = files.map((file) => relative(root, file)).sort();

assert.deepEqual(
  actualExecutableFiles,
  expectedExecutableFiles,
  'Runtime/config entry points changed. Review and update the explicit security allowlist.',
);

const sources = files.map((file) => ({ file, content: readFileSync(file, 'utf8') }));
const joined = sources.map(({ content }) => content).join('\n');
const config = readFileSync(join(root, 'src/wallet/config.ts'), 'utf8');

const forbidden = [
  ['Ethereum Mainnet chain import', /import\s*\{[^}]*\bmainnet\b[^}]*\}\s*from\s*['"]viem\/chains['"]/i],
  ['Ethereum Mainnet chain id', /\b(chainId|id)\s*[:=]{1,3}\s*1\b/],
  ['IFR production token address', /0x77e99917eca8539c62f509ed1193ac36580a6e7b/i],
  ['transaction sender', /\b(sendTransaction|sendCalls|writeContract)\b/],
  ['token approval', /\b(approve|allowance)\b/i],
  ['protocol mutation', /\b(lock|unlock|swap|redeem|reward)\s*\(/i],
  ['private key handling', /\b(privateKey|mnemonic|seedPhrase|recoveryPhrase)\b/],
  ['browser persistence', /\b(localStorage|sessionStorage|indexedDB)\b/],
  ['custom host network client', /\b(fetch|XMLHttpRequest|WebSocket)\s*(?:\(|\.)/],
  ['QR implementation', /\b(qr-scanner|react-qr-code|BarcodeDetector|getUserMedia)\b/i],
  ['seller or reward API', /\/api\/(?:sellers|sessions|passes|redeem|rewards)\b/i],
  ['MFA bypass', /skipMfa\s*=\s*\{?true\}?/],
];

for (const [label, pattern] of forbidden) {
  const offender = sources.find(({ content }) => pattern.test(content));
  assert.equal(offender, undefined, `${label} found in ${offender ? relative(root, offender.file) : 'source'}`);
}

assert.match(config, /createOnLogin:\s*'eoa'/, 'Prototype must create an exportable EOA.');
assert.match(config, /disableAnalytics:\s*true/, 'Provider analytics must remain disabled.');
assert.match(config, /chains:\s*\[sepolia\]/, 'Provider must remain restricted to Sepolia.');
assert.match(config, /announceProvider:\s*false/, 'Prototype provider must not announce globally.');
assert.match(joined, /skipMfa=\{false\}/, 'Wallet export must retain the provider MFA gate.');
assert.match(joined, /VITE_CDP_PROJECT_ID/, 'Missing configuration must be detected before SDK initialization.');

console.log(`[wallet-prototype-security] PASS (${files.length} allowlisted runtime/config files)`);
