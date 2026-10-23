// Offline lifecycle coverage: no browser, RPC, timers or network access required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
const motionSource = fs.readFileSync(path.join(__dirname, '../docs/assets/page-motion.js'), 'utf8');

function classList() {
  const values = new Set();
  return {
    add: name => values.add(name),
    remove: name => values.delete(name),
    contains: name => values.has(name),
    toggle(name, enabled) { if (enabled) values.add(name); else values.delete(name); },
  };
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, callback, options) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ callback, options });
    },
    emit(type) { for (const { callback } of listeners.get(type) || []) callback(); },
    listeners,
  };
}
function environment() {
  const frames = new Map(), timers = new Map(), observers = [], mutations = [], media = new Map();
  let sequence = 0, contexts = 0, draws = 0, stars = 0, resolveFonts;
  const fills = [];
  const ctx = new Proxy({}, {
    get(target, key) {
      if (key === 'measureText') return () => ({ width: 40 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
      return key in target ? target[key] : () => { draws++; if (key === 'fill') fills.push(target.fillStyle); };
    },
  });
  const hero = { rendered: true, offsetWidth: 1440, offsetHeight: 560,
    getClientRects() { return this.rendered ? [{}] : []; },
    getBoundingClientRect() { return { top: 0, bottom: 560 }; } };
  const nodes = {
    'ifr-bstars': { parentElement: hero, appendChild() { stars++; } },
    'ifr-bh-void': { classList: classList() }, 'ifr-bh-ambient': { classList: classList() },
  };
  for (const id of ['ifr-c-parts', 'ifr-c-shock', 'ifr-c-title', 'dist-donut']) {
    nodes[id] = { width: 520, height: 520, getContext() { contexts++; return ctx; } };
  }
  const document = Object.assign(eventTarget(), {
    hidden: false,
    documentElement: { classList: classList() }, body: {},
    fonts: { ready: new Promise(resolve => { resolveFonts = resolve; }) },
    getElementById: id => nodes[id] || null,
    createElement: () => ({ style: {} }),
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  const window = Object.assign(eventTarget(), {
    innerHeight: 1000,
    matchMedia(query) {
      if (!media.has(query)) media.set(query, Object.assign(eventTarget(), { matches: false }));
      return media.get(query);
    },
  });
  const IntersectionObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
    unobserve() {}
    disconnect() {}
    emit(visible) { this.callback([{ target: this.target, isIntersecting: visible }]); }
  };
  window.IntersectionObserver = IntersectionObserver;
  const navigator = { hardwareConcurrency: 8, deviceMemory: 8 };
  window.navigator = navigator;
  const MutationObserver = class {
    constructor(callback) { this.callback = callback; mutations.push(this); }
    observe() {}
    emit(addedNodes = [], removedNodes = []) { this.callback([{ addedNodes, removedNodes }]); }
  };
  const context = vm.createContext({ document, window, navigator, IntersectionObserver, MutationObserver,
    location: { hash: '' },
    requestAnimationFrame: callback => { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: callback => { const id = ++sequence; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
  });
  return { context, document, window, hero, nodes, observers, mutations, frames, timers, fills,
    ready: resolveFonts, stats: () => ({ contexts, draws, stars }),
    setMedia(query, matches) { const item = media.get(query); item.matches = matches; item.emit('change'); },
    frame(now = 100) { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(now); },
  };
}

async function main() {
  const banner = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(source => source.includes('function createBanner()'));
  assert.ok(banner, 'test the shipped inline banner controller');
  const env = environment();
  vm.runInContext(banner, env.context);
  const observer = env.observers[0];
  assert.deepEqual(env.stats(), { contexts: 0, draws: 0, stars: 0 });
  observer.emit(false);
  env.hero.rendered = false;
  observer.emit(true);
  assert.equal(env.stats().contexts, 0, 'CSS-hidden legacy hero never initializes');
  env.hero.rendered = true;
  env.setMedia('(max-width: 1024px)', true);
  observer.emit(true);
  assert.equal(env.stats().contexts, 0, 'CSS-hidden tablet/mobile canvas never initializes');
  env.setMedia('(prefers-reduced-motion: reduce)', true);
  env.setMedia('(max-width: 1024px)', false);
  assert.equal(env.stats().contexts, 0, 'reduced motion skips canvas and star allocation');
  env.setMedia('(prefers-reduced-motion: reduce)', false);
  assert.equal(env.stats().contexts, 3);
  assert.equal(env.stats().stars, 130);
  assert.equal(env.frames.size, 0, 'wait for fonts before drawing');
  observer.emit(false);
  env.ready();
  await Promise.resolve();
  assert.equal(env.frames.size, 0, 'font completion cannot restart an offscreen banner');
  observer.emit(true);
  observer.emit(true);
  assert.equal(env.frames.size, 1, 'repeated visibility notifications share one frame loop');
  assert.equal(env.timers.size, 2);
  env.frame();
  assert.ok(env.stats().draws > 0);
  assert.equal(env.frames.size, 1);
  observer.emit(false);
  assert.equal(env.frames.size, 0, 'leaving the viewport cancels the next frame');
  assert.equal(env.timers.size, 0, 'leaving the viewport clears delayed effects');
  const beforeResize = env.stats().draws;
  env.window.emit('resize');
  assert.equal(env.stats().draws, beforeResize, 'offscreen resize does no canvas work');
  observer.emit(true);
  assert.equal(env.frames.size, 1);
  env.document.hidden = true;
  env.document.emit('visibilitychange');
  assert.equal(env.frames.size, 0, 'hidden tabs stop rendering');
  env.document.hidden = false;
  env.document.emit('visibilitychange');
  assert.equal(env.frames.size, 1);
  env.setMedia('(prefers-reduced-motion: reduce)', true);
  assert.equal(env.frames.size, 0, 'live preference changes stop rendering');
  env.setMedia('(prefers-reduced-motion: reduce)', false);
  env.setMedia('(max-width: 1024px)', true);
  assert.equal(env.frames.size, 0, 'switching to the static mobile presentation stops rendering');
  assert.equal(env.stats().stars, 130, 'resuming does not duplicate decorative nodes');

  const fallback = environment();
  delete fallback.window.IntersectionObserver;
  vm.runInContext(banner, fallback.context);
  fallback.frame();
  for (let i = 0; i < 10; i++) fallback.window.emit('scroll');
  assert.equal(fallback.frames.size, 1, 'fallback scroll reads are throttled');
  assert.equal(fallback.window.listeners.get('scroll')[0].options.passive, true);

  const lowEnd = environment();
  lowEnd.context.navigator.hardwareConcurrency = 4;
  vm.runInContext(banner, lowEnd.context);
  lowEnd.observers[0].emit(true);
  lowEnd.ready();
  await Promise.resolve();
  assert.equal(lowEnd.stats().stars, 40, 'low-end hardware allocates fewer decorative stars');
  lowEnd.frame(100);
  const firstLowEndDraw = lowEnd.stats().draws;
  lowEnd.frame(116);
  assert.equal(lowEnd.stats().draws, firstLowEndDraw, 'low-end canvas skips frames above 30 fps');
  lowEnd.frame(140);
  assert.ok(lowEnd.stats().draws > firstLowEndDraw, 'low-end canvas keeps animating at the reduced cadence');

  const noAPIs = environment();
  delete noAPIs.context.navigator;
  delete noAPIs.window.navigator;
  noAPIs.window.IntersectionObserver = undefined;
  delete noAPIs.context.IntersectionObserver;
  delete noAPIs.window.matchMedia;
  vm.runInContext(banner, noAPIs.context);
  noAPIs.frame();
  noAPIs.ready();
  await Promise.resolve();
  assert.equal(noAPIs.stats().stars, 130, 'missing hardware information keeps normal quality');
  noAPIs.frame();
  assert.ok(noAPIs.stats().draws > 0, 'banner runs without navigator, matchMedia or IntersectionObserver');

  const decorations = environment();
  const classes = new Set();
  const button = { classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } } };
  decorations.document.querySelectorAll = selector => selector.startsWith('.hero-web3-btn,') ? [button] : [];
  vm.runInContext(motionSource, decorations.context);
  assert.ok(classes.has('site-motion-paused'), 'decorations begin paused until observed');
  decorations.observers[0].emit(true);
  assert.ok(!classes.has('site-motion-paused'));
  decorations.document.hidden = true;
  decorations.document.emit('visibilitychange');
  assert.ok(classes.has('site-motion-paused'));
  decorations.document.hidden = false;
  decorations.document.emit('visibilitychange');
  assert.ok(!classes.has('site-motion-paused'));
  decorations.observers[0].emit(false);
  assert.ok(classes.has('site-motion-paused'));
  decorations.observers[0].emit(true);
  decorations.setMedia('(prefers-reduced-motion: reduce)', true);
  assert.ok(classes.has('site-motion-paused'), 'reduced motion pauses visible CSS decorations');
  decorations.setMedia('(prefers-reduced-motion: reduce)', false);
  assert.ok(!classes.has('site-motion-paused'), 'CSS decorations resume when reduced motion is disabled');
  decorations.setMedia('(max-width: 1024px)', true);
  assert.ok(decorations.document.documentElement.classList.contains('site-motion-limited'), 'compact screens reduce CSS decoration');

  const lowMemory = environment();
  lowMemory.context.navigator.deviceMemory = 4;
  vm.runInContext(motionSource, lowMemory.context);
  assert.ok(lowMemory.document.documentElement.classList.contains('site-motion-limited'), 'low memory reduces CSS decoration');

  const inserted = { nodeType: 1, isConnected: true, classList: classList(), matches: () => true, querySelectorAll: () => [] };
  decorations.mutations[0].emit([inserted]);
  assert.ok(inserted.classList.contains('site-motion-paused'), 'dynamically inserted decorations wait for visibility');
  decorations.observers[0].emit(true);
  assert.ok(!inserted.classList.contains('site-motion-paused'));
  decorations.mutations[0].emit([], [inserted]);
  decorations.document.hidden = true;
  decorations.document.emit('visibilitychange');
  assert.ok(inserted.classList.contains('site-motion-paused'), 'moving a connected decoration preserves its lifecycle');
  inserted.isConnected = false;
  decorations.mutations[0].emit([], [inserted]);
  decorations.document.hidden = false;
  decorations.document.emit('visibilitychange');
  assert.ok(inserted.classList.contains('site-motion-paused'), 'detached decorations are no longer updated');

  const motionFallback = environment();
  const fallbackButton = { classList: classList() };
  motionFallback.document.querySelectorAll = () => [fallbackButton];
  delete motionFallback.context.navigator;
  motionFallback.window.IntersectionObserver = undefined;
  delete motionFallback.window.matchMedia;
  delete motionFallback.context.MutationObserver;
  vm.runInContext(motionSource, motionFallback.context);
  assert.ok(!fallbackButton.classList.contains('site-motion-paused'), 'missing optional APIs leave CSS motion running');
  assert.ok(!motionFallback.document.documentElement.classList.contains('site-motion-limited'));
  motionFallback.document.hidden = true;
  motionFallback.document.emit('visibilitychange');
  assert.ok(fallbackButton.classList.contains('site-motion-paused'), 'visibility handling still works without optional APIs');

  const scroll = environment();
  const operations = [], bars = [];
  const reveals = [40, 20].map(width => {
    const bar = { style: {}, dataset: { width } };
    bars.push(bar);
    return {
      getBoundingClientRect() { operations.push('read'); return { top: 200, bottom: 400 }; },
      classList: { add() { operations.push('write'); }, contains() { return false; } },
      querySelectorAll: () => [bar],
    };
  });
  let scrolled;
  scroll.document.querySelector = () => ({ classList: { toggle(name, value) { scrolled = value; } } });
  scroll.document.querySelectorAll = () => reveals;
  const scrollSource = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(source => source.includes('// Nav scroll effect'));
  vm.runInContext(scrollSource, scroll.context);
  scroll.frame();
  assert.deepEqual(operations, ['read', 'read', 'write', 'write'], 'restore batches layout reads before DOM writes');
  assert.deepEqual(bars.map(bar => bar.style.transform), ['scaleX(0.4)', 'scaleX(0.2)']);
  scroll.window.scrollY = 100;
  for (let i = 0; i < 10; i++) scroll.window.emit('scroll');
  assert.equal(scroll.frames.size, 1, 'scroll bursts schedule one navigation update');
  assert.equal(scroll.window.listeners.get('scroll')[0].options.passive, true);
  scroll.frame();
  assert.equal(scrolled, true);

  const donut = environment();
  Object.assign(donut.context, { CATS: [], REST_COLOR: 'rest', UNAVAILABLE_COLOR: 'unavailable' });
  const start = html.indexOf("  var donutCanvas = document.getElementById('dist-donut');");
  const end = html.indexOf('  // Below 1 IFR', start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(html.slice(start, end), donut.context);
  donut.context.drawDonut(donut.nodes['dist-donut'], { partial: false });
  donut.context.drawDonut(donut.nodes['dist-donut'], { partial: true });
  assert.equal(donut.stats().contexts, 0, 'offscreen chart snapshots do not draw');
  donut.observers[0].emit(true);
  assert.deepEqual(donut.fills, ['unavailable'], 'first visible draw uses the latest snapshot');
  donut.document.hidden = true;
  donut.context.drawDonut(donut.nodes['dist-donut'], { partial: false });
  assert.equal(donut.fills.length, 1);
  donut.document.hidden = false;
  donut.document.emit('visibilitychange');
  assert.deepEqual(donut.fills, ['unavailable', 'rest'], 'resuming paints current data');

  const flowSource = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(source => source.includes('// Token-flow SMIL'));
  assert.ok(flowSource, 'test the shipped token-flow motion controller');
  function flowEnvironment() {
    const env = environment();
    let starts = 0, paused;
    const svg = { dataset: {}, getBoundingClientRect: () => ({ top: 0, bottom: 540 }),
      pauseAnimations() { paused = true; }, unpauseAnimations() { paused = false; },
      querySelectorAll: () => [{ dataset: { motionDelay: '0.7' }, beginElementAt(delay) { assert.equal(delay, 0.7); starts++; } }],
    };
    env.document.querySelector = () => svg;
    return { ...env, svg, starts: () => starts, paused: () => paused };
  }
  const flow = flowEnvironment();
  vm.runInContext(flowSource, flow.context);
  assert.equal(flow.paused(), true, 'SMIL starts paused until observed');
  assert.equal(flow.starts(), 0);
  flow.observers[0].emit(true);
  assert.equal(flow.paused(), false);
  assert.equal(flow.svg.dataset.flowMotion, 'running');
  assert.equal(flow.starts(), 1);
  flow.observers[0].emit(false);
  assert.equal(flow.paused(), true, 'offscreen SMIL pauses');
  flow.observers[0].emit(true);
  assert.equal(flow.starts(), 1, 'resuming does not restart the SMIL timeline');
  flow.document.hidden = true;
  flow.document.emit('visibilitychange');
  assert.equal(flow.paused(), true, 'background tabs pause SMIL');
  flow.document.hidden = false;
  flow.document.emit('visibilitychange');
  assert.equal(flow.paused(), false);
  flow.setMedia('(prefers-reduced-motion: reduce)', true);
  assert.equal(flow.paused(), true, 'reduced motion stops SMIL');
  flow.setMedia('(prefers-reduced-motion: reduce)', false);
  flow.setMedia('(max-width: 1024px)', true);
  assert.equal(flow.paused(), true, 'compact screens skip SMIL');
  const limitedFlow = flowEnvironment();
  limitedFlow.context.navigator.deviceMemory = 4;
  vm.runInContext(flowSource, limitedFlow.context);
  limitedFlow.observers[0].emit(true);
  assert.equal(limitedFlow.starts(), 0, 'low-end hardware skips SMIL');
  const fallbackFlow = flowEnvironment();
  delete fallbackFlow.context.navigator;
  fallbackFlow.window.IntersectionObserver = undefined;
  delete fallbackFlow.window.matchMedia;
  vm.runInContext(flowSource, fallbackFlow.context);
  fallbackFlow.frame();
  assert.equal(fallbackFlow.paused(), false, 'SMIL runs without optional browser APIs');

  for (const source of [html, ...fs.readdirSync(path.join(__dirname, '../docs/wiki'))
    .filter(file => file.endsWith('.html')).map(file => fs.readFileSync(path.join(__dirname, '../docs/wiki', file), 'utf8'))]
    .filter(source => source.includes('redesign-skin.css'))) {
    assert.match(source, /<script defer src="(?:\.\.\/)?assets\/page-motion\.js\?v=20261023-p1"><\/script>/,
      'landing and wiki pages using the shared skin load its motion lifecycle');
  }
  console.log('[landing-performance] PASS deferred setup, visibility, tabs, preferences, resize, passive/throttled scroll, batched layout reads, CSS/SMIL lifecycle, low-end reduction, optional API fallbacks, asset registration and latest chart snapshot');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
