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
  const rag = JSON.parse(fs.readFileSync(path.resolve(root, '../apps/ai-copilot/src/context/wiki-content.json'), 'utf8'));
  const summary = rag.find(entry => entry.slug === 'governance').content;
  for (const state of ['Pending', 'Executable', 'Executed', 'Cancelled']) assert(summary.includes(state));
  assert(!summary.endsWith('...'));
  assert(summary.length <= 2000);
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
    for (const width of [1440, 820, 360]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const base = `http://127.0.0.1:${server.address().port}`;
      await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
      await page.goto(base + '/wiki/governance.html#council-agenda');
      await page.locator('#council-agenda').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.governance-section[open]').count(), 0);
      assert(await page.locator('#council-agenda').isVisible());
      for (const hash of ['self-governance', 'dao-roadmap', 'two-chamber', 'participating', 'council-privacy']) {
        await page.evaluate(hash => { location.hash = hash; }, hash);
        await page.waitForFunction(hash => {
          const el = document.getElementById(hash);
          return !!el && el.getBoundingClientRect().height > 0 && !el.closest('details:not([open])');
        }, hash);
      }
      const summary = page.locator('#council-privacy > summary');
      await summary.focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#council-privacy').getAttribute('open'), null);
      await page.keyboard.press('Enter');
      assert.notEqual(await page.locator('#council-privacy').getAttribute('open'), null);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}: overflow`);
      if (process.env.GOVERNANCE_SCREENSHOTS) {
        await page.goto(base + '/wiki/governance.html#council-agenda');
        await page.reload();
        await page.waitForFunction(() => {
          const y = document.getElementById('council-agenda').getBoundingClientRect().top;
          return y >= 0 && y < 180;
        });
        await page.screenshot({ path: path.join(process.env.GOVERNANCE_SCREENSHOTS, `governance-${width}.png`) });
      }
      await page.close();
    }
    console.log('PASS: governance navigation at desktop/tablet/mobile, legacy anchors, disclosure keyboard and overflow');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
