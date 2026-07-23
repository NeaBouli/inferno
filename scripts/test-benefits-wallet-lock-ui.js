#!/usr/bin/env node

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');
const { ethers } = require('ethers');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'apps', 'benefits-network', 'frontend');
const port = Number(process.env.BENEFITS_WALLET_UI_PORT || 3211);
const origin = `http://127.0.0.1:${port}`;
const wallet = '0x3333333333333333333333333333333333333333';
const token = '0x77e99917Eca8539c62F509ED1193ac36580A6e7B';
const lock = '0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb';
const decimals = 9n;
const unit = 10n ** decimals;
const amount = 1000n * unit;
const selectors = {
  approve: ethers.utils.id('approve(address,uint256)').slice(0, 10),
  balanceOf: ethers.utils.id('balanceOf(address)').slice(0, 10),
  allowance: ethers.utils.id('allowance(address,address)').slice(0, 10),
  lockedBalance: ethers.utils.id('lockedBalance(address)').slice(0, 10),
  lock: ethers.utils.id('lock(uint256)').slice(0, 10),
  unlock: ethers.utils.id('unlock()').slice(0, 10),
};
const multicall = new ethers.utils.Interface([
  'function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)',
]);
const coder = ethers.utils.defaultAbiCoder;

function encodeUint(value) {
  return coder.encode(['uint256'], [value.toString()]);
}

function decodeAmount(data) {
  return BigInt(`0x${data.slice(-64)}`);
}

function callResult(state, target, data) {
  const normalizedTarget = String(target).toLowerCase();
  const selector = String(data).slice(0, 10).toLowerCase();
  if (normalizedTarget === token.toLowerCase() && selector === selectors.balanceOf) return encodeUint(state.ifr);
  if (normalizedTarget === token.toLowerCase() && selector === selectors.allowance) return encodeUint(state.allowance);
  if (normalizedTarget === lock.toLowerCase() && selector === selectors.lockedBalance) return encodeUint(state.locked);
  return encodeUint(0n);
}

function rpcResult(payload, state) {
  const method = payload.method;
  if (method === 'eth_chainId') return '0x1';
  if (method === 'net_version') return '1';
  if (method === 'eth_blockNumber') return '0x10';
  if (method === 'eth_getBalance') return `0x${state.eth.toString(16)}`;
  if (method === 'eth_getCode') return '0x01';
  if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') return '0x3b9aca00';
  if (method === 'eth_call') {
    const call = payload.params?.[0] || {};
    const data = call.data || '0x';
    if (data.startsWith(multicall.getSighash('aggregate3'))) {
      const decoded = multicall.decodeFunctionData('aggregate3', data);
      return multicall.encodeFunctionResult('aggregate3', [
        decoded.calls.map((item) => [true, callResult(state, item.target, item.callData)]),
      ]);
    }
    return callResult(state, call.to, data);
  }
  if (method === 'eth_getTransactionReceipt') {
    const hash = payload.params?.[0];
    const transaction = state.transactions.find((item) => item.hash === hash);
    if (!transaction) return null;
    return {
      blockHash: `0x${'ab'.repeat(32)}`,
      blockNumber: '0x10',
      contractAddress: null,
      cumulativeGasUsed: '0x5208',
      effectiveGasPrice: '0x3b9aca00',
      from: wallet,
      gasUsed: '0x5208',
      logs: [],
      logsBloom: `0x${'00'.repeat(256)}`,
      status: '0x1',
      to: transaction.to,
      transactionHash: hash,
      transactionIndex: '0x0',
      type: '0x2',
    };
  }
  if (method === 'eth_getTransactionByHash') return null;
  throw new Error(`Unexpected public RPC method: ${method}`);
}

function applyTransaction(state, transaction) {
  const to = String(transaction.to || '').toLowerCase();
  const data = String(transaction.data || '0x').toLowerCase();
  let action;
  let rawAmount = 0n;

  if (to === token.toLowerCase() && data.startsWith(selectors.approve)) {
    const spender = `0x${data.slice(34, 74)}`;
    assert.equal(spender.toLowerCase(), lock.toLowerCase(), 'approval spender must be IFRLock');
    rawAmount = decodeAmount(data);
    assert.equal(rawAmount, amount, 'approval must preserve IFR 9-decimal amount');
    state.allowance = rawAmount;
    action = 'approve';
  } else if (to === lock.toLowerCase() && data.startsWith(selectors.lock)) {
    rawAmount = decodeAmount(data);
    assert.equal(rawAmount, amount, 'lock must preserve IFR 9-decimal amount');
    assert.ok(state.ifr >= rawAmount, 'lock cannot exceed unlocked IFR');
    assert.ok(state.allowance >= rawAmount, 'lock cannot exceed allowance');
    state.ifr -= rawAmount;
    state.allowance -= rawAmount;
    state.locked += rawAmount;
    action = 'lock';
  } else if (to === lock.toLowerCase() && data.startsWith(selectors.unlock)) {
    rawAmount = state.locked;
    state.ifr += state.locked;
    state.locked = 0n;
    action = 'unlock';
  } else {
    throw new Error(`Unexpected wallet transaction: ${transaction.to} ${transaction.data}`);
  }

  const hash = `0x${String(state.transactions.length + 1).padStart(64, '0')}`;
  state.transactions.push({ action, amount: rawAmount.toString(), hash, to: transaction.to });
  return hash;
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

async function run() {
  const state = {
    ifr: 10_000n * unit,
    locked: 0n,
    allowance: 0n,
    eth: 10n ** 18n,
    transactions: [],
    rpcCalls: [],
  };
  const serverOutput = [];
  const server = spawn(process.execPath, [path.join(frontend, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: frontend,
    env: {
      ...process.env,
      NEXT_PUBLIC_CHAIN_ID: '1',
      NEXT_PUBLIC_IFR_TOKEN_ADDRESS: token,
      NEXT_PUBLIC_IFRLOCK_ADDRESS: lock,
      BENEFITS_API_INTERNAL_URL: 'http://127.0.0.1:9',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => serverOutput.push(chunk.toString()));
  server.stderr.on('data', (chunk) => serverOutput.push(chunk.toString()));

  let browser;
  try {
    await waitForServer(server);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addInitScript(({ account, methodSelectors }) => {
      const listeners = new Map();
      const methods = [];
      Object.defineProperty(window, '__ifrWalletLockMethods', { value: methods });
      const provider = {
        isMetaMask: true,
        providers: [],
        request: async ({ method, params }) => {
          methods.push(method);
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
          if (method === 'eth_chainId') return '0x1';
          if (method === 'net_version') return '1';
          if (method === 'wallet_getCapabilities') return {};
          if (method === 'wallet_switchEthereumChain' || method === 'wallet_requestPermissions') return null;
          if (method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }];
          if (method === 'eth_estimateGas') return '0x186a0';
          if (method === 'eth_getTransactionCount') return '0x0';
          if (method === 'eth_sendTransaction') {
            const response = await fetch('/__test_wallet_tx', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(params?.[0] || {}),
            });
            if (!response.ok) throw new Error(await response.text());
            return (await response.json()).hash;
          }
          if (method === 'eth_getBalance') return '0xde0b6b3a7640000';
          if (method === 'eth_blockNumber') return '0x10';
          if (method === 'eth_getCode') return '0x01';
          if (method === 'eth_call') return `0x${'0'.repeat(64)}`;
          throw new Error(`Unsupported test wallet method: ${method} (${JSON.stringify(methodSelectors)})`);
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
    }, { account: wallet, methodSelectors: selectors });

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route('**/__test_wallet_tx', async (route) => {
      try {
        const hash = applyTransaction(state, route.request().postDataJSON());
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hash }) });
      } catch (error) {
        await route.fulfill({ status: 400, contentType: 'text/plain', body: error.stack || error.message });
      }
    });
    await page.route('https://eth.merkle.io/', async (route) => {
      const payload = route.request().postDataJSON();
      const respond = (item) => {
        state.rpcCalls.push({ method: item.method, to: item.params?.[0]?.to, data: item.params?.[0]?.data?.slice(0, 10) });
        try {
          return { jsonrpc: '2.0', id: item.id, result: rpcResult(item, state) };
        } catch (error) {
          return { jsonrpc: '2.0', id: item.id, error: { code: -32000, message: error.message } };
        }
      };
      const body = Array.isArray(payload) ? payload.map(respond) : respond(payload);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/businesses') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ offers: [], categories: [], serviceAreas: [], pagination: { page: 1, limit: 8, total: 0, totalPages: 0, hasNext: false } }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', chainId: 1 }) });
    });

    await page.goto(`${origin}/#customer-wallet`, { waitUntil: 'domcontentloaded' });
    const walletPanel = page.locator('#customer-wallet');
    await walletPanel.getByText('MetaMask provider', { exact: true }).waitFor();
    const connectButton = walletPanel.locator('[data-wallet-action="connect"]');
    await connectButton.click();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).first().waitFor({ timeout: 10_000 }).catch(async () => {
      throw new Error(`Wallet did not connect. Methods: ${JSON.stringify(await page.evaluate(() => window.__ifrWalletLockMethods || []))}`);
    });
    await page.waitForTimeout(2000);
    if (!await walletPanel.getByText('10,000.000 IFR', { exact: true }).count()) {
      throw new Error(`Wallet state did not load. RPC calls: ${JSON.stringify(state.rpcCalls)}\n${await walletPanel.innerText()}`);
    }
    await walletPanel.getByText('10,000.000 IFR', { exact: true }).first().waitFor();
    for (const tier of ['Bronze / 1,000 IFR', 'Silver / 2,500 IFR', 'Gold / 5,000 IFR', 'Platinum / 10,000 IFR']) {
      await walletPanel.getByRole('button', { name: tier, exact: true }).waitFor();
    }
    await walletPanel.getByText('Sellers define each real rule and may use different thresholds.', { exact: true }).waitFor();
    await walletPanel.getByRole('button', { name: 'Approve 1,000 IFR', exact: true }).click();
    await walletPanel.getByText('Approval confirmed. You can lock IFR now.', { exact: true }).waitFor({ timeout: 15_000 });
    await walletPanel.getByText('1,000.000 IFR', { exact: true }).first().waitFor();
    await walletPanel.getByRole('button', { name: 'Lock 1,000 IFR', exact: true }).click();
    await walletPanel.getByText('Lock confirmed. Wallet status is refreshing.', { exact: true }).waitFor({ timeout: 15_000 });
    await walletPanel.getByText('9,000.000 IFR', { exact: true }).first().waitFor();
    await walletPanel.getByText('Ready for checkout', { exact: true }).waitFor();
    const currentTier = walletPanel.getByText('Example tier guide', { exact: true }).locator('xpath=..');
    await currentTier.getByText('Bronze', { exact: true }).waitFor();
    const unlock = walletPanel.getByRole('button', { name: 'Unlock all', exact: true });
    assert.equal(await unlock.isEnabled(), true, 'unlock must be enabled after the lock receipt refresh');
    await unlock.click();
    await walletPanel.getByText('Unlock confirmed. Wallet status is refreshing.', { exact: true }).waitFor({ timeout: 15_000 });
    await walletPanel.getByText('10,000.000 IFR', { exact: true }).first().waitFor();
    await currentTier.getByText('None', { exact: true }).waitFor();

    assert.deepEqual(state.transactions.map(({ action, amount: raw }) => ({ action, amount: raw })), [
      { action: 'approve', amount: amount.toString() },
      { action: 'lock', amount: amount.toString() },
      { action: 'unlock', amount: amount.toString() },
    ]);
    assert.equal(state.ifr, 10_000n * unit);
    assert.equal(state.locked, 0n);
    assert.equal(state.allowance, 0n);
    assert.deepEqual(pageErrors, []);
    await context.close();
    console.log('[benefits-wallet-lock-ui] PASS - approve -> lock -> refreshed access -> unlock');
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

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
