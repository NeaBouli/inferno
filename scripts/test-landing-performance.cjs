// Offline lifecycle coverage: no browser, RPC, timers or network access required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
const motionSource = fs.readFileSync(path.join(__dirname, '../docs/assets/page-motion.js'), 'utf8');
const collapseSource = fs.readFileSync(path.join(__dirname, '../docs/assets/landing-collapse.js'), 'utf8');

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
    setMedia(query, matches) { const item = window.matchMedia(query); item.matches = matches; item.emit('change'); },
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

  // Minimal DOM interface fixture: execute the shipped disclosure, preserving node identity.
  const disclosure = environment();
  function node(tagName) {
    return Object.assign(eventTarget(), {
      tagName, childNodes: [], classList: classList(), attributes: {},
      append(...children) {
        for (const child of children) {
          if (child.parentElement) child.parentElement.childNodes.splice(child.parentElement.childNodes.indexOf(child), 1);
          child.parentElement = this;
          this.childNodes.push(child);
        }
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) { return this.attributes[name]; },
      querySelector(selector) {
        return this.childNodes.find(child => selector === 'h2' ? child.tagName === 'h2'
          : selector === '.section-label, [data-landing-label]' ? child.className === 'section-label'
          : selector === ':scope > .landing-collapse-panel' && child.className === 'landing-collapse-panel') || null;
      },
    });
  }
  const sections = ['contracts', 'tokenomics'].map(id => {
    const section = node('section'), label = node('p'), title = node('h2');
    section.id = id;
    label.className = 'section-label';
    const rows = Array.from({ length: id === 'contracts' ? 19 : 14 }, () => node('div'));
    section.append(label, title, ...rows);
    return { section, rows, label, title };
  });
  disclosure.document.createElement = node;
  disclosure.document.getElementById = () => null;
  disclosure.document.querySelectorAll = selector => {
    assert.equal(selector, 'main > section:not(.hero)', 'address rows must never become disclosures');
    return sections.map(item => item.section);
  };
  vm.runInContext(collapseSource, disclosure.context);
  for (const { section, rows, label, title } of sections) {
    const [heading, panel] = section.childNodes;
    assert.equal(section.childNodes.length, 2, 'exactly one common heading and body');
    assert.equal(panel.className, 'landing-collapse-panel');
    assert.deepEqual(panel.childNodes, rows, 'all original rows move together, never clone or nest');
    assert.equal(heading.childNodes[0], label);
    assert.equal(heading.childNodes[1], title);
    const button = heading.childNodes[2];
    assert.equal(button.tagName, 'button');
    assert.equal(button.type, 'button', 'retain native keyboard behavior');
    assert.equal(button.getAttribute('aria-controls'), `${section.id}-panel`);
    assert.equal(button.getAttribute('aria-labelledby'), `${label.id} ${title.id}`);
    assert.equal(panel.hidden, true);
    button.emit('click');
    assert.equal(panel.hidden, false, 'one toggle reveals the entire address inventory');
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    button.emit('click');
    assert.equal(panel.hidden, true, 'one toggle hides the entire address inventory');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.ok(rows.every(row => row.childNodes.length === 0), 'no row-level headers or buttons are injected');
  }
  const contractsMarkup = html.match(/<section id="contracts"[\s\S]*?<\/section>/)[0];
  const rowStyles = [...contractsMarkup.matchAll(/class="contract-row" style="([^"]+)"/g)].map(match => match[1]);
  assert.equal(rowStyles.length, 19, '18 canonical components plus the external LP Pair row');
  assert.equal(new Set(rowStyles).size, 1, 'LP Pair reuses exactly the existing row style');
  assert.equal((contractsMarkup.match(/class="copy-btn" data-addr=/g) || []).length, 19);
  assert.ok(contractsMarkup.includes('data-addr="0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0"'));
  assert.ok(contractsMarkup.includes('href="https://app.uniswap.org/swap?outputCurrency=0x77e99917Eca8539c62F509ED1193ac36580A6e7B"'));
  assert.ok(html.includes('assets/landing-collapse.js?v=20261112-contracts-v2'), 'changed helper has a new cache key');

  const flowSource = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(source => source.includes('// Token-flow SMIL'));
  assert.ok(flowSource, 'test the shipped token-flow motion controller');
  function flowEnvironment() {
    const env = environment();
    let starts = 0, paused, rect = { top: 0, bottom: 540 };
    const svg = { dataset: {}, getBoundingClientRect: () => rect,
      pauseAnimations() { paused = true; }, unpauseAnimations() { paused = false; },
      querySelectorAll: () => [{ dataset: { motionDelay: '0.7' }, beginElementAt(delay) { assert.equal(delay, 0.7); starts++; } }],
    };
    env.document.querySelector = () => svg;
    return { ...env, svg, starts: () => starts, paused: () => paused, setRect(value) { rect = value; } };
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
  assert.equal(flow.paused(), false, 'SMIL resumes after reduced motion is disabled');
  flow.setMedia('(max-width: 1024px)', true);
  assert.equal(flow.paused(), true, 'compact screens skip SMIL');
  flow.setMedia('(max-width: 1024px)', false);
  assert.equal(flow.paused(), false, 'desktop motion resumes after leaving compact mode');
  assert.equal(flow.starts(), 1, 'compact transitions preserve the original SMIL start');
  for (const [cores, memory, width] of [[4, 32, 1440], [4, 8, 1440], [8, 4, 1440], [2, 32, 1440], [4, undefined, 1440], [undefined, 4, 1440]]) {
    const limitedFlow = flowEnvironment();
    Object.assign(limitedFlow.context.navigator, { hardwareConcurrency: cores, deviceMemory: memory });
    limitedFlow.window.innerWidth = width;
    limitedFlow.setMedia('(max-width: 1024px)', width <= 1024);
    vm.runInContext(flowSource, limitedFlow.context);
    assert.equal(limitedFlow.starts(), 0, 'desktop hardware still waits for actual visibility');
    limitedFlow.observers[0].emit(true);
    assert.equal(limitedFlow.starts(), 1, `visible ${width}px/${cores} cores/${memory}GB starts SMIL`);
    assert.equal(limitedFlow.paused(), false);
    limitedFlow.setMedia('(prefers-reduced-motion: reduce)', true);
    assert.equal(limitedFlow.paused(), true, 'permitted desktop motion still respects reduced preference');
    limitedFlow.document.hidden = true;
    limitedFlow.document.emit('visibilitychange');
    limitedFlow.setMedia('(prefers-reduced-motion: reduce)', false);
    assert.equal(limitedFlow.paused(), true, 'preference change cannot resume a hidden document');
    limitedFlow.observers[0].emit(false);
    limitedFlow.document.hidden = false;
    limitedFlow.document.emit('visibilitychange');
    assert.equal(limitedFlow.paused(), true, 'visible document cannot resume offscreen motion');
    limitedFlow.observers[0].emit(true);
    assert.equal(limitedFlow.paused(), false);
    assert.equal(limitedFlow.starts(), 1, 'all pause/resume combinations preserve start-once SMIL');
  }
  for (const [cores, memory, width] of [[8, 8, 390], [4, 32, 820], [4, 4, 1440], [2, 2, 1440], [4, 4, 390]]) {
    const guardedFlow = flowEnvironment();
    Object.assign(guardedFlow.context.navigator, { hardwareConcurrency: cores, deviceMemory: memory });
    guardedFlow.window.innerWidth = width;
    guardedFlow.setMedia('(max-width: 1024px)', width <= 1024);
    vm.runInContext(flowSource, guardedFlow.context);
    guardedFlow.observers[0].emit(true);
    assert.equal(guardedFlow.paused(), true, `compact or both-low hardware remains paused (${width}px/${cores}/${memory})`);
    assert.equal(guardedFlow.starts(), 0, 'guarded environments never start SMIL');
    guardedFlow.setMedia('(prefers-reduced-motion: reduce)', true);
    guardedFlow.setMedia('(prefers-reduced-motion: reduce)', false);
    assert.equal(guardedFlow.starts(), 0, 'preference changes cannot bypass compact/hardware guards');
    guardedFlow.setMedia('(max-width: 1024px)', false);
    const weak = cores <= 4 && memory <= 4;
    assert.equal(guardedFlow.paused(), weak, 'leaving compact resumes only hardware permitted by the AND policy');
    assert.equal(guardedFlow.starts(), weak ? 0 : 1);
    guardedFlow.setMedia('(max-width: 1024px)', true);
    assert.equal(guardedFlow.paused(), true, 'restored compact listener pauses on live width changes');
    assert.equal(guardedFlow.starts(), weak ? 0 : 1);
  }
  const reducedFlow = flowEnvironment();
  reducedFlow.setMedia('(prefers-reduced-motion: reduce)', true);
  vm.runInContext(flowSource, reducedFlow.context);
  reducedFlow.observers[0].emit(true);
  assert.equal(reducedFlow.starts(), 0, 'initial reduced preference prevents the first start');
  reducedFlow.setMedia('(prefers-reduced-motion: reduce)', false);
  assert.equal(reducedFlow.starts(), 1);
  const hiddenFlow = flowEnvironment();
  hiddenFlow.document.hidden = true;
  vm.runInContext(flowSource, hiddenFlow.context);
  hiddenFlow.observers[0].emit(true);
  assert.equal(hiddenFlow.starts(), 0, 'initially hidden documents cannot start SMIL');
  hiddenFlow.document.hidden = false;
  hiddenFlow.document.emit('visibilitychange');
  assert.equal(hiddenFlow.starts(), 1);
  const fallbackFlow = flowEnvironment();
  delete fallbackFlow.context.navigator;
  fallbackFlow.window.IntersectionObserver = undefined;
  delete fallbackFlow.window.matchMedia;
  vm.runInContext(flowSource, fallbackFlow.context);
  fallbackFlow.frame();
  assert.equal(fallbackFlow.paused(), false, 'SMIL runs without optional browser APIs');
  fallbackFlow.setRect({ top: 1200, bottom: 1740 });
  for (let i = 0; i < 10; i++) fallbackFlow.window.emit('scroll');
  assert.equal(fallbackFlow.frames.size, 1, 'fallback scroll work stays throttled');
  fallbackFlow.frame();
  assert.equal(fallbackFlow.paused(), true, 'fallback intersection still pauses offscreen SMIL');
  fallbackFlow.setRect({ top: 0, bottom: 540 });
  fallbackFlow.window.emit('resize');
  fallbackFlow.frame();
  assert.equal(fallbackFlow.paused(), false);
  assert.equal(fallbackFlow.starts(), 1, 'fallback resume also preserves start-once SMIL');

  for (const source of [html, ...fs.readdirSync(path.join(__dirname, '../docs/wiki'))
    .filter(file => file.endsWith('.html')).map(file => fs.readFileSync(path.join(__dirname, '../docs/wiki', file), 'utf8'))]
    .filter(source => source.includes('redesign-skin.css'))) {
    assert.match(source, /<script defer src="(?:\.\.\/)?assets\/page-motion\.js\?v=20261023-p1"><\/script>/,
      'landing and wiki pages using the shared skin load its motion lifecycle');
  }
  console.log('[landing-performance] PASS deferred setup, visibility, tabs, preferences, resize, passive/throttled scroll, batched layout reads, CSS/SMIL lifecycle, unchanged compact veto, both-low hardware AND policy, common address disclosure, LP row style, optional API fallbacks, asset registration and latest chart snapshot');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
