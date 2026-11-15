const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { expandLandingSections } = require('./helpers/landing-collapse');
const { RPC_URL, TOKEN, FEE_ROUTER, OTHER, FAIL, K, selector, word, addr, flowCalls, answerRpc, answerProxy } = require('./helpers/token-flow-rpc-fixture');

test.describe.configure({ timeout: 60000 });
test.use({ serviceWorkers: 'block', acceptDownloads: false });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = fs.readFileSync(path.join(__dirname, '../../docs/index.html'), 'utf8');
const baseHash = '55ccc14d22a4be613d7e8aef990f7335fee1934d7e4cbd8dd19e7321198320b7';
const candidateTag = '<text x="406" y="310" fill="#9ca3af" font-size="8" data-flow-rpc data-live-key="flow-pool-edge">';
const baseTag = candidateTag.replace('y="310"', 'y="324"');
const key = (contract, signature) => `${contract}:${selector(signature)}`;
const rateKeys = ['senderBurnBps()', 'recipientBurnBps()', 'poolFeeBps()'].map(signature => key(TOKEN, signature));
const protocolKey = key(FEE_ROUTER, 'protocolFeeBps()');
const feeKeys = [...rateKeys, K.poolReceiver, protocolKey, K.collector];
const defaults = {
  pool: '1% pool fee', eth: 'ETH fee', total: 'Transfer fee 3.5% (non-exempt)',
  split: '2.5% burned in-token \u00b7 1% pool fee \u2192 BuybackController', router: 'ETH fee 0.05% \u2192 Controller',
  poolActive: true, ethActive: true, baselineCollision: false,
};
const states = [
  { name: 'loading', loading: true, pool: 'pool fee: loading\u2026', eth: 'ETH fee: loading\u2026',
    total: 'Transfer fee: loading\u2026', split: 'burn and pool fee: loading\u2026', router: 'ETH swap fee: loading\u2026', poolActive: false, ethActive: false },
  { name: 'canonical' },
  { name: 'pool-only-failed', overrides: { [K.poolReceiver]: FAIL }, pool: 'pool fee receiver: unavailable',
    split: '2.5% burned in-token \u00b7 1% pool fee \u2192 unavailable', poolActive: false, baselineCollision: true },
  { name: 'eth-only-failed', overrides: { [K.collector]: FAIL }, eth: 'ETH fee receiver: unavailable',
    router: 'ETH fee 0.05% \u2192 unavailable', ethActive: false },
  { name: 'both-failed-no-provider-equivalent', overrides: Object.fromEntries(feeKeys.map(name => [name, FAIL])),
    pool: 'pool fee receiver: unavailable', eth: 'ETH fee receiver: unavailable', total: 'Transfer fee: unavailable',
    split: 'burn and pool fee: unavailable', router: 'ETH fee: unavailable', poolActive: false, ethActive: false, baselineCollision: true },
  { name: 'changed-receivers', overrides: { [K.poolReceiver]: addr(OTHER), [K.collector]: addr(OTHER) },
    pool: '1% pool fee \u2192 0x1234\u20265678, not here', eth: 'ETH fee \u2192 0x1234\u20265678, not here',
    split: '2.5% burned in-token \u00b7 1% pool fee \u2192 0x1234\u20265678', router: 'ETH fee 0.05% \u2192 0x1234\u20265678',
    poolActive: false, ethActive: false, baselineCollision: true },
  { name: 'zero-rates', overrides: Object.fromEntries([...rateKeys, protocolKey].map(name => [name, word(0n)])),
    pool: '0% pool fee', total: 'Transfer fee 0% (non-exempt)', split: '0% burned in-token \u00b7 0% pool fee \u2192 BuybackController',
    router: 'ETH fee 0% \u2192 Controller', poolActive: false, ethActive: false },
  { name: 'rates-unavailable-not-zero', overrides: Object.fromEntries([...rateKeys, protocolKey].map(name => [name, FAIL])),
    pool: 'pool fee', total: 'Transfer fee: unavailable', split: 'burn and pool fee: unavailable', router: 'ETH fee: unavailable', poolActive: false, ethActive: false },
  { name: 'long-valid-near-caps', overrides: { [rateKeys[0]]: word(0n), [rateKeys[1]]: word(0n), [rateKeys[2]]: word(499n),
    [protocolKey]: word(25n), [K.poolReceiver]: addr(OTHER), [K.collector]: addr(OTHER) },
    pool: '4.99% pool fee \u2192 0x1234\u20265678, not here', eth: 'ETH fee \u2192 0x1234\u20265678, not here', total: 'Transfer fee 4.99% (non-exempt)',
    split: '0% burned in-token \u00b7 4.99% pool fee \u2192 0x1234\u20265678', router: 'ETH fee 0.25% \u2192 0x1234\u20265678',
    poolActive: false, ethActive: false, baselineCollision: true },
].map(state => ({ ...defaults, ...state }));

function assertFit(measurement) {
  expect(measurement.violations, 'full text, visibility, base typography, containment and route semantics').toEqual([]);
  expect(measurement.collisions, 'edge glyph bounds must clear protocol-node strokes, the central circle and connection strokes').toEqual([]);
}

async function sample(svg, state, positions = [310]) {
  const result = await svg.evaluate((root, { state, positions }) => {
    const pool = root.querySelector('[data-live-key="flow-pool-edge"]');
    const originalY = pool.getAttribute('y'), inverse = root.getScreenCTM().inverse();
    const matrix = element => {
      const m = inverse.multiply(element.getScreenCTM());
      if (![m.a, m.b, m.c, m.d, m.e, m.f].every(Number.isFinite) || Math.abs(m.a * m.d - m.b * m.c) < 1e-12) throw new Error('INVALID_SVG_MATRIX');
      return m;
    };
    const point = (m, x, y) => new DOMPoint(x, y).matrixTransform(m);
    const bounds = (element, padding = 0) => {
      const b = element.getBBox(), m = matrix(element);
      if (![b.x, b.y, b.width, b.height, padding].every(Number.isFinite) || b.width < 0 || b.height < 0 || padding < 0) throw new Error('INVALID_SVG_BOUNDS');
      if (Math.abs(m.b) > 1e-8 || Math.abs(m.c) > 1e-8) throw new Error('UNSUPPORTED_ROTATED_NODE');
      const points = [[b.x - padding, b.y - padding], [b.x + b.width + padding, b.y - padding],
        [b.x - padding, b.y + b.height + padding], [b.x + b.width + padding, b.y + b.height + padding]].map(([x, y]) => point(m, x, y));
      return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
        top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) };
    };
    const stroke = element => {
      const style = getComputedStyle(element);
      if (style.vectorEffect !== 'none') throw new Error('UNSUPPORTED_NONSCALING_STROKE');
      const half = parseFloat(style.strokeWidth) / 2;
      if (!Number.isFinite(half) || half <= 0 || style.stroke === 'none') throw new Error('PROTOCOL_STROKE_MISSING');
      return half;
    };
    // Actual protocol nodes only: snapshot/fee frames, legend dots and motion particles are not nodes.
    const nodes = [
      ['lp-reserve', 335, 38], ['bootstrap', 510, 158], ['uniswap', 495, 318], ['liquidity-reserve', 178, 158],
      ['treasury', 55, 158], ['community', 55, 253], ['partner', 150, 338], ['controller', 340, 338],
      ['fee-router', 330, 440], ['burn-reserve', 155, 420], ['builder', 20, 420], ['vesting', 650, 80],
      ['beneficiary', 655, 138], ['ifr-lock', 640, 232], ['user', 640, 328], ['commitment', 640, 408], ['lending', 500, 464],
    ].map(([name, x, y]) => {
      const element = root.querySelector(`rect[x="${x}"][y="${y}"]`);
      if (!element) throw new Error('PROTOCOL_NODE_MISSING');
      return { name, box: bounds(element, stroke(element)) };
    });
    const circle = root.querySelector('circle[cx="400"][cy="260"][r="42"]');
    if (!circle) throw new Error('TOKEN_CIRCLE_MISSING');
    const cm = matrix(circle);
    if (Math.abs(cm.b) > 1e-8 || Math.abs(cm.c) > 1e-8 || Math.abs(cm.a - cm.d) > 1e-8) throw new Error('UNSUPPORTED_CIRCLE_TRANSFORM');
    const center = point(cm, circle.cx.baseVal.value, circle.cy.baseVal.value);
    const radius = (circle.r.baseVal.value + stroke(circle)) * Math.abs(cm.a);
    const lines = [...root.querySelectorAll('line')].map((line, index) => {
      const m = matrix(line);
      if (Math.abs(m.b) > 1e-8 || Math.abs(m.c) > 1e-8 || Math.abs(m.a - m.d) > 1e-8) throw new Error('UNSUPPORTED_LINE_TRANSFORM');
      return { name: `connection-${index}`, a: point(m, line.x1.baseVal.value, line.y1.baseVal.value),
        b: point(m, line.x2.baseVal.value, line.y2.baseVal.value), half: stroke(line) * Math.abs(m.a) };
    });
    const overlaps = (a, b) => a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
    const crosses = (box, line) => {
      let low = 0, high = 1;
      for (const [axis, min, max] of [['x', box.left - line.half, box.right + line.half], ['y', box.top - line.half, box.bottom + line.half]]) {
        const delta = line.b[axis] - line.a[axis];
        if (Math.abs(delta) < 1e-10) { if (line.a[axis] < min || line.a[axis] > max) return false; }
        else {
          const first = (min - line.a[axis]) / delta, second = (max - line.a[axis]) / delta;
          low = Math.max(low, Math.min(first, second)); high = Math.min(high, Math.max(first, second));
          if (low > high) return false;
        }
      }
      return true;
    };
    const snapshot = () => {
      const violations = [], collisions = [], labels = [];
      for (const [name, expected] of [['flow-pool-edge', state.pool], ['flow-eth-edge', state.eth]]) {
        const element = root.querySelector(`[data-live-key="${name}"]`), style = getComputedStyle(element), box = bounds(element);
        const m = element.getScreenCTM();
        let visible = element.getClientRects().length > 0;
        for (let parent = element; parent; parent = parent.parentElement) {
          const s = getComputedStyle(parent);
          visible &&= s.display !== 'none' && s.visibility === 'visible' && Number(s.opacity) > 0;
        }
        visible &&= style.fill !== 'none' && Number(style.fillOpacity) > 0;
        if (!visible || box.right <= box.left || box.bottom <= box.top) violations.push(`${name}:visible`);
        if (element.textContent !== expected) violations.push(`${name}:exact-text`);
        if (element.getAttribute('font-size') !== '8' || style.fontSize !== '8px') violations.push(`${name}:font-size`);
        const v = root.viewBox.baseVal;
        if (box.left < v.x || box.top < v.y || box.right > v.x + v.width || box.bottom > v.y + v.height) violations.push(`${name}:svg-containment`);
        if (![m.a, m.b, m.c, m.d, m.e, m.f, box.left, box.right, box.top, box.bottom].every(Number.isFinite) || Math.abs(m.a * m.d - m.b * m.c) < 1e-12) violations.push(`${name}:matrix`);
        for (const node of nodes) if (overlaps(box, node.box)) collisions.push({ label: name, target: node.name });
        const dx = Math.max(box.left - center.x, 0, center.x - box.right), dy = Math.max(box.top - center.y, 0, center.y - box.bottom);
        const circleClearance = Math.hypot(dx, dy) - radius;
        if (circleClearance <= 0) collisions.push({ label: name, target: 'token-circle' });
        for (const line of lines) if (crosses(box, line)) collisions.push({ label: name, target: line.name });
        labels.push({ name, text: element.textContent, box, visible, fontFamily: style.fontFamily, fontSize: style.fontSize,
          attributeFontSize: element.getAttribute('font-size'), circleClearance, screenCTM: [m.a, m.b, m.c, m.d, m.e, m.f] });
      }
      const routes = {};
      for (const name of ['pool', 'eth']) {
        const active = state[`${name}Active`], expected = state.loading ? null : active ? 'active' : 'unconfirmed';
        const elements = [...root.querySelectorAll(`[data-flow-route="${name}"]`)];
        if (elements.length !== 2) violations.push(`${name}:route-count`);
        routes[name] = elements.map(element => {
          const line = element.tagName.toLowerCase() === 'line', routeState = element.getAttribute('data-route-state');
          if (routeState !== expected || (line ? element.hasAttribute('stroke-dasharray') !== !active : element.getAttribute('visibility') !== (active ? 'visible' : 'hidden'))) violations.push(`${name}:route-state`);
          return { tag: element.tagName, state: routeState, dashed: element.hasAttribute('stroke-dasharray'), visibility: element.getAttribute('visibility') };
        });
      }
      const clone = root.cloneNode(true); clone.querySelector('[data-live-key="flow-pool-edge"]').removeAttribute('y');
      return { y: pool.getAttribute('y'), violations, collisions, labels, routes, nodes, circle: { x: center.x, y: center.y, radius },
        connections: lines.map(line => ({ name: line.name, a: { x: line.a.x, y: line.a.y }, b: { x: line.b.x, y: line.b.y }, halfStroke: line.half })),
        markup: clone.outerHTML };
    };
    try { return positions.map(y => { pool.setAttribute('y', String(y)); return snapshot(); }); }
    finally { pool.setAttribute('y', originalY); }
  }, { state: { pool: state.pool, eth: state.eth, poolActive: state.poolActive, ethActive: state.ethActive, loading: !!state.loading }, positions });
  return result.map(({ markup, ...measurement }) => ({ ...measurement, normalizedDOMSHA256: hash(markup) }));
}

for (const [width, height] of [[375, 812], [390, 844], [820, 1180], [1180, 820], [1440, 1000]]) {
  for (const state of states) {
    test(`fee edge glyph/stroke control ${state.name} at ${width}x${height}`, async ({ page }, info) => {
      const observations = { state: state.name, viewport: { width, height }, classification: 'NOT_MEASURED',
        sourceSHA256: hash(source), baselineSourceSHA256: baseHash, syntheticData: true, walletOrProviderConnection: false, mutations: [] };
      const fontTasks = [], fontFailures = [], errors = [], rpcFailures = [], held = new Set(), pendingRPC = new Set();
      const remoteFonts = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
      let release, blockedRequests = 0;
      const gate = new Promise(resolve => { release = resolve; });
      try {
        expect(source.split(candidateTag)).toHaveLength(2);
        expect(hash(source.replace(candidateTag, baseTag)), 'outside the one y attribute, frozen Main HTML must be byte-identical').toBe(baseHash);
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        page.on('pageerror', error => errors.push(error.name));
        page.on('requestfailed', request => { if (remoteFonts.has(new URL(request.url()).hostname)) fontFailures.push('FONT_REQUEST_FAILED'); });
        page.on('response', response => {
          if (remoteFonts.has(new URL(response.url()).hostname)) fontTasks.push(response.body()
            .then(bytes => ({ url: response.url(), status: response.status(), bytes: bytes.length, sha256: hash(bytes) }))
            .catch(() => ({ url: response.url(), status: response.status(), error: 'FONT_BODY_UNAVAILABLE' })));
        });
        await page.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.protocol === 'https:' && remoteFonts.has(url.hostname)) return route.continue();
          blockedRequests++; return route.abort();
        });
        await answerProxy(page);
        const respond = answerRpc(flowCalls(state.overrides));
        await page.route(RPC_URL, async route => {
          let done;
          const completion = new Promise(resolve => { done = resolve; });
          pendingRPC.add(completion);
          try {
            const body = route.request().postDataJSON(), requests = Array.isArray(body) ? body : [body];
            const keys = requests.filter(req => req.method === 'eth_call').map(req => `${String(req.params[0].to).toLowerCase()}:${String(req.params[0].data).slice(0, 10)}`);
            if (state.loading && keys.some(name => feeKeys.includes(name))) {
              keys.filter(name => feeKeys.includes(name)).forEach(name => held.add(name));
              await gate;
            }
            await respond(route);
          } catch (error) { rpcFailures.push(error.name); throw error; }
          finally { done(); pendingRPC.delete(completion); }
        });
        await page.goto('/');
        const flow = page.locator('#token-flow'), svg = flow.locator('svg[data-flow-motion]');
        observations.usedFonts = await svg.evaluate(async (root, texts) => {
          const rows = [];
          for (const [name, text] of texts) {
            const style = getComputedStyle(root.querySelector(`[data-live-key="${name}"]`));
            const family = style.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
            const spec = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${JSON.stringify(family)}`;
            const faces = await document.fonts.load(spec, text);
            rows.push({ name, family, spec, faces: faces.length, checked: document.fonts.check(spec, text),
              loaded: faces.length > 0 && faces.every(face => face.status === 'loaded' && face.family.replace(/^["']|["']$/g, '') === family) });
          }
          await document.fonts.ready;
          return rows;
        }, [['flow-pool-edge', state.pool], ['flow-eth-edge', state.eth]]);
        expect(observations.usedFonts).toHaveLength(2);
        expect(observations.usedFonts.every(font => font.loaded && font.checked), 'actual edge-label custom fonts, not fallback-only glyphs').toBe(true);
        await expandLandingSections(page, 'token-flow');
        await svg.scrollIntoViewIfNeeded();
        if (state.loading) await expect.poll(() => feeKeys.every(name => held.has(name)), { timeout: 3000 }).toBe(true);
        for (const [name, text] of [['flow-pool-edge', state.pool], ['flow-eth-edge', state.eth], ['flow-fee-total', state.total], ['flow-fee-split', state.split], ['flow-feerouter-bps', state.router]]) {
          await expect(flow.locator(`[data-live-key="${name}"]`)).toHaveText(text);
        }
        const [baseline, candidate] = await sample(svg, state, [324, 310]);
        observations.baseline = baseline; observations.candidate = candidate;
        expect(baseline.normalizedDOMSHA256).toBe(candidate.normalizedDOMSHA256);
        expect(baseline.violations).toEqual([]);
        const reproduced = baseline.collisions.some(item => item.label === 'flow-pool-edge' && item.target === 'uniswap');
        observations.classification = state.baselineCollision ? reproduced ? 'BASELINE_REPRODUCED_CANDIDATE_PENDING' : 'UNKNOWN_BASELINE_NOT_REPRODUCED' : 'FITTING_BASELINE_COUNTERCASE';
        const pool = flow.locator('[data-live-key="flow-pool-edge"]');
        await pool.evaluate(element => element.setAttribute('y', '324'));
        try {
          const png = await svg.screenshot({ path: info.outputPath('baseline-y324.png'), animations: 'disabled' });
          observations.baselinePNG = { bytes: png.length, sha256: hash(png) };
        } finally { await pool.evaluate(element => element.setAttribute('y', '310')); }
        const png = await svg.screenshot({ path: info.outputPath('candidate-y310.png'), animations: 'disabled' });
        observations.candidatePNG = { bytes: png.length, sha256: hash(png) };
        if (state.baselineCollision) {
          expect(reproduced, 'old y324 must reproduce the claimed real-font Uniswap collision; otherwise HOLD, not adoption').toBe(true);
          expect(() => assertFit(baseline)).toThrow();
          observations.reversionRejected = true;
        } else { expect(reproduced).toBe(false); assertFit(baseline); }
        assertFit(candidate);
        for (const mutation of ['hide', 'truncate', 'shrink']) {
          const saved = await pool.evaluate(element => ({ style: element.getAttribute('style'), text: element.textContent, size: element.getAttribute('font-size') }));
          try {
            await pool.evaluate((element, kind) => {
              if (kind === 'hide') element.style.setProperty('visibility', 'hidden', 'important');
              if (kind === 'truncate') element.textContent = element.textContent.slice(0, -1);
              if (kind === 'shrink') element.setAttribute('font-size', '7');
            }, mutation);
            const [negative] = await sample(svg, state);
            expect(negative.violations).toContain(`flow-pool-edge:${{ hide: 'visible', truncate: 'exact-text', shrink: 'font-size' }[mutation]}`);
            expect(() => assertFit(negative)).toThrow();
            observations.mutations.push({ mutation, rejectedBy: negative.violations });
          } finally {
            await pool.evaluate((element, saved) => {
              if (saved.style === null) element.removeAttribute('style'); else element.setAttribute('style', saved.style);
              element.textContent = saved.text; element.setAttribute('font-size', saved.size);
            }, saved);
          }
        }
        const inactive = ['pool', 'eth'].find(name => !state[`${name}Active`]);
        if (inactive) {
          const routes = flow.locator(`[data-flow-route="${inactive}"]`);
          const saved = await routes.evaluateAll(elements => elements.map(element => ['data-route-state', 'stroke-dasharray', 'visibility'].map(name => [name, element.getAttribute(name)])));
          try {
            await routes.evaluateAll(elements => elements.forEach(element => {
              element.setAttribute('data-route-state', 'active');
              if (element.tagName.toLowerCase() === 'line') element.removeAttribute('stroke-dasharray'); else element.setAttribute('visibility', 'visible');
            }));
            const [negative] = await sample(svg, state);
            expect(negative.violations).toContain(`${inactive}:route-state`);
            expect(() => assertFit(negative)).toThrow();
            observations.mutations.push({ mutation: 'activate-unconfirmed-route', rejectedBy: negative.violations });
          } finally {
            await routes.evaluateAll((elements, saved) => elements.forEach((element, index) => saved[index].forEach(([name, value]) => {
              if (value === null) element.removeAttribute(name); else element.setAttribute(name, value);
            })), saved);
          }
        }
        const [restored] = await sample(svg, state); assertFit(restored);
        observations.restored = restored;
        expect(restored.labels.map(label => [label.text, label.fontSize, label.attributeFontSize, label.box]))
          .toEqual(candidate.labels.map(label => [label.text, label.fontSize, label.attributeFontSize, label.box]));
        const fonts = await Promise.all(fontTasks);
        expect(fonts.length).toBeGreaterThan(0);
        expect(fonts.every(font => font.status === 200 && font.bytes > 0 && typeof font.sha256 === 'string')).toBe(true);
        expect(fontFailures).toEqual([]); expect(errors).toEqual([]);
        observations.classification = state.baselineCollision ? 'CAUSAL_GEOMETRY_ONLY_VISUAL_REVIEW_PENDING' : 'COUNTERCASE_GEOMETRY_ONLY_VISUAL_REVIEW_PENDING';
      } finally {
        release();
        await Promise.all([...pendingRPC]);
        fs.writeFileSync(info.outputPath('observations.json'), JSON.stringify({ ...observations, eventSHA: process.env.GITHUB_SHA || null,
          fonts: await Promise.all(fontTasks), fontFailures, pageErrors: errors, rpcFailures, delayedReadKeys: [...held], blockedRequests }, null, 2));
      }
    });
  }
}
