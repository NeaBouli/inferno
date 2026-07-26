import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const repoRoot = resolve(root, '../..');
const evidencePath = join(repoRoot, 'docs/ifrp-commerce-app/EMBEDDED_WALLET_EVIDENCE.md');
const decisionPath = join(repoRoot, 'docs/ifrp-commerce-app/EMBEDDED_WALLET_DECISION.md');

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
const walletSurface = readFileSync(join(root, 'src/wallet/WalletPrototype.tsx'), 'utf8');

const forbidden = [
  ['Ethereum Mainnet chain import', /import\s*\{[^}]*\bmainnet\b[^}]*\}\s*from\s*['"]viem\/chains['"]/i],
  ['Ethereum Mainnet chain id', /\b(chainId|id)\s*[:=]{1,3}\s*1\b/],
  ['IFR production token address', /0x77e99917eca8539c62f509ed1193ac36580a6e7b/i],
  ['transaction sender', /\b(sendTransaction|sendCalls|writeContract)\b/],
  [
    'message, typed-data or transaction signing',
    /(?:\b(?:useSignMessage|useSignTypedData|useSignTransaction|signMessage(?:Async)?|signTypedData(?:Async)?|signTransaction(?:Async)?|personalSign|personal_sign|eth_sign(?:TypedData(?:_v\d+)?)?)\b|(?:^|[^\w])_signTypedData\b)/,
  ],
  ['token approval', /\b(approve|allowance)\b/i],
  ['protocol mutation', /\b(lock|unlock|swap|redeem|reward)\s*\(/i],
  ['private key handling', /\b(privateKey|mnemonic|seedPhrase|recoveryPhrase)\b/],
  ['browser persistence', /\b(localStorage|sessionStorage|indexedDB)\b/],
  ['custom host network client', /\b(fetch|XMLHttpRequest|WebSocket)\s*(?:\(|\.)/],
  ['QR implementation', /\b(qr-scanner|react-qr-code|BarcodeDetector|getUserMedia)\b/i],
  ['seller or reward API', /\/api\/(?:sellers|sessions|passes|redeem|rewards)\b/i],
  ['MFA bypass', /skipMfa\s*=\s*\{?true\}?/],
];

function assertAllowedContent(content, label = 'source') {
  for (const [boundary, pattern] of forbidden) {
    assert.doesNotMatch(content, pattern, `${boundary} found in ${label}`);
  }
}

for (const source of sources) {
  assertAllowedContent(source.content, relative(root, source.file));
}

assert.match(config, /createOnLogin:\s*'eoa'/, 'Prototype must create an exportable EOA.');
assert.match(config, /disableAnalytics:\s*true/, 'Provider analytics must remain disabled.');
assert.match(
  config,
  /authMethods:\s*\['email'\]\s*,/,
  'Provider authentication must remain exactly email-only.',
);
assert.match(config, /chains:\s*\[sepolia\]/, 'Provider must remain restricted to Sepolia.');
assert.match(config, /announceProvider:\s*false/, 'Prototype provider must not announce globally.');
assert.match(
  walletSurface,
  /<SignIn\s+authMethods=\{\['email'\]\}\s*\/>/,
  'The visible sign-in surface must remain exactly email-only.',
);
assert.match(walletSurface, /skipMfa=\{false\}/, 'Wallet export must retain the provider MFA gate.');
assert.match(joined, /VITE_CDP_PROJECT_ID/, 'Missing configuration must be detected before SDK initialization.');
assert.match(
  joined,
  /className="loading-screen"\s+role="status"/,
  'The lazy loading fallback must expose status semantics.',
);

assert.throws(
  () => assertAllowedContent('const signer = useSignMessage();', 'signing probe'),
  /message, typed-data or transaction signing/,
  'Message-signing capability must fail the source boundary.',
);
assert.throws(
  () => assertAllowedContent('provider.request({ method: "personal_sign" });', 'personal-sign probe'),
  /message, typed-data or transaction signing/,
  'Personal-sign capability must fail the source boundary.',
);
assert.throws(
  () => assertAllowedContent('provider.request({ method: "eth_signTypedData_v4" });', 'typed-data probe'),
  /message, typed-data or transaction signing/,
  'Versioned typed-data signing must fail the source boundary.',
);
assert.throws(
  () => assertAllowedContent('await signer._signTypedData(domain, types, value);', 'ethers signing probe'),
  /message, typed-data or transaction signing/,
  'Ethers typed-data signing must fail the source boundary.',
);
assert.doesNotMatch(
  config.replace("authMethods: ['email']", "authMethods: ['email', 'sms']"),
  /authMethods:\s*\['email'\]\s*,/,
  'Additional authentication methods must fail the email-only invariant.',
);

const expectedEvidenceGateIds = [
  'wallet-creation-repeat-login',
  'key-export-owner-escape',
  'second-device-recovery',
  'lost-primary-auth',
  'linked-auth-takeover-resistance',
  'provider-outage-sdk-failure',
  'secure-mobile-export-no-webview',
  'recovery-trust-model',
  'account-deletion-data-export',
  'accessible-mobile-recovery-warnings',
  'legal-privacy-review',
  'independent-security-review',
].sort();
const evidenceStatuses = new Set(['blocked', 'unverified', 'passed']);
const secretLikePatterns = [
  /0x[0-9a-f]{40,64}\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\b(?:password|secret|api[_-]?key|private[_-]?key)\s*[:=]\s*\S+/i,
  /\b(?:sk_live_|pk_live_|xox[baprs]-)[A-Za-z0-9_-]+/i,
];

function assertNoSecretLikeMaterial(content) {
  for (const pattern of secretLikePatterns) {
    assert.doesNotMatch(content, pattern, 'Evidence contains secret-like or private material.');
  }
}

function extractEvidence(markdown) {
  const match = markdown.match(
    /<!-- EMBEDDED_WALLET_EVIDENCE_JSON_START -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- EMBEDDED_WALLET_EVIDENCE_JSON_END -->/,
  );
  assert.ok(match, 'Embedded-wallet evidence must contain the marked JSON record.');
  return JSON.parse(match[1]);
}

function validateEvidence(record) {
  assert.equal(record.record, 'ifr-embedded-wallet-acceptance', 'Unexpected evidence record type.');
  assert.equal(record.version, 1, 'Unsupported evidence record version.');
  assert.match(record.updated, /^\d{4}-\d{2}-\d{2}$/, 'Evidence update date must use YYYY-MM-DD.');
  assert.ok(Array.isArray(record.gates), 'Evidence gates must be an array.');

  const ids = record.gates.map((gate) => gate.id);
  assert.equal(new Set(ids).size, ids.length, 'Evidence gate IDs must be unique.');
  assert.deepEqual([...ids].sort(), expectedEvidenceGateIds, 'Evidence gate set is incomplete or unknown.');

  for (const gate of record.gates) {
    assert.ok(evidenceStatuses.has(gate.status), `Unsupported status for ${gate.id}.`);
    assert.ok(Array.isArray(gate.artifacts), `Artifacts for ${gate.id} must be an array.`);
    assert.ok(
      gate.artifacts.every((artifact) => typeof artifact === 'string' && artifact.trim()),
      `Artifacts for ${gate.id} must be non-empty string references.`,
    );
    assert.ok(
      gate.artifacts.every(
        (artifact) =>
          /^https:\/\/[^\s]+$/.test(artifact) ||
          /^(?:artifacts|docs\/evidence|screenshots|test-results)\/[A-Za-z0-9._/-]+$/.test(artifact),
      ),
      `Artifacts for ${gate.id} must use HTTPS or an approved repository-relative evidence path.`,
    );

    if (gate.status === 'passed') {
      assert.ok(gate.result?.trim(), `Passed gate ${gate.id} requires a result.`);
      assert.match(
        gate.verifiedAt ?? '',
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
        `Passed gate ${gate.id} requires a UTC verification timestamp.`,
      );
      assert.ok(gate.verifiedBy?.trim(), `Passed gate ${gate.id} requires a reviewer.`);
      assert.ok(gate.artifacts.length > 0, `Passed gate ${gate.id} requires an artifact reference.`);
    } else {
      assert.ok(gate.blocker?.trim(), `Open gate ${gate.id} requires a blocker.`);
      assert.equal(gate.result, '', `Open gate ${gate.id} cannot claim a result.`);
      assert.equal(gate.verifiedAt, null, `Open gate ${gate.id} cannot claim a verification time.`);
      assert.equal(gate.verifiedBy, null, `Open gate ${gate.id} cannot claim a reviewer.`);
      assert.deepEqual(gate.artifacts, [], `Open gate ${gate.id} cannot claim passing artifacts.`);
    }
  }

  assertNoSecretLikeMaterial(JSON.stringify(record));
}

const evidenceMarkdown = readFileSync(evidencePath, 'utf8');
assertNoSecretLikeMaterial(evidenceMarkdown);
const evidence = extractEvidence(evidenceMarkdown);
validateEvidence(evidence);
assert.match(
  readFileSync(decisionPath, 'utf8'),
  /EMBEDDED_WALLET_EVIDENCE\.md/,
  'The decision record must link the evidence gate record.',
);

const missingArtifactProbe = structuredClone(evidence);
missingArtifactProbe.gates[0] = {
  ...missingArtifactProbe.gates[0],
  status: 'passed',
  blocker: '',
  result: 'Repeat login passed.',
  verifiedAt: '2026-07-26T18:00:00Z',
  verifiedBy: 'Independent reviewer',
};
assert.throws(
  () => validateEvidence(missingArtifactProbe),
  /requires an artifact reference/,
  'A passed gate without artifacts must fail.',
);

const secretProbe = structuredClone(evidence);
secretProbe.gates[0].blocker = `Leaked wallet: 0x${'a'.repeat(40)}`;
assert.throws(
  () => validateEvidence(secretProbe),
  /secret-like or private material/,
  'Secret-like evidence must fail.',
);

const artifactPathProbe = structuredClone(evidence);
artifactPathProbe.gates[0] = {
  ...artifactPathProbe.gates[0],
  status: 'passed',
  blocker: '',
  result: 'Repeat login passed.',
  verifiedAt: '2026-07-26T18:00:00Z',
  verifiedBy: 'Independent reviewer',
  artifacts: ['/tmp/unredacted-wallet-session.log'],
};
assert.throws(
  () => validateEvidence(artifactPathProbe),
  /approved repository-relative evidence path/,
  'Absolute or unapproved artifact paths must fail.',
);

console.log(
  `[wallet-prototype-security] PASS (${files.length} allowlisted runtime/config files; ${evidence.gates.length} evidence gates)`,
);
