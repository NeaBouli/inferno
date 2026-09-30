#!/usr/bin/env node

// Web3 static release helpers for web3.ifrunit.tech (T-160, CWA-47/48/81).
// Pure local logic used by scripts/deploy-web3-site.sh so every rule is testable
// without SSH:
//   stage <sha> <dir>        write the exact-SHA docroot to <dir>/html
//   manifest <html>          print sha256 of the public files the release must serve
//   csp                      print the CSP value from infra/web3
//
// The docroot is the full `docs/` tree (the nginx root route serves
// web3/index.html), overlaid with the web3-host discovery anchors from
// infra/web3 so the host never serves the GitHub Pages sitemap. The host
// nginx.conf includes html/.nginx/web3-security-headers.conf (dot paths are not
// served), so the headers ship byte-for-byte with the docroot.

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const HEADERS_CONF = path.join(root, 'infra', 'web3', 'web3-security-headers.conf');

// Files whose absence caused the 2026-09 drift (vendor 404, stale service worker).
const REQUIRED_FILES = [
  'web3/index.html',
  'web3-wallet-core.js',
  'web3-sw.js',
  'web3-manifest.webmanifest',
  'assets/vendor/ethers-6.17.0.umd.min.js',
  'assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js',
  'robots.txt',
  'sitemap.xml',
  'llms.txt',
];
const HEADERS_TARGET = '.nginx/web3-security-headers.conf';
const OVERLAYS = {
  'infra/web3/robots.txt': 'robots.txt',
  'infra/web3/sitemap.xml': 'sitemap.xml',
  'infra/web3/web3-security-headers.conf': HEADERS_TARGET,
};
const RELEASE_FILE = 'web3-release.json';

function repoCsp(conf = fs.readFileSync(HEADERS_CONF, 'utf8')) {
  const lines = conf.split('\n').filter((line) => /^\s*add_header\s+Content-Security-Policy\s/.test(line));
  assert.equal(lines.length, 1, 'repository headers conf must define exactly one CSP');
  return lines[0].trim();
}

function stage(sha, outDir) {
  assert.match(sha, /^[0-9a-f]{40}$/, 'stage needs a full 40-char commit SHA');
  const html = path.join(outDir, 'html');
  fs.rmSync(html, { recursive: true, force: true });
  fs.mkdirSync(html, { recursive: true });
  // git archive reads the commit, never the working tree, so local edits cannot ship.
  const tar = execFileSync('git', ['archive', '--format=tar', sha, 'docs', 'infra/web3'], { cwd: root, maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', outDir], { input: tar });
  fs.cpSync(path.join(outDir, 'docs'), html, { recursive: true });
  fs.mkdirSync(path.join(html, path.dirname(HEADERS_TARGET)), { recursive: true });
  for (const [from, to] of Object.entries(OVERLAYS)) fs.copyFileSync(path.join(outDir, from), path.join(html, to));
  fs.rmSync(path.join(outDir, 'docs'), { recursive: true, force: true });
  fs.rmSync(path.join(outDir, 'infra'), { recursive: true, force: true });
  fs.writeFileSync(path.join(html, RELEASE_FILE), `${JSON.stringify({ sha })}\n`);
  for (const file of REQUIRED_FILES) assert.ok(fs.existsSync(path.join(html, file)), `staged docroot is missing ${file}`);
  const sitemap = fs.readFileSync(path.join(html, 'sitemap.xml'), 'utf8');
  for (const [, loc] of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    assert.ok(loc.startsWith('https://web3.ifrunit.tech/'), `web3 sitemap must use same-host URLs: ${loc}`);
  }
  return html;
}

function manifest(html) {
  const out = {};
  for (const file of [...REQUIRED_FILES, RELEASE_FILE]) {
    out[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(html, file))).digest('hex');
  }
  return out;
}

module.exports = { REQUIRED_FILES, RELEASE_FILE, HEADERS_TARGET, repoCsp, stage, manifest };

if (require.main === module) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'stage') process.stdout.write(`${stage(a, b)}\n`);
  else if (cmd === 'manifest') {
    for (const [file, hash] of Object.entries(manifest(a))) process.stdout.write(`${hash}  ${file}\n`);
  } else if (cmd === 'csp') process.stdout.write(`${repoCsp().replace(/^add_header\s+Content-Security-Policy\s+"|"\s+always;$/g, '')}\n`);
  else {
    process.stderr.write('usage: web3-release.cjs stage <sha> <dir> | manifest <html> | csp\n');
    process.exit(2);
  }
}
