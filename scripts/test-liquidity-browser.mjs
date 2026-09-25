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
        return { eth:250000000000000000n, ifr:1000000000000000n, block:123, timestamp:Math.floor(Date.now()/1000) - (window.gaugeAge || 0), ethUsd: 'gaugeUsd' in window ? window.gaugeUsd : 250000000000n, ethUsdUpdatedAt: Math.floor(Date.now()/1000) - (window.gaugeAge || 0) - 60 };
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
      const intro = document.querySelector('#hero .container > .reveal').getBoundingClientRect();
      return { visible: dial.width > 0 && dial.height > 0, below: (ledger.height === 0 || dial.top >= ledger.bottom) && dial.top >= intro.bottom, wide: dial.width > innerWidth * .65, height: dial.height };
    });
    assert.ok(placement.visible, 'gauge visible at every viewport');
    assert.ok(placement.below, 'gauge below protocol ledger');
    assert.ok(placement.wide, 'gauge spans hero width rather than ledger column');
    if (width === 1440) assert.ok(placement.height < 560, 'desktop liquidity area stays horizontal and compact');
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
  for (const [name, width, height] of [['desktop', 1440, 1000], ['ipad-landscape', 1180, 820], ['ipad-portrait', 820, 1180], ['mobile', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.clock.install();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.route('**/liquidity-calculator.mjs', route => route.fulfill({ contentType: 'text/javascript', body: `
      export const units = (v,d) => String(v / 10n ** BigInt(d)) + '.' + String(v % 10n ** BigInt(d)).padStart(d,'0').replace(/0+$/,'');
      export async function readPool() {
        window.poolReads = (window.poolReads || 0) + 1;
        window.poolPending = (window.poolPending || 0) + 1;
        window.maxPending = Math.max(window.maxPending || 0, window.poolPending);
        try {
          if(window.poolOffline) throw new Error('Offline');
          if(window.poolHang) await new Promise(resolve => { window.resolvePool = resolve; });
          return { eth:window.poolEth || 250000000000000000n, ifr:1000000000000000n, block:123, timestamp:Math.floor(Date.now()/1000) - (window.poolAge || 0), ethUsd: 'poolUsd' in window ? window.poolUsd : 250000000000n, ethUsdUpdatedAt: window.poolUsdAt === 'future' ? Math.floor(Date.now()/1000) - (window.poolAge || 0) + 5 : 'poolUsdAt' in window ? window.poolUsdAt : Math.floor(Date.now()/1000) - (window.poolAge || 0) - 60 };
        } finally { window.poolPending--; }
      }` }));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    const ref = page.locator('#trade-impact');
    const live = () => page.waitForFunction(() => document.querySelector('#trade-impact').dataset.state === 'live');
    const closed = async label => {
      await page.waitForFunction(() => document.querySelector('#trade-impact').dataset.state === 'unavailable');
      assert.equal(await ref.locator('[data-guidance]').isHidden(), true, label + ': guidance hidden');
      assert.equal(await ref.locator('[data-reference-unavailable]').isVisible(), true, label + ': unavailable state visible');
      assert.equal(await ref.locator('[data-ceiling-eth]').textContent(), '--', label);
      assert.equal(await ref.locator('[data-ceiling-usd]').textContent(), '--', label);
      assert.doesNotMatch(await ref.innerText(), /\d\.\d+ ETH|\$\d/, label + ': no numeric guidance or fallback amount');
      assert.equal(await ref.locator('[data-reference-unavailable] a[href="https://app.uniswap.org/swap?outputCurrency=0x77e99917Eca8539c62F509ED1193ac36580A6e7B"]').count(), 1, label + ': Uniswap quote link');
    };
    await live();
    const values = async () => [await ref.locator('[data-ceiling-eth]').textContent(), await ref.locator('[data-ceiling-usd]').textContent()];
    assert.equal(await ref.locator('input:checked').getAttribute('value'), '50', 'conservative 0.5% default');
    assert.deepEqual(await values(), ['0.00126 ETH', '≈ $3.15']);
    assert.equal(await ref.locator('[data-reference-unavailable]').isHidden(), true);
    assert.match(await ref.locator('[data-reference-block]').textContent(), /block 123/);
    assert.equal(await ref.locator('[data-reference-live]').textContent(), 'Live');
    const readsBefore = await page.evaluate(() => window.poolReads);
    // Keep the control clear of the fixed navigation before pointer interaction.
    await ref.locator('fieldset').evaluate(el => el.scrollIntoView({ block: 'center' }));
    await ref.locator('input:checked').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await ref.locator('input:checked').getAttribute('value'), '100', 'arrow key moves selection');
    assert.deepEqual(await values(), ['0.002532 ETH', '≈ $6.33']);
    assert.equal(await ref.locator('input:checked + span').evaluate(el => getComputedStyle(el).outlineStyle), 'solid', 'visible focus state');
    await ref.locator('label', { hasText: '2%' }).click();
    assert.deepEqual(await values(), ['0.005117 ETH', '≈ $12.79']);
    assert.equal(await ref.locator('input:checked + span').evaluate(el => getComputedStyle(el, '::before').content), '"✓"', 'selected state is not color-only');
    assert.equal(await page.evaluate(() => window.poolReads), readsBefore, 'threshold changes reuse the same snapshot');
    await ref.locator('label', { hasText: '0.5%' }).click();
    assert.equal(await ref.locator('button').count(), 0, 'no manual refresh control');
    assert.equal(await ref.locator('fieldset legend').textContent(), 'Estimated price impact');
    // Layout contract: below the four metrics cards, inside the page container, no overlap/overflow.
    const layout = await page.evaluate(() => {
      const box = el => el.getBoundingClientRect();
      const section = document.querySelector('#trade-impact'), stats = document.querySelector('#about .what-stats'), container = document.querySelector('#about .container');
      const [intro, tool] = [section.querySelector('.ti-intro'), section.querySelector('.ti-tool')].map(box);
      const segments = [...section.querySelectorAll('.ti-thresholds span')].map(box);
      const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      return {
        below: box(section).top >= box(stats).bottom, afterStats: stats.parentElement.nextElementSibling === section,
        inside: box(section).left >= box(container).left - 1 && box(section).right <= box(container).right + 1,
        overflow: document.documentElement.scrollWidth > innerWidth || [...section.querySelectorAll('*')].some(el => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible'),
        overlap: overlap(intro, tool), sideBySide: intro.top === tool.top,
        segments: segments.every(r => r.height >= 44) && segments.every((r, i) => !i || r.left >= segments[i - 1].right - 1 && r.top === segments[0].top),
        nested: section.querySelector('.stat-card, .card') !== null
      };
    });
    assert.ok(layout.below && layout.afterStats, name + ': directly below the metrics grid');
    assert.ok(layout.inside, name + ': inside landing max width');
    assert.equal(layout.overflow, false, name + ': no horizontal scroll or clipping');
    assert.equal(layout.overlap, false, name + ': intro and tool do not overlap');
    assert.equal(layout.sideBySide, width > 900, name + ': two columns only on wide layouts');
    assert.ok(layout.segments, name + ': one-row segmented control with 44px targets');
    assert.equal(layout.nested, false, name + ': no nested cards');
    await ref.scrollIntoViewIfNeeded();
    await ref.screenshot({ path: `/tmp/ifr-trade-impact-${name}.png` });
    // One-minute cadence through the shared poller, never more than one request in flight.
    await page.clock.fastForward(60000);
    await page.waitForFunction(n => window.poolReads === n + 1, readsBefore);
    await live();
    // Partial snapshot: reserves without ETH/USD, and invalid ETH/USD.
    for (const value of [undefined, 0n]) {
      await page.evaluate(v => { window.poolUsd = v; }, value);
      await page.clock.fastForward(60000);
      await closed('ETH/USD ' + String(value));
      assert.equal(await page.locator('#liquidity-gauge').evaluate(el => el.dataset.state), 'live', 'gauge unaffected by missing USD');
    }
    // Feed rejected by the reader (null price and round time) or a round not bound to this snapshot block.
    const gaugeText = () => page.evaluate(() => ['reserve', 'details', 'capacity', 'target'].map(n => document.querySelector(`#liquidity-gauge [data-${n}]`).textContent));
    await page.evaluate(() => { delete window.poolUsd; });
    await page.clock.fastForward(60000);
    await live();
    const liveGauge = await gaugeText();
    for (const [label, usd, at] of [['feed rejected', null, null], ['round time missing', 250000000000n, undefined], ['round after block', 250000000000n, 'future']]) {
      await page.evaluate(([u, t]) => { window.poolUsd = u; window.poolUsdAt = t; }, [usd, at]);
      await page.clock.fastForward(60000);
      await closed(label);
      assert.equal(await page.locator('#liquidity-gauge').evaluate(el => el.dataset.state), 'live', label + ': gauge stays live');
      assert.deepEqual(await gaugeText(), liveGauge, label + ': gauge values unchanged');
      assert.equal(await page.locator('#liquidity-gauge [data-needle]').evaluate(el => el.hidden), false, label + ': needle visible');
    }
    await page.evaluate(() => { delete window.poolUsd; delete window.poolUsdAt; });
    await page.clock.fastForward(60000);
    await live();
    assert.match(await ref.locator('[data-reference-block]').textContent(), /^Pool reserves and ETH\/USD at block 123 · .+; ETH\/USD round updated .+\.$/, 'feed freshness text');
    assert.equal(await ref.locator('[data-guidance] a[href="https://data.chain.link/feeds/ethereum/mainnet/eth-usd"]').textContent(), 'Chainlink ETH/USD', 'feed source link');
    // Stale snapshot expires without a new read.
    await page.evaluate(() => { window.poolAge = 170; });
    await page.clock.fastForward(60000);
    await live();
    await page.clock.fastForward(11000);
    await closed('expired');
    await page.evaluate(() => { window.poolAge = 0; });
    await page.clock.fastForward(60000);
    await live();
    // Invalid reserves and RPC failure.
    await page.evaluate(() => { window.poolEth = -1n; });
    await page.clock.fastForward(60000);
    await closed('invalid reserves');
    await page.evaluate(() => { window.poolEth = 0; window.poolOffline = true; });
    await page.clock.fastForward(60000);
    await closed('rpc failure');
    await page.evaluate(() => { window.poolOffline = false; });
    await page.clock.fastForward(60000);
    await live();
    // Timeout, no parallel duplicate while pending, and superseded late response.
    await page.evaluate(() => { window.poolHang = true; });
    await page.clock.fastForward(60000);
    await page.clock.fastForward(16000);
    await closed('timeout');
    const pendingReads = await page.evaluate(() => window.poolReads);
    await page.clock.fastForward(60000);
    assert.equal(await page.evaluate(() => window.poolReads), pendingReads, 'no duplicate request while one is pending');
    await page.evaluate(async () => { window.poolHang = false; window.resolvePool(); await new Promise(resolve => setTimeout(resolve, 0)); });
    await closed('superseded late response');
    await page.clock.fastForward(60000);
    await live();
    assert.equal(await page.evaluate(() => window.maxPending), 1, 'never more than one pool read in flight');
    assert.deepEqual(errors, []);
    await page.close();
    console.log('PASS trade-impact', name, width + 'x' + height, 'thresholds/keyboard/layout/cadence/partial/invalid/stale/timeout/superseded');
  }
  if (process.env.RUN_LIVE_POOL === '1') {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/wiki/liquidity.html`);
    await page.waitForFunction(() => document.querySelector('#pool-status').textContent.includes('Pool fee exemption active'), undefined, { timeout: 25000 });
    assert.match(await page.locator('#eth-estimate').textContent(), / ETH$/);
    console.log('PASS live browser public RPC/CORS/ethers bundle', await page.locator('#pool-status').textContent());
    await page.close();
    // Landing reference over the same public RPC: reserves and Chainlink ETH/USD from one block.
    const landingLive = await browser.newPage();
    await landingLive.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await landingLive.waitForFunction(() => document.querySelector('#trade-impact').dataset.state === 'live', undefined, { timeout: 25000 });
    assert.match(await landingLive.locator('#trade-impact [data-ceiling-usd]').textContent(), /^≈ \$[\d,]+\.\d{2}$/);
    console.log('PASS live landing trade-impact', await landingLive.locator('#trade-impact [data-ceiling-eth]').textContent(), await landingLive.locator('#trade-impact [data-ceiling-usd]').textContent(), await landingLive.locator('#trade-impact [data-reference-block]').textContent());
    await landingLive.close();
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
