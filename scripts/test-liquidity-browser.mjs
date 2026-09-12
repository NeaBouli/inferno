import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve('docs');
const server = createServer(async (req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(file);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
try {
  for (const [name, width, height] of [['desktop', 1440, 1000], ['ipad', 820, 1180], ['android', 360, 800]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.clock.install();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/ethers-6.17.0.umd.min.js', route => route.fulfill({ contentType: 'text/javascript', body: `
      window.ethers = {
        FetchRequest: class {},
        JsonRpcProvider: class {
          async getNetwork(){ if(window.failRPC) throw new Error('offline'); if(window.delayRPC) await new Promise(resolve => {window.resolveRPC = resolve;}); return {chainId:1n}; }
          async getBlock(){return {number:123,timestamp:Math.floor(Date.now()/1000)};}
          destroy(){}
        },
        Contract: class {
          async token0(){return '0x77e99917Eca8539c62F509ED1193ac36580A6e7B';}
          async token1(){return '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';}
          async getReserves(){return [1000000000000000n,20000000000000000n];}
          async feeExempt(){return true;}
        }
      };` })) ;
    await page.goto(`http://127.0.0.1:${server.address().port}/wiki/liquidity.html`);
    await page.waitForFunction(() => document.querySelector('#eth-estimate').textContent === '0.02 ETH');
    await page.evaluate(() => { window.delayRPC = true; });
    await page.locator('#refresh-pool').click();
    await page.clock.fastForward(16000);
    assert.equal(await page.locator('#refresh-pool').isEnabled(), true);
    assert.match(await page.locator('#pool-status').textContent(), /timed out/);
    await page.evaluate(() => { window.delayRPC = false; });
    await page.locator('#refresh-pool').click();
    await page.waitForFunction(() => document.querySelector('#eth-estimate').textContent === '0.02 ETH');
    const currentStatus = await page.locator('#pool-status').textContent();
    await page.clock.fastForward(1000);
    await page.evaluate(async () => { window.resolveRPC(); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(await page.locator('#pool-status').textContent(), currentStatus, 'late older read does not replace current snapshot');
    await page.locator('#ifr-amount').fill('30000000');
    assert.equal(await page.locator('#eth-estimate').textContent(), '0.6 ETH');
    await page.locator('#ifr-amount').fill('1,000');
    assert.match(await page.locator('#eth-estimate').textContent(), /decimal point/);
    await page.locator('#ifr-amount').fill('1000000');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ': no horizontal overflow');
    assert.ok(await page.locator('.guide-topbar img').evaluate(img => img.complete && img.naturalWidth > 0));
    if (width <= 900) {
      await page.locator('#hamburger').click();
      assert.equal(await page.locator('#hamburger').getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('.main').evaluate(main => main.inert), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#hamburger').getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('.main').evaluate(main => main.inert), false);
    }
    await page.screenshot({ path: `/tmp/ifr-liquidity-${name}.png`, fullPage: true });
    await page.clock.fastForward(181000);
    assert.equal(await page.locator('#eth-estimate').textContent(), 'Unavailable');
    await page.evaluate(() => { window.failRPC = true; });
    await page.locator('#refresh-pool').click();
    await page.waitForFunction(() => document.querySelector('#pool-status').textContent.includes('could not be verified'));
    assert.equal(await page.locator('#pool-reserves').textContent(), '');
    await page.evaluate(() => { window.failRPC = false; });
    await page.locator('#refresh-pool').click();
    await page.waitForFunction(() => document.querySelector('#eth-estimate').textContent === '0.02 ETH');
    assert.deepEqual(errors, []);
    await page.close();
    console.log('PASS', name, 'responsive/assets/input/stale/RPC failure/recovery; mocked read-only chain');
  }
  for (const width of [1440, 820, 360]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.clock.install();
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.route('**/liquidity-calculator.mjs', route => route.fulfill({ contentType: 'text/javascript', body: `
      export const units = (v,d) => String(v / 10n ** BigInt(d)) + '.' + String(v % 10n ** BigInt(d)).padStart(d,'0').replace(/0+$/,'');
      export async function readPool() {
        window.gaugeReads = (window.gaugeReads || 0) + 1;
        if(window.gaugeOffline) throw new Error('Offline');
        if(window.gaugeHang) await new Promise(resolve => { window.resolveGauge = resolve; });
        return { eth:250000000000000000n, ifr:1000000000000000n, block:123, timestamp:Math.floor(Date.now()/1000) };
      }` }));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    const gauge = page.locator('#liquidity-gauge');
    await page.waitForFunction(() => document.querySelector('[data-reserve]').textContent === '0.25 WETH');
    assert.equal(await gauge.locator('[data-needle]').evaluate(el => el.hidden), false);
    assert.equal(await gauge.locator('[data-live]').textContent(), 'Live');
    assert.equal(await gauge.locator('button').count(), 0);
    assert.match(await gauge.locator('[data-target]').textContent(), /9.8703 WETH/);
    await gauge.locator('[data-buy]').fill('0.001');
    assert.equal(await gauge.locator('[data-needle]').evaluate(el => el.style.transform), 'rotate(90deg)');
    await gauge.locator('[data-buy]').fill('0');
    assert.equal(await gauge.locator('[data-needle]').evaluate(el => el.hidden), true);
    await gauge.locator('[data-buy]').fill('0.1');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    // Read both rectangles in one frame: their shared reveal animation can move
    // between separate browser round trips after input focus scrolls the page.
    const placement = await page.evaluate(() => {
      const ledger = document.querySelector('.hero-ledger-stack .ledger').getBoundingClientRect();
      const dial = document.querySelector('#liquidity-gauge').getBoundingClientRect();
      return { visible: dial.width > 0 && dial.height > 0, below: ledger.height === 0 || dial.top >= ledger.bottom };
    });
    assert.ok(placement.visible, 'gauge visible at every viewport');
    assert.ok(placement.below, 'gauge below protocol ledger');
    await gauge.scrollIntoViewIfNeeded();
    await gauge.screenshot({ path: `/tmp/ifr-gauge-${width}.png` });
    await page.clock.fastForward(60000);
    await page.waitForFunction(() => document.querySelector('[data-live]').textContent === 'Live');
    await page.evaluate(() => { window.gaugeOffline = true; });
    await page.clock.fastForward(60000);
    await page.waitForFunction(() => document.querySelector('[data-status]').textContent.includes('could not be verified'));
    await page.evaluate(() => { window.gaugeOffline = false; window.gaugeHang = true; });
    await page.clock.fastForward(60000);
    await page.clock.fastForward(16000);
    assert.equal(await gauge.locator('[data-live]').textContent(), 'Unavailable');
    assert.match(await gauge.locator('[data-status]').textContent(), /timed out/);
    const timedOutReads = await page.evaluate(() => window.gaugeReads);
    await page.clock.fastForward(60000);
    assert.equal(await page.evaluate(() => window.gaugeReads), timedOutReads, 'no overlapping read while old request remains pending');
    await page.evaluate(() => { window.gaugeHang = false; window.resolveGauge(); });
    assert.equal(await gauge.locator('[data-reserve]').textContent(), 'Unavailable', 'late response remains rejected');
    await page.clock.fastForward(60000);
    await page.waitForFunction(() => document.querySelector('[data-reserve]').textContent === '0.25 WETH');
    assert.equal(await gauge.locator('.gauge-actions a').getAttribute('href'), 'wiki/liquidity.html');
    await page.close();
    console.log('PASS landing gauge', width, 'placement/scale/stale/error/timeout/late response/retry');
  }
  if (process.env.RUN_LIVE_POOL === '1') {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/wiki/liquidity.html`);
    await page.waitForFunction(() => document.querySelector('#pool-status').textContent.includes('Pool fee exemption active'), undefined, { timeout: 25000 });
    assert.match(await page.locator('#eth-estimate').textContent(), / ETH$/);
    console.log('PASS live browser public RPC/CORS/ethers bundle', await page.locator('#pool-status').textContent());
    await page.close();
  }
  const landing = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await landing.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await landing.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await landing.getByText('Provide IFR / ETH liquidity', { exact: true }).click();
  await landing.getByText('What would you like to do with liquidity?', { exact: true }).waitFor();
  assert.equal(await landing.getByText('Calculate matching ETH', { exact: true }).count(), 1);
  await landing.getByText('Calculate matching ETH', { exact: true }).click();
  // Wizard links may open another tab; verify the destination independently in source tests.
  console.log('PASS landing first-step liquidity wizard and calculator choice');
  await landing.close();
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
