import { readPool, units } from './liquidity-calculator.mjs';

const SCALE_WEI = 1000000000000000000n;
export function gaugePosition(wei) {
  if (typeof wei !== 'bigint' || wei < 0n) throw new Error('Invalid reserve');
  // Only the bounded drawing coordinate becomes a Number; reserves stay bigint.
  return Number((wei > SCALE_WEI ? SCALE_WEI : wei) * 10000n / SCALE_WEI) / 100;
}

export function mountGauge(root, loadPool = () => readPool(window.ethers)) {
  const value = root.querySelector('[data-reserve]');
  const details = root.querySelector('[data-details]');
  const status = root.querySelector('[data-status]');
  const needle = root.querySelector('[data-needle]');
  const button = root.querySelector('button');
  let snapshot = null;
  let generation = 0;
  let deadline;
  function unavailable(message) {
    snapshot = null;
    value.textContent = 'Unavailable';
    details.textContent = '';
    status.textContent = message;
    needle.hidden = true;
  }
  async function refresh() {
    const request = ++generation;
    clearTimeout(deadline);
    unavailable('Reading Ethereum Mainnet...');
    button.disabled = true;
    deadline = setTimeout(() => {
      if (request !== generation) return;
      generation++;
      unavailable('Pool request timed out. Refresh to retry.');
      button.disabled = false;
    }, 15000);
    try {
      const result = await loadPool();
      if (request !== generation) return;
      if (Math.abs(Date.now() / 1000 - result.timestamp) > 180) throw new Error('Stale');
      const position = gaugePosition(result.eth);
      snapshot = result;
      value.textContent = `${units(result.eth, 18)} WETH`;
      details.textContent = `${units(result.ifr, 9)} IFR in the same pool`;
      status.textContent = `Block ${result.block} · ${new Date(result.timestamp * 1000).toLocaleString()}`;
      needle.style.transform = `rotate(${position * 1.8 - 90}deg)`;
      needle.hidden = false;
    } catch {
      if (request === generation) unavailable('Pool data could not be verified. Refresh to retry.');
    } finally {
      if (request === generation) { clearTimeout(deadline); button.disabled = false; }
    }
  }
  button.addEventListener('click', refresh);
  const freshness = setInterval(() => {
    if (snapshot && Math.abs(Date.now() / 1000 - snapshot.timestamp) > 180) unavailable('Data expired. Refresh for a current reading.');
  }, 10000);
  refresh();
  return () => { generation++; clearTimeout(deadline); clearInterval(freshness); button.removeEventListener('click', refresh); };
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('liquidity-gauge');
  if (root) mountGauge(root);
}
