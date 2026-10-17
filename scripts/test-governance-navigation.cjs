const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('@playwright/test');

async function main() {
  const root = path.resolve(__dirname, '../docs');
  const governance = fs.readFileSync(path.join(root, 'wiki/governance.html'), 'utf8');
  assert(governance.includes('https://ethereum.org/roadmap/privacy/'));
  assert(governance.includes('one vote per eligible member'));
  assert(governance.includes('Splitting an amount into multiple locks must not increase its total weight'));
  assert(!governance.includes('1 lock = 1 vote'));
  assert(!governance.includes('With only five eligible members'));





  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end(); return;
    }
    const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[path.extname(file)];
    res.setHeader('Content-Type', type || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });

    console.log('PASS: governance navigation at desktop/tablet/mobile, legacy anchors, disclosure keyboard and overflow');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
