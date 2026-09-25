import { readPool, units } from './liquidity-calculator.mjs';
import { parseETH, capacity, depth, decimal, usd } from './liquidity-depth.mjs?v=impact1';

export function mountGauge(root, loadPool = signal => readPool(window.ethers, signal), reference = null) {
  const get = name => root.querySelector(`[data-${name}]`);
  const input = get('buy');
  const needle = get('needle');
  let snapshot = null, generation = 0, pending = false, disposed = false, deadline, expiry, controller;
  function state(name, message) {
    root.dataset.state = name;
    get('live').textContent = name === 'live' ? 'Live' : name === 'loading' ? 'Updating' : 'Unavailable';
    get('status').textContent = message;
    renderReference();
  }
  // The trade-impact reference shares this poller's snapshot, sequencing and expiry; it never reads on its own.
  function renderReference() {
    if (!reference) return;
    const field = name => reference.querySelector(`[data-${name}]`);
    let eth = null, dollars = null;
    try {
      if (snapshot && Math.abs(Date.now() / 1000 - snapshot.timestamp) <= 180) {
        const ceiling = capacity(snapshot.eth, BigInt(reference.querySelector('input:checked').value));
        [eth, dollars] = [`${decimal(ceiling)} ETH`, `≈ ${usd(ceiling, snapshot.ethUsd)}`];
      }
    } catch { eth = dollars = null; }
    const loading = root.dataset.state === 'loading';
    reference.dataset.state = eth ? 'live' : loading ? 'loading' : 'unavailable';
    field('reference-live').textContent = loading ? 'Updating' : eth ? 'Live' : 'Unavailable';
    field('guidance').hidden = !eth;
    field('reference-unavailable').hidden = !!eth;
    field('ceiling-eth').textContent = eth || '--';
    field('ceiling-usd').textContent = dollars || '--';
    field('reference-block').textContent = eth ? `Pool reserves and ETH/USD at block ${snapshot.block} · ${new Date(snapshot.timestamp * 1000).toLocaleString()}.` : '';
    const status = eth ? '' : loading && !snapshot ? 'Reading current pool reserves on Ethereum Mainnet.' : 'Current pool reserves or the ETH/USD price could not be verified, so no trade-size figure is shown. Check the live Uniswap quote instead.';
    // Polite live region: only rewrite on change so the 10-second freshness tick does not repeat announcements.
    if (field('reference-status').textContent !== status) field('reference-status').textContent = status;
  }
  function clearCalculations() {
    for (const name of ['capacity', 'impact', 'target', 'missing', 'mid', 'end']) get(name).textContent = '--';
    root.querySelectorAll('[data-cap]').forEach(el => { el.textContent = '--'; });
    needle.hidden = true;
  }
  function unavailable(message) {
    clearTimeout(expiry);
    snapshot = null;
    get('reserve').textContent = 'Unavailable';
    get('details').textContent = '';
    clearCalculations();
    state('unavailable', message);
  }
  function render() {
    if (!snapshot) return;
    if (Math.abs(Date.now() / 1000 - snapshot.timestamp) > 180) { unavailable('Data expired. Retrying automatically.'); return; }
    renderReference();
    get('capacity').textContent = `${decimal(capacity(snapshot.eth, 100n))} ETH`;
    root.querySelectorAll('[data-cap]').forEach(el => { el.textContent = `${decimal(capacity(snapshot.eth, BigInt(el.dataset.cap)))} ETH`; });
    try {
      const result = depth(parseETH(input.value.trim()), snapshot.eth, snapshot.ifr);
      input.removeAttribute('aria-invalid');
      get('impact').textContent = `${result.impactBps / 100n}.${String(result.impactBps % 100n).padStart(2, '0')}% curve impact`;
      get('target').textContent = `${units(result.required, 18)} WETH required for this buy at 1%`;
      get('missing').textContent = result.missing ? `Additional liquidity: ${units(result.missing, 18)} ETH + ${units(result.missingIFR, 9)} IFR at the current ratio` : 'Current reserves meet this 1% scenario.';
      get('mid').textContent = `${decimal(result.required / 2n)} WETH`;
      get('end').textContent = `${decimal(result.required)} WETH`;
      needle.style.transform = `rotate(${result.coverage * 1.8 - 90}deg)`;
      needle.hidden = false;
    } catch (error) {
      input.setAttribute('aria-invalid', 'true');
      get('impact').textContent = error.message;
      for (const name of ['target', 'missing', 'mid', 'end']) get(name).textContent = '--';
      needle.hidden = true;
    }
  }
  async function refresh() {
    if (disposed || pending || document.hidden) return;
    const request = ++generation;
    pending = true;
    controller = new AbortController();
    state('loading', 'Reading Ethereum Mainnet...');
    deadline = setTimeout(() => {
      if (request !== generation) return;
      generation++;
      controller.abort();
      unavailable('Pool request timed out. Retrying automatically.');
    }, 15000);
    try {
      const result = await loadPool(controller.signal);
      if (request !== generation) return;
      if (Math.abs(Date.now() / 1000 - result.timestamp) > 180 || result.eth <= 0n || result.ifr <= 0n) throw new Error('Unverified snapshot');
      snapshot = result;
      clearTimeout(expiry);
      expiry = setTimeout(() => unavailable('Data expired. Retrying automatically.'), Math.max(0, result.timestamp * 1000 + 180000 - Date.now()));
      get('reserve').textContent = `${units(result.eth, 18)} WETH`;
      get('details').textContent = `${units(result.ifr, 9)} IFR in the same pool`;
      state('live', `Block ${result.block} · ${new Date(result.timestamp * 1000).toLocaleString()}`);
      render();
    } catch {
      if (request === generation) unavailable('Pool data could not be verified. Retrying automatically.');
    } finally {
      clearTimeout(deadline); pending = false;
    }
  }
  const visibility = () => { render(); if (!document.hidden) refresh(); };
  input.addEventListener('input', render);
  reference?.addEventListener('change', renderReference);
  document.addEventListener('visibilitychange', visibility);
  const freshness = setInterval(render, 10000);
  const updates = setInterval(refresh, 60000);
  refresh();
  return () => { disposed = true; generation++; controller?.abort(); clearTimeout(deadline); clearTimeout(expiry); clearInterval(freshness); clearInterval(updates); input.removeEventListener('input', render); reference?.removeEventListener('change', renderReference); document.removeEventListener('visibilitychange', visibility); };
}
if (typeof document !== 'undefined') {
  const root = document.getElementById('liquidity-gauge');
  if (root) mountGauge(root, undefined, document.getElementById('trade-impact'));
}
