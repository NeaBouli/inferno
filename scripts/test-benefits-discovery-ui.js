#!/usr/bin/env node

const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { chromium, devices } = require('playwright');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'apps', 'benefits-network', 'frontend');
const port = Number(process.env.BENEFITS_DISCOVERY_UI_PORT || 3212);
const origin = `http://127.0.0.1:${port}`;
const NAVIGATION_TIMEOUT_MS = 90_000;
const catalogProductionOnly = process.argv.length === 3 && process.argv[2] === '--catalog-production-only';
const sellerWallet = '0x1000000000000000000000000000000000000001';
const sellerSignature = `0x${'11'.repeat(65)}`;
const sellerAuthMessage = 'IFR Benefits Network deterministic seller UI authorization';

const offer = {
  id: 'offer-ui-e2e',
  label: 'Member standard',
  category: 'Coffee',
  productName: 'IFR member coffee',
  discountPercent: 10,
  requiredLockIFR: 1000,
  minIFRHeld: 500,
  lockSource: 'commitment_time_only',
  // Per-customer limits are not IFR-hosted (owner decision B, T-231b): the API only serves 0.
  dailyRedemptionLimit: 0,
  monthlyRedemptionLimit: 0,
  business: {
    id: 'seller-ui-e2e',
    slug: 'ifr-test-cafe',
    name: 'IFR Test Cafe',
    description: 'Deterministic offer-discovery fixture.',
    website: 'https://example.com',
    logoUrl: 'https://assets.example.com/ifr-seller-logo.png',
    serviceArea: 'Online',
    categories: ['Coffee'],
  },
  product: {
    id: 'product-ui-e2e',
    name: 'IFR member coffee',
    description: 'A priced catalog fixture.',
    basePriceMinor: '1999',
    currency: 'EUR',
  },
};

function discoveryResponse(offers) {
  return {
    offers,
    categories: offers.length ? ['Coffee'] : [],
    serviceAreas: offers.length ? ['Online'] : [],
    pagination: {
      page: 1,
      limit: 8,
      total: offers.length,
      totalPages: offers.length ? 1 : 0,
      hasNext: false,
    },
  };
}

function installSellerWallet(context) {
  return context.addInitScript(({ account, signature }) => {
    const listeners = new Map();
    const signedMessages = [];
    let connected = false;
    Object.defineProperty(window, '__ifrSellerSignedMessages', { value: signedMessages });
    const provider = {
      isMetaMask: true,
      providers: [],
      request: async ({ method, params }) => {
        if (method === 'eth_requestAccounts') {
          connected = true;
          return [account];
        }
        if (method === 'eth_accounts') return connected ? [account] : [];
        if (method === 'eth_chainId') return '0x1';
        if (method === 'net_version') return '1';
        if (method === 'personal_sign' || method === 'eth_sign') {
          signedMessages.push(params?.[0]);
          return signature;
        }
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_requestPermissions') return null;
        if (method === 'wallet_getPermissions') {
          return connected ? [{ parentCapability: 'eth_accounts' }] : [];
        }
        if (method === 'eth_getBalance') return '0x16345785d8a0000';
        if (method === 'eth_blockNumber') return '0x1';
        if (method === 'eth_call') return `0x${'0'.repeat(64)}`;
        if (method === 'eth_getCode') return '0x01';
        throw new Error(`Unsupported seller test wallet method: ${method}`);
      },
      on: (event, listener) => {
        const current = listeners.get(event) || [];
        current.push(listener);
        listeners.set(event, current);
      },
      removeListener: (event, listener) => {
        listeners.set(event, (listeners.get(event) || []).filter((item) => item !== listener));
      },
    };
    provider.providers = [provider];
    Object.defineProperty(window, 'ethereum', { configurable: true, value: provider });
    window.dispatchEvent(new Event('ethereum#initialized'));
  }, { account: sellerWallet, signature: sellerSignature });
}

function installPhantomNamespaceWallet(context) {
  const account = '0x2000000000000000000000000000000000000002';
  return context.addInitScript(({ walletAddress }) => {
    const listeners = new Map();
    const methods = [];
    let connected = false;
    const provider = {
      isPhantom: true,
      request: async ({ method }) => {
        methods.push(method);
        if (method === 'eth_requestAccounts') {
          connected = true;
          return [walletAddress];
        }
        if (method === 'eth_accounts') return connected ? [walletAddress] : [];
        if (method === 'eth_chainId') return '0x1';
        if (method === 'net_version') return '1';
        if (method === 'wallet_requestPermissions') return null;
        if (method === 'wallet_getPermissions') {
          return connected ? [{ parentCapability: 'eth_accounts' }] : [];
        }
        if (method === 'wallet_getCapabilities') return {};
        throw new Error(`Unsupported Phantom test wallet method: ${method}`);
      },
      on: (event, listener) => {
        const current = listeners.get(event) || [];
        current.push(listener);
        listeners.set(event, current);
      },
      removeListener: (event, listener) => {
        listeners.set(event, (listeners.get(event) || []).filter((item) => item !== listener));
      },
    };
    Object.defineProperty(window, '__ifrPhantomWalletMethods', { value: methods });
    Object.defineProperty(window, 'phantom', {
      configurable: true,
      value: { ethereum: provider },
    });
  }, { walletAddress: account });
}

async function waitForServer(child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next.js exited before startup (${child.exitCode})`);
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for Benefits frontend');
}

async function waitForAttribute(locator, name, expected, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await locator.getAttribute(name) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(await locator.getAttribute(name), expected);
}

async function waitForRoleSelection(locator) {
  await waitForAttribute(locator, 'aria-pressed', 'true', 30_000);
}

async function verifyMobileNoProviderFallback(page, expectedSurface) {
  const walletControl = page.locator('[data-wallet-connect-control]').first();
  await waitForAttribute(walletControl, 'data-wallet-connectors-ready', 'true', 30_000);
  await walletControl.getByText(expectedSurface, { exact: true }).waitFor();
  await walletControl.getByText('No injected provider', { exact: true }).waitFor();
  await walletControl.getByText('Not connected', { exact: true }).first().waitFor();
  assert.equal(
    await walletControl.getByRole('button', { name: 'Disconnect', exact: true }).count(),
    0,
    `${expectedSurface} without a provider must not render a connected state`,
  );
  await walletControl.getByText('Open in wallet app', { exact: true }).waitFor();

  const expectedHosts = {
    metamask: 'metamask.app.link',
    trust: 'link.trustwallet.com',
    okx: 'web3.okx.com',
    phantom: 'phantom.app',
  };
  for (const [wallet, host] of Object.entries(expectedHosts)) {
    const link = walletControl.locator(`[data-wallet-launch="${wallet}"]`);
    await link.waitFor();
    const href = await link.getAttribute('href');
    assert.ok(href, `${wallet} fallback must include an href`);
    const url = new URL(href);
    assert.equal(url.protocol, 'https:', `${wallet} fallback must use HTTPS`);
    assert.equal(url.hostname, host, `${wallet} fallback must use its official launch host`);
    assert.match(decodeURIComponent(decodeURIComponent(href)), /shop\.ifrunit\.tech/);
  }
}

async function waitForLocation(page, pathname, hash = '') {
  await page.waitForFunction(
    ({ expectedPathname, expectedHash }) => (
      window.location.pathname === expectedPathname && window.location.hash === expectedHash
    ),
    { expectedPathname: pathname, expectedHash: hash },
    { timeout: 90_000 }
  );
}

function catalogImagePlan(viewport, state, live) {
  if (live) return state === 'all' || state === 'combined-order' ? { fullPage: state === 'all' } : null;
  if (state === 'name-order-all') return { fullPage: true };
  if (state === 'combined-order') return { fullPage: false };
  if (state === 'all' && viewport.width !== 320) return { fullPage: true };
  return viewport.width === 1440 && ['loading', 'empty', 'load-error', 'no-match'].includes(state) ? { fullPage: false } : null;
}
function catalogPngSize(bytes) {
  assert.ok(bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.toString('ascii', 12, 16) === 'IHDR', 'catalog PNG header must be valid');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
function catalogPublicPath(value) {
  const decoded = decodeURIComponent(value);
  assert.ok(decoded.startsWith('/') && !/[\\\0%?#]/.test(decoded)
    && !decoded.split('/').some(part => part === '.' || part === '..'), 'catalog asset path must be canonical');
  return decoded;
}
const CATALOG_FAILURE_CODES = new Set(['CATALOG_WORK_DEADLINE', 'CATALOG_WEBSOCKET_FORBIDDEN', 'CATALOG_WEBSOCKET_CLOSE_FAILED',
  'CATALOG_NETWORK_ADMISSION', 'CATALOG_ABORT_FAILED', 'CATALOG_FIXTURE_API', 'CATALOG_FIXTURE_LOGO', 'CATALOG_ASSET_IDENTITY']);
const CATALOG_FAILURE_STAGES = new Set(['ADMISSION', 'CONTINUE', 'COUNT', 'MAP', 'STATUS', 'HEADER', 'BODY', 'BYTES', 'API', 'LOGO', 'WEBSOCKET', 'ABORT']);
const CATALOG_RESOURCE_TYPES = new Set(['document', 'stylesheet', 'image', 'media', 'font', 'script', 'texttrack', 'xhr', 'fetch', 'eventsource', 'websocket', 'manifest', 'other']);
const CATALOG_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'OTHER']);
const catalogWorkDeadlineObservers = new WeakMap();
function catalogFailureSample(code, stage, request, targetOrigin, status) {
  if (!CATALOG_FAILURE_CODES.has(code) || !CATALOG_FAILURE_STAGES.has(stage)) return null;
  try {
    const url = new URL(request.url()); const method = typeof request.method === 'function' ? request.method() : 'OTHER';
    const type = typeof request.resourceType === 'function' ? request.resourceType() : 'other';
    let publicPath = url.pathname; try { publicPath = catalogPublicPath(publicPath); } catch { /* Hash only. */ }
    const sample = { code, stage, method: CATALOG_METHODS.has(method) ? method : 'OTHER', resourceType: CATALOG_RESOURCE_TYPES.has(type) ? type : 'other',
      originClass: url.origin === targetOrigin ? 'TARGET' : ['http:', 'https:'].includes(url.protocol) ? 'OTHER_HTTP' : 'OTHER',
      pathSha256: crypto.createHash('sha256').update(publicPath).digest('hex') };
    if (Number.isInteger(status) && status >= 100 && status <= 599) sample.status = status;
    return sample;
  } catch { return null; }
}
function catalogCompletionCheckpoint(proof, sourceClosingEqual, buildClosingEqual) {
  const elapsedMs = performance.now() - proof.started;
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const histogram = Object.fromEntries([...CATALOG_FAILURE_CODES, 'UNKNOWN_FAILURE_CODE'].map(code => [code, 0]));
  for (const code of proof.failures) histogram[CATALOG_FAILURE_CODES.has(code) ? code : 'UNKNOWN_FAILURE_CODE'] += 1;
  const samples = (proof.failureSamples || []).slice(0, 16).flatMap(sample => {
    if (!sample || !CATALOG_FAILURE_CODES.has(sample.code) || !CATALOG_FAILURE_STAGES.has(sample.stage)) return [];
    const safe = { code: sample.code, stage: sample.stage, method: CATALOG_METHODS.has(sample.method) ? sample.method : 'OTHER',
      resourceType: CATALOG_RESOURCE_TYPES.has(sample.resourceType) ? sample.resourceType : 'other',
      originClass: ['TARGET', 'OTHER_HTTP', 'OTHER'].includes(sample.originClass) ? sample.originClass : 'OTHER',
      pathSha256: /^[a-f0-9]{64}$/.test(sample.pathSha256) ? sample.pathSha256 : null };
    if (Number.isInteger(sample.status) && sample.status >= 100 && sample.status <= 599) safe.status = sample.status;
    return [safe];
  });
  const conditions = { notAborted: !proof.aborted, withinWorkBudget: elapsedMs <= 300000,
    ownContextsClosed: proof.contexts.size === 0, noRecordedFailures: proof.failures.length === 0,
    sourceClosingEqual: sourceClosingEqual === true, buildClosingEqual: buildClosingEqual === true };
  return { schema: 'catalog-completion-checkpoint/v1', status: Object.values(conditions).every(Boolean) ? 'PRE_ASSERT_CHECKPOINT' : 'FAIL',
    stage: 'BEFORE_COMPLETION_ASSERT', isAcceptance: false, elapsedMs: Number.isFinite(elapsedMs) && elapsedMs >= 0 ? elapsedMs : null, conditions,
    counts: { failures: count(proof.failures.length), contexts: count(proof.contexts.size), pendingAssetJobs: count(proof.pending.size),
      assetResponses: count(proof.responseCount), assetResponseBytes: count(proof.responseBytes), verifiedAssets: count(proof.assets.size),
      images: count(proof.images.length), imageBytes: count(proof.imageBytes), omittedSamples: count(proof.failureSampleOmitted || 0) },
    knownFailureCodeHistogram: histogram, samples, rawUrlsQueriesErrorsBodiesRetained: false, validationUnchanged: true };
}

function catalogDrainSample(phase, request, targetOrigin) {
  if (!['REQUEST_PENDING', 'PRE_BODY_CHECK', 'BODY_READ', 'BYTE_VERIFY'].includes(phase)) return null;
  // Reuse the closed metadata projection without recording a failure.
  const sample = catalogFailureSample('CATALOG_ASSET_IDENTITY', 'BODY', request, targetOrigin);
  return sample ? { phase, method: sample.method, resourceType: sample.resourceType,
    originClass: sample.originClass, pathSha256: sample.pathSha256 } : null;
}
function catalogDrainCheckpoint(proof, event, context = null, trigger = null) {
  try {
    if (!['DRAIN_ENTRY', 'WORK_ABORT'].includes(event)
      || (event === 'DRAIN_ENTRY' ? trigger !== null : !['OUTER_WORK_DEADLINE', 'INNER_WORK_DEADLINE'].includes(trigger))) return false;
    const contexts = context ? [context] : [...proof.contexts];
    if (contexts.length > 5) return false;
    let remaining = event === 'WORK_ABORT' ? 16 : 0;
    const rows = contexts.map(owned => {
      const row = proof.contextDrains.get(owned).snapshot(proof.origin, remaining);
      remaining -= row.samples.length; return row;
    });
    const elapsedMs = performance.now() - proof.started;
    const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
    const receipt = { schema: 'catalog-drain-observation/v1', isAcceptance: false, event, trigger,
      scriptSha256: /^[a-f0-9]{64}$/.test(proof.source.scriptSha256) ? proof.source.scriptSha256 : null, elapsedMs: Number.isFinite(elapsedMs) && elapsedMs >= 0 ? elapsedMs : null,
      activeContextCount: count(proof.contexts.size), globalPendingValidationJobCount: count(proof.pending.size), contexts: rows,
      rawUrlsQueriesErrorsHeadersBodiesRetained: false };
    if (Buffer.byteLength(JSON.stringify(receipt)) > 16 * 1024) return false;
    const ordinal = rows[0]?.contextOrdinal;
    if (event === 'DRAIN_ENTRY' && (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 5)) return false;
    proof.write(event === 'DRAIN_ENTRY' ? `catalog-drain-entry-0${ordinal}.json` : 'catalog-drain-work-abort.json', receipt);
    return true;
  } catch { return false; } // Observation must never prevent the original abort/wake/close.
}

function createCatalogContextDrain(context, isAborted, identity = {}) {
  const requests = new Set(); const jobs = new Set(); const waiters = new Set(); const observations = new Map();
  const never = new Promise(() => {}); let revision = 0; let rejected = false; let rejection; let lifecyclePhase = 'PRE_CLOSE';
  const wake = () => { revision += 1; for (const resume of waiters) resume(); };
  context.on('request', request => { requests.add(request); wake(); });
  const terminal = request => { requests.delete(request); wake(); };
  context.on('requestfinished', terminal); context.on('requestfailed', terminal); context.on('close', wake);
  const wait = async promise => {
    let resume; const changed = new Promise(resolve => { resume = resolve; waiters.add(resolve); });
    try { await Promise.race([promise, changed]); } finally { waiters.delete(resume); }
  };
  const drain = async () => {
    for (;;) {
      assert.ok(!isAborted(), 'catalog context drain stays inside the original work budget');
      if (rejected) throw rejection;
      const observed = revision;
      await wait(Promise.all([...jobs]));
      if (requests.size === 0 && jobs.size === 0 && revision === observed) {
        // Let already queued protocol events register before the close handoff.
        await wait(new Promise(resolve => setImmediate(resolve)));
        if (requests.size === 0 && jobs.size === 0 && revision === observed) return;
      } else if (jobs.size === 0 && requests.size > 0) await wait(never);
    }
  };
  return {
    wake,
    track(job, observation = null) {
      jobs.add(job); if (observation) observations.set(job, observation); wake();
      void job.then(() => { jobs.delete(job); observations.delete(job); wake(); }, error => { rejected = true; rejection = error; jobs.delete(job); observations.delete(job); wake(); });
      return job;
    },
    snapshot(targetOrigin, sampleLimit = 0) {
      const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
      const limit = Number.isInteger(sampleLimit) ? Math.max(0, Math.min(16, sampleLimit)) : 0;
      const samples = [], bodyPhases = { PRE_BODY_CHECK: 0, BODY_READ: 0, BYTE_VERIFY: 0, UNKNOWN: 0 };
      let unavailableMetadataCount = 0;
      const sample = (phase, request) => {
        if (samples.length >= limit) return;
        try {
          const projected = catalogDrainSample(phase, typeof request === 'function' ? request() : request, targetOrigin);
          if (projected) samples.push(projected); else unavailableMetadataCount += 1;
        } catch { unavailableMetadataCount += 1; }
      };
      for (const job of jobs) {
        try {
          const observation = observations.get(job); const phase = observation?.phase();
          if (['PRE_BODY_CHECK', 'BODY_READ', 'BYTE_VERIFY'].includes(phase)) {
            bodyPhases[phase] += 1; sample(phase, () => observation.request());
          } else { bodyPhases.UNKNOWN += 1; unavailableMetadataCount += 1; }
        } catch { bodyPhases.UNKNOWN += 1; unavailableMetadataCount += 1; }
      }
      for (const request of requests) sample('REQUEST_PENDING', request);
      let aborted = null; try { aborted = isAborted() === true; } catch { unavailableMetadataCount += 1; }
      return { contextOrdinal: count(identity.ordinal), viewportWidth: [1440, 1180, 820, 390, 320].includes(identity.viewportWidth) ? identity.viewportWidth : null,
        lifecyclePhase, aborted, revision: count(revision), pendingRequestCount: count(requests.size), pendingValidationJobCount: count(jobs.size),
        bodyPhases, samples, omittedSampleCount: count(requests.size + jobs.size - samples.length), unavailableMetadataCount: count(unavailableMetadataCount) };
    },
    async close() {
      do { await drain(); } while (requests.size || jobs.size);
      lifecyclePhase = 'CONTEXT_CLOSE'; await context.close(); lifecyclePhase = 'POST_CLOSE';
      await drain(); // Late close-time work is validated, never discarded.
    },
  };
}

async function prepareCatalogQualification(options, browser) {
  const qualificationStarted = performance.now();
  assert.equal(Number(process.versions.node.split('.')[0]), 22, 'catalog qualification requires Node22');
  assert.equal(require('playwright/package.json').version, '1.64.1', 'catalog qualification uses the admitted Playwright');
  assert.ok(chromium.executablePath().includes('chromium-1248'), 'catalog qualification uses the admitted Chromium revision');
  assert.ok(options && Object.keys(options).every(key => ['scope', 'evidenceDir', 'binding'].includes(key)), 'closed catalog qualification input required');
  const live = options.scope === 'root-live-critical';
  assert.ok(live || (options.scope === 'loopback-production' && catalogProductionOnly), 'catalog qualification scope is closed');
  assert.ok(path.isAbsolute(options.evidenceDir || '') && !fs.existsSync(options.evidenceDir), 'fresh absolute catalog evidence directory required');
  const directory = path.resolve(options.evidenceDir); fs.mkdirSync(directory, { mode: 0o700 });
  assert.equal(fs.realpathSync(directory), directory, 'catalog evidence path must not use symlinks');
  const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const fileBytes = (file, maximum) => {
    const stat = fs.lstatSync(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= maximum, 'bounded regular catalog artifact required');
    return fs.readFileSync(file);
  };
  const sourceSnapshot = () => {
    const gitIds = execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', root, 'rev-parse', 'HEAD', 'HEAD:apps/benefits-network/frontend'],
    { encoding: 'utf8', timeout: 5000, maxBuffer: 4096 }).trim().split('\n');
  assert.ok(gitIds.length === 2 && gitIds.every(value => /^[a-f0-9]{40}$/.test(value)), 'catalog source Git identity required');
    return { sourceCommit: gitIds[0], frontendTree: gitIds[1], scriptSha256: digest(fileBytes(__filename, 512 * 1024)),
    componentSha256: digest(fileBytes(path.join(frontend, 'src/app/s/[businessId]/SellerCatalogClient.tsx'), 256 * 1024)),
    packageSha256: digest(fileBytes(path.join(frontend, 'package.json'), 128 * 1024)),
    lockSha256: digest(fileBytes(path.join(frontend, 'package-lock.json'), 4 * 1024 * 1024)) };
  };
  const source = sourceSnapshot();
  const expected = new Map(); let buildId; let binding = null;
  if (live) {
    binding = options.binding;
    const bindingKeys = ['releasedMain', 'sourceCommit', 'frontendTree', 'containerId', 'imageId', 'state', 'observedUtc', 'buildId', 'assets', 'postSourceKind', 'buildReceiptSha256', 'postSourceReceiptSha256', 'postSource'];
    assert.ok(binding && Object.keys(binding).length === bindingKeys.length && bindingKeys.every(key => Object.hasOwn(binding, key)), 'closed Root deployment binding required');
    assert.ok(binding && binding.state?.status === 'running' && binding.state.health === 'healthy' && binding.state.stableThroughRead === true, 'Root stable healthy deployment binding required');
    const age = Date.now() - Date.parse(binding.observedUtc);
    assert.ok(Number.isFinite(age) && age >= 0 && age <= 300000, 'Root opening deployment proof must be fresh');
    assert.ok(binding.postSourceKind === 'ROOT_SUPPLIED_VERIFIED_SOURCE'
      && /^[a-f0-9]{64}$/.test(binding.buildReceiptSha256 || '') && /^[a-f0-9]{64}$/.test(binding.postSourceReceiptSha256 || ''), 'Root verified source/build receipt hashes required');
    assert.ok(binding.releasedMain === source.sourceCommit && binding.sourceCommit === source.sourceCommit
      && binding.frontendTree === source.frontendTree, 'Root released Main and local imported source must match');
    assert.ok(/^[a-f0-9]{64}$/.test(binding.containerId || '') && /^sha256:[a-f0-9]{64}$/.test(binding.imageId || ''), 'Root actual CID/image required');
    const post = binding.postSource;
    const postKeys = ['sourceCommit', 'frontendTree', 'containerId', 'imageId', 'componentSha256', 'packageSha256', 'lockSha256'];
    assert.ok(post && Object.keys(post).length === postKeys.length && postKeys.every(key => Object.hasOwn(post, key))
      && post.sourceCommit === binding.sourceCommit && post.frontendTree === binding.frontendTree
      && post.containerId === binding.containerId && post.imageId === binding.imageId
      && ['componentSha256', 'packageSha256', 'lockSha256'].every(key => post[key] === source[key]), 'Root post-source frame must join exact deployment/source inputs');
    assert.ok(Array.isArray(binding.assets) && binding.assets.length > 0 && binding.assets.length <= 4096, 'Root actual-CID asset map required');
    for (const asset of binding.assets) {
      const publicPath = catalogPublicPath(asset.path);
      assert.ok(!expected.has(publicPath) && Number.isSafeInteger(asset.bytes) && asset.bytes >= 0 && asset.bytes <= 16 * 1024 * 1024 && /^[a-f0-9]{64}$/.test(asset.sha256), 'bounded unique actual-CID asset record required');
      expected.set(publicPath, { bytes: asset.bytes, sha256: asset.sha256 });
    }
    buildId = binding.buildId;
  } else {
    assert.equal(options.binding, undefined, 'local production uses its own artifact, not a live binding');
    buildId = fileBytes(path.join(frontend, '.next/BUILD_ID'), 512).toString('utf8').trim();
  }
  assert.ok(typeof buildId === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(buildId), 'production BUILD_ID required');
  const targetOrigin = live ? 'https://shop.ifrunit.tech' : origin;
  if (!live) assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'fixed loopback port required');
  const assetRecord = pathname => {
    const publicPath = catalogPublicPath(pathname);
    if (!expected.has(publicPath) && !live) {
      const isNext = publicPath.startsWith('/_next/static/');
      const base = path.join(frontend, isNext ? '.next/static' : 'public');
      const relative = isNext ? publicPath.slice('/_next/static/'.length) : publicPath.slice(1);
      const file = path.join(base, relative); const realBase = fs.realpathSync(base); const realFile = fs.realpathSync(file);
      assert.ok(realFile.startsWith(realBase + path.sep), 'catalog asset must stay inside the current artifact');
      const bytes = fileBytes(file, 16 * 1024 * 1024);
      expected.set(publicPath, { bytes: bytes.length, sha256: digest(bytes) });
    }
    assert.ok(expected.has(publicPath), 'served catalog asset must exist in the bound artifact map');
    return { path: publicPath, ...expected.get(publicPath) };
  };
  const manifestPath = `/_next/static/${buildId}/_buildManifest.js`;
  const servedBuild = async () => {
    const expectedManifest = assetRecord(manifestPath);
    const response = await fetch(targetOrigin + manifestPath, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, 'bound production build manifest must be served');
    const declared = response.headers.get('content-length');
    if (declared !== null) assert.ok(Number(declared) <= 16 * 1024 * 1024, 'production manifest response must be bounded');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length === expectedManifest.bytes && digest(bytes) === expectedManifest.sha256, 'served production BUILD_ID manifest must match bound artifact');
    if (!live) assert.equal(fileBytes(path.join(frontend, '.next/BUILD_ID'), 512).toString('utf8').trim(), buildId, 'current production build must remain unchanged');
    return expectedManifest;
  };
  const proof = { live, origin: targetOrigin, directory, source, buildId, bindingSha256: binding ? digest(Buffer.from(JSON.stringify(binding))) : null,
    failures: [], images: [], imageBytes: 0, assets: new Map(), pending: new Set(), contexts: new Set(), contextDrains: new Map(), responseCount: 0, responseBytes: 0, started: qualificationStarted, aborted: false };
  proof.opening = await servedBuild();
  const observeOuterWorkDeadline = () => catalogDrainCheckpoint(proof, 'WORK_ABORT', null, 'OUTER_WORK_DEADLINE');
  let wakeAbort; const workAborted = new Promise(resolve => { wakeAbort = resolve; });
  proof.timer = setTimeout(() => { proof.aborted = true; proof.failures.push('CATALOG_WORK_DEADLINE'); catalogDrainCheckpoint(proof, 'WORK_ABORT', null, 'INNER_WORK_DEADLINE'); wakeAbort();
    for (const context of proof.contexts) { proof.contextDrains.get(context)?.wake(); void context.close().catch(() => {}); }
  }, Math.max(1, 300000 - (performance.now() - qualificationStarted))); proof.timer.unref();
  proof.write = (name, value) => { const file = path.join(directory, name); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); };
  proof.runtime = { node: process.version, playwright: require('playwright/package.json').version, browser: browser.version(), declaredExecutable: chromium.executablePath() };
  proof.write('catalog-opening.json', { schema: 'catalog-production-opening/v1', source, buildId, origin: targetOrigin,
    runtime: proof.runtime,
    binding: binding ? { releasedMain: binding.releasedMain, sourceCommit: binding.sourceCommit, frontendTree: binding.frontendTree, containerId: binding.containerId, imageId: binding.imageId,
      state: binding.state, observedUtc: binding.observedUtc, postSourceKind: binding.postSourceKind, buildReceiptSha256: binding.buildReceiptSha256, postSourceReceiptSha256: binding.postSourceReceiptSha256 } : null,
    bindingSha256: proof.bindingSha256, servedBuild: proof.opening });
  proof.failureSamples = []; proof.failureSampleKeys = new Set(); proof.failureSampleOmitted = 0;
  proof.sampleFailure = (code, stage, request, status) => {
    try {
      const sample = catalogFailureSample(code, stage, typeof request === 'function' ? request() : request, targetOrigin, typeof status === 'function' ? status() : status);
      if (!sample) return;
      const key = JSON.stringify(sample); if (proof.failureSampleKeys.has(key)) return;
      if (proof.failureSamples.length >= 16) { proof.failureSampleOmitted += 1; return; }
      proof.failureSampleKeys.add(key); proof.failureSamples.push(sample);
    } catch { /* Metadata must not replace the existing validation outcome. */ }
  };
  proof.admittedAssets = new Set();
  proof.admit = request => {
    const url = new URL(request.url());
    assert.ok(request.method() === 'GET' && url.origin === targetOrigin, 'catalog network is fixed-origin GET only');
    const publicPath = catalogPublicPath(url.pathname);
    const appRoute = ['/', '/guide', '/support', '/privacy', '/s/catalog-filter-fixture', '/s/catalog-second-fixture'].includes(publicPath);
    if (!appRoute) { assetRecord(publicPath); proof.admittedAssets.add(publicPath); }
  };
  proof.abort = async (route, code, stage = 'ABORT') => {
    proof.failures.push(code); proof.sampleFailure(code, stage, () => route.request());
    try { await route.abort(); }
    catch { proof.failures.push('CATALOG_ABORT_FAILED'); proof.sampleFailure('CATALOG_ABORT_FAILED', 'ABORT', () => route.request()); }
  };
  proof.response = (response, contextDrain = null) => {
    let failureStage = 'MAP';
    const job = (async () => {
      const url = new URL(response.url());
      if (url.origin !== targetOrigin) return; // The only external fixture logo is fulfilled locally by the owning fixture.
      if (!proof.admittedAssets.has(catalogPublicPath(url.pathname))) return;
      failureStage = 'COUNT'; assert.ok(++proof.responseCount <= 2048, 'catalog asset response count must be bounded');
      failureStage = 'MAP'; const record = assetRecord(url.pathname);
      failureStage = 'STATUS'; assert.equal(response.status(), 200, 'loaded catalog asset must be served successfully');
      failureStage = 'HEADER'; const length = response.headers()['content-length']; if (length !== undefined) assert.ok(Number(length) <= 16 * 1024 * 1024, 'loaded catalog asset header must be bounded');
      failureStage = 'BODY'; const bytes = await response.body(); proof.responseBytes += bytes.length;
      failureStage = 'BYTES';
      assert.ok(bytes.length === record.bytes && digest(bytes) === record.sha256 && proof.responseBytes <= 256 * 1024 * 1024, 'loaded catalog asset bytes must match the bound artifact');
      proof.assets.set(record.path, { ...record, responses: (proof.assets.get(record.path)?.responses || 0) + 1 });
    })().catch(() => { proof.failures.push('CATALOG_ASSET_IDENTITY'); proof.sampleFailure('CATALOG_ASSET_IDENTITY', failureStage, () => response.request(), () => response.status()); });
    proof.pending.add(job); void job.finally(() => proof.pending.delete(job));
    if (contextDrain) contextDrain.track(job, { request: () => response.request(),
      phase: () => failureStage === 'BODY' ? 'BODY_READ' : failureStage === 'BYTES' ? 'BYTE_VERIFY' : 'PRE_BODY_CHECK' });
  };
  proof.flush = async () => {
    while (proof.pending.size) {
      assert.ok(!proof.aborted, 'catalog asset drain stays inside the original work budget');
      await Promise.race([Promise.all([...proof.pending]), workAborted]);
    }
    assert.ok(!proof.aborted, 'catalog asset drain stays inside the original work budget');
  };
  proof.finish = async () => {
    await proof.flush(); const closing = await servedBuild();
    const closingSource = sourceSnapshot();
    assert.deepEqual(closingSource, source, 'catalog source Git/script/component/package/lock identity must remain unchanged');
    clearTimeout(proof.timer);
    if (catalogWorkDeadlineObservers.get(browser) === observeOuterWorkDeadline) catalogWorkDeadlineObservers.delete(browser);
    proof.write('catalog-completion-checkpoint.json', catalogCompletionCheckpoint(proof, true,
      closing.sha256 === proof.opening.sha256 && closing.bytes === proof.opening.bytes));
    assert.ok(!proof.aborted && performance.now() - proof.started <= 300000 && proof.contexts.size === 0 && proof.failures.length === 0, 'catalog qualification/owned context cleanup must complete');
    assert.equal(proof.images.length, live ? 4 : 18, 'complete catalog screenshot matrix required');
    assert.ok(proof.assets.size > 0 && [...proof.assets.keys()].some(value => value.endsWith('.css'))
      && [...proof.assets.keys()].some(value => value.includes('/app/s/') && value.endsWith('.js')), 'actual catalog route chunk and CSS identity required');
    const receipt = { schema: 'catalog-production-qualification/v1', status: 'PASS', scope: live ? 'root-live-critical' : 'loopback-production', source, buildId, origin: targetOrigin,
      runtime: proof.runtime, bindingSha256: proof.bindingSha256, opening: proof.opening, closing, closingSource, assets: [...proof.assets.values()], images: proof.images, imageBytes: proof.imageBytes,
      elapsedMs: performance.now() - proof.started, ownContextsClosed: true, rawBodiesRetained: false, sourceBuildJoinRequiresRootBuildReceipt: !live, invokerBrowserCleanup: 'REQUIRED_SEPARATELY', visualReviewByRoot: 'PENDING' };
    proof.write('catalog-production-result.json', receipt); return receipt;
  };
  catalogWorkDeadlineObservers.set(browser, observeOuterWorkDeadline);
  return proof;
}

async function verifySellerCatalogFilters(browser, qualification = null) {
  const proof = qualification ? await prepareCatalogQualification(qualification, browser) : null;
  const catalogOrigin = proof ? proof.origin : origin;
  const stamp = '2026-10-28T00:00:00.000Z';
  const business = { ...offer.business, id: 'catalog-filter-seller', slug: 'catalog-filter-fixture',
    name: 'Independent neighbourhood market and member services', categories: ['Coffee', 'Services', 'General offers'] };
  const rule = (id, label, productId, productName, extra = {}) => ({
    id, label, businessId: business.id, productId, productName, category: productId ? 'Coffee' : 'Membership',
    discountPercent: 10, requiredLockIFR: 1000, minIFRHeld: 0, lockSource: 'ifrlock',
    dailyRedemptionLimit: 0, monthlyRedemptionLimit: 0, ttlSeconds: 90, active: true,
    createdAt: stamp, updatedAt: stamp, ...extra,
  });
  const coffeeName = `Artisan coffee collection ${'Neighbourhood'.repeat(5)}`;
  const coffeeRules = [
    rule('catalog-rule-standard', 'Morning member benefit', 'catalog-product-coffee', coffeeName),
    rule('catalog-rule-loyalty', 'Time-only LOYALTY reward', 'catalog-product-coffee', coffeeName,
      { discountPercent: 20, requiredLockIFR: 25000, minIFRHeld: 500, lockSource: 'commitment_time_only' }),
    rule('catalog-rule-either', `Flexible benefit ${'Extraordinary'.repeat(5)}`, 'catalog-product-coffee', coffeeName,
      { discountPercent: 15, lockSource: 'either' }),
  ];
  const serviceRule = rule('catalog-rule-service', 'Wellness member benefit', 'catalog-product-service', 'Restorative wellness session');
  const generalRules = [
    rule('catalog-rule-community', 'Weekly community bonus', null, 'Community membership'),
    rule('catalog-rule-welcome', 'Weekend welcome offer', null, 'General welcome benefit'),
  ];
  const product = (id, name, category, description, benefitRules, price = '1999', currency = 'EUR') => ({
    id, name, category, description, benefitRules, businessId: business.id,
    basePriceMinor: price, currency, active: true, createdAt: stamp, updatedAt: stamp,
  });
  const products = [
    product('catalog-product-coffee', coffeeName, 'Coffee', 'Roasted hazelnut notes and a reusable presentation box.', coffeeRules),
    product('catalog-product-service', 'Restorative wellness session', 'Services', 'A quiet zone for recovery and rest.', [serviceRule]),
    product('catalog-product-cup', 'Reusable member cup', 'General offers', 'A listed item without an attached discount.', [], '900719925474099313', 'USD'),
  ];
  const rules = [...coffeeRules, serviceRule, ...generalRules];
  // Separate ordering fixtures keep every original search fixture/assertion intact.
  const usdHigh = product('catalog-order-usd-high', 'Equal member item', 'Coffee', 'Exact upper neighbouring reference price.', [], '900719925474099314', 'USD');
  const usdLow = product('catalog-order-usd-low', 'equal MEMBER item', 'Coffee', 'Exact lower neighbouring reference price.', [], '900719925474099313', 'USD');
  const usdTie = product('catalog-order-usd-tie', 'Zulu member item', 'Coffee', 'Equal price preserves its source position.', [], '900719925474099313', 'USD');
  const usdZero = product('catalog-order-usd-zero', 'Alpha zero item', 'Coffee', 'A genuine free reference price.', [], '0', 'USD');
  const eurHigh = product('catalog-order-eur-high', 'Beta euro item', 'Services', 'Euro upper price.', [], '2000', 'EUR');
  const eurLow = product('catalog-order-eur-low', 'Alpha euro item', 'Services', 'Euro lower price.', [], '1998', 'EUR');
  const jpyHigh = product('catalog-order-jpy-high', 'Kyoto high item', 'Services', 'JPY has no fractional minor digits.', [], '1000', 'JPY');
  const jpyLow = product('catalog-order-jpy-low', 'Kyoto low item', 'Services', 'JPY lower reference price.', [], '999', 'JPY');
  const invalidPairs = [[null, null], [null, 'USD'], ['100', null], ['01', 'USD'],
    ['-1', 'USD'], ['1e2', 'EUR'], ['1000000000000000000', 'JPY'], ['100', 'ZZZ']];
  const invalidProducts = invalidPairs.map(([price, currency], index) => product(`catalog-order-invalid-${index}`,
    `Unpriced defensive item ${index}`, 'Coffee', 'Invalid price/currency pairs must not become a zero price.', [], price, currency));
  const orderingProducts = [...products, usdHigh, usdLow, usdTie, usdZero, eurHigh, eurLow, jpyHigh, jpyLow, ...invalidProducts];
  const coffeeOrder = [products[0], usdHigh, usdLow, usdTie, usdZero, ...invalidProducts];
  const servicesOrder = [products[1], eurHigh, eurLow, jpyHigh, jpyLow];
  const orderingOriginal = [...coffeeOrder, ...servicesOrder, products[2]].map(item => item.id);
  const orderingTotal = orderingProducts.length + generalRules.length;
  const secondBusiness = { ...business, id: 'catalog-second-seller', slug: 'catalog-second-fixture', name: 'Second independent seller' };
  const secondProducts = [{ ...usdZero, id: 'catalog-second-zero', businessId: secondBusiness.id },
    { ...jpyLow, id: 'catalog-second-jpy', businessId: secondBusiness.id }];
  const secondRules = [rule('catalog-second-general', 'Second seller member benefit', null, 'Second seller membership', { businessId: secondBusiness.id })];
  const combinedQueryMatches = orderingProducts.filter(item => item.category === 'Coffee' && item.currency === 'USD'
    && typeof item.basePriceMinor === 'string' && /^(0|[1-9][0-9]{0,17})$/.test(item.basePriceMinor)
    && [item.name, item.description || '', ...item.benefitRules.map(offer => offer.label)]
      .some(text => text.toLowerCase().includes('equal')));
  assert.deepEqual(combinedQueryMatches.map(item => item.id), [usdHigh.id, usdLow.id, usdTie.id], 'combined fixture query must retain name and description matches');
  const viewports = [
    { width: 1440, height: 1000 }, { width: 1180, height: 820 }, { width: 820, height: 1180 },
    { width: 390, height: 844 }, { width: 320, height: 844 },
  ];
  const evidenceDir = proof ? proof.directory : process.env.BENEFITS_CATALOG_EVIDENCE_DIR;
  const metrics = [];
  if (evidenceDir) fs.mkdirSync(path.join(evidenceDir, 'screenshots'), { recursive: true });

  for (const viewport of viewports.filter(value => !proof?.live || value.width === 1440 || value.width === 390)) {
    assert.ok(!proof?.aborted, 'catalog work deadline must not start another context');
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1,
      isMobile: viewport.width <= 390, hasTouch: viewport.width <= 390, serviceWorkers: 'block' });
    const contextDrain = proof ? createCatalogContextDrain(context, () => proof.aborted,
      { ordinal: viewports.findIndex(value => value.width === viewport.width) + 1, viewportWidth: viewport.width }) : null;
    if (proof) {
      proof.contexts.add(context); proof.contextDrains.set(context, contextDrain);
      context.on('response', response => proof.response(response, contextDrain));
      await context.routeWebSocket('**/*', async socket => {
        proof.failures.push('CATALOG_WEBSOCKET_FORBIDDEN');
        const metadata = { url: () => socket.url(), method: () => 'GET', resourceType: () => 'websocket' };
        proof.sampleFailure('CATALOG_WEBSOCKET_FORBIDDEN', 'WEBSOCKET', metadata);
        try { await socket.close(); } catch { proof.failures.push('CATALOG_WEBSOCKET_CLOSE_FAILED'); proof.sampleFailure('CATALOG_WEBSOCKET_CLOSE_FAILED', 'WEBSOCKET', metadata); }
      });
      await context.route('**/*', async route => {
        let stage = 'ADMISSION';
        try { proof.admit(route.request()); stage = 'CONTINUE'; await route.continue(); }
        catch { await proof.abort(route, 'CATALOG_NETWORK_ADMISSION', stage); }
      });
    }
    let mode = viewport.width === 1440 ? 'loading' : 'ready';
    let releaseLoading;
    const loadingGate = new Promise(resolve => { releaseLoading = resolve; });
    const catalogRequests = [];
    const pageErrors = [];
    await context.route('**/api/**', async route => {
      try {
      const request = route.request();
      const url = new URL(request.url());
      if (proof) assert.equal(url.origin, catalogOrigin, 'catalog fixture API stays on the fixed renderer origin');
      assert.equal(request.method(), 'GET', 'public catalog fixture must never mutate data');
      const second = url.pathname.startsWith(`/api/businesses/${secondBusiness.slug}/`);
      const selectedBusiness = second ? secondBusiness : business;
      const selectedProducts = second ? secondProducts : mode === 'ordering' ? orderingProducts : products;
      const selectedRules = second ? secondRules : rules;
      const isProducts = url.pathname === `/api/businesses/${selectedBusiness.slug}/products`;
      const isRules = url.pathname === `/api/businesses/${selectedBusiness.slug}/rules`;
      if (isProducts || isRules) {
        catalogRequests.push(url.pathname);
        if (mode === 'loading') await loadingGate;
        if (mode === 'error') return await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Catalog fixture temporarily unavailable' }) });
        return await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isProducts
          ? { business: selectedBusiness, products: mode === 'empty' ? [] : selectedProducts }
          : { rules: mode === 'empty' ? [] : selectedRules }) });
      }
      if (url.pathname === `/api/businesses/${secondBusiness.slug}`) return await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(secondBusiness) });
      if (url.pathname === `/api/businesses/${business.slug}`) return await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(business) });
      if (url.pathname === '/api/businesses') return await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(discoveryResponse([])) });
      if (url.pathname === '/api/ready') return await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ready', chainId: 1, database: 'ok', rateLimitStore: 'ok' }) });
      throw new Error(`Unexpected catalog fixture request ${url.pathname}`);
      } catch (error) {
        if (!proof) throw error;
        await proof.abort(route, 'CATALOG_FIXTURE_API', 'API');
      }
    });
    await context.route('https://assets.example.com/ifr-seller-logo.png', async route => {
      try {
        assert.equal(route.request().method(), 'GET', 'synthetic catalog logo must not mutate data');
        await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
      } catch (error) { if (!proof) throw error; await proof.abort(route, 'CATALOG_FIXTURE_LOGO', 'LOGO'); }
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    page.on('pageerror', error => pageErrors.push(error.message));
    const url = `${catalogOrigin}/s/${business.slug}`;
    const entries = () => page.locator('[data-catalog-entry]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-catalog-entry')));
    const search = page.getByRole('searchbox', { name: 'Search this catalog', exact: true });
    const category = page.getByLabel('Category', { exact: true });
    const reset = page.getByRole('button', { name: 'Reset filters', exact: true });
    const currency = page.getByLabel('Reference-price currency', { exact: true });
    const order = page.getByLabel('Sort products within each category', { exact: true });
    const resetFilters = async () => {
      if (await reset.isEnabled()) {
        if (viewport.width <= 390) await reset.tap(); else await reset.click();
      }
      await page.waitForFunction(() => document.querySelector('[data-catalog-result-count]')?.textContent?.trim() === 'Showing 5 of 5 catalog entries.');
    };
    const capture = async (state, focusId = 'catalog-search') => {
      if (proof) await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      const contrastRatio = (foreground, background) => {
        const fg = foreground.match(/[\d.]+/g).map(Number);
        let bg = background.match(/[\d.]+/g).map(Number);
        if (bg.length > 3 && bg[3] === 0) bg = [245, 241, 232];
        const alpha = fg.length > 3 ? fg[3] : 1;
        const luminance = rgb => rgb.slice(0, 3).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
        const a = luminance(fg.slice(0, 3).map((value, index) => value * alpha + bg[index] * (1 - alpha)));
        const b = luminance(bg);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const layout = await page.evaluate(focusId => {
        const filters = document.querySelector('[data-catalog-filters]');
        const cards = [...document.querySelectorAll('[data-catalog-entry]')];
        const targets = filters ? [...filters.querySelectorAll('input,select,button')] : [];
        const boxes = targets.map(node => {
          const r = node.getBoundingClientRect(); const s = getComputedStyle(node);
          return { id: node.id || node.textContent.trim(), x: r.x, y: r.y, width: r.width, height: r.height,
            padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(parseFloat),
            color: s.color, background: s.backgroundColor, disabled: node.disabled };
        });
        const overlaps = [];
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          if (Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1) overlaps.push([a.id, b.id]);
        }
        const clippedText = [];
        for (const node of document.querySelectorAll('#catalog-results h2,#catalog-results p,#catalog-results a,[data-catalog-filters] h2,[data-catalog-filters] p')) {
          const b = node.getBoundingClientRect(); if (!b.width || !b.height) continue;
          const range = document.createRange(); range.selectNodeContents(node);
          for (const line of range.getClientRects()) if (line.left < b.left - 1 || line.right > b.right + 1 || line.top < b.top - 1 || line.bottom > b.bottom + 1) {
            clippedText.push(node.textContent.slice(0, 60)); break;
          }
        }
        const outsideCards = cards.filter(node => {
          const b = node.getBoundingClientRect(); return b.left < -1 || b.right > innerWidth + 1 || node.scrollWidth > node.clientWidth + 1;
        }).map(node => node.getAttribute('data-catalog-entry'));
        const input = document.getElementById(focusId);
        const style = input ? getComputedStyle(input) : null;
        return { viewport: { width: innerWidth, height: innerHeight }, scrollWidth: document.documentElement.scrollWidth,
          controls: boxes, overlaps, clippedText, outsideCards, entryCount: cards.length,
          focus: input ? { visible: input.matches(':focus-visible'), outlineWidth: style.outlineWidth, outlineColor: style.outlineColor } : null };
      }, focusId);
      metrics.push({ state, ...layout, catalogRequests: catalogRequests.length });
      assert.ok(layout.scrollWidth <= viewport.width, `${state} must not cause document overflow at ${viewport.width}`);
      assert.deepEqual(layout.overlaps, [], `${state}: controls must not overlap`);
      assert.deepEqual(layout.clippedText, [], `${state}: catalog text must wrap inside its own box`);
      assert.deepEqual(layout.outsideCards, [], `${state}: cards must fit without hidden horizontal content`);
      for (const control of layout.controls) {
        assert.ok(control.width >= 44 && control.height >= 48, `${control.id}: minimum touch target at ${viewport.width}`);
        assert.ok(control.padding.every(value => value >= 12), `${control.id}: internal padding must remain on all sides`);
      }
      if (state === 'rule-match') {
        const input = layout.controls.find(control => control.id === 'catalog-search');
        assert.ok(parseFloat(layout.focus.outlineWidth) >= 2, 'keyboard focus outline must be measurable');
        assert.ok(contrastRatio(layout.focus.outlineColor, input.background) >= 3, 'keyboard focus must contrast with the field');
      }
      if (state === 'currency-focus' || state === 'order-focus' || state === 'combined-order') {
        const control = layout.controls.find(control => control.id === focusId);
        assert.ok(control && layout.focus.visible, 'new catalog select must retain visible keyboard focus');
        assert.ok(parseFloat(layout.focus.outlineWidth) >= 2, 'new select focus outline must be measurable');
        assert.ok(contrastRatio(layout.focus.outlineColor, control.background) >= 3, 'new select focus must contrast with its field');
      }
      for (const control of layout.controls.filter(control => !control.disabled)) {
        assert.ok(contrastRatio(control.color, control.background) >= 4.5, `${control.id}: readable control text contrast`);
      }
      const imagePlan = proof ? catalogImagePlan(viewport, state, proof.live) : { fullPage: state === 'all' };
      if (evidenceDir && imagePlan) {
        await page.evaluate(full => {
          const target = document.querySelector('[data-catalog-filters]') || document.querySelector('#catalog-results');
          const header = document.querySelector('.shop-header');
          const top = full ? 0 : Math.max(0, target.getBoundingClientRect().top + scrollY - header.getBoundingClientRect().height - 16);
          window.scrollTo({ top, behavior: 'instant' });
        }, imagePlan.fullPage);
        const coverage = proof ? await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, scrollX, scrollY,
          documentHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight), scale: visualViewport?.scale, zoom: getComputedStyle(document.documentElement).zoom })) : null;
        const imagePath = path.join(evidenceDir, 'screenshots', `${viewport.width}x${viewport.height}-${state}.png`);
        if (proof) assert.equal(fs.existsSync(imagePath), false, 'new catalog proof must not overwrite a capture');
        await page.screenshot({ path: imagePath, fullPage: imagePlan.fullPage });
        if (proof) {
          fs.chmodSync(imagePath, 0o600); const bytes = fs.readFileSync(imagePath); const size = catalogPngSize(bytes);
          assert.ok(bytes.length <= 4 * 1024 * 1024 && size.width * size.height <= 30 * 1000 * 1000, 'catalog PNG must meet byte/pixel budgets');
          assert.ok(coverage.width === viewport.width && coverage.height === viewport.height && coverage.dpr === 1 && coverage.scale === 1 && ['1', 'normal'].includes(coverage.zoom), 'catalog proof must use the actual DPR1 viewport without zoom');
          assert.equal(size.width, viewport.width);
          assert.ok(Math.abs(size.height - (imagePlan.fullPage ? coverage.documentHeight : viewport.height)) <= 1, 'catalog PNG must cover its complete measured document/viewport');
          if (imagePlan.fullPage) assert.ok(Math.abs(coverage.scrollY) <= 1 && Math.abs(coverage.scrollX) <= 1, 'full-page catalog capture starts at the top');
          proof.imageBytes += bytes.length; assert.ok(proof.imageBytes <= 48 * 1024 * 1024, 'catalog image matrix must meet total byte budget');
          proof.images.push({ file: path.relative(evidenceDir, imagePath), state, viewport, fullPage: imagePlan.fullPage, coverage, ...size, bytes: bytes.length,
            sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
        }
      }
    };
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (mode === 'loading') {
        await page.getByText('Loading active catalog...', { exact: true }).waitFor();
        assert.equal(await page.getByText('No public offers yet', { exact: true }).count(), 0);
        assert.equal(await search.count(), 0, 'loading must not expose stale filters');
        await capture('loading'); mode = 'ready'; releaseLoading();
      }
      await page.getByText('Showing 5 of 5 catalog entries.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('link', { name: 'Use this offer', exact: true }).count(), 6, 'entry count must not count child offer rules');
      const originalOrder = await entries();
      assert.deepEqual(originalOrder, [...products.map(p => p.id), ...generalRules.map(r => r.id)]);
      assert.deepEqual(await category.locator('option').allTextContents(), ['All categories', 'Coffee', 'Services', 'General offers', 'General offers only']);
      const originalLinks = await page.locator('#catalog-results a[href*="offer="]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
      assert.deepEqual(originalLinks, rules.map(rule => `/?seller=${business.slug}&offer=${rule.id}#customer-pass`));
      await page.getByText('Reference price: USD 9,007,199,254,740,993.13', { exact: true }).waitFor();
      await capture('all');
      const requestsBeforeFiltering = catalogRequests.length;
      assert.equal(requestsBeforeFiltering, 2);
      await search.fill('  lOyAlTy  ');
      await page.getByText('Showing 1 of 5 catalog entries.', { exact: true }).waitFor();
      assert.deepEqual(await entries(), [products[0].id]);
      assert.equal(await page.locator('[data-catalog-rule]').count(), 3, 'matching one rule must retain every original product offer');
      await page.getByText('Reference price: EUR 19.99', { exact: true }).waitFor();
      await page.getByText('Verify at least 25,000 IFR in active TIME_ONLY commitments and 500 IFR held at checkout.', { exact: true }).waitFor();
      assert.equal(await page.getByText('Connect wallet to check', { exact: true }).count(), 3, 'filter must preserve existing eligibility state for all original rules');
      await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      assert.equal(await search.evaluate(node => node.matches(':focus-visible')), true, 'keyboard focus must remain visible');
      await capture('rule-match');
      await category.selectOption('category:Services');
      await page.getByRole('heading', { name: 'No matching catalog entries', exact: true }).waitFor();
      await page.getByText('Showing 0 of 5 catalog entries.', { exact: true }).waitFor();
      assert.equal(await page.getByText('No public offers yet', { exact: true }).count(), 0, 'no-match is not initial empty catalog');
      await capture('no-match');
      await resetFilters();
      await search.fill('  HAZELNUT  ');
      await page.getByText('Showing 1 of 5 catalog entries.', { exact: true }).waitFor();
      assert.deepEqual(await entries(), [products[0].id], 'description search must be trimmed and case-insensitive');
      await search.fill('WELLNESS'); await category.selectOption('category:Services');
      await page.getByText('Showing 1 of 5 catalog entries.', { exact: true }).waitFor();
      assert.deepEqual(await entries(), [products[1].id], 'product-name search combines with category');
      await resetFilters(); await category.selectOption('category:General offers');
      await page.getByText('Showing 1 of 5 catalog entries.', { exact: true }).waitFor();
      assert.deepEqual(await entries(), [products[2].id], 'literal product category must not collide with general-offer group');
      await resetFilters(); await category.selectOption('general');
      await page.getByText('Showing 2 of 5 catalog entries.', { exact: true }).waitFor();
      assert.deepEqual(await entries(), generalRules.map(r => r.id));
      await capture('general-offers');
      await search.fill('  COMMUNITY  ');
      await page.getByText('Showing 1 of 5 catalog entries.', { exact: true }).waitFor();
      assert.deepEqual(await entries(), [generalRules[0].id], 'general offer searches its own label');
      const marker = 'CATALOG-QUERY-NOT-PERSISTED-390'; await search.fill(marker);
      await page.getByText('Showing 0 of 5 catalog entries.', { exact: true }).waitFor();
      assert.equal(await page.evaluate(value => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(value), marker), false, 'search state must not be persisted');
      await resetFilters();
      assert.deepEqual(await entries(), originalOrder, 'reset restores original entry ordering');
      assert.deepEqual(await page.locator('#catalog-results a[href*="offer="]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href'))), originalLinks, 'reset preserves exact seller/rule bindings');
      assert.equal(new URL(page.url()).search, '', 'local filters must not change the shared seller URL');
      assert.equal(catalogRequests.length, requestsBeforeFiltering, 'keystrokes, category and reset make no catalog requests');
      // New reference-price/order controls: same owning fixture, no new runner mode.
      await page.addInitScript(() => {
        const effects = { storage: 0, history: 0 };
        Object.defineProperty(window, '__catalogOrderingEffects', { value: effects });
        for (const method of ['setItem', 'removeItem', 'clear']) {
          const original = Storage.prototype[method];
          Storage.prototype[method] = function (...args) { effects.storage += 1; return Reflect.apply(original, this, args); };
        }
        for (const method of ['pushState', 'replaceState']) {
          const original = history[method];
          history[method] = function (...args) { effects.history += 1; return Reflect.apply(original, this, args); };
        }
      });
      mode = 'ordering'; await page.reload({ waitUntil: 'domcontentloaded' });
      const generalIds = generalRules.map(item => item.id);
      const orderingEntries = [...orderingOriginal, ...generalIds];
      const currencyValues = () => currency.locator('option').evaluateAll(nodes => nodes.map(node => node.value));
      const checkBindings = async productIds => {
        for (const id of productIds) {
          const fixture = orderingProducts.find(item => item.id === id);
          const card = page.locator(`[data-catalog-entry="${id}"]`);
          assert.deepEqual(await card.locator('[data-catalog-rule]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-catalog-rule'))), fixture.benefitRules.map(item => item.id), `${id}: every original child rule stays attached`);
          assert.deepEqual(await card.locator('a[href*="offer="]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href'))), fixture.benefitRules.map(item => `/?seller=${business.slug}&offer=${item.id}#customer-pass`), `${id}: exact offer links stay attached`);
        }
      };
      const expectOrdering = async (productIds, standalone = generalIds) => {
        const expected = [...productIds, ...standalone];
        await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('[data-catalog-entry]')].map(node => node.getAttribute('data-catalog-entry'))) === JSON.stringify(expected), expected);
        assert.deepEqual(await entries(), expected);
        await page.getByText(`Showing ${expected.length} of ${orderingTotal} catalog entries.`, { exact: true }).waitFor();
        await checkBindings(productIds);
        for (const id of standalone) assert.equal(await page.locator(`[data-catalog-entry="${id}"] a[href*="offer="]`).getAttribute('href'), `/?seller=${business.slug}&offer=${id}#customer-pass`);
      };
      const resetOrdering = async () => {
        if (await reset.isEnabled()) { if (viewport.width <= 390) await reset.tap(); else await reset.click(); }
        assert.equal(await search.inputValue(), ''); assert.equal(await category.inputValue(), 'all');
        assert.equal(await currency.inputValue(), 'all'); assert.equal(await order.inputValue(), 'original');
        await expectOrdering(orderingOriginal);
      };
      await expectOrdering(orderingOriginal);
      assert.deepEqual(await currencyValues(), ['all', 'USD', 'EUR', 'JPY'], 'options come from the entire valid priced catalog in allowlist order');
      assert.deepEqual(await order.locator('option').evaluateAll(nodes => nodes.map(node => node.value)), ['original', 'name-asc', 'name-desc', 'price-asc', 'price-desc']);
      for (const value of ['price-asc', 'price-desc']) assert.equal(await order.locator(`option[value="${value}"]`).isDisabled(), true, 'All currencies cannot enable price comparisons');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const effectsBefore = await page.evaluate(() => ({ ...window.__catalogOrderingEffects }));
      assert.equal(await page.evaluate(() => typeof window.ethereum), 'undefined', 'catalog qualification must not install a wallet provider');
      const orderingRequests = catalogRequests.length; const orderingUrl = page.url();
      // A forged disabled-option event must still never sort across currencies.
      await order.evaluate(node => { node.value = 'price-asc'; node.dispatchEvent(new Event('change', { bubbles: true })); });
      await expectOrdering(orderingOriginal); await resetOrdering();
      if (viewport.width <= 390) { await currency.tap(); await page.keyboard.press('Escape'); }
      await currency.selectOption('USD');
      for (const value of ['price-asc', 'price-desc']) assert.equal(await order.locator(`option[value="${value}"]`).isDisabled(), false);
      const usdOriginal = [usdHigh.id, usdLow.id, usdTie.id, usdZero.id, products[2].id];
      await expectOrdering(usdOriginal);
      assert.equal(await page.locator('[data-catalog-entry^="catalog-order-invalid-"]').count(), 0, 'null/malformed/unknown pairs never enter an explicit currency');
      await page.locator(`[data-catalog-entry="${usdZero.id}"]`).getByText('Reference price: USD 0.00', { exact: true }).waitFor();
      await page.locator(`[data-catalog-entry="${usdHigh.id}"]`).getByText('Reference price: USD 9,007,199,254,740,993.14', { exact: true }).waitFor();
      await page.locator(`[data-catalog-entry="${usdLow.id}"]`).getByText('Reference price: USD 9,007,199,254,740,993.13', { exact: true }).waitFor();
      await currency.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      assert.equal(await currency.evaluate(node => node.matches(':focus-visible')), true);
      const currencyId = await currency.getAttribute('id'); assert.ok(currencyId);
      await capture('currency-focus', currencyId);
      if (viewport.width <= 390) { await order.tap(); await page.keyboard.press('Escape'); }
      await order.selectOption('name-asc');
      await expectOrdering([usdZero.id, usdHigh.id, usdLow.id, usdTie.id, products[2].id]);
      await order.selectOption('name-desc');
      await expectOrdering([usdTie.id, usdHigh.id, usdLow.id, usdZero.id, products[2].id]);
      await order.selectOption('price-asc');
      await expectOrdering([usdZero.id, usdLow.id, usdTie.id, usdHigh.id, products[2].id]);
      await order.selectOption('price-desc');
      await expectOrdering([usdHigh.id, usdLow.id, usdTie.id, usdZero.id, products[2].id]);
      await order.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      assert.equal(await order.evaluate(node => node.matches(':focus-visible')), true, 'reordering retains focus on the active select');
      const orderId = await order.getAttribute('id'); assert.ok(orderId);
      await capture('order-focus', orderId);
      await currency.selectOption('EUR'); assert.equal(await order.inputValue(), 'price-desc', 'explicit currency changes preserve direction');
      await expectOrdering([products[0].id, eurHigh.id, products[1].id, eurLow.id]);
      await order.selectOption('price-asc'); await expectOrdering([products[0].id, eurLow.id, products[1].id, eurHigh.id]);
      await currency.selectOption('JPY'); assert.equal(await order.inputValue(), 'price-asc');
      await expectOrdering([jpyLow.id, jpyHigh.id]);
      await page.locator(`[data-catalog-entry="${jpyHigh.id}"]`).getByText('Reference price: JPY 1,000', { exact: true }).waitFor();
      await page.locator(`[data-catalog-entry="${jpyLow.id}"]`).getByText('Reference price: JPY 999', { exact: true }).waitFor();
      await order.selectOption('price-desc'); await expectOrdering([jpyHigh.id, jpyLow.id]);
      await currency.selectOption('all'); assert.equal(await order.inputValue(), 'original', 'clearing currency resets price order only');
      await expectOrdering(orderingOriginal);
      await currency.selectOption('USD'); await order.selectOption('name-desc'); await currency.selectOption('all');
      assert.equal(await order.inputValue(), 'name-desc', 'clearing currency preserves name order');
      await expectOrdering([usdTie.id, ...invalidProducts.map(item => item.id).reverse(), usdHigh.id, usdLow.id, products[0].id, usdZero.id,
        products[1].id, jpyLow.id, jpyHigh.id, eurHigh.id, eurLow.id, products[2].id]);
      await capture('name-order-all'); await resetOrdering();
      await currency.selectOption('USD'); await order.selectOption('price-desc'); await category.selectOption('category:Coffee'); await search.fill('equal');
      await expectOrdering([usdHigh.id, usdLow.id, usdTie.id], []);
      await order.selectOption('price-asc'); await expectOrdering([usdLow.id, usdTie.id, usdHigh.id], []);
      assert.deepEqual(await currencyValues(), ['all', 'USD', 'EUR', 'JPY'], 'search/category must not narrow currency choices');
      await order.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      await capture('combined-order', orderId);
      await search.fill('loyalty'); await currency.selectOption('EUR');
      await expectOrdering([products[0].id], []);
      assert.equal(await page.locator('[data-catalog-rule]').count(), 3, 'currency/search ordering preserves all child offer rules');
      await resetOrdering(); await currency.selectOption('JPY'); await order.selectOption('price-desc'); await category.selectOption('general');
      await expectOrdering([], generalIds);
      await search.fill('community'); await expectOrdering([], [generalRules[0].id]);
      await resetOrdering(); await currency.selectOption('USD'); await order.selectOption('price-asc'); await category.selectOption('category:General offers');
      await expectOrdering([products[2].id], []);
      await resetOrdering();
      assert.equal(catalogRequests.length, orderingRequests, 'currency/order/search/category/reset add no catalog GETs');
      assert.equal(page.url(), orderingUrl, 'all four transient controls leave the shared URL unchanged');
      assert.deepEqual(await page.evaluate(() => ({ ...window.__catalogOrderingEffects })), effectsBefore, 'control changes must not write storage/history');
      assert.equal(await page.evaluate(() => typeof window.ethereum), 'undefined', 'catalog controls must not create a wallet provider');
      // All four controls also reset on a fresh load and a different seller URL.
      await currency.selectOption('USD'); await order.selectOption('price-desc'); await category.selectOption('category:Coffee'); await search.fill('equal');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByText(`Showing ${orderingTotal} of ${orderingTotal} catalog entries.`, { exact: true }).waitFor();
      assert.equal(await search.inputValue(), ''); assert.equal(await category.inputValue(), 'all');
      assert.equal(await currency.inputValue(), 'all'); assert.equal(await order.inputValue(), 'original');
      await expectOrdering(orderingOriginal);
      await currency.selectOption('USD'); await order.selectOption('price-desc'); await category.selectOption('category:Coffee'); await search.fill('equal');
      await page.goto(`${catalogOrigin}/s/${secondBusiness.slug}`, { waitUntil: 'domcontentloaded' });
      await page.getByText('Showing 3 of 3 catalog entries.', { exact: true }).waitFor();
      assert.equal(await search.inputValue(), ''); assert.equal(await category.inputValue(), 'all');
      assert.equal(await currency.inputValue(), 'all'); assert.equal(await order.inputValue(), 'original');
      assert.deepEqual(await entries(), [...secondProducts.map(item => item.id), ...secondRules.map(item => item.id)]);
      assert.deepEqual(await currencyValues(), ['all', 'USD', 'JPY'], 'seller change must derive only that seller currency choices');
      assert.equal(await page.locator(`[data-catalog-entry="${secondRules[0].id}"] a[href*="offer="]`).getAttribute('href'), `/?seller=${secondBusiness.slug}&offer=${secondRules[0].id}#customer-pass`);
      await capture('second-seller');
      mode = 'ready'; await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.getByText('Showing 5 of 5 catalog entries.', { exact: true }).waitFor();
      await search.fill('not-restored-after-reload'); await category.selectOption('general');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByText('Showing 5 of 5 catalog entries.', { exact: true }).waitFor();
      assert.equal(await search.inputValue(), ''); assert.equal(await category.inputValue(), 'all');
      mode = 'empty'; await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'No public offers yet', exact: true }).waitFor();
      assert.equal(await search.count(), 0); assert.equal(await page.getByRole('heading', { name: 'No matching catalog entries', exact: true }).count(), 0);
      await capture('empty');
      mode = 'error'; await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByText('Catalog fixture temporarily unavailable', { exact: true }).waitFor();
      assert.equal(await search.count(), 0); assert.equal(await page.getByText('No public offers yet', { exact: true }).count(), 0);
      await capture('load-error');
      if (viewport.width === 390) {
        mode = 'ready'; await page.reload({ waitUntil: 'domcontentloaded' });
        await search.fill('loyalty');
        await page.getByText('Showing 1 of 5 catalog entries.', { exact: true }).waitFor();
        await page.locator('[data-catalog-rule="catalog-rule-loyalty"]').getByRole('link', { name: 'Use this offer', exact: true }).tap();
        await waitForLocation(page, '/', '#customer-pass');
        assert.equal(new URL(page.url()).searchParams.get('seller'), business.slug);
        assert.equal(new URL(page.url()).searchParams.get('offer'), coffeeRules[1].id);
        await page.locator('#customer-pass').getByText('Selected public offer', { exact: true }).waitFor();
        await page.locator('#customer-pass').getByText('20% benefit · 25,000 IFR lock in active TIME_ONLY commitments · 500 IFR held', { exact: true }).waitFor();
      }
      assert.deepEqual(pageErrors, []);
    } finally {
      releaseLoading();
      if (contextDrain) { catalogDrainCheckpoint(proof, 'DRAIN_ENTRY', context); await contextDrain.close(); } else await context.close();
      if (proof) { proof.contexts.delete(context); proof.contextDrains.delete(context); }
      if (evidenceDir) fs.writeFileSync(path.join(evidenceDir, 'catalog-layout-metrics.json'), JSON.stringify({ fixtureOnly: true, viewports: viewports.filter(value => !proof?.live || value.width === 1440 || value.width === 390), metrics }, null, 2), { mode: proof ? 0o600 : 0o644 });
    }
  }
  const qualificationReceipt = proof ? await proof.finish() : null;
  console.log('[seller-catalog-search] PASS - search/categories, exact currency-safe within-group ordering, transient state, exact bindings and responsive viewports');
  return qualificationReceipt;
}

async function verifyOfferDiscoveryRecovery(browser) {
  const evidenceDir = process.env.BENEFITS_DISCOVERY_RECOVERY_EVIDENCE_DIR;
  const viewports = [{ width: 1440, height: 1000 }, { width: 1180, height: 820 },
    { width: 820, height: 1180 }, { width: 390, height: 844 }, { width: 320, height: 844 }];
  const fixtures = Array.from({ length: 17 }, (_, index) => ({ ...offer,
    id: `discovery-recovery-${index + 1}`, label: `Member benefit ${index + 1}`,
    productName: `Member item ${String(index + 1).padStart(2, '0')} ${index === 0 ? 'Neighbourhood'.repeat(5) : 'coffee'}`,
    product: { ...offer.product, id: `recovery-product-${index + 1}`, description: `Recovery fixture ${'Extraordinary'.repeat(4)}` },
  }));
  const metrics = [], requestEvidence = [];
  if (evidenceDir) fs.mkdirSync(path.join(evidenceDir, 'screenshots'), { recursive: true });
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: 'block',
      isMobile: viewport.width <= 390, hasTouch: viewport.width <= 390 });
    let size = 17, failure = false, inconsistent = false, holdRecovery = false, releaseLate, facetMode = 'normal';
    let lateGate = new Promise(resolve => { releaseLate = resolve; });
    const requests = [], errors = [];
    await context.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(request.method(), 'GET', 'discovery recovery fixture must never mutate data');
      if (url.pathname === '/api/businesses') {
        const page = Number(url.searchParams.get('page') || 1), query = url.searchParams.get('query') || '';
        const snapshot = { page, query, category: url.searchParams.get('category') || '',
          serviceArea: url.searchParams.get('serviceArea') || '', size, failure, inconsistent, held: holdRecovery, facetMode };
        requests.push(snapshot);
        const total = query === 'no-match' || (facetMode === 'removed' && snapshot.category === 'Coffee') ? 0 : query === 'current' ? 1 : size;
        const selected = query === 'current' ? [fixtures[16]] : fixtures.slice(0, size);
        const items = inconsistent || total === 0 ? [] : selected.slice((page - 1) * 8, page * 8);
        const categories = size === 0 ? [] : facetMode === 'removed' ? ['Services'] : ['Coffee'];
        const serviceAreas = size === 0 ? [] : facetMode === 'removed' ? ['Local'] : ['Online'];
        if (snapshot.held) await lateGate;
        if (snapshot.failure) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Discovery fixture temporarily unavailable' }) });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          offers: items, categories, serviceAreas,
          pagination: { page, limit: 8, total, totalPages: total === 0 ? 0 : Math.ceil(total / 8), hasNext: page * 8 < total },
        }) });
      }
      if (url.pathname === '/api/ready') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ready', chainId: 1, database: 'ok', rateLimitStore: 'ok' }) });
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Unknown recovery fixture route' }) });
    });
    await context.route('https://assets.example.com/ifr-seller-logo.png', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }));
    const page = await context.newPage(); page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    page.on('pageerror', error => errors.push(error.message));
    const root = page.locator('#offers'), search = root.locator('input[type="search"]');
    const category = root.locator('select').nth(0), area = root.locator('select').nth(1);
    const next = root.getByRole('button', { name: 'Next', exact: true });
    const previous = root.getByRole('button', { name: 'Previous', exact: true });
    const recovery = root.getByRole('button', { name: 'Return to first page', exact: true });
    const launch = root.getByText('The first public seller offers are still being prepared.', { exact: true });
    const noMatch = root.getByText('No offers match these filters', { exact: true });
    const ids = () => root.locator('article a[href*="offer="]').evaluateAll(nodes => nodes.map(n => new URL(n.href).searchParams.get('offer')));
    const waitCount = value => root.getByText(`${value} active offer${value === 1 ? '' : 's'}`, { exact: true }).waitFor();
    const waitRequests = async count => {
      const deadline = Date.now() + 5000;
      while (requests.length < count && Date.now() < deadline) await page.waitForTimeout(25);
      assert.equal(requests.length, count, 'only the expected discovery request is made');
    };
    const activate = async locator => viewport.width <= 390 ? locator.tap() : locator.click();
    const returnFirst = async expectedTotal => {
      const before = requests.length;
      await activate(recovery); await waitCount(expectedTotal);
      await page.waitForFunction(() => !document.querySelector('#offers [data-discovery-recovery]'));
      assert.equal(requests.length, before + 1, 'one user recovery action makes exactly one request');
      assert.equal(requests.at(-1).page, 1);
      await page.waitForFunction(() => document.querySelector('#offers [data-discovery-result-status]') === document.activeElement);
      assert.equal(await root.locator('[data-discovery-result-status]').evaluate(n => n === document.activeElement), true, 'recovery returns keyboard focus to its result status');
    };
    const capture = async state => {
      const layout = await root.evaluate(section => {
        const rgb = value => value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0];
        const over = (fg, bg) => fg.slice(0, 3).map((n, i) => n * (fg[3] ?? 1) + bg[i] * (1 - (fg[3] ?? 1)));
        const background = node => {
          const ancestors = []; for (let p = node; p; p = p.parentElement) ancestors.unshift(p);
          return ancestors.reduce((bg, p) => over(rgb(getComputedStyle(p).backgroundColor), bg), [255, 255, 255]);
        };
        const luminance = values => values.map(n => n / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
        const contrast = (fg, bg) => { const a = luminance(over(fg, bg)), b = luminance(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
        const controls = [...section.querySelectorAll('input,select,button')].filter(n => n.getBoundingClientRect().width).map(n => {
          const r = n.getBoundingClientRect(), s = getComputedStyle(n), bg = background(n);
          return { name: n.textContent.trim() || n.getAttribute('type'), x: r.x, y: r.y, width: r.width, height: r.height,
            padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(parseFloat),
            disabled: n.disabled, contrast: contrast(rgb(s.color), bg), focusVisible: n.matches(':focus-visible'),
            outlineWidth: parseFloat(s.outlineWidth), focusContrast: contrast(rgb(s.outlineColor), bg) };
        });
        const overlaps = [];
        for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
          const a = controls[i], b = controls[j];
          if (Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1) overlaps.push([a.name, b.name]);
        }
        const clipped = [];
        for (const n of section.querySelectorAll('h2,h3,p,a,span')) {
          const r = n.getBoundingClientRect(); if (!r.width || !r.height || n.closest('.sr-only,[aria-hidden="true"]')) continue;
          const range = document.createRange(); range.selectNodeContents(n);
          if ([...range.getClientRects()].some(line => line.left < r.left - 1 || line.right > r.right + 1 || line.top < r.top - 1 || line.bottom > r.bottom + 1)) clipped.push(n.textContent.slice(0, 60));
        }
        return { viewport: { width: innerWidth, height: innerHeight }, scrollWidth: document.documentElement.scrollWidth,
          controls, overlaps, clipped, outsideCards: [...section.querySelectorAll('article')].filter(n => n.scrollWidth > n.clientWidth + 1 || n.getBoundingClientRect().right > innerWidth + 1).length };
      });
      metrics.push({ state, ...layout, discoveryRequests: requests.length });
      assert.ok(layout.scrollWidth <= viewport.width, `${state}: document must fit`);
      assert.deepEqual(layout.overlaps, [], `${state}: controls must not overlap`);
      assert.deepEqual(layout.clipped, [], `${state}: text must fit`);
      assert.equal(layout.outsideCards, 0);
      for (const control of layout.controls) {
        assert.ok(control.width >= 44 && control.height >= 48, `${state}: touch target ${control.name}`);
        assert.ok(control.padding.every(n => n >= 12), `${state}: control padding`);
        if (!control.disabled) assert.ok(control.contrast >= 4.5, `${state}: control contrast`);
      }
      if (state === 'unavailable-9') {
        const button = layout.controls.find(n => n.name === 'Return to first page');
        assert.ok(button.focusVisible && button.outlineWidth >= 2 && button.focusContrast >= 3, 'recovery has a visible contrasting keyboard outline');
      }
      if (evidenceDir) {
        // Keep the sticky site header at document top, outside this section's document-coordinate capture.
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        const clip = await root.evaluate(section => { const r = section.getBoundingClientRect();
          return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; }); assert.ok(clip);
        metrics.at(-1).documentClip = clip;
        await page.screenshot({ path: path.join(evidenceDir, 'screenshots', `${viewport.width}x${viewport.height}-${state}.png`), fullPage: true, clip });
      }
    };
    try {
      await page.goto(`${origin}/#offers`, { waitUntil: 'domcontentloaded' }); await waitCount(17);
      assert.deepEqual(await ids(), fixtures.slice(0, 8).map(n => n.id));
      await activate(next); await page.waitForFunction(() => document.querySelector('#offers article a[href*="offer="]')?.getAttribute('href').includes('discovery-recovery-9'));
      size = 9; await activate(next); await waitCount(9);
      // This is deliberately the first new correctness assertion: baseline renders the false network-launch message here.
      assert.equal(await launch.count(), 0, 'a positive catalog total must not be called an empty network');
      assert.equal(await noMatch.count(), 0);
      await recovery.waitFor(); await recovery.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      await capture('unavailable-9');
      await returnFirst(9); assert.deepEqual(await ids(), fixtures.slice(0, 8).map(n => n.id));

      size = 17; await search.fill('member'); await waitCount(17);
      assert.equal(await previous.isDisabled(), true); await capture('page-1');
      await root.getByText('Reference price: EUR 19.99', { exact: true }).first().waitFor();
      await root.getByText('1,000 IFR in active TIME_ONLY commitments', { exact: false }).first().waitFor();
      assert.deepEqual(await root.locator('article a[href*="offer="]').evaluateAll(nodes => nodes.map(n => n.getAttribute('href'))), fixtures.slice(0, 8).map(n => `/?seller=${offer.business.slug}&offer=${n.id}#customer-pass`));
      await activate(next); await page.waitForFunction(() => document.querySelector('#offers article a[href*="offer="]')?.getAttribute('href').includes('discovery-recovery-9')); await capture('page-2');
      await activate(next); await page.waitForFunction(() => document.querySelector('#offers article a[href*="offer="]')?.getAttribute('href').includes('discovery-recovery-17'));
      assert.equal(await next.isDisabled(), true); assert.deepEqual(await ids(), [fixtures[16].id]); await capture('page-3');
      await activate(previous); await page.waitForFunction(() => document.querySelector('#offers article a[href*="offer="]')?.getAttribute('href').includes('discovery-recovery-9'));
      size = 8; await activate(next); await waitCount(8); await recovery.waitFor();
      assert.equal(await noMatch.count(), 0); assert.equal(await launch.count(), 0); await capture('unavailable-8');
      await returnFirst(8); assert.deepEqual(await ids(), fixtures.slice(0, 8).map(n => n.id)); await capture('recovered-8');

      size = 17; await search.fill('  member  '); await category.selectOption('Coffee'); await area.selectOption('Online'); await waitCount(17);
      await activate(next); await page.waitForFunction(() => document.querySelector('#offers article a[href*="offer="]')?.getAttribute('href').includes('discovery-recovery-9'));
      size = 9; await activate(next); await waitCount(9); await recovery.waitFor(); await capture('filtered-unavailable-9');
      await returnFirst(9);
      assert.equal(await search.inputValue(), '  member  '); assert.equal(await category.inputValue(), 'Coffee'); assert.equal(await area.inputValue(), 'Online');
      assert.deepEqual({ query: requests.at(-1).query, category: requests.at(-1).category, serviceArea: requests.at(-1).serviceArea }, { query: 'member', category: 'Coffee', serviceArea: 'Online' });
      await search.fill('no-match'); await waitCount(0); await noMatch.waitFor(); assert.equal(await recovery.count(), 0); await capture('filtered-zero');
      size = 17; await activate(root.getByRole('button', { name: 'Clear filters', exact: true })); await waitCount(17);
      await activate(next); await page.waitForFunction(() => document.querySelector('#offers article a[href*="offer="]')?.getAttribute('href').includes('discovery-recovery-9'));
      size = 0; await activate(next); await waitCount(0); await launch.waitFor();
      assert.equal(await noMatch.count(), 0); await capture('network-empty');
      failure = true; await search.fill('error'); await root.getByText('Discovery fixture temporarily unavailable', { exact: true }).waitFor();
      assert.equal(await launch.count(), 0); assert.equal(await noMatch.count(), 0); assert.equal(await recovery.count(), 0); await capture('load-error');

      failure = false; size = 9; inconsistent = true; await activate(root.getByRole('button', { name: 'Try again', exact: true })); await recovery.waitFor();
      const stableRequests = requests.length; await page.waitForTimeout(600);
      assert.equal(requests.length, stableRequests, 'inconsistent first-page response must not auto-retry');
      inconsistent = false; holdRecovery = true;
      const beforeLate = requests.length;
      const lateResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/businesses' && new URL(response.url()).searchParams.get('query') === 'error');
      await activate(recovery); await waitRequests(beforeLate + 1);
      holdRecovery = false;
      await search.fill('current'); await waitCount(1); assert.deepEqual(await ids(), [fixtures[16].id]);
      assert.equal(await search.evaluate(n => n === document.activeElement), true, 'a newer filter action cancels recovery focus');
      releaseLate(); await (await lateResponse).finished(); await page.waitForTimeout(350);
      assert.deepEqual(await ids(), [fixtures[16].id], 'late recovery response cannot restore old offers');
      assert.equal(await search.evaluate(n => n === document.activeElement), true, 'late recovery cannot steal input focus');
      assert.equal(requests.length, beforeLate + 2, 'one recovery click plus one newer filter make two requests; late response adds none');
      assert.equal(await recovery.count(), 0); assert.equal(await launch.count(), 0); await waitCount(1);

      // A focus-only move does not change the filter or make a new request.
      for (const targetName of ['search', 'outside']) {
        inconsistent = true; await search.fill(`focus-${targetName}`); await recovery.waitFor();
        inconsistent = false; holdRecovery = true;
        lateGate = new Promise(resolve => { releaseLate = resolve; });
        const beforeFocus = requests.length;
        await activate(recovery); await waitRequests(beforeFocus + 1);
        const target = targetName === 'search' ? search : page.locator('header a[href="/#customer-wallet"]');
        await target.focus(); assert.equal(await target.evaluate(n => n === document.activeElement), true);
        holdRecovery = false; releaseLate(); await waitCount(9); await page.waitForTimeout(350);
        assert.equal(await target.evaluate(n => n === document.activeElement), true, 'a focus-only move during recovery must not be replaced by result focus');
        assert.equal(await search.inputValue(), `focus-${targetName}`, 'focus-only movement does not edit the search');
        assert.equal(requests.length, beforeFocus + 1, 'one recovery click and a focus-only move make exactly one request');
        await capture(`focus-${targetName}-preserved`);
      }

      await category.selectOption('Coffee'); await area.selectOption('Online'); await search.fill('facet-selection'); await waitCount(9);
      assert.deepEqual(await category.locator('option').allTextContents(), ['All categories', 'Coffee'], 'a selected value already in the facets is not duplicated');
      assert.deepEqual(await area.locator('option').allTextContents(), ['All areas', 'Online'], 'a selected area already in the facets is not duplicated');
      facetMode = 'removed'; await search.fill('missing-selected-facets'); await waitCount(0); await noMatch.waitFor();
      assert.deepEqual(await category.locator('option').allTextContents(), ['All categories', 'Services', 'Coffee'], 'current facets and the missing selected category stay visible once');
      assert.deepEqual(await area.locator('option').allTextContents(), ['All areas', 'Local', 'Online'], 'current facets and the missing selected area stay visible once');
      assert.equal(await category.inputValue(), 'Coffee'); assert.equal(await area.inputValue(), 'Online');
      assert.equal(await category.locator('option:checked').textContent(), 'Coffee'); assert.equal(await area.locator('option:checked').textContent(), 'Online');
      await capture('missing-selected-facets');

      size = 0; await search.fill('empty-selected-facets'); await waitCount(0); await noMatch.waitFor();
      await page.waitForFunction(() => document.querySelector('#offers select option[value="Services"]') === null);
      assert.deepEqual(await category.locator('option').allTextContents(), ['All categories', 'Coffee']);
      assert.deepEqual(await area.locator('option').allTextContents(), ['All areas', 'Online']);
      assert.equal(await category.inputValue(), 'Coffee'); assert.equal(await area.inputValue(), 'Online');
      assert.equal(await category.locator('option:checked').textContent(), 'Coffee'); assert.equal(await area.locator('option:checked').textContent(), 'Online');
      assert.deepEqual({ query: requests.at(-1).query, category: requests.at(-1).category, serviceArea: requests.at(-1).serviceArea },
        { query: 'empty-selected-facets', category: 'Coffee', serviceArea: 'Online' }, 'empty backend facets must not disguise retained request filters');
      await capture('empty-selected-facets');
      const beforeClear = requests.length;
      await activate(root.getByRole('button', { name: 'Clear filters', exact: true })); await launch.waitFor();
      assert.equal(await search.inputValue(), ''); assert.equal(await category.inputValue(), ''); assert.equal(await area.inputValue(), '');
      assert.deepEqual(await category.locator('option').allTextContents(), ['All categories']);
      assert.deepEqual(await area.locator('option').allTextContents(), ['All areas']);
      assert.deepEqual({ query: requests.at(-1).query, category: requests.at(-1).category, serviceArea: requests.at(-1).serviceArea },
        { query: '', category: '', serviceArea: '' });
      assert.equal(requests.length, beforeClear + 1, 'clear makes exactly one request and removes retained selections');
      assert.deepEqual(errors, []);
    } finally {
      releaseLate(); await context.close(); requestEvidence.push({ viewport, requests });
      if (evidenceDir) fs.writeFileSync(path.join(evidenceDir, 'discovery-recovery-metrics.json'), JSON.stringify({ fixtureOnly: true, viewports, metrics, requestEvidence }, null, 2));
    }
  }
  console.log('[offer-discovery-recovery] PASS - paging, user recovery, retained filters/facets, focus-only moves, bounded requests, stale response and five responsive viewports');
}

async function runCatalogProductionOnly() {
  const evidenceDir = process.env.BENEFITS_CATALOG_EVIDENCE_DIR;
  assert.ok(path.isAbsolute(evidenceDir || '') && !fs.existsSync(evidenceDir), 'fresh catalog evidence directory required before launch');
  assert.ok(fs.existsSync(path.join(frontend, '.next/BUILD_ID')), 'production artifact required before launch');
  let browser; let receipt; let failure = false; let closed = false;
  const started = performance.now();
  let workExpired = false;
  const workDeadline = setTimeout(() => {
    workExpired = true;
    if (browser) {
      try { catalogWorkDeadlineObservers.get(browser)?.(); } catch { /* Observation cannot prevent the original forced close. */ }
      void browser.close().catch(() => {});
    }
  }, 300000);
  const deadline = setTimeout(() => {
    process.stdout.write('BENEFITS_CATALOG_PRODUCTION {"status":"FAIL","failureCode":"OUTER_DEADLINE","ownedBrowserOutcome":"UNKNOWN"}\n');
    process.exit(1);
  }, 360000);
  try {
    browser = await chromium.launch({ headless: true, timeout: 30000 });
    receipt = await verifySellerCatalogFilters(browser, { scope: 'loopback-production', evidenceDir });
  } catch (error) {
    failure = { kind: ['AssertionError', 'TimeoutError', 'Error'].includes(error?.name) ? error.name : 'OTHER',
      messageSha256: crypto.createHash('sha256').update(typeof error?.message === 'string' ? error.message : '').digest('hex') };
  }
  finally {
    clearTimeout(workDeadline);
    if (browser) {
      catalogWorkDeadlineObservers.delete(browser); // Only this runner's privately created browser.
      let timer;
      closed = await Promise.race([browser.close().then(() => true, () => false),
        new Promise(resolve => { timer = setTimeout(() => resolve(false), 60000); })]);
      clearTimeout(timer);
    }
    clearTimeout(deadline);
  }
  const result = { schema: 'catalog-production-runner/v1', status: !failure && !workExpired && receipt && closed ? 'PASS' : 'FAIL',
    scope: 'loopback-production', elapsedMs: performance.now() - started, fixtureReceipt: receipt ? 'catalog-production-result.json' : null,
    failure: failure || null, workExpired,
    ownedBrowserClose: closed ? 'PASS' : 'UNPROVEN', processOutcomeUnknown: Boolean(browser && !closed), images: receipt?.images.length || 0,
    realWalletProviderAcceptance: false, visualReviewByRoot: 'PENDING' };
  if (fs.existsSync(evidenceDir)) fs.writeFileSync(path.join(evidenceDir, 'catalog-production-runner.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write('BENEFITS_CATALOG_PRODUCTION ' + JSON.stringify(result) + '\n');
  if (result.status !== 'PASS') process.exitCode = 1;
  if (browser && !closed) process.exit(1); // Bounded failure; do not claim an unproved child cleanup.
}

async function run() {
  const serverOutput = [];
  const server = spawn(
    process.execPath,
    [path.join(frontend, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      cwd: frontend,
      env: { ...process.env, BENEFITS_API_INTERNAL_URL: 'http://127.0.0.1:9' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  server.stdout.on('data', (chunk) => serverOutput.push(chunk.toString()));
  server.stderr.on('data', (chunk) => serverOutput.push(chunk.toString()));

  let browser;
  try {
    await waitForServer(server);
    browser = await chromium.launch({ headless: true });
    await verifySellerCatalogFilters(browser);
    await verifyOfferDiscoveryRecovery(browser);
    const context = await browser.newContext({ serviceWorkers: 'block' });
    let networkEmpty = false;

    await context.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/businesses') {
        const filtered = Boolean(url.searchParams.get('query'));
        if (!filtered && !networkEmpty) await new Promise((resolve) => setTimeout(resolve, 600));
        const offers = networkEmpty || filtered ? [] : [offer];
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(discoveryResponse(offers)),
        });
      }
      if (
        url.pathname === `/api/businesses/${offer.business.slug}` ||
        url.pathname === `/api/businesses/${offer.business.id}`
      ) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...offer.business, discountPercent: 10, requiredLockIFR: 1000, tierLabel: null }),
        });
      }
      if (
        url.pathname === `/api/businesses/${offer.business.slug}/products` ||
        url.pathname === `/api/businesses/${offer.business.id}/products`
      ) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            business: offer.business,
            products: [{
              ...offer.product,
              businessId: offer.business.id,
              category: offer.category,
              active: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              benefitRules: [{
                id: offer.id,
                label: offer.label,
                discountPercent: offer.discountPercent,
                requiredLockIFR: offer.requiredLockIFR,
                minIFRHeld: offer.minIFRHeld,
                lockSource: offer.lockSource,
                dailyRedemptionLimit: offer.dailyRedemptionLimit,
                monthlyRedemptionLimit: offer.monthlyRedemptionLimit,
                ttlSeconds: 90,
              }],
            }],
          }),
        });
      }
      if (
        url.pathname === `/api/businesses/${offer.business.slug}/rules` ||
        url.pathname === `/api/businesses/${offer.business.id}/rules`
      ) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            rules: [{
              id: offer.id,
              businessId: offer.business.id,
              productId: offer.product.id,
              label: offer.label,
              category: offer.category,
              productName: offer.productName,
              discountPercent: offer.discountPercent,
              requiredLockIFR: offer.requiredLockIFR,
              minIFRHeld: offer.minIFRHeld,
              lockSource: offer.lockSource,
              dailyRedemptionLimit: offer.dailyRedemptionLimit,
              monthlyRedemptionLimit: offer.monthlyRedemptionLimit,
              ttlSeconds: 90,
              active: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }],
          }),
        });
      }
      if (url.pathname === '/api/passes/test-pass/control') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'BOUND',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            checkout: {
              status: 'PENDING',
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              businessId: offer.business.id,
              benefitRuleId: 'different-offer',
              sellerName: offer.business.name,
              benefit: {
                label: 'Different member offer',
                category: 'Coffee',
                productName: 'Different coffee',
                basePriceMinor: '1299',
                currency: 'USD',
                discountPercent: 5,
                requiredLockIFR: 500,
                minIFRHeld: 0,
                lockSource: 'ifrlock',
              },
              reason: null,
            },
          }),
        });
      }
      if (url.pathname === '/api/ready') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'ready',
            chainId: 1,
            database: 'ok',
            rateLimitStore: 'ok',
          }),
        });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) });
    });
    await context.route('https://assets.example.com/ifr-seller-logo.png', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      ),
    }));

    const page = await context.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });

    const walletControl = page.locator('[data-wallet-connect-control]').first();
    await walletControl.getByRole('button', { name: 'Connect wallet', exact: true }).waitFor();
    await waitForAttribute(walletControl, 'data-wallet-connectors-ready', 'true', 30_000);
    assert.equal(await walletControl.getAttribute('data-wallet-connector-ids'), 'coinbaseWalletSDK');
    assert.equal(
      await walletControl.getByRole('button', { name: 'Browser wallet', exact: true }).count(),
      0,
      'a browser without an injected provider must not offer the unusable injected connector',
    );
    assert.equal(
      await walletControl.getByText('Connect with', { exact: true }).count(),
      1,
      'a browser without an injected provider must expose its explicit universal wallet choice',
    );
    await walletControl.getByRole('button', { name: 'Coinbase Wallet', exact: true }).waitFor();
    await walletControl.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await walletControl.getByText(
      'No browser wallet or WalletConnect session is available. Choose Coinbase Wallet below, or open this page inside your wallet app.',
      { exact: true },
    ).waitFor();
    assert.equal(
      await walletControl.getByRole('button', { name: 'Connect wallet', exact: true }).isEnabled(),
      true,
      'no-provider recovery must leave the primary connect action usable',
    );

    const offersSection = page.locator('#offers');
    await offersSection.getByText(offer.productName, { exact: true }).waitFor();
    await offersSection.getByText('Reference price: EUR 19.99', { exact: true }).waitFor();
    await offersSection.getByText('1,000 IFR in active TIME_ONLY commitments', { exact: true }).waitFor();
    await offersSection.getByText('500 IFR held', { exact: true }).waitFor();
    const discoveryLogo = offersSection.getByRole('img', { name: `${offer.business.name} logo`, exact: true });
    await discoveryLogo.waitFor();
    assert.equal(await discoveryLogo.getAttribute('referrerpolicy'), 'no-referrer');
    await discoveryLogo.evaluate((image) => image.dispatchEvent(new Event('error')));
    await offersSection.getByRole('img', { name: `${offer.business.name} logo placeholder`, exact: true }).waitFor();
    await offersSection.getByRole('link', { name: 'Seller catalog', exact: true }).click();
    await waitForLocation(page, `/s/${offer.business.slug}`);
    await page.getByText(offer.productName, { exact: true }).waitFor();
    await page.getByText('Reference price: EUR 19.99', { exact: true }).waitFor();
    await page.getByText('Verify at least 1,000 IFR in active TIME_ONLY commitments and 500 IFR held at checkout.', { exact: true }).first().waitFor();
    assert.equal(await page.getByRole('img', { name: `${offer.business.name} logo`, exact: true }).count(), 1);
    assert.equal(
      await page.getByText('No public offers yet', { exact: true }).count(),
      0,
      'a standalone active rule must not produce an empty seller catalog'
    );
    await page.getByRole('link', { name: 'Use this offer', exact: true }).click();
    await waitForLocation(page, '/', '#customer-pass');
    assert.equal(new URL(page.url()).searchParams.get('seller'), offer.business.slug);
    assert.equal(new URL(page.url()).searchParams.get('offer'), offer.id);
    const selectedOffer = page.locator('#customer-pass');
    await selectedOffer.getByText('Selected public offer', { exact: true }).waitFor();
    await selectedOffer.getByText(`${offer.productName} · ${offer.business.name}`, { exact: true }).waitFor();
    await selectedOffer.getByText('10% benefit · 1,000 IFR lock in active TIME_ONLY commitments · 500 IFR held', { exact: true }).waitFor();
    await selectedOffer.getByText('Offer verified. The seller still binds it and you approve the exact checkout snapshot.', { exact: true }).waitFor();
    await page.evaluate(() => window.history.pushState({}, '', '/?seller=invalid!&offer=bad#customer-pass'));
    await selectedOffer.getByText('This offer link is invalid. Browse the current public offers below.', { exact: true }).waitFor();
    assert.equal(await selectedOffer.getByText('Selected public offer', { exact: true }).count(), 0, 'invalid same-route context must clear the prior verified offer');

    await page.evaluate(({ businessId, offerId }) => {
      window.sessionStorage.setItem('ifr.shop.activeCustomerPass', JSON.stringify({
        passId: 'test-pass',
        controlToken: 'x'.repeat(48),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        qrUrl: '/p/test-pass',
        walletAddress: '0x0000000000000000000000000000000000000001',
      }));
      window.history.pushState({}, '', `/?seller=${businessId}&offer=${offerId}#customer-pass`);
    }, { businessId: offer.business.id, offerId: offer.id });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await selectedOffer.getByText('The seller bound a different offer than the public offer you selected.', { exact: false }).waitFor();
    await selectedOffer.getByText('USD 12.99', { exact: true }).waitFor();
    await selectedOffer.getByRole('button', { name: 'Clear', exact: true }).click();
    assert.equal(new URL(page.url()).searchParams.has('seller'), false);
    assert.equal(new URL(page.url()).searchParams.has('offer'), false);
    await page.evaluate(() => window.sessionStorage.removeItem('ifr.shop.activeCustomerPass'));
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await waitForLocation(page, '/');
    await offersSection.getByText(offer.productName, { exact: true }).waitFor();
    await offersSection.getByRole('searchbox', { name: 'Search offers', exact: true }).fill('missing');
    await offersSection.getByText('No offers match these filters', { exact: true }).waitFor();

    await offersSection.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await offersSection.getByText('Loading...', { exact: true }).waitFor();
    assert.equal(
      await offersSection.getByText('The first public seller offers are still being prepared.', { exact: true }).count(),
      0,
      'filter reset must not announce an empty network while the unfiltered request is pending'
    );
    await offersSection.getByText(offer.productName, { exact: true }).waitFor();

    networkEmpty = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await offersSection.getByText('The first public seller offers are still being prepared.', { exact: true }).waitFor();
    await offersSection.getByRole('button', { name: 'Become a seller', exact: true }).click();
    await waitForLocation(page, '/', '#seller-workspace');
    const sellerModeButton = page.getByRole('button', { name: /Seller Offer discounts/ });
    await sellerModeButton.waitFor();
    await waitForRoleSelection(sellerModeButton);
    await page.getByRole('heading', { name: 'Benefit rule manager', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Finish the seller profile first', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await page.getByRole('alert').getByText(
      'No browser wallet or WalletConnect session is available. Choose Coinbase Wallet below, or open this page inside your wallet app.',
      { exact: true },
    ).waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Connect wallet', exact: true }).isEnabled(),
      true,
      'seller no-provider recovery must not remain stuck in Connecting state',
    );
    await page.getByText('Connect with', { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel('Accepted lock source', { exact: true }).count(),
      0,
      'rule controls must stay hidden until a seller profile is loaded'
    );
    const integrationGenerator = page.locator('#integrate');
    const generatorCopy = integrationGenerator.getByRole('button', { name: 'Copy', exact: true });
    await integrationGenerator.getByRole('heading', { name: 'Create a seller entry point', exact: true }).waitFor();
    assert.equal(await generatorCopy.isDisabled(), true, 'generator must not copy placeholder IDs');
    const businessIdInput = integrationGenerator.getByLabel('Business ID', { exact: true });
    const ruleIdInput = integrationGenerator.getByLabel('Benefit rule ID', { exact: true });
    await businessIdInput.fill('invalid business');
    await integrationGenerator.locator('#integration-generator-validation').getByText('Business ID may contain only letters, numbers, hyphens and underscores.', { exact: true }).waitFor();
    assert.equal(await businessIdInput.getAttribute('aria-invalid'), 'true');
    assert.equal(await generatorCopy.isDisabled(), true, 'invalid Business ID must keep generator actions disabled');
    await businessIdInput.fill(offer.business.id);
    await ruleIdInput.fill(offer.id);
    await integrationGenerator.getByRole('button', { name: 'SDK / POS', exact: true }).click();
    await integrationGenerator.getByText('IFRBenefitsClient', { exact: false }).waitFor();
    await integrationGenerator.getByText(`businessId: "${offer.business.id}"`, { exact: false }).waitFor();
    await integrationGenerator.getByText(`benefitRuleId: "${offer.id}"`, { exact: false }).waitFor();
    assert.equal(await generatorCopy.isDisabled(), false, 'valid exact IDs must enable generator output');
    assert.equal((await integrationGenerator.locator('pre').innerText()).includes('selected-active-rule-id'), false, 'generated POS code must not retain a fake rule ID');
    assert.equal((await integrationGenerator.locator('pre').innerText()).includes('privateKey'), false, 'generated POS code must not embed a private key field');
    await ruleIdInput.fill('bad/rule');
    await integrationGenerator.locator('#integration-generator-validation').getByText('Benefit rule ID may contain only letters, numbers, hyphens and underscores.', { exact: true }).waitFor();
    assert.equal(await generatorCopy.isDisabled(), true, 'invalid rule ID must disable rule-bound generator output');
    await ruleIdInput.fill(offer.id);
    assert.equal(await generatorCopy.isDisabled(), false, 'correcting the rule ID must recover generator output');

    await page.goBack({ waitUntil: 'domcontentloaded' });
    await waitForLocation(page, '/');
    const customerModeButton = page.getByRole('button', { name: /Customer Unlock benefits/ });
    await customerModeButton.waitFor();
    await waitForRoleSelection(sellerModeButton);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForRoleSelection(sellerModeButton);

    await customerModeButton.click();
    await waitForRoleSelection(customerModeButton);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForRoleSelection(customerModeButton);

    await page.goto(`${origin}/?mode=seller`, { waitUntil: 'domcontentloaded' });
    await waitForRoleSelection(sellerModeButton);
    await customerModeButton.click();
    assert.equal(new URL(page.url()).searchParams.has('mode'), false, 'manual role choice must clear the mode override');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForRoleSelection(customerModeButton);

    await page.goto(`${origin}/#seller-workspace`, { waitUntil: 'domcontentloaded' });
    await waitForRoleSelection(sellerModeButton);
    await customerModeButton.click();
    assert.equal(new URL(page.url()).hash, '', 'manual role choice must clear a role-specific hash override');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForRoleSelection(customerModeButton);

    await context.clearCookies();
    await page.evaluate(() => window.localStorage.clear());
    const gatedSellerHashes = [
      '#seller-catalog',
      '#seller-rule-editor',
      '#seller-team',
      '#seller-session-history',
      '#seller-rewards',
    ];
    for (const gatedHash of gatedSellerHashes) {
      await page.goto(`${origin}/${gatedHash}`, { waitUntil: 'domcontentloaded' });
      await waitForRoleSelection(sellerModeButton);
      const gatedTarget = page.locator(`[id="${gatedHash.slice(1)}"]`);
      await gatedTarget.waitFor({ state: 'attached' });
      assert.equal(
        await gatedTarget.count(),
        1,
        `${gatedHash} must retain a profile-gate anchor before seller setup`
      );
      const sellerProfileGate = page.locator('[data-seller-profile-gate]');
      await sellerProfileGate.getByRole('heading', { name: 'Finish the seller profile first', exact: true }).waitFor();
      await page.waitForFunction(() => {
        const gate = document.querySelector('[data-seller-profile-gate]');
        if (!gate) return false;
        const bounds = gate.getBoundingClientRect();
        return bounds.top < window.innerHeight && bounds.bottom > 0;
      });
    }
    const sellerTasks = page.getByRole('navigation', { name: 'Seller tasks', exact: true });
    await sellerTasks.getByRole('link', { name: /Profile/ }).waitFor();
    assert.equal(await sellerTasks.getByRole('link', { name: /Products/ }).count(), 0, 'product task must stay hidden until a profile exists');
    assert.equal(await sellerTasks.getByRole('link', { name: 'Team', exact: true }).count(), 0, 'team task must stay hidden until a profile exists');

    for (const viewport of [{ width: 375, height: 812 }, { width: 820, height: 1180 }]) {
      await page.setViewportSize(viewport);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await sellerTasks.getByRole('link', { name: /Profile/ }).waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
        false,
        `seller layout must not overflow at ${viewport.width}px`
      );
    }

    const sellerContext = await browser.newContext({ serviceWorkers: 'block' });
    await installSellerWallet(sellerContext);
    const sellerLifecycle = {
      active: true,
      deactivateCalls: 0,
      reactivateCalls: 0,
    };
    const sellerSummary = {
      id: offer.business.id,
      slug: offer.business.slug,
      name: offer.business.name,
      description: offer.business.description,
      website: offer.business.website,
      logoUrl: offer.business.logoUrl,
      serviceArea: offer.business.serviceArea,
      categories: offer.business.categories,
      ownerAddress: sellerWallet,
      verifyUrl: `/b/${offer.business.slug}`,
      qrUrl: `/b/${offer.business.slug}`,
      discountPercent: offer.discountPercent,
      requiredLockIFR: offer.requiredLockIFR,
      tierLabel: null,
      createdAt: new Date().toISOString(),
      rulesCount: 1,
      productsCount: 1,
    };
    await sellerContext.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/ready') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ready', chainId: 1, database: 'ok', rateLimitStore: 'ok' }),
        });
      }
      if (url.pathname === '/api/businesses') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(discoveryResponse([])),
        });
      }
      if (url.pathname === '/api/seller/auth-message') {
        const action = url.searchParams.get('action');
        const mutating = action === 'business:delete' || action === 'business:reactivate';
        assert.ok(action === 'business:list' || mutating, `unexpected seller lifecycle action: ${action}`);
        assert.equal(url.searchParams.get('businessId'), mutating ? offer.business.id : 'seller');
        assert.equal(url.searchParams.has('scope'), mutating, 'only lifecycle mutations send an exact scope');
        assert.equal(
          url.searchParams.has('walletAddress'),
          false,
          'every seller action issues a wallet-free single-use challenge'
        );
        if (mutating) assert.equal(url.searchParams.get('scope'), offer.business.id);
        const timestamp = String(Date.now());
        const message = `${sellerAuthMessage}:${action}`;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            action,
            businessId: url.searchParams.get('businessId'),
            scope: url.searchParams.get('scope'),
            timestamp,
            issuedAt: new Date(Number(timestamp)).toISOString(),
            expiresAt: new Date(Number(timestamp) + 60_000).toISOString(),
            nonce: `nonce-${action}`,
            message,
          }),
        });
      }
      if (url.pathname === '/api/seller/businesses' && request.method() === 'GET') {
        assert.equal(request.headers()['x-ifr-wallet'], sellerWallet.toLowerCase());
        assert.equal(request.headers()['x-ifr-signature'], sellerSignature);
        assert.equal(request.headers()['x-ifr-nonce'], 'nonce-business:list', 'read-only profile listing must send its one-time nonce');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            businesses: sellerLifecycle.active ? [sellerSummary] : [],
            inactiveBusinesses: sellerLifecycle.active ? [] : [sellerSummary],
          }),
        });
      }
      if (
        url.pathname === `/api/seller/businesses/${offer.business.id}` &&
        request.method() === 'DELETE'
      ) {
        assert.equal(request.headers()['x-ifr-wallet'], sellerWallet.toLowerCase());
        assert.equal(request.headers()['x-ifr-signature'], sellerSignature);
        assert.equal(request.headers()['x-ifr-nonce'], 'nonce-business:delete');
        sellerLifecycle.deactivateCalls += 1;
        sellerLifecycle.active = false;
        return route.fulfill({ status: 204, body: '' });
      }
      if (
        url.pathname === `/api/seller/businesses/${offer.business.id}/reactivate` &&
        request.method() === 'POST'
      ) {
        assert.equal(request.headers()['x-ifr-wallet'], sellerWallet.toLowerCase());
        assert.equal(request.headers()['x-ifr-signature'], sellerSignature);
        assert.equal(request.headers()['x-ifr-nonce'], 'nonce-business:reactivate');
        sellerLifecycle.reactivateCalls += 1;
        sellerLifecycle.active = true;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(sellerSummary),
        });
      }
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: `Unexpected seller transition request: ${request.method()} ${url.pathname}` }),
      });
    });
    await sellerContext.route('https://assets.example.com/ifr-seller-logo.png', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      ),
    }));
    const sellerPage = await sellerContext.newPage();
    sellerPage.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    const sellerPageErrors = [];
    sellerPage.on('pageerror', (error) => sellerPageErrors.push(error.message));
    await sellerPage.goto(`${origin}/#seller-workspace`, { waitUntil: 'domcontentloaded' });
    await sellerPage.getByRole('heading', { name: 'Benefit rule manager', exact: true }).waitFor();
    await sellerPage.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await sellerPage.getByRole('button', { name: 'Disconnect', exact: true }).waitFor();
    await sellerPage.getByText('up to five active and 25 total seller profiles', { exact: false }).waitFor();
    await sellerPage.getByRole('button', { name: 'Load my seller profiles', exact: true }).click();
    await sellerPage.getByText('Loaded 1 seller profile.', { exact: true }).waitFor();
    assert.deepEqual(
      await sellerPage.evaluate(() => window.__ifrSellerSignedMessages),
      [`0x${Buffer.from(`${sellerAuthMessage}:business:list`, 'utf8').toString('hex')}`],
      'the wallet must sign the exact challenge returned for profile listing'
    );
    assert.equal(
      await sellerPage.getByRole('heading', { name: 'Finish the seller profile first', exact: true }).count(),
      0,
      'profile gate must disappear after the owner loads a seller profile'
    );
    const loadedSellerTasks = sellerPage.getByRole('navigation', { name: 'Seller tasks', exact: true });
    await loadedSellerTasks.getByRole('link', { name: /Products/ }).waitFor();
    await loadedSellerTasks.getByRole('link', { name: 'Team', exact: true }).waitFor();
    for (const gatedHash of gatedSellerHashes) {
      assert.equal(
        await sellerPage.locator(gatedHash).count(),
        1,
        `${gatedHash} must expose its advanced tool after profile load`
      );
    }
    await sellerPage.getByLabel('Accepted lock source', { exact: true }).waitFor();

    await sellerPage.getByRole('button', { name: 'Deactivate', exact: true }).click();
    const deactivationDialog = sellerPage.getByRole('dialog', { name: `Take ${offer.business.name} offline?` });
    await deactivationDialog.waitFor();
    await deactivationDialog.getByText('public catalog and scanner will stop working immediately', { exact: false }).waitFor();
    await deactivationDialog.getByText('every checkout staff wallet will be paused', { exact: false }).waitFor();
    await deactivationDialog.getByRole('button', { name: 'Keep profile active', exact: true }).waitFor();
    assert.equal(
      await sellerPage.evaluate(() => document.activeElement?.textContent?.trim()),
      'Keep profile active',
      'the safe action must receive initial dialog focus'
    );
    await sellerPage.keyboard.press('Shift+Tab');
    assert.equal(
      await sellerPage.evaluate(() => document.activeElement?.textContent?.trim()),
      'Deactivate profile',
      'backward tabbing must remain inside the modal'
    );
    await sellerPage.keyboard.press('Tab');
    assert.equal(sellerLifecycle.deactivateCalls, 0, 'opening the warning must not deactivate the profile');
    await deactivationDialog.getByRole('button', { name: 'Keep profile active', exact: true }).click();
    await deactivationDialog.waitFor({ state: 'hidden' });
    assert.equal(sellerLifecycle.deactivateCalls, 0, 'cancelling the warning must preserve the active profile');
    await sellerPage.waitForFunction(
      () => document.activeElement?.textContent?.trim() === 'Deactivate'
    );
    assert.equal(
      await sellerPage.evaluate(() => document.activeElement?.textContent?.trim()),
      'Deactivate',
      'cancelling the modal must return focus to its trigger'
    );

    await sellerPage.getByRole('button', { name: 'Deactivate', exact: true }).click();
    await deactivationDialog.getByRole('button', { name: 'Deactivate profile', exact: true }).click();
    await sellerPage.getByText('Seller profile deactivated. Catalog, scanner, products, rules and checkout staff are paused; the permanent seller URL remains reserved.', { exact: true }).waitFor();
    assert.equal(sellerLifecycle.deactivateCalls, 1, 'confirmed deactivation must reach the API exactly once');
    await sellerPage.getByText('Deactivated profiles', { exact: true }).waitFor();
    await sellerPage.getByText(`Reserved URL: shop.ifrunit.tech/s/${offer.business.slug}`, { exact: true }).waitFor();
    await sellerPage.getByRole('heading', { name: 'Finish the seller profile first', exact: true }).waitFor();
    assert.equal(
      await sellerPage.evaluate(() => window.localStorage.getItem('ifr.shop.lastSellerBusinessId')),
      null,
      'deactivation must not leave an inactive profile selected for the next reload'
    );

    await sellerPage.getByRole('button', { name: 'Reactivate', exact: true }).click();
    await sellerPage.getByText('Seller profile reactivated. Its permanent URL is restored. Products and rules remain paused, and each checkout staff wallet must be authorized again.', { exact: true }).waitFor();
    assert.equal(sellerLifecycle.reactivateCalls, 1, 'reactivation must reach the API exactly once');
    await sellerPage.getByRole('button', { name: 'Deactivate', exact: true }).waitFor();
    assert.equal(await sellerPage.getByText('Deactivated profiles', { exact: true }).count(), 0);
    assert.equal(
      await sellerPage.evaluate(() => window.localStorage.getItem('ifr.shop.lastSellerBusinessId')),
      offer.business.id,
      'reactivation must restore the active profile selection'
    );
    assert.deepEqual(
      await sellerPage.evaluate(() => window.__ifrSellerSignedMessages),
      [
        `0x${Buffer.from(`${sellerAuthMessage}:business:list`, 'utf8').toString('hex')}`,
        `0x${Buffer.from(`${sellerAuthMessage}:business:delete`, 'utf8').toString('hex')}`,
        `0x${Buffer.from(`${sellerAuthMessage}:business:reactivate`, 'utf8').toString('hex')}`,
      ],
      'seller lifecycle mutations must sign their exact one-time challenges'
    );
    assert.deepEqual(sellerPageErrors, []);
    await sellerContext.close();

    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-pwa-install-listeners-ready="true"]').waitFor();
    await page.evaluate(() => {
      window.__benefitsInstallPrompted = false;
      const event = new Event('beforeinstallprompt');
      event.prompt = async () => { window.__benefitsInstallPrompted = true; };
      event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
      window.dispatchEvent(event);
    });
    await page.getByRole('button', { name: 'Install app', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__benefitsInstallPrompted), true, 'desktop install button must invoke the captured PWA prompt');
    await page.getByText('Install accepted.', { exact: true }).waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await page.getByRole('button', { name: 'App installed', exact: true }).waitFor();

    const ipadContext = await browser.newContext({ ...devices['iPad Pro 11'], serviceWorkers: 'block' });
    await ipadContext.route('**/api/**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(route.request().url().includes('/api/ready')
        ? { status: 'ready', chainId: 1, database: 'ok', rateLimitStore: 'ok' }
        : discoveryResponse([])),
    }));
    const ipadPage = await ipadContext.newPage();
    ipadPage.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    await ipadPage.goto(origin, { waitUntil: 'domcontentloaded' });
    await verifyMobileNoProviderFallback(ipadPage, 'iPad/iPhone');
    await ipadPage.locator('[data-pwa-install-listeners-ready="true"]').waitFor();
    assert.equal(await ipadPage.locator('[data-ios-install-steps="visible"]').count(), 0, 'iOS details should stay compact until requested');
    const iosInstallButton = ipadPage.getByRole('button', { name: 'Show iPad / iPhone install steps', exact: true });
    assert.equal(await iosInstallButton.getAttribute('aria-expanded'), 'false');
    await iosInstallButton.click();
    await ipadPage.locator('[data-ios-install-steps="visible"]').waitFor();
    await ipadPage.getByText('Tap the Share icon in the browser toolbar.', { exact: true }).waitFor();
    await ipadPage.getByText(/iOS requires this browser action and does not allow websites to start installation directly/).waitFor();
    const iosHideButton = ipadPage.getByRole('button', { name: 'Hide iPad / iPhone steps', exact: true });
    assert.equal(await iosHideButton.getAttribute('aria-expanded'), 'true');
    assert.equal(await iosHideButton.getAttribute('aria-controls'), 'ios-pwa-install-steps');
    await iosHideButton.click();
    assert.equal(await ipadPage.locator('[data-ios-install-steps="visible"]').count(), 0, 'iOS install help must collapse again');
    assert.equal(
      await ipadPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
      false,
      'iPad install help must not cause horizontal overflow',
    );
    await ipadContext.close();

    const androidNoProviderContext = await browser.newContext({
      ...devices['Galaxy S9+'],
      serviceWorkers: 'block',
    });
    await androidNoProviderContext.route('**/api/**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(route.request().url().includes('/api/ready')
        ? { status: 'ready', chainId: 1, database: 'ok', rateLimitStore: 'ok' }
        : discoveryResponse([])),
    }));
    const androidNoProviderPage = await androidNoProviderContext.newPage();
    androidNoProviderPage.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    await androidNoProviderPage.goto(origin, { waitUntil: 'domcontentloaded' });
    await verifyMobileNoProviderFallback(androidNoProviderPage, 'Android');
    assert.equal(
      await androidNoProviderPage.evaluate(() => (
        document.documentElement.scrollWidth > document.documentElement.clientWidth
      )),
      false,
      'Android wallet fallback must not cause horizontal overflow',
    );
    await androidNoProviderContext.close();

    const legacyAndroidContext = await browser.newContext({
      viewport: { width: 360, height: 640 },
      userAgent: 'Mozilla/5.0 (Linux; Android 9; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
      serviceWorkers: 'block',
    });
    await legacyAndroidContext.route('**/api/**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(route.request().url().includes('/api/ready')
        ? { status: 'ready', chainId: 1, database: 'ok', rateLimitStore: 'ok' }
        : discoveryResponse([])),
    }));
    const legacyAndroidPage = await legacyAndroidContext.newPage();
    legacyAndroidPage.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    await legacyAndroidPage.goto(origin, { waitUntil: 'domcontentloaded' });
    await legacyAndroidPage.locator('[data-pwa-install-listeners-ready="true"]').waitFor();
    await legacyAndroidPage.evaluate(() => {
      window.__benefitsLegacyInstallPrompted = false;
      const event = new Event('beforeinstallprompt');
      event.prompt = async () => { window.__benefitsLegacyInstallPrompted = true; };
      event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
      window.dispatchEvent(event);
    });
    await legacyAndroidPage.getByText('Browser mode required', { exact: true }).waitFor();
    await legacyAndroidPage.getByRole('button', { name: 'Use in browser', exact: true }).click();
    assert.equal(await legacyAndroidPage.evaluate(() => window.__benefitsLegacyInstallPrompted), false, 'Android 9 must not invoke Chrome WebAPK installation');
    await legacyAndroidPage.getByText(/App installation requires Android 10 or newer/).waitFor();
    await legacyAndroidContext.close();

    const phantomContext = await browser.newContext({
      ...devices['Galaxy S9+'],
      serviceWorkers: 'block',
    });
    await installPhantomNamespaceWallet(phantomContext);
    await phantomContext.route('**/api/**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(route.request().url().includes('/api/ready')
        ? { status: 'ready', chainId: 1, database: 'ok', rateLimitStore: 'ok' }
        : discoveryResponse([])),
    }));
    const phantomPage = await phantomContext.newPage();
    phantomPage.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    await phantomPage.goto(origin, { waitUntil: 'domcontentloaded' });
    const phantomWalletControl = phantomPage.locator('[data-wallet-connect-control]').first();
    await waitForAttribute(phantomWalletControl, 'data-wallet-connectors-ready', 'true');
    assert.equal(
      await phantomWalletControl.getAttribute('data-wallet-connector-ids'),
      'phantom,coinbaseWalletSDK',
      'Phantom namespace provider must be offered once alongside the universal Coinbase fallback',
    );
    await phantomWalletControl.getByText('Phantom provider', { exact: true }).waitFor();
    await phantomWalletControl.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await phantomWalletControl.getByText('0x2000...0002', { exact: true }).waitFor();
    await phantomWalletControl.getByText('Phantom', { exact: true }).last().waitFor();
    assert.equal(
      await phantomPage.evaluate(() => window.__ifrPhantomWalletMethods.includes('eth_requestAccounts')),
      true,
      'Phantom namespace provider must receive the account request',
    );
    await phantomContext.close();

    await page.goto(`${origin}/privacy`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Privacy & data, stated plainly.', exact: true }).waitFor();
    await page.evaluate(async () => {
      window.localStorage.setItem('ifr.shop.test-local', 'remove-me');
      window.localStorage.setItem('wallet.provider.test', 'preserve-me');
      window.sessionStorage.setItem('ifr.shop.test-session', 'remove-me');
      window.sessionStorage.setItem('unrelated.session.test', 'preserve-me');
      await window.caches.open('ifr-benefits-test');
      await window.caches.open('unrelated-cache-test');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('ifr.shop.test-local', { exact: false }).waitFor();
    await page.getByText('ifr.shop.test-session', { exact: false }).waitFor();
    await page.getByText('ifr-benefits-test', { exact: false }).waitFor();
    const clearLocalData = page.getByRole('button', { name: 'Clear local IFR data', exact: true });
    await clearLocalData.click();
    const confirmClear = page.getByRole('button', { name: 'Yes, clear local data', exact: true });
    await confirmClear.waitFor();
    assert.equal(await confirmClear.evaluate((element) => document.activeElement === element), true);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await clearLocalData.evaluate((element) => document.activeElement === element), true);
    await page.evaluate(() => window.localStorage.setItem('ifr.shop.added-after-snapshot', 'remove-me-too'));
    await clearLocalData.click();
    await confirmClear.waitFor();
    await confirmClear.click();
    const clearedStatus = page.getByText(/Cleared \d+ ifr\.shop\.\* storage keys? and \d+ ifr-benefits-\* caches? from this browser\./);
    await clearedStatus.waitFor();
    assert.equal(await clearedStatus.evaluate((element) => document.activeElement === element), true);
    const localDataResult = await page.evaluate(async () => ({
      appLocalKeys: Object.keys(window.localStorage).filter((key) => key.startsWith('ifr.shop.')),
      appSessionKeys: Object.keys(window.sessionStorage).filter((key) => key.startsWith('ifr.shop.')),
      appCaches: (await window.caches.keys()).filter((name) => name.startsWith('ifr-benefits-')),
      unrelatedLocal: window.localStorage.getItem('wallet.provider.test'),
      unrelatedSession: window.sessionStorage.getItem('unrelated.session.test'),
      unrelatedCachePresent: (await window.caches.keys()).includes('unrelated-cache-test'),
    }));
    assert.deepEqual(localDataResult.appLocalKeys, [], 'privacy control must remove all and only ifr.shop.* localStorage keys');
    assert.deepEqual(localDataResult.appSessionKeys, [], 'privacy control must remove all and only ifr.shop.* sessionStorage keys');
    assert.deepEqual(localDataResult.appCaches, [], 'privacy control must remove all and only ifr-benefits-* caches');
    assert.equal(localDataResult.unrelatedLocal, 'preserve-me', 'privacy control must preserve wallet-provider localStorage');
    assert.equal(localDataResult.unrelatedSession, 'preserve-me', 'privacy control must preserve unrelated sessionStorage');
    assert.equal(localDataResult.unrelatedCachePresent, true, 'privacy control must preserve unrelated caches');
    await page.getByRole('link', { name: 'Privacy & data', exact: true }).waitFor();

    assert.deepEqual(pageErrors, []);
    await context.close();
    console.log('[benefits-discovery-ui] PASS - catalog/filter/empty network -> seller handoff -> persistent role overrides');
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      server.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    if (process.exitCode) process.stderr.write(serverOutput.join(''));
  }
}

module.exports = Object.freeze({ verifySellerCatalogFilters });
if (require.main === module) {
  (catalogProductionOnly ? runCatalogProductionOnly() : run()).catch((error) => {
    if (catalogProductionOnly) console.error('[catalog-production] FAIL - qualification control');
    else console.error(error);
    process.exitCode = 1;
  });
}
