export const IFR = '0x77e99917Eca8539c62F509ED1193ac36580A6e7B';
export const PAIR = '0xbE495E9c0d8cc2DCf95570cf95B63c4844dF31A0';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
export function parseIFR(value) {
  if (!/^(0|[1-9]\d{0,18})(\.\d{1,9})?$/.test(value)) throw new Error('Enter a positive IFR amount with a decimal point, no grouping separators, and at most 9 decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'));
  if (amount <= 0n) throw new Error('Enter an amount greater than zero.');
  return amount;
}
export function quote(amount, ifrReserve, ethReserve) {
  if (amount <= 0n || ifrReserve <= 0n || ethReserve <= 0n) throw new Error('Pool reserves are unavailable.');
  return (amount * ethReserve + ifrReserve - 1n) / ifrReserve;
}
export function units(value, decimals) {
  const text = value.toString().padStart(decimals + 1, '0');
  return text.slice(0, -decimals) + '.' + text.slice(-decimals).replace(/0+$/, '').padEnd(1, '0');
}
export async function readPool(ethers, signal) {
  const request = new ethers.FetchRequest('https://ethereum-rpc.publicnode.com');
  request.timeout = 10000;
  const rpc = new ethers.JsonRpcProvider(request);
  const abort = () => rpc.destroy();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw new Error('Cancelled');
    if ((await rpc.getNetwork()).chainId !== 1n) throw new Error('Wrong network.');
    const block = await rpc.getBlock('latest');
    if (!block || Math.abs(Date.now() / 1000 - block.timestamp) > 180) throw new Error('RPC block is stale.');
    const pool = new ethers.Contract(PAIR, ['function token0() view returns(address)', 'function token1() view returns(address)', 'function getReserves() view returns(uint112,uint112,uint32)'], rpc);
    const token = new ethers.Contract(IFR, ['function feeExempt(address) view returns(bool)'], rpc);
    const options = { blockTag: block.number };
    const [first, second, reserves, exempt] = await Promise.all([pool.token0(options), pool.token1(options), pool.getReserves(options), token.feeExempt(PAIR, options)]);
    if (first.toLowerCase() !== IFR.toLowerCase() || second.toLowerCase() !== WETH.toLowerCase()) throw new Error('Pool identity mismatch.');
    if (!exempt) throw new Error('Pool fee exemption is not active; this calculator cannot provide a reliable deposit estimate.');
    quote(1n, reserves[0], reserves[1]);
    return { ifr: reserves[0], eth: reserves[1], block: block.number, timestamp: block.timestamp };
  } finally { signal?.removeEventListener('abort', abort); rpc.destroy(); }
}
if (typeof document !== 'undefined' && document.getElementById('ifr-amount')) {
  const input = document.getElementById('ifr-amount');
  const output = document.getElementById('eth-estimate');
  const status = document.getElementById('pool-status');
  const button = document.getElementById('refresh-pool');
  let snapshot = null;
  let generation = 0;
  let deadline;
  function render() {
    output.textContent = 'Unavailable';
    if (!snapshot) return;
    if (Date.now() / 1000 - snapshot.timestamp > 180) {
      status.textContent = 'Data expired. Refresh the pool before estimating.';
      document.getElementById('pool-reserves').textContent = '';
      snapshot = null;
      return;
    }
    try { output.textContent = units(quote(parseIFR(input.value.trim()), snapshot.ifr, snapshot.eth), 18) + ' ETH'; }
    catch (error) { output.textContent = error.message; }
  }
  async function refresh() {
    const request = ++generation;
    clearTimeout(deadline);
    snapshot = null;
    document.getElementById('pool-reserves').textContent = '';
    render();
    button.disabled = true;
    status.textContent = 'Reading Ethereum Mainnet...';
    deadline = setTimeout(() => {
      if (request !== generation) return;
      generation++;
      button.disabled = false;
      status.textContent = 'RPC timed out. No estimate is available. Refresh to retry or check the pool on Uniswap.';
    }, 15000);
    try {
      const result = await readPool(window.ethers);
      if (request === generation) {
        snapshot = result;
        status.textContent = `Block ${result.block} · ${new Date(result.timestamp * 1000).toLocaleString()} · Pool fee exemption active`;
        document.getElementById('pool-reserves').textContent = `${units(result.ifr, 9)} IFR + ${units(result.eth, 18)} WETH`;
      }
    } catch {
      if (request === generation) status.textContent = 'Pool data could not be verified. No estimate is available. Try Refresh or check Uniswap.';
    } finally { if (request === generation) { clearTimeout(deadline); button.disabled = false; render(); } }
  }
  input.addEventListener('input', render);
  button.addEventListener('click', refresh);
  setInterval(render, 10000);
  window.addEventListener('load', refresh, { once: true });
}
