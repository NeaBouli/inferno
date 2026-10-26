#!/usr/bin/env node
// W02: actual Benefits configuration/connector/SDK composition, NOT Next/React UI
// or production proof. No wallet approval, encrypted-session success,
// CONNECT_SUCCESS, signatures, transactions, live restore or disconnect proof.
// All HTTP/WS terminate in Playwright fixtures. Never retain transport content.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'apps/benefits-network/frontend');
const origin = 'http://127.0.0.1:41739'; // Fulfilled by routing; no listening server.
const rpcOrigin = 'https://127.0.0.1:9443';
const projectId = '00000000000000000000000000000000';
const pulseOrigin = 'https://pulse.walletconnect.org';
const sampleWait = 10500; // Three real, unchanged 10-second SDK timer periods.
let stage = 'setup';

// Fixed synthetic relay-control material. Never wallet, pairing or session data;
// real SDK pairing topics are random and cannot collide with these constants.
const relayControlTopics = {
  subscribe: 'aa11'.repeat(16),
  publish: 'bb22'.repeat(16),
  refusedProposal: 'ff00'.repeat(16),
  refusedSubscribe: '00ff'.repeat(16),
};
const relayControlMessages = {
  publish: 'benefits-fixture-synthetic-publish',
  refusedProposal: 'benefits-fixture-synthetic-refused-proposal',
};
// Failure snapshots copy only this literal numeric/boolean allowlist from the live
// fixture counters: method/ACK/refusal counts, page errors, session and approval
// flags, native Pulse counts. Never URLs, URIs, topics, payloads, keys, SDK error
// text, console output, traces, HAR or storage.
const SNAPSHOT_KEYS = ['sdkChunks', 'rpc', 'catalog', 'config', 'relay', 'proposal', 'subscribe',
  'publish', 'refusedProposal', 'refusedSubscribe', 'unknownRejected', 'expectedUnknownRejected', 'syntheticUnknownRejected',
  'malformedRejected', 'e', 'batch', 'initialize', 'sdkError', 'forbidden', 'approved', 'pageErrors',
  'queuedInitialize', 'timerSamples', 'missingMarkerCleaned', 'stateKnown', 'sessionActive',
  'approvedFlag', 'nativeFetch', 'nativeBeacon', 'nativeE', 'nativeBatch', 'qr',
  'fixtureNativeOnline', 'fixtureOnlineOverrideApplied', 'fixtureObservedOnline'];
let activeCounts = null;
// Captured at the moment of the primary failure, before any cleanup stage
// reassignment, and restored after cleanup: cleanup can never replace it,
// including when a cleanup operation hangs until the global deadline.
let primaryFailureStage = null;
function snapshot() {
  const result = {};
  if (activeCounts) {
    for (const key of SNAPSHOT_KEYS) {
      const value = activeCounts[key];
      if (typeof value === 'number' || typeof value === 'boolean') result[key] = value;
    }
  }
  return JSON.stringify(result);
}
function reportCleanupFailure(label) {
  console.error(`[benefits-walletconnect-runtime] CLEANUP-FAIL ${label} ${snapshot()}`);
}

function reportCompilerErrors(errors, warnings = 0) {
  const counts = { total: errors.length, warnings, tsConfig: 0, tsOptions: 0, tsTranspile: 0,
    guardImport: 0, resolution: 0, scheme: 0, moduleBuild: 0, moduleParse: 0, other: 0 };
  for (const error of errors) {
    // Inspect compiler text only in memory. Never emit messages, paths, module
    // identifiers, causes or stacks, including for unknown compiler failures.
    const message = typeof error?.message === 'string' ? error.message : '';
    const names = [error?.name, error?.error?.name];
    const category = message.includes('Fixture TypeScript config') ? 'tsConfig'
      : message.includes('Fixture TypeScript options') ? 'tsOptions'
      : message.includes('Fixture TypeScript transpile') ? 'tsTranspile'
      : message.includes('Fixture guard import') ? 'guardImport'
      : names.includes('ModuleNotFoundError') || message.includes("Can't resolve") ? 'resolution'
      : names.includes('UnhandledSchemeError') ? 'scheme'
      : names.includes('ModuleBuildError') ? 'moduleBuild'
      : names.includes('ModuleParseError') ? 'moduleParse' : 'other';
    counts[category]++;
  }
  console.error(`[benefits-walletconnect-runtime] COMPILER ${JSON.stringify(counts)}`);
}

function isInstalledPackageRoot(directory, name, entry) {
  const suffix = path.sep + path.join('node_modules', ...name.split('/'));
  const relative = path.relative(directory, entry);
  return directory.endsWith(suffix) && relative !== '' && relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function checkPackageRootStructure() {
  const manifest = { name: '@reown/appkit', version: '1.8.19',
    main: './dist/esm/exports/index.js', exports: { './core': './dist/esm/exports/core.js' } };
  const directory = path.join(os.tmpdir(), 'benefits-root-shape', 'node_modules', '@reown', 'appkit');
  const entry = path.join(directory, 'dist', 'esm', 'exports', 'core.js');
  // The dist marker duplicates the COMPLETE manifest, not just name/version.
  const candidates = [path.join(directory, 'dist', 'esm'), directory].map(directory => ({ directory, manifest }));
  const found = candidates.find(item => item.manifest.name === manifest.name &&
    isInstalledPackageRoot(item.directory, manifest.name, entry));
  assert.equal(found?.directory, directory);
  assert.equal(found?.manifest.version, '1.8.19');
  assert.equal(isInstalledPackageRoot(directory, manifest.name, path.join(directory, '..', 'other', 'index.js')), false);
  const unscoped = path.join(os.tmpdir(), 'benefits-root-shape', 'node_modules', 'wagmi');
  assert.equal(isInstalledPackageRoot(unscoped, 'wagmi', path.join(unscoped, 'dist', 'index.js')), true);
}

function packageAt(entry, name, version) {
  const resolvedEntry = realpathSync(entry);
  let directory = path.dirname(resolvedEntry);
  for (;;) {
    const manifest = path.join(directory, 'package.json');
    try {
      const data = JSON.parse(readFileSync(manifest, 'utf8'));
      if (data.name === name && isInstalledPackageRoot(directory, name, resolvedEntry)) {
        assert.equal(data.version, version);
        return { directory: realpathSync(directory), entry };
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(directory);
    assert.notEqual(parent, directory);
    directory = parent;
  }
}

// Generated only in the artifact directory. The mutation changes precisely the
// guard import in wagmi.ts to a no-op binding, never a connector or SDK module.
function loaderSource(typescriptPath, wagmiPath, configPath) {
  return `const ts = require(${JSON.stringify(typescriptPath)});
const fs = require('node:fs');
const configPath = ${JSON.stringify(configPath)};
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error('Fixture TypeScript config');
const parsed = ts.convertCompilerOptionsFromJson(config.config.compilerOptions, require('node:path').dirname(configPath));
if (parsed.errors.length) throw new Error('Fixture TypeScript options');
module.exports = function(source) {
  if (this.getOptions().omitGuard && fs.realpathSync(this.resourcePath) === ${JSON.stringify(wagmiPath)}) {
    const ast = ts.createSourceFile(this.resourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const imports = ast.statements.filter(node => ts.isImportDeclaration(node) &&
      node.moduleSpecifier.text === '@/lib/wallet-telemetry-guard.mjs');
    if (imports.length !== 1 || imports[0].importClause.namedBindings.elements.length !== 1 ||
      imports[0].importClause.namedBindings.elements[0].name.text !== 'installWalletConnectTelemetryGuard') {
      throw new Error('Fixture guard import');
    }
    const node = imports[0];
    source = source.slice(0, node.getStart(ast)) + 'const installWalletConnectTelemetryGuard = () => {};' + source.slice(node.end);
  }
  const result = ts.transpileModule(source, { fileName: this.resourcePath, reportDiagnostics: true,
    compilerOptions: { ...parsed.options, noEmit: false, incremental: false, sourceMap: false, declaration: false } });
  if (result.diagnostics.some(item => item.category === ts.DiagnosticCategory.Error)) throw new Error('Fixture TypeScript transpile');
  return result.outputText;
};
`;
}

const browserEntry = `
import { wagmiConfig, hasWalletConnectProjectId, targetChain } from '@/lib/wagmi.ts';
import { SDK_SESSION_STORAGE_KEY, RECENT_CONNECTOR_STORAGE_KEY } from '@/lib/deferredWalletConnector.mjs';
import { connect, reconnect, getBlockNumber } from 'wagmi/actions';
const connector = wagmiConfig.connectors.find(item => item.id === 'walletConnect');
if (!connector || !hasWalletConnectProjectId || targetChain.id !== 1) throw new Error('Fixture config');
let provider;
let controllers;
let pendingConnect;
let qr = 0;
let settled = false;
let approved = false;
connector.emitter.on('message', event => { if (event.type === 'display_uri') qr++; });
function beginConnect() {
  settled = false;
  pendingConnect = connect(wagmiConfig, { connector, chainId: 1 }).then(
    () => { approved = true; settled = true; },
    () => { settled = true; }
  );
}
async function loadProvider() {
  provider = await connector.getProvider();
  if (!provider?.modal || !provider.signer?.client) throw new Error('Fixture real provider');
  await provider.modal.ready();
  // Diagnostics only AFTER the connector's real dynamic SDK initialization.
  controllers = await import('@reown/appkit-controllers');
}
window.benefitsRuntime = {
  async dormant() {
    await connector.setup();
    const absent = (await connector.getProvider()) === undefined;
    const unauthorized = !(await connector.isAuthorized());
    const restored = await reconnect(wagmiConfig);
    return { absent, unauthorized, restored: restored.length, baseline: window.benefitsNative.baseline() };
  },
  async activate() { beginConnect(); await loadProvider(); },
  retry() { beginConnect(); },
  qrReady() { return qr > 0 && provider?.modal.getState().open; },
  qrCount() { return qr; },
  async cancel() { await provider.modal.close(); await pendingConnect; return settled && !approved; },
  async cache() {
    const fetch = window.fetch;
    const beacon = navigator.sendBeacon;
    const [first, second] = await Promise.all([connector.getProvider(), connector.getProvider()]);
    return first === provider && second === provider && fetch === window.fetch && beacon === navigator.sendBeacon;
  },
  async revalidate() {
    const result = [];
    for (const key of ['fetch', 'sendBeacon']) {
      const owner = key === 'fetch' ? window : navigator;
      const saved = owner[key];
      owner[key] = window.benefitsNative[key];
      try { await connector.getProvider(); result.push(false); }
      catch (error) { result.push(error.message === 'WalletConnect telemetry guard replaced'); }
      finally { owner[key] = saved; }
    }
    return result.every(Boolean) && (await connector.getProvider()) === provider;
  },
  error() {
    const before = controllers.TelemetryController.state.events.length;
    const variables = Object.defineProperty({}, '--w3m-accent', { enumerable: true,
      get() { throw new Error('synthetic-public-canary'); } });
    let threw = false;
    try { provider.modal.setThemeVariables(variables); } catch { threw = true; }
    const events = controllers.TelemetryController.state.events;
    return threw && events.length > before && events.some(event => event.properties.errorMessage === 'synthetic-public-canary');
  },
  state() {
    const events = controllers?.EventsController.state;
    return { qr, settled, approved, session: Boolean(provider?.session), status: wagmiConfig.state.status,
      initialize: events?.pendingEvents.filter(event => event.props.event === 'INITIALIZE').length || 0,
      pending: events?.pendingEvents.length || 0, lastFlush: events?.lastFlush || 0,
      subscribed: Boolean(events?.subscribedToVisibilityChange), baseline: window.benefitsNative.baseline(),
      native: { ...window.benefitsNative.counts } };
  },
  flush(kind) {
    if (kind === 'hidden') {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    } else if (kind === 'freeze') document.dispatchEvent(new Event('freeze'));
    else if (kind === 'pagehide') window.dispatchEvent(new Event('pagehide'));
    else throw new Error('Fixture lifecycle');
  },
  async rpc() { return (await getBlockNumber(wagmiConfig, { chainId: 1 })) === 0x1234n; },
  async relaySubscribe() {
    // Positive control through the real pinned Core relayer with a clearly
    // synthetic topic; the promise only resolves after the fixture ACK.
    await provider.signer.client.core.relayer.subscribe(${JSON.stringify(relayControlTopics.subscribe)});
    return true;
  },
  async relayPublish() {
    // Positive control through the real pinned Core relayer with clearly
    // synthetic data. internal.throwOnFailedPublish is required: the pinned
    // Publisher otherwise suppresses a failed publish instead of rejecting.
    await provider.signer.client.core.relayer.publish(${JSON.stringify(relayControlTopics.publish)},
      ${JSON.stringify(relayControlMessages.publish)}, { internal: { throwOnFailedPublish: true } });
    return true;
  },
  async relayRefusedProposal() {
    // Negative control over the real pinned Core relayer request path. Only the
    // fixture's fixed refusal (JSON-RPC error code -32001) qualifies; any other
    // rejection or a resolved ACK fails the proof. Error text never leaves the page.
    try {
      await provider.signer.client.core.relayer.request({ method: 'wc_proposeSession',
        params: { pairingTopic: ${JSON.stringify(relayControlTopics.refusedProposal)},
          sessionProposal: ${JSON.stringify(relayControlMessages.refusedProposal)} } });
      return false; // A refused proposal must never be ACKed.
    } catch (error) {
      return error?.code === -32001;
    }
  },
  async relayRefusedSubscribe() {
    try {
      await provider.signer.client.core.relayer.request({ method: 'irn_subscribe',
        params: { topic: ${JSON.stringify(relayControlTopics.refusedSubscribe)} } });
      return false; // A refused subscribe must never be ACKed.
    } catch (error) {
      return error?.code === -32001;
    }
  },
  async relayUnknownMethod() {
    // Negative fixture-integrity control: one raw loopback page socket sends a
    // fixed synthetic unknown method; pass only if the fixture closes it without
    // any response. A generic-ACK regression answers and fails this proof.
    return await new Promise(resolve => {
      let done = false;
      let sent = false;
      let timer;
      const probe = new WebSocket('wss://relay.walletconnect.org/');
      const finish = value => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { probe.close(); } catch { /* already closed */ }
        resolve(value);
      };
      probe.onopen = () => {
        probe.send(JSON.stringify({ jsonrpc: '2.0', id: 907001, method: 'wc_fixtureUnknown', params: {} }));
        sent = true;
      };
      probe.onmessage = () => finish(false);
      probe.onclose = () => finish(sent);
      probe.onerror = () => finish(false);
      timer = setTimeout(() => finish(false), 8000);
    });
  },
  async allowedHttp() {
    // The direct QR view need not load the catalogue automatically.
    const wallets = await controllers.ApiController.fetchWallets({ page: 1, entries: 1 });
    const config = await controllers.ApiController.fetchProjectConfig();
    return Array.isArray(wallets.data) && wallets.count === 0 && typeof config === 'object' && config !== null;
  },
  async missingSession() {
    await wagmiConfig.storage.setItem(SDK_SESSION_STORAGE_KEY, connector.id);
    await wagmiConfig.storage.setItem(RECENT_CONNECTOR_STORAGE_KEY, connector.id);
    const restored = await reconnect(wagmiConfig);
    await loadProvider();
    return restored.length === 0 && !provider.session && wagmiConfig.state.status === 'disconnected' &&
      (await wagmiConfig.storage.getItem(SDK_SESSION_STORAGE_KEY)) === null &&
      (await wagmiConfig.storage.getItem(RECENT_CONNECTOR_STORAGE_KEY)) === null;
  }
};
`;

async function buildBundles(artifacts) {
  const frontendRequire = createRequire(path.join(frontend, 'package.json'));
  const wagmi = packageAt(frontendRequire.resolve('wagmi'), 'wagmi', '3.7.3');
  const connector = packageAt(createRequire(wagmi.entry).resolve('@wagmi/connectors/walletConnect'), '@wagmi/connectors', '8.0.24');
  const ethereum = packageAt(createRequire(connector.entry).resolve('@walletconnect/ethereum-provider'), '@walletconnect/ethereum-provider', '2.23.10');
  const appkit = packageAt(createRequire(ethereum.entry).resolve('@reown/appkit/core'), '@reown/appkit', '1.8.19');
  const controllers = packageAt(createRequire(appkit.entry).resolve('@reown/appkit-controllers'), '@reown/appkit-controllers', '1.8.19');
  const lock = JSON.parse(readFileSync(path.join(frontend, 'package-lock.json'), 'utf8'));
  for (const [name, version] of [['wagmi', '3.7.3'], ['@wagmi/connectors', '8.0.24'],
    ['@walletconnect/ethereum-provider', '2.23.10'], ['@reown/appkit', '1.8.19']]) {
    assert.ok(Object.entries(lock.packages).some(([key, value]) => key.endsWith(`node_modules/${name}`) && value.version === version));
  }
  const nextWebpack = frontendRequire('next/dist/compiled/webpack/webpack.js');
  // Always Next's bundled webpack, never environment-selected local webpack/Rspack.
  assert.ok(!process.env.NEXT_RSPACK && !process.env.NEXT_PRIVATE_LOCAL_WEBPACK);
  nextWebpack.init();
  const webpack = nextWebpack.webpack;
  const source = realpathSync(path.join(frontend, 'src/lib/wagmi.ts'));
  const loader = path.join(artifacts, 'typescript-loader.cjs');
  const entry = path.join(artifacts, 'entry.mjs');
  writeFileSync(loader, loaderSource(frontendRequire.resolve('typescript'), source, path.join(frontend, 'tsconfig.json')));
  writeFileSync(entry, browserEntry);
  const bundles = {};
  for (const mode of ['guarded', 'mutation']) {
    stage = `${mode}-bundle-create`;
    const compiler = webpack({
      mode: 'production', target: 'web', context: frontend, entry, devtool: false, cache: false,
      output: { path: path.join(artifacts, mode), filename: 'entry.js', chunkFilename: '[id].js', publicPath: `/${mode}/` },
      resolve: { alias: { '@': path.join(frontend, 'src') }, extensions: ['.ts', '.tsx', '.mjs', '.js', '.json'],
        modules: ['node_modules', path.join(frontend, 'node_modules')] },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: [{ loader, options: { omitGuard: mode === 'mutation' } }] }] },
      plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'production',
        NEXT_PUBLIC_CHAIN_ID: '1', NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: projectId,
        NEXT_PUBLIC_ETHEREUM_RPC_URL: `${rpcOrigin}/rpc` }) })],
      optimization: { minimize: false, concatenateModules: false, splitChunks: false, runtimeChunk: false },
      performance: false,
      infrastructureLogging: { level: 'none' }, stats: 'none',
    });
    let stats;
    let primary = null;
    try {
      stage = `${mode}-bundle-run`;
      stats = await new Promise((resolve, reject) => compiler.run((error, result) => {
        if (error) { reportCompilerErrors([error]); reject(error); }
        else resolve(result);
      }));
      stage = `${mode}-bundle-stats-present`;
      assert.ok(stats);
      stage = `${mode}-bundle-stats-errors`;
      reportCompilerErrors(stats.compilation.errors, stats.compilation.warnings.length);
      assert.ok(!stats.hasErrors());
      stage = `${mode}-bundle-resources`;
      const compilation = stats.compilation;
      const modules = [...compilation.modules].filter(item => item.resource);
      const resources = modules.map(item => item.resource);
      stage = `${mode}-bundle-source`;
      assert.ok(resources.includes(source));
      stage = `${mode}-bundle-deferred`;
      assert.ok(resources.includes(realpathSync(path.join(frontend, 'src/lib/deferredWalletConnector.mjs'))));
      stage = `${mode}-bundle-guard`;
      assert.equal(resources.includes(realpathSync(path.join(frontend, 'src/lib/wallet-telemetry-guard.mjs'))), mode === 'guarded');
      for (const [label, pkg] of [['connector', connector], ['ethereum', ethereum], ['appkit', appkit], ['controllers', controllers]]) {
        stage = `${mode}-bundle-sdk-${label}`;
        assert.ok(resources.some(resource => resource.startsWith(`${pkg.directory}${path.sep}dist${path.sep}`)));
      }
      stage = `${mode}-bundle-sdk-modules`;
      const sdkModules = modules.filter(item => item.resource.startsWith(`${ethereum.directory}${path.sep}dist${path.sep}`));
      const sdkFiles = new Set();
      for (const item of sdkModules) {
        stage = `${mode}-bundle-chunk-graph`;
        for (const chunk of compilation.chunkGraph.getModuleChunksIterable(item)) {
          stage = `${mode}-bundle-chunk-deferred`;
          assert.equal(chunk.canBeInitial(), false, 'SDK must stay in deferred chunks');
          stage = `${mode}-bundle-chunk-files`;
          for (const file of chunk.files) sdkFiles.add(`/${mode}/${file}`);
        }
      }
      stage = `${mode}-bundle-sdk-files`;
      assert.ok(sdkFiles.size > 0);
      stage = `${mode}-bundle-assets`;
      const assets = new Map(compilation.getAssets().map(asset => [
        `/${mode}/${asset.name}`, readFileSync(path.join(artifacts, mode, asset.name)),
      ]));
      bundles[mode] = { assets, sdkFiles };
    } catch (error) {
      primary = error;
      primaryFailureStage = stage;
      throw error;
    } finally {
      // Cleanup stage is assigned BEFORE the operation; a compiler close failure
      // never masks a primary build failure, and the primary stage is restored.
      stage = `${mode}-bundle-close`;
      let closeError = null;
      try {
        await new Promise((resolve, reject) => compiler.close(error => (error ? reject(error) : resolve())));
      } catch (error) { closeError = error; }
      if (closeError) {
        reportCompilerErrors([closeError]); // Aggregate compiler categories only, never text.
        if (primary) {
          reportCleanupFailure(`${mode}-bundle-close`);
        } else {
          primaryFailureStage = stage;
          throw closeError;
        }
      }
      if (primary) stage = primaryFailureStage;
    }
  }
  return bundles;
}

// Installed before ANY bundle evaluation, below the later app-owned guard.
function observeTransports() {
  const counts = { fetch: 0, beacon: 0, e: 0, batch: 0 };
  function observe(input, transport) {
    const value = typeof input === 'string' ? input : input?.url || input?.href;
    try {
      const url = new URL(value, document.baseURI);
      if (url.origin !== 'https://pulse.walletconnect.org') return;
      counts[transport]++;
      if (url.pathname === '/e') counts.e++;
      if (url.pathname === '/batch') counts.batch++;
    } catch { /* Invalid inputs keep native semantics. */ }
  }
  const nativeFetch = window.fetch;
  const nativeBeacon = navigator.sendBeacon;
  window.fetch = function(input) { observe(input, 'fetch'); return Reflect.apply(nativeFetch, this, arguments); };
  navigator.sendBeacon = function(input) { observe(input, 'beacon'); return Reflect.apply(nativeBeacon, this, arguments); };
  const fetch = window.fetch;
  const sendBeacon = navigator.sendBeacon;
  window.benefitsNative = { counts, fetch, sendBeacon,
    baseline: () => window.fetch === fetch && navigator.sendBeacon === sendBeacon };
}

// Fixture-only platform metadata override; supports OS-network-none validation.
// Logical HTTP/WS transports are supplied by the routes below. SDK/product code,
// transport implementations, proposal/ACK rules and Pulse observation are unchanged.
// Capture the native Boolean before shadowing this one Navigator property.
function initializeFixtureOnline() {
  const state = { native: navigator.onLine, applied: false, observed: false };
  try {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    state.applied = true;
  } catch { /* The hard precondition below fails closed without free error text. */ }
  state.observed = navigator.onLine;
  window.benefitsFixtureOnline = state;
}

async function fixture(browser, bundle, mode, body) {
  const counts = { sdkChunks: 0, rpc: 0, catalog: 0, config: 0, relay: 0, proposal: 0, subscribe: 0,
    publish: 0, refusedProposal: 0, refusedSubscribe: 0, unknownRejected: 0, expectedUnknownRejected: 0, syntheticUnknownRejected: 0,
    malformedRejected: 0, e: 0, batch: 0, initialize: 0, sdkError: 0, forbidden: 0, approved: 0,
    pageErrors: 0, stateKnown: false };
  activeCounts = counts;
  let primary = null;
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS' };
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBz0AAAAASUVORK5CYII=', 'base64');
  const json = (route, value) => route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(value) });
  const refuse = route => { counts.forbidden++; return route.abort(); };
  // Hoisted so the failure path can best-effort read safe state before close.
  let page = null;
  try {
    await context.addInitScript(initializeFixtureOnline);
    await context.addInitScript(observeTransports);
    await context.route('**/*', async route => {
      try {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();
        if (url.origin === origin && method === 'GET') {
          if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body:
            `<!doctype html><title>Benefits offline runtime fixture</title><script src="/${mode}/entry.js"></script>` });
          const asset = bundle.assets.get(url.pathname);
          if (asset) {
            if (bundle.sdkFiles.has(url.pathname)) counts.sdkChunks++;
            return route.fulfill({ contentType: 'text/javascript', body: asset });
          }
          if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
          return refuse(route);
        }
        const rpc = (url.origin === rpcOrigin && url.pathname === '/rpc') ||
          (url.origin === 'https://rpc.walletconnect.org' && ['/v1', '/v1/'].includes(url.pathname) && url.searchParams.get('chainId') === 'eip155:1');
        const api = url.origin === 'https://api.web3modal.org';
        const apiPaths = ['/getAnalyticsConfig', '/appkit/v1/config', '/appkit/v1/project-limits', '/projects/v1/origins', '/getWallets'];
        const pulse = url.origin === pulseOrigin && ['/e', '/batch'].includes(url.pathname);
        if (method === 'OPTIONS') {
          if (!rpc && !(api && apiPaths.includes(url.pathname)) && !pulse) return refuse(route);
          return route.fulfill({ status: 204, headers });
        }
        if (pulse && method === 'POST') {
          const value = request.postDataJSON();
          if (url.pathname === '/e') {
            counts.e++;
            if (value.props?.type === 'error' && value.props.errorMessage === 'synthetic-public-canary') counts.sdkError++;
          } else {
            counts.batch++;
            if (!Array.isArray(value)) return refuse(route);
            counts.initialize += value.filter(event => event.props?.event === 'INITIALIZE').length;
            counts.approved += value.filter(event => event.props?.event === 'CONNECT_SUCCESS').length;
          }
          return json(route, {});
        }
        if (rpc && method === 'POST') {
          const payload = request.postDataJSON();
          const respond = entry => {
            const values = { eth_chainId: '0x1', net_version: '1', eth_accounts: [], eth_blockNumber: '0x1234' };
            if (!Object.hasOwn(values, entry.method)) {
              counts.forbidden++;
              return { jsonrpc: '2.0', id: entry.id, error: { code: 4200, message: 'Fixture refuses method' } };
            }
            counts.rpc++;
            return { jsonrpc: '2.0', id: entry.id, result: values[entry.method] };
          };
          return json(route, Array.isArray(payload) ? payload.map(respond) : respond(payload));
        }
        if (api && method === 'GET') {
          if (url.pathname === '/getWallets') { counts.catalog++; return json(route, { count: 0, data: [] }); }
          const responses = {
            '/getAnalyticsConfig': { isAnalyticsEnabled: false },
            '/appkit/v1/config': { features: { email: false, socials: false, swaps: false, onramp: false,
              activity: false, reownAuthentication: false } },
            '/appkit/v1/project-limits': { planLimits: { tier: 'unlimited', isAboveMauLimit: false, isAboveRpcLimit: false } },
            '/projects/v1/origins': { allowedOrigins: [origin] },
          };
          if (Object.hasOwn(responses, url.pathname)) { counts.config++; return json(route, responses[url.pathname]); }
          if (/^\/public\/getAssetImage\/[a-zA-Z0-9-]+$/.test(url.pathname)) {
            return route.fulfill({ headers, contentType: 'image/png', body: pixel });
          }
        }
        // The real config's metadata icon also terminates here, never at its host.
        if (url.origin === 'https://shop.ifrunit.tech' && url.pathname === '/icons/ifr-token-256-v11.png' && method === 'GET') {
          return route.fulfill({ headers, contentType: 'image/png', body: pixel });
        }
        if (url.origin === 'https://verify.walletconnect.org' && url.pathname === '/v3/attestation' && method === 'GET') {
          return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Offline verify fixture</title>' });
        }
        if (url.origin === 'https://fonts.reown.com' && method === 'GET' &&
          /^\/KHTeka(?:-Light|-Regular|-Medium|Mono-Regular)\.woff2?$/.test(url.pathname)) return route.fulfill({ status: 204, headers });
        return refuse(route); // No continue(), fallback(), or generic success response.
      } catch { return refuse(route); }
    });
    await context.routeWebSocket('**/*', socket => {
      const url = new URL(socket.url());
      if (!['wss://relay.walletconnect.org', 'wss://relay.walletconnect.com'].includes(url.origin) || url.pathname !== '/') {
        counts.forbidden++;
        socket.close();
        return;
      }
      // Locally ACKed allowlist only: no server connection, wallet peer,
      // approval, fabricated encrypted session or inbound publication.
      // wc_proposeSession is counted distinctly and never feeds IRN counters.
      // Basic envelope and exercised-params shape validation: a known method
      // name with an absent or mis-shaped payload is malformed (counted and
      // closed), never generic-ACKed. Pinned subscriber.ts385-396 defines
      // irn_unsubscribe as { topic, id }; batch-unsubscribe is unsupported here.
      socket.onMessage(raw => {
        let message;
        try { message = JSON.parse(String(raw)); }
        catch { counts.malformedRejected++; socket.close(); return; }
        const malformed = () => { counts.malformedRejected++; socket.close(); };
        const isString = value => typeof value === 'string' && value.length > 0;
        try {
          const validEnvelope = message && typeof message === 'object' && message.jsonrpc === '2.0' &&
            (typeof message.id === 'number' || typeof message.id === 'string') &&
            typeof message.method === 'string';
          if (!validEnvelope) return malformed();
          const subscription = topic => createHash('sha256').update(topic).digest('hex');
          const refuse = category => {
            counts[category]++;
            socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id,
              error: { code: -32001, message: 'Fixture refuses relay traffic' } }));
          };
          const params = message.params;
          let result;
          switch (message.method) {
            case 'irn_subscribe':
              if (!params || !isString(params.topic)) return malformed();
              if (params.topic === relayControlTopics.refusedSubscribe) return refuse('refusedSubscribe');
              result = subscription(params.topic); counts.subscribe++; break;
            case 'irn_batchSubscribe':
              if (!params || !Array.isArray(params.topics) || !params.topics.every(isString)) return malformed();
              result = params.topics.map(subscription); counts.subscribe++; break;
            case 'irn_publish':
              if (!params || !isString(params.topic) || !isString(params.message)) return malformed();
              result = true; counts.publish++; break;
            case 'wc_proposeSession':
              if (!params || !isString(params.pairingTopic) || !isString(params.sessionProposal)) return malformed();
              if (params.pairingTopic === relayControlTopics.refusedProposal) return refuse('refusedProposal');
              result = true; counts.proposal++; break;
            case 'irn_unsubscribe':
              if (!params || !isString(params.topic) || !isString(params.id)) return malformed();
              result = true; break;
            case 'irn_batchUnsubscribe':
              counts.unknownRejected++; socket.close(); return; // No pinned SDK sender/schema.
            default:
              counts.unknownRejected++;
              if (message.method === 'wc_fixtureUnknown' && message.id === 907001) counts.syntheticUnknownRejected++;
              socket.close(); return;
          }
          counts.relay++;
          socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
        } catch { counts.malformedRejected++; socket.close(); }
      });
    });
    page = await context.newPage();
    page.on('pageerror', () => { counts.pageErrors++; });
    page.setDefaultTimeout(12000);
    page.setDefaultNavigationTimeout(12000);
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.benefitsRuntime));
    stage = `${mode}-fixture-online-precondition`;
    const online = await page.evaluate(() => ({
      native: window.benefitsFixtureOnline?.native,
      applied: window.benefitsFixtureOnline?.applied,
      observed: navigator.onLine,
    }));
    // Only actual Boolean observations enter the snapshot; no coercion/default
    // can turn an unavailable original value into a claimed native false.
    if (typeof online.native === 'boolean') counts.fixtureNativeOnline = online.native;
    if (typeof online.applied === 'boolean') counts.fixtureOnlineOverrideApplied = online.applied;
    if (typeof online.observed === 'boolean') counts.fixtureObservedOnline = online.observed;
    assert.equal(typeof online.native, 'boolean');
    assert.equal(online.applied, true);
    assert.equal(online.observed, true);
    await body(page, counts);
    stage = `${mode}-fixture-forbidden-egress`;
    assert.equal(counts.forbidden, 0);
    stage = `${mode}-fixture-malformed-rejected`;
    assert.equal(counts.malformedRejected, 0);
    stage = `${mode}-fixture-unknown-rejected`;
    // Checked against the declared intent, never derived from observed counts:
    // exactly one only where the intentional unknown-method control ran.
    assert.equal(counts.unknownRejected, counts.expectedUnknownRejected);
    stage = `${mode}-fixture-synthetic-unknown-rejected`;
    assert.equal(counts.syntheticUnknownRejected, counts.expectedUnknownRejected);
    stage = `${mode}-fixture-page-errors`;
    assert.equal(counts.pageErrors, 0);
    stage = `${mode}-fixture-connect-success-absent`;
    assert.equal(counts.approved, 0);
    stage = `${mode}-fixture-state`;
    const state = await page.evaluate(() => window.benefitsRuntime.state());
    counts.stateKnown = true;
    counts.sessionActive = state.session;
    counts.approvedFlag = state.approved;
    counts.nativeFetch = state.native.fetch;
    counts.nativeBeacon = state.native.beacon;
    counts.nativeE = state.native.e;
    counts.nativeBatch = state.native.batch;
    counts.qr = state.qr;
    stage = `${mode}-fixture-session-absent`;
    assert.equal(state.session, false);
    stage = `${mode}-fixture-approval-absent`;
    assert.equal(state.approved, false);
    if (mode === 'guarded') {
      stage = `${mode}-fixture-pulse-native-absent`;
      assert.equal(state.native.fetch + state.native.beacon, 0);
      stage = `${mode}-fixture-pulse-counts-absent`;
      assert.equal(counts.e + counts.batch, 0);
    }
    return { ...counts };
  } catch (error) {
    primary = error;
    primaryFailureStage = stage;
    // Best-effort: enrich the failure snapshot with safe allowlisted runtime
    // state BEFORE context close. A retrieval problem never replaces the
    // primary failure, and only numeric/boolean fields are copied.
    try {
      if (page) {
        const state = await page.evaluate(() => (window.benefitsRuntime ? window.benefitsRuntime.state() : null));
        if (state && typeof state === 'object') {
          counts.stateKnown = true;
          counts.sessionActive = Boolean(state.session);
          counts.approvedFlag = Boolean(state.approved);
          if (typeof state.qr === 'number') counts.qr = state.qr;
          const native = state.native || {};
          if (typeof native.fetch === 'number') counts.nativeFetch = native.fetch;
          if (typeof native.beacon === 'number') counts.nativeBeacon = native.beacon;
          if (typeof native.e === 'number') counts.nativeE = native.e;
          if (typeof native.batch === 'number') counts.nativeBatch = native.batch;
        }
      }
    } catch { /* Snapshot retrieval failure never replaces the primary failure. */ }
    throw error;
  } finally {
    // Cleanup stage is assigned BEFORE the operation; a close failure never
    // masks a primary failure, and the primary stage is restored afterwards.
    stage = `${mode}-fixture-context-close`;
    let closeError = null;
    try { await context.close(); } catch (error) { closeError = error; }
    if (closeError) {
      if (primary) {
        reportCleanupFailure(`${mode}-fixture-context-close`);
      } else {
        primaryFailureStage = stage;
        throw closeError;
      }
    }
    if (primary) stage = primaryFailureStage;
  }
}

async function dormant(page, counts) {
  const before = counts.sdkChunks;
  const result = await page.evaluate(() => window.benefitsRuntime.dormant());
  assert.deepEqual(result, { absent: true, unauthorized: true, restored: 0, baseline: true });
  assert.equal(counts.sdkChunks, before, 'Dormant reconnect must not even load the real SDK chunk');
  assert.equal(counts.proposal, 0, 'Without a QR display there must be no relay proposal');
}

async function initialize(page, counts) {
  assert.equal(counts.sdkChunks, 0);
  await page.evaluate(() => window.benefitsRuntime.activate());
  assert.ok(counts.sdkChunks > 0);
  const state = await page.evaluate(() => window.benefitsRuntime.state());
  assert.ok(state.initialize > 0 && state.subscribed, 'Actual SDK INITIALIZE must be queued');
  counts.queuedInitialize = state.initialize;
}

async function cancelQr(page, previous) {
  await page.waitForFunction(before => window.benefitsRuntime.qrReady() && window.benefitsRuntime.qrCount() > before, previous);
  assert.equal(await page.evaluate(() => window.benefitsRuntime.cancel()), true);
  const state = await page.evaluate(() => window.benefitsRuntime.state());
  assert.equal(state.status, 'disconnected');
  assert.equal(state.session, false);
  return state.qr;
}

async function runtimeCase(browser, bundle, mode) {
  return fixture(browser, bundle, mode, async (page, counts) => {
    stage = `${mode}-dormant`;
    await dormant(page, counts);
    stage = `${mode}-selection`;
    await initialize(page, counts);
    assert.equal(await page.evaluate(() => window.benefitsRuntime.state().baseline), mode === 'mutation');
    stage = `${mode}-error`;
    assert.equal(await page.evaluate(() => window.benefitsRuntime.error()), true);
    stage = `${mode}-qr-cancel-retry`;
    const first = await cancelQr(page, 0);
    await page.evaluate(() => window.benefitsRuntime.retry());
    await cancelQr(page, first);
    stage = `${mode}-cache`;
    assert.equal(await page.evaluate(() => window.benefitsRuntime.cache()), true);
    if (mode === 'guarded') assert.equal(await page.evaluate(() => window.benefitsRuntime.revalidate()), true);
    assert.equal(await page.evaluate(() => window.benefitsRuntime.rpc()), true);
    stage = `${mode}-allowed-http`;
    assert.equal(await page.evaluate(() => window.benefitsRuntime.allowedHttp()), true);
    stage = `${mode}-timer`;
    let previous = await page.evaluate(() => window.benefitsRuntime.state().lastFlush);
    for (const period of [1, 2, 3]) {
      stage = `${mode}-timer-${period}`;
      await page.waitForTimeout(sampleWait); // Fixed samples, not retries or accelerated timers.
      const state = await page.evaluate(() => window.benefitsRuntime.state());
      assert.ok(state.lastFlush > previous);
      assert.equal(state.pending, 0);
      previous = state.lastFlush;
      counts.timerSamples = period;
    }
    stage = `${mode}-permitted-http-counts`;
    assert.ok(counts.rpc > 0 && counts.catalog > 0 && counts.config > 0);
    stage = `${mode}-relay-proposal-qr`;
    // Positive QR proposal proof: the SDK awaits the relay proposal ACK before
    // displaying each QR, so every display implies a fixture-observed
    // wc_proposeSession; the proposal route never feeds the IRN counters.
    const qrCount = (await page.evaluate(() => window.benefitsRuntime.state())).qr;
    assert.ok(qrCount >= 2, 'QR modal must display for both connect attempts');
    assert.ok(counts.proposal >= qrCount, 'Each QR display requires a prior relay proposal');
    assert.equal(counts.subscribe, 0, 'QR proposals must not use irn_subscribe');
    assert.equal(counts.publish, 0, 'QR proposals must not use irn_publish');
    const proposals = counts.proposal;
    stage = `${mode}-relay-control-subscribe`;
    assert.equal(await page.evaluate(() => window.benefitsRuntime.relaySubscribe()), true);
    assert.equal(counts.subscribe, 1, 'Synthetic Core relayer subscribe must be ACKed exactly once');
    stage = `${mode}-relay-control-publish`;
    assert.equal(await page.evaluate(() => window.benefitsRuntime.relayPublish()), true);
    assert.equal(counts.publish, 1, 'Synthetic Core relayer publish must be ACKed exactly once');
    stage = `${mode}-relay-refusal-proposal`;
    assert.equal(await page.evaluate(() => window.benefitsRuntime.relayRefusedProposal()), true);
    assert.equal(counts.refusedProposal, 1, 'The refused proposal category must be refused exactly once');
    assert.equal(counts.proposal, proposals, 'A refused proposal must never be ACKed');
    stage = `${mode}-relay-refusal-subscribe`;
    assert.equal(await page.evaluate(() => window.benefitsRuntime.relayRefusedSubscribe()), true);
    assert.equal(counts.refusedSubscribe, 1, 'The refused subscribe category must be refused exactly once');
    assert.equal(counts.subscribe, 1, 'A refused subscribe must never be ACKed');
    stage = `${mode}-relay-unknown-rejected`;
    // Declared intent BEFORE the control runs; the fixture final re-checks the
    // observed count against this declaration, never derives it from counts.
    assert.equal(counts.unknownRejected, 0, 'No earlier unknown SDK traffic may satisfy the control');
    assert.equal(counts.syntheticUnknownRejected, 0);
    counts.expectedUnknownRejected = 1;
    assert.equal(await page.evaluate(() => window.benefitsRuntime.relayUnknownMethod()), true);
    assert.equal(counts.unknownRejected, 1, 'Unknown relay methods must stay rejected');
    assert.equal(counts.syntheticUnknownRejected, 1, 'Only the exact synthetic method/ID qualifies');
    assert.equal(counts.forbidden, 0);
    stage = `${mode}-relay-counts`;
    assert.ok(counts.subscribe > 0 && counts.publish > 0);
    if (mode === 'mutation') {
      stage = `${mode}-pulse-negative-control`;
      const state = await page.evaluate(() => window.benefitsRuntime.state());
      assert.ok(counts.sdkError > 0 && counts.initialize > 0 && counts.e > 0 && counts.batch > 0);
      assert.ok(state.native.fetch > 0 && state.native.beacon > 0 && state.native.e > 0 && state.native.batch > 0);
    }
  });
}

async function lifecycleCase(browser, bundle, mode, kind) {
  stage = `${mode}-${kind}`;
  return fixture(browser, bundle, mode, async (page, counts) => {
    await initialize(page, counts);
    const before = await page.evaluate(() => window.benefitsRuntime.state());
    const response = mode === 'mutation' ? page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === pulseOrigin && url.pathname === '/batch';
    }) : null;
    // Attach both rejection handlers immediately, including on early failure.
    const [after] = await Promise.all([
      page.evaluate(event => {
        window.benefitsRuntime.flush(event);
        return window.benefitsRuntime.state();
      }, kind),
      response,
    ]);
    assert.ok(before.initialize > 0);
    assert.equal(after.pending, 0, 'Each fresh lifecycle case must drain its own INITIALIZE');
    if (mode === 'mutation') {
      assert.ok(after.native.beacon > before.native.beacon);
      assert.ok(counts.batch > 0 && counts.initialize > 0);
    } else {
      assert.equal(after.native.fetch + after.native.beacon, 0);
    }
    await cancelQr(page, 0);
  });
}

async function main() {
  let browser;
  let artifacts;
  const retained = Boolean(process.env.BENEFITS_RUNTIME_ARTIFACT_DIR);
  const deadline = setTimeout(() => {
    // A hung cleanup keeps the primary failure stage visible.
    console.error(`[benefits-walletconnect-runtime] FAIL timeout ${primaryFailureStage ?? stage} ${snapshot()}`);
    process.exit(1);
  }, 240000);
  let primary = null;
  let passLine = null;
  try {
    checkPackageRootStructure();
    const base = retained ? path.resolve(process.env.BENEFITS_RUNTIME_ARTIFACT_DIR) : os.tmpdir();
    if (retained) mkdirSync(base, { recursive: true });
    artifacts = mkdtempSync(path.join(base, 'benefits-walletconnect-runtime-'));
    const bundles = await buildBundles(artifacts);
    stage = 'browser';
    const { chromium } = require('@playwright/test');
    browser = await chromium.launch({ headless: true, args: ['--disable-background-networking'] });
    const result = { excluded: ['NextReactUI', 'production', 'approvedSession', 'CONNECT_SUCCESS', 'signing', 'transactions', 'liveRestore', 'disconnect'] };
    for (const mode of ['guarded', 'mutation']) {
      result[mode] = { runtime: await runtimeCase(browser, bundles[mode], mode) };
      for (const kind of ['hidden', 'freeze', 'pagehide']) {
        result[mode][kind] = await lifecycleCase(browser, bundles[mode], mode, kind);
      }
    }
    stage = 'missing-session-marker';
    result.missingSession = await fixture(browser, bundles.guarded, 'guarded', async (page, counts) => {
      await dormant(page, counts);
      assert.equal(await page.evaluate(() => window.benefitsRuntime.missingSession()), true);
      counts.missingMarkerCleaned = 1;
      assert.ok(counts.sdkChunks > 0);
      const loaded = counts.sdkChunks;
      await page.reload();
      await page.waitForFunction(() => Boolean(window.benefitsRuntime));
      await dormant(page, counts);
      assert.equal(counts.sdkChunks, loaded);
    });
    stage = 'complete';
    writeFileSync(path.join(artifacts, 'summary.json'), `${JSON.stringify(result, null, 2)}\n`);
    passLine = `[benefits-walletconnect-runtime] PASS ${JSON.stringify(result)}`;
  } catch (error) {
    primary = error;
    primaryFailureStage = stage;
  } finally {
    // Cleanup stages are assigned BEFORE each operation; cleanup failures never
    // mask a primary failure, and the primary stage is restored afterwards.
    if (browser) {
      stage = 'browser-close';
      try { await browser.close(); } catch (error) {
        if (primary) reportCleanupFailure('browser-close');
        else { primary = error; primaryFailureStage = stage; }
      }
    }
    if (!retained && artifacts) {
      stage = 'artifacts-remove';
      try { rmSync(artifacts, { recursive: true, force: true }); } catch (error) {
        if (primary) reportCleanupFailure('artifacts-remove');
        else { primary = error; primaryFailureStage = stage; }
      }
    }
    clearTimeout(deadline);
    if (primary && primaryFailureStage !== null) stage = primaryFailureStage;
  }
  if (primary) throw primary;
  console.log(passLine);
}

main().catch(() => {
  // Compiler/Playwright/SDK errors may contain paths, URLs or pairing material.
  // Fixed stage categories and the allowlisted numeric/boolean snapshot only;
  // no console forwarding, traces, HAR or storage dump.
  console.error(`[benefits-walletconnect-runtime] FAIL ${primaryFailureStage ?? stage} ${snapshot()}`);
  process.exitCode = 1;
});
