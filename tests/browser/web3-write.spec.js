// @ts-check
const { test, expect } = require("@playwright/test");
const { ethers } = require("ethers");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");

const ACCOUNT = "0x3333333333333333333333333333333333333333";
const TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const IFR_LOCK = "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb";
const COMMITMENT = "0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3";
const COMMITMENT_V2 = "0x8efae0C85ad6d44C731cAEDA1cBC275904Fc7c8F";
const LENDING = "0x974305Ab0EC905172e697271C3d7d385194EB9DF";
const UNIT = 10n ** 9n;
const coder = ethers.AbiCoder.defaultAbiCoder();

const selector = (signature) => ethers.id(signature).slice(0, 10).toLowerCase();
const selectors = {
  approve: selector("approve(address,uint256)"),
  balanceOf: selector("balanceOf(address)"),
  allowance: selector("allowance(address,address)"),
  accessLocked: selector("lockedBalance(address)"),
  accessLockWithType: selector("lockWithType(uint256,bytes32)"),
  accessUnlock: selector("unlock()"),
  commitmentLock: selector("lock(uint256,uint8,uint256,uint256)"),
  commitmentCount: selector("getTrancheCount(address)"),
  commitmentPriceOracle: selector("priceOracle()"),
  commitmentUnlock: selector("unlock(address,uint256)"),
  commitmentGetTranche: selector("getTranche(address,uint256)"),
  commitmentConditionMet: selector("isConditionMet(address,uint256)"),
  feeExempt: selector("feeExempt(address)"),
  commitmentGetTranches: selector("getTranches(address)"),
  lendingCreate: selector("createOffer(uint256)"),
  lendingIncrease: selector("increaseOffer(uint256)"),
  lendingWithdraw: selector("withdrawOffer(uint256)"),
  lendingOfferIndex: selector("lenderOfferIndex(address)"),
  lendingHasOffer: selector("hasOffer(address)"),
  lendingPrice: selector("ifrPriceWei()"),
  lendingRate: selector("getInterestRate()"),
  lendingOfferCount: selector("getOfferCount()"),
  lendingGetOffer: selector("getOffer(uint256)"),
  lendingLoanCount: selector("getLoanCount()"),
};

function uintResult(value) {
  return coder.encode(["uint256"], [value]);
}

function addressResult(value) {
  return coder.encode(["address"], [value]);
}

function decodeWord(data, index) {
  const start = 10 + index * 64;
  return BigInt(`0x${data.slice(start, start + 64)}`);
}

function expectedWrite(transaction) {
  const to = String(transaction.to || "").toLowerCase();
  const data = String(transaction.data || "0x").toLowerCase();
  if (to === TOKEN.toLowerCase() && data.startsWith(selectors.approve)) {
    return { action: "approve", amount: decodeWord(data, 1) };
  }
  if (to === IFR_LOCK.toLowerCase() && data.startsWith(selectors.accessLockWithType)) {
    return { action: "access-lock", amount: decodeWord(data, 0) };
  }
  if (to === IFR_LOCK.toLowerCase() && data.startsWith(selectors.accessUnlock)) {
    return { action: "access-unlock", amount: 0n };
  }
  if (to === COMMITMENT.toLowerCase() && data.startsWith(selectors.commitmentLock)) {
    return { action: "commitment-lock", amount: decodeWord(data, 0) };
  }
  if (to === COMMITMENT_V2.toLowerCase() && data.startsWith(selectors.commitmentLock)) {
    return { action: "commitment-lock-v2", amount: decodeWord(data, 0), cType: decodeWord(data, 1), p0Multiplier: decodeWord(data, 3) };
  }
  if (to === COMMITMENT.toLowerCase() && data.startsWith(selectors.commitmentUnlock)) {
    return { action: "commitment-unlock-v1", amount: decodeWord(data, 1) };
  }
  if (to === COMMITMENT_V2.toLowerCase() && data.startsWith(selectors.commitmentUnlock)) {
    return { action: "commitment-unlock-v2", amount: decodeWord(data, 1) };
  }
  if (to === LENDING.toLowerCase() && data.startsWith(selectors.lendingCreate)) {
    return { action: "lending-create", amount: decodeWord(data, 0) };
  }
  if (to === LENDING.toLowerCase() && data.startsWith(selectors.lendingIncrease)) {
    return { action: "lending-increase", amount: decodeWord(data, 0) };
  }
  if (to === LENDING.toLowerCase() && data.startsWith(selectors.lendingWithdraw)) {
    return { action: "lending-withdraw", amount: decodeWord(data, 0) };
  }
  throw new Error(`Unexpected Web3 write: ${transaction.to} ${transaction.data}`);
}

function buildCallResults(options = {}) {
  const locked = options.locked || 0n;
  // lenderOffer: the connected wallet owns an active offer (hasOffer = true, index 0).
  const lenderOffer = options.lenderOffer === true;
  const availableOffer = options.offerAvailable === true || lenderOffer;
  const callResults = {
    [selectors.balanceOf]: uintResult(10_000n * UNIT),
    [selectors.allowance]: uintResult(0n),
    [selectors.accessLocked]: uintResult(locked),
    [selectors.commitmentCount]: uintResult(0n),
    [selectors.commitmentPriceOracle]: addressResult(ethers.ZeroAddress),
    [selectors.lendingHasOffer]: uintResult(lenderOffer ? 1n : 0n),
    [selectors.lendingOfferIndex]: uintResult(0n),
    [selectors.lendingPrice]: uintResult(0n),
    [selectors.lendingRate]: uintResult(200n),
    [selectors.lendingOfferCount]: uintResult(availableOffer ? 1n : 0n),
    [selectors.lendingGetOffer]: coder.encode(
      ["tuple(address lender,uint256 availableIFR,uint256 lentIFR,bool active)"],
      [[ACCOUNT, 1000n * UNIT, 0n, availableOffer]],
    ),
    [selectors.lendingLoanCount]: uintResult(0n),
  };
  // InfernoToken.feeExempt(V2): false by default (V2 closed), true opens V2, "error" makes the read fail.
  const feeExemptV2 = options.feeExemptV2 === undefined ? false : options.feeExemptV2;
  callResults[`${TOKEN.toLowerCase()}:${selectors.feeExempt}`] = feeExemptV2 === "error" ? "__THROW__" : uintResult(feeExemptV2 ? 1n : 0n);
  if (options.v1Tranche) {
    const now = 1_700_000_000n;
    callResults[`${COMMITMENT.toLowerCase()}:${selectors.commitmentCount}`] = uintResult(1n);
    callResults[`${COMMITMENT.toLowerCase()}:${selectors.commitmentGetTranche}`] = coder.encode(
      ["tuple(uint256 amount,uint8 cType,uint256 unlockTime,uint256 p0Multiplier,bool unlocked,uint256 conditionMetAt)"],
      [[9_500n * UNIT, 0, now, 0n, false, now]],
    );
    callResults[`${COMMITMENT.toLowerCase()}:${selectors.commitmentConditionMet}`] = uintResult(1n);
    callResults[`${COMMITMENT.toLowerCase()}:${selectors.commitmentGetTranches}`] = coder.encode(
      ["tuple(uint256 amount,uint8 cType,uint256 unlockTime,uint256 p0Multiplier,bool unlocked,uint256 conditionMetAt)[]"],
      [[[9_500n * UNIT, 0, now, 0n, false, now]]],
    );
  }
  if (options.v1TrancheCount !== undefined) callResults[`${COMMITMENT.toLowerCase()}:${selectors.commitmentCount}`] = uintResult(options.v1TrancheCount);
  if (options.v2TrancheCount !== undefined) callResults[`${COMMITMENT_V2.toLowerCase()}:${selectors.commitmentCount}`] = uintResult(options.v2TrancheCount);
  return callResults;
}

const READ_RPC_PATTERNS = [
  "https://ethereum-rpc.publicnode.com/**",
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org/**",
  "https://eth.drpc.org",
  "https://1rpc.io/eth",
  "https://1rpc.io/eth/**",
];

// Answers the Web3 wallet core's chain-pinned public read RPCs from a fixture (never the real network).
async function routeReadRpc(target, results, options = {}) {
  const chainId = options.readChainId || "0x1";
  const log = options.readLog || null;
  const handler = async (route) => {
    let payload;
    try {
      payload = route.request().postDataJSON();
    } catch {
      return route.abort();
    }
    const respond = (item) => {
      if (log) log.push(item.method);
      let result = null;
      if (item.method === "eth_chainId") result = chainId;
      else if (item.method === "net_version") result = String(Number.parseInt(chainId, 16));
      else if (item.method === "eth_blockNumber") result = "0x10";
      else if (item.method === "eth_getCode") result = "0x01";
      else if (item.method === "eth_getBalance") result = "0xde0b6b3a7640000";
      else if (item.method === "eth_call") {
        const call = item.params && item.params[0] ? item.params[0] : {};
        const data = String(call.data || "0x").slice(0, 10).toLowerCase();
        const key = `${String(call.to || "").toLowerCase()}:${data}`;
        const flip = options.feeExemptFlip;
        const flipped = flip && key === flip.key && options.sendCount && options.sendCount() >= flip.afterSends;
        const scoped = flipped ? flip.value : results[key];
        if (scoped === "__THROW__") {
          return { jsonrpc: "2.0", id: item.id, error: { code: 3, message: "execution reverted (test)", data: "0x" } };
        }
        result = scoped || results[data] || `0x${"0".repeat(64)}`;
      }
      return { jsonrpc: "2.0", id: item.id, result };
    };
    const body = Array.isArray(payload) ? payload.map(respond) : respond(payload);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  };
  for (const pattern of READ_RPC_PATTERNS) await target.route(pattern, handler);
}

// Every context gets fixture read RPCs by default, so no test reaches a real public endpoint.
async function newRoutedContext(browser, contextOptions) {
  const context = await browser.newContext(contextOptions);
  await routeReadRpc(context, buildCallResults());
  return context;
}

// Optional: feeExempt(V2) changes after N eth_sendTransaction calls ({ afterSends, to: false | "error" }).
function buildFeeExemptFlip(options) {
  return options.feeExemptFlip
    ? {
        key: `${TOKEN.toLowerCase()}:${selectors.feeExempt}`,
        afterSends: options.feeExemptFlip.afterSends,
        value: options.feeExemptFlip.to === "error" ? "__THROW__" : uintResult(options.feeExemptFlip.to ? 1n : 0n),
      }
    : null;
}

async function installWallet(context, options = {}) {
  const chainId = options.chainId || "0x1";
  const rejectSwitch = options.rejectSwitch === true;
  const callResults = buildCallResults(options);
  const walletResults = { ...callResults, ...(options.walletResultsOverride || {}) };

  const feeExemptFlip = buildFeeExemptFlip(options);

  await context.addInitScript(({ account, initialChainId, shouldRejectSwitch, results, flip }) => {
    let sendCount = 0;
    const listeners = new Map();
    const transactions = new Map();
    let activeChainId = initialChainId;
    let activeAccount = account;
    const requestCounts = {};

    Object.defineProperty(window, "__web3TestChainId", { get: () => activeChainId });
    Object.defineProperty(window, "__web3RequestCounts", { value: requestCounts });
    Object.defineProperty(window, "__web3Emit", {
      value: (event, payload) => {
        if (event === "accountsChanged" && payload && payload[0]) activeAccount = payload[0];
        for (const listener of listeners.get(event) || []) listener(payload);
      },
    });
    Object.defineProperty(window, "__web3WatchAssets", { value: [] });
    Object.defineProperty(window, "ethereum", {
      configurable: true,
      value: {
        isMetaMask: true,
        request: async ({ method, params }) => {
          requestCounts[method] = (requestCounts[method] || 0) + 1;
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [activeAccount];
          if (method === "eth_chainId") return activeChainId;
          if (method === "net_version") return String(Number.parseInt(activeChainId, 16));
          if (method === "wallet_switchEthereumChain") {
            if (shouldRejectSwitch) {
              const error = new Error("User rejected network switch");
              error.code = 4001;
              throw error;
            }
            activeChainId = params && params[0] ? params[0].chainId : activeChainId;
            return null;
          }
          if (method === "wallet_watchAsset") {
            window.__web3WatchAssets.push(params);
            return true;
          }
          if (method === "eth_getBalance") return "0xde0b6b3a7640000";
          if (method === "eth_blockNumber") return "0x10";
          if (method === "eth_getCode") return "0x01";
          if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas") return "0x3b9aca00";
          if (method === "eth_getTransactionCount") return "0x0";
          if (method === "eth_estimateGas") return "0x186a0";
          if (method === "eth_call") {
            const call = params && params[0] ? params[0] : {};
            const data = String(call.data || "0x").slice(0, 10).toLowerCase();
            const scoped = results[`${String(call.to || "").toLowerCase()}:${data}`];
            if (scoped === "__THROW__") throw Object.assign(new Error("execution reverted (test)"), { code: -32000 });
            return scoped || results[data] || `0x${"0".repeat(64)}`;
          }
          if (method === "eth_sendTransaction") {
            sendCount += 1;
            if (flip && sendCount >= flip.afterSends) results[flip.key] = flip.value;
            const response = await fetch("/__web3_test_transaction", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(params && params[0] ? params[0] : {}),
            });
            if (!response.ok) throw new Error(await response.text());
            const { hash } = await response.json();
            transactions.set(hash, params && params[0] ? params[0] : {});
            return hash;
          }
          if (method === "eth_getTransactionReceipt") {
            const hash = params && params[0];
            const transaction = transactions.get(hash);
            if (!transaction) return null;
            return {
              blockHash: `0x${"ab".repeat(32)}`,
              blockNumber: "0x10",
              contractAddress: null,
              cumulativeGasUsed: "0x5208",
              effectiveGasPrice: "0x3b9aca00",
              from: account,
              gasUsed: "0x5208",
              logs: [],
              logsBloom: `0x${"00".repeat(256)}`,
              status: "0x1",
              to: transaction.to,
              transactionHash: hash,
              transactionIndex: "0x0",
              type: "0x2",
            };
          }
          if (method === "eth_getTransactionByHash") {
            const hash = params && params[0];
            const transaction = transactions.get(hash);
            if (!transaction) return null;
            return {
              blockHash: null,
              blockNumber: null,
              from: account,
              gas: transaction.gas || "0x186a0",
              gasPrice: transaction.gasPrice || "0x3b9aca00",
              hash,
              input: transaction.data || "0x",
              nonce: transaction.nonce || "0x0",
              r: `0x${"00".repeat(32)}`,
              s: `0x${"00".repeat(32)}`,
              to: transaction.to,
              transactionIndex: null,
              type: "0x0",
              v: "0x1b",
              value: transaction.value || "0x0",
            };
          }
          return null;
        },
        on: (event, listener) => {
          const current = listeners.get(event) || [];
          current.push(listener);
          listeners.set(event, current);
        },
        removeListener: (event, listener) => {
          listeners.set(event, (listeners.get(event) || []).filter((item) => item !== listener));
        },
      },
    });
  }, {
    account: ACCOUNT,
    initialChainId: chainId,
    shouldRejectSwitch: rejectSwitch,
    results: walletResults,
    flip: feeExemptFlip,
  });
  return callResults;
}

async function preparePage(browser, options = {}) {
  const context = await newRoutedContext(browser, { serviceWorkers: "block", ...(options.contextOptions || {}) });
  const readResults = await installWallet(context, options);
  const writes = [];
  await routeReadRpc(context, { ...readResults, ...(options.readResultsOverride || {}) }, {
    ...options,
    feeExemptFlip: buildFeeExemptFlip(options),
    sendCount: () => writes.length,
  });
  const pageErrors = [];
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/__web3_test_transaction", async (route) => {
    try {
      const transaction = route.request().postDataJSON();
      const decoded = expectedWrite(transaction);
      const hash = `0x${String(writes.length + 1).padStart(64, "0")}`;
      writes.push({ ...decoded, to: transaction.to, data: transaction.data, hash });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ hash }) });
    } catch (error) {
      await route.fulfill({ status: 400, contentType: "text/plain", body: error.stack || error.message });
    }
  });
  await page.route("https://eth.llamarpc.com/**", async (route) => {
    let payload;
    try {
      payload = route.request().postDataJSON();
    } catch {
      return route.abort();
    }
    const respond = (item) => ({ jsonrpc: "2.0", id: item.id, result: `0x${"0".repeat(64)}` });
    const body = Array.isArray(payload) ? payload.map(respond) : respond(payload);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return { context, page, writes, pageErrors };
}

async function connect(page) {
  await page.locator("[data-wallet-connect]:visible").first().click();
  await page.locator('[data-wallet-option-type="injected"]').first().click();
  await expect(page.locator("[data-wallet-state]").first()).toContainText("Connected", { timeout: 10_000 });
}

async function selectInjectedWallet(page, name) {
  const option = name
    ? page.locator('[data-wallet-option-type="injected"]', { hasText: name })
    : page.locator('[data-wallet-option-type="injected"]').first();
  await option.click();
}

test("wrong-chain rejection fails closed before connected state or writes", async ({ browser }) => {
  const { context, page, writes, pageErrors } = await preparePage(browser, {
    chainId: "0xaa36a7",
    rejectSwitch: true,
  });
  await page.goto("/web3/", { waitUntil: "domcontentloaded" });
  await page.locator("[data-wallet-connect]").first().click();
  await selectInjectedWallet(page);
  await expect(page.locator("[data-wallet-state]").first()).toContainText("Ethereum Mainnet");
  expect(await page.evaluate(() => window.IFRWallet.isConnected())).toBe(false);
  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
  await context.close();
});

test("WalletConnect-style numeric Mainnet chain id connects without a false network error", async ({ browser }) => {
  const { context, page, writes, pageErrors } = await preparePage(browser, { chainId: 1 });
  await page.goto("/web3/", { waitUntil: "domcontentloaded" });
  await connect(page);
  expect(await page.evaluate(() => window.IFRWallet.isConnected())).toBe(true);
  expect(await page.evaluate(() => window.__web3TestChainId)).toBe(1);
  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
  await context.close();
});

test("zero-padded hexadecimal Mainnet chain id connects without a false network error", async ({ browser }) => {
  const { context, page, writes, pageErrors } = await preparePage(browser, { chainId: "0x01" });
  await page.goto("/web3/", { waitUntil: "domcontentloaded" });
  await connect(page);
  expect(await page.evaluate(() => window.IFRWallet.isConnected())).toBe(true);
  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
  await context.close();
});

test("Web3 wallet manager shows connector details, tracks account changes and disconnects", async ({ browser }) => {
  const { context, page, writes, pageErrors } = await preparePage(browser);
  await page.goto("/web3/", { waitUntil: "domcontentloaded" });
  expect(await page.locator("[data-wallet-header-disconnect]").evaluate((element) => ({
    hidden: element.hidden,
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
  }))).toEqual({ hidden: true, width: 0, height: 0 });
  await connect(page);

  await expect(page.locator("[data-wallet-address]")).toHaveText("0x3333...3333");
  await expect(page.locator("[data-wallet-address]")).toHaveAttribute("title", ACCOUNT);
  await expect(page.locator("[data-wallet-connector]")).toHaveText("MetaMask");
  await expect(page.locator("[data-wallet-network]")).toHaveText("Ethereum Mainnet");
  await expect(page.locator("[data-wallet-disconnect]")).toBeVisible();
  await expect(page.locator("[data-wallet-header-disconnect]")).toBeVisible();
  await expect(page.locator("[data-wallet-copy-address]")).toBeVisible();

  const requestsBefore = await page.evaluate(() => window.__web3RequestCounts.eth_requestAccounts);
  await page.locator("[data-wallet-connect]:visible").first().click();
  expect(await page.evaluate(() => window.__web3RequestCounts.eth_requestAccounts)).toBe(requestsBefore);

  const nextAccount = "0x4444444444444444444444444444444444444444";
  await page.evaluate((address) => window.__web3Emit("accountsChanged", [address]), nextAccount);
  await expect(page.locator("[data-wallet-address]")).toHaveText("0x4444...4444");
  await expect(page.locator("[data-wallet-address]")).toHaveAttribute("title", nextAccount);

  await page.locator("[data-wallet-header-disconnect]").click();
  await expect(page.locator("[data-wallet-address]")).toHaveText("Not connected");
  await expect(page.locator("[data-wallet-state]")).toHaveText("Disconnected");
  await expect(page.locator("[data-wallet-disconnect]")).toBeHidden();
  expect(await page.locator("[data-wallet-header-disconnect]").evaluate((element) => ({
    hidden: element.hidden,
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
  }))).toEqual({ hidden: true, width: 0, height: 0 });
  await expect(page.locator("[data-wallet-connect]").first()).toHaveText("Connect Wallet");
  expect(await page.evaluate(() => window.IFRWallet.isConnected())).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem("ifr_web3_wallet_connected"))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem("ifr_web3_wallet_connected"))).toBeNull();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-wallet-address]")).toHaveText("Not connected");
  expect(await page.evaluate(() => window.IFRWallet.isConnected())).toBe(false);
  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
  await context.close();
});

test("failed account refresh clears the previous wallet data", async ({ browser }) => {
  const { context, page, writes, pageErrors } = await preparePage(browser);
  await page.goto("/web3/", { waitUntil: "domcontentloaded" });
  await connect(page);
  await expect(page.locator("[data-ifr-balance]")).toContainText("IFR");

  const nextAccount = "0x5555555555555555555555555555555555555555";
  await page.evaluate((address) => {
    const originalLoad = window.IFRState.load.bind(window.IFRState);
    window.IFRState.load = (requestedAddress) => (
      requestedAddress.toLowerCase() === address.toLowerCase()
        ? Promise.reject(new Error("Test-only account refresh failure"))
        : originalLoad(requestedAddress)
    );
    window.__web3Emit("accountsChanged", [address]);
  }, nextAccount);

  await expect(page.locator("[data-wallet-address]")).toHaveText("0x5555...5555");
  await expect(page.locator("[data-wallet-address]")).toHaveAttribute("title", nextAccount);
  await expect(page.locator("[data-wallet-state]")).toHaveText("Connected · status unavailable");
  await expect(page.locator("[data-ifr-balance]")).toHaveText("Unavailable");
  await expect(page.locator("[data-access-lock-balance]")).toHaveText("Unavailable");
  await expect(page.locator("[data-commitment-balance]")).toHaveText("Unavailable");
  await expect(page.locator("[data-lending-summary]")).toHaveText("Unavailable");
  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
  await context.close();
});

test("wallet chooser keeps WalletConnect available with zero or multiple injected wallets", async ({ browser }) => {
  const emptyContext = await newRoutedContext(browser, { serviceWorkers: "block" });
  try {
    const emptyPage = await emptyContext.newPage();
    await emptyPage.goto("/web3/", { waitUntil: "domcontentloaded" });
    await emptyPage.locator("[data-wallet-connect]").first().click();
    await expect(emptyPage.locator("[data-wallet-option]")).toHaveCount(1);
    await expect(emptyPage.locator('[data-wallet-option="walletconnect"]')).toBeVisible();
  } finally {
    await emptyContext.close();
  }

  const { context, page, pageErrors } = await preparePage(browser);
  try {
    await page.goto("/web3/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      const metaMask = window.ethereum;
      const coinbase = {
        isCoinbaseWallet: true,
        request: (args) => metaMask.request(args),
        on: (event, listener) => metaMask.on(event, listener),
        removeListener: (event, listener) => metaMask.removeListener(event, listener),
      };
      window.ethereum.providers = [metaMask, coinbase];
    });
    await page.locator("[data-wallet-connect]").first().click();
    await expect(page.locator('[data-wallet-option-type="injected"]')).toHaveCount(2);
    await expect(page.locator('[data-wallet-option="walletconnect"]')).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("new Web3 HTML fails visibly when an old cached wallet core lacks the chooser API", async ({ browser }) => {
  const context = await newRoutedContext(browser, { serviceWorkers: "block" });
  await context.route("**/web3-wallet-core.js?v=20261004-rpc-fallback-v6", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `window.IFRWallet = {
      autoReconnect: async () => false,
      isConnected: () => false,
      on: () => {},
      off: () => {},
      getAddress: () => null
    };`,
  }));
  try {
    const page = await context.newPage();
    await page.goto("/web3/", { waitUntil: "domcontentloaded" });
    await page.locator("[data-wallet-connect]").first().click();
    await expect(page.locator("[data-wallet-state]").first()).toHaveText(
      "Wallet update required · reload page",
    );
    await expect(page.locator("[data-wallet-chooser]")).toHaveAttribute("aria-hidden", "true");
  } finally {
    await context.close();
  }
});

test("closing the wallet chooser stays disconnected and requests no account access", async ({ browser }) => {
  const { context, page, writes, pageErrors } = await preparePage(browser);
  try {
    await page.goto("/web3/", { waitUntil: "domcontentloaded" });
    await page.locator("[data-wallet-connect]").first().click();
    await expect(page.locator("[data-wallet-chooser]")).toHaveAttribute("aria-hidden", "false");
    await page.locator("[data-wallet-chooser-close]").click();
    await expect(page.locator("[data-wallet-chooser]")).toHaveAttribute("aria-hidden", "true");
    expect(await page.evaluate(() => window.IFRWallet.isConnected())).toBe(false);
    expect(await page.evaluate(() => window.__web3RequestCounts.eth_requestAccounts ?? 0)).toBe(0);
    expect(writes).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("EIP-6963 providers are deduplicated and only the chosen provider requests accounts", async ({ browser }) => {
  const { context, page, writes, pageErrors } = await preparePage(browser);
  try {
    await page.goto("/web3/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      const metaMask = window.ethereum;
      let rainbowRequests = 0;
      const rainbow = {
        request: (args) => {
          if (args.method === "eth_requestAccounts") rainbowRequests += 1;
          return metaMask.request(args);
        },
        on: (event, listener) => metaMask.on(event, listener),
        removeListener: (event, listener) => metaMask.removeListener(event, listener),
      };
      Object.defineProperty(window, "__rainbowRequests", { get: () => rainbowRequests });
      window.ethereum.providers = [metaMask, rainbow];
      const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
        detail: {
          info: {
            uuid: "rainbow-test-provider",
            name: "Rainbow Test",
            icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
            rdns: "me.rainbow",
          },
          provider: rainbow,
        },
      }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    });

    await page.locator("[data-wallet-connect]").first().click();
    await expect(page.locator('[data-wallet-option-type="injected"]')).toHaveCount(2);
    await expect(page.locator('[data-wallet-option-type="injected"]', { hasText: "Rainbow Test" })).toHaveCount(1);
    await selectInjectedWallet(page, "Rainbow Test");
    await expect(page.locator("[data-wallet-state]")).toContainText("Connected", { timeout: 10_000 });
    expect(await page.evaluate(() => window.__rainbowRequests)).toBe(1);
    expect(await page.evaluate(() => window.__web3RequestCounts.eth_requestAccounts)).toBe(1);
    expect(writes).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("wallet chooser is the only initial connect surface on desktop, iPad and Android", async ({ browser }) => {
  const surfaces = [
    { name: "desktop", contextOptions: { viewport: { width: 1280, height: 800 } } },
    { name: "iPad", contextOptions: { viewport: { width: 820, height: 1180 }, userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1", isMobile: true, hasTouch: true } },
    { name: "Android", contextOptions: { viewport: { width: 360, height: 800 }, userAgent: "Mozilla/5.0 (Linux; Android 13; SM-G973F) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36", isMobile: true, hasTouch: true } },
  ];
  for (const surface of surfaces) {
    const { context, page, pageErrors } = await preparePage(browser, { contextOptions: surface.contextOptions });
    try {
      await page.goto("/web3/", { waitUntil: "domcontentloaded" });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
        `${surface.name} should not overflow horizontally`,
      ).toBe(false);
      await page.locator("[data-wallet-connect]").first().click();
      await expect(page.locator("[data-wallet-chooser]")).toHaveClass(/is-open/);
      await expect(page.locator("[data-wallet-dialog]")).not.toHaveClass(/is-open/);
      await expect(page.locator('[data-wallet-option="walletconnect"]')).toBeVisible();
      expect(pageErrors, surface.name).toEqual([]);
    } finally {
      await context.close();
    }
  }
});

test("Web3 header stays compact and non-overlapping before and after wallet connection", async ({ browser }) => {
  const surfaces = [
    { name: "desktop", contextOptions: { viewport: { width: 1280, height: 800 } } },
    { name: "iPad", contextOptions: { viewport: { width: 820, height: 1180 }, userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1", isMobile: true, hasTouch: true } },
    { name: "Android", contextOptions: { viewport: { width: 360, height: 800 }, userAgent: "Mozilla/5.0 (Linux; Android 13; SM-G973F) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36", isMobile: true, hasTouch: true } },
  ];

  for (const surface of surfaces) {
    const { context, page, pageErrors } = await preparePage(browser, {
      contextOptions: surface.contextOptions,
    });
    try {
      await page.goto("/web3/", { waitUntil: "domcontentloaded" });
      await expect(page.locator('nav[aria-label="Primary navigation"]')).toHaveCount(1);

      const readGeometry = () => page.evaluate(() => {
        const rect = (selector) => {
          const element = document.querySelector(selector);
          const bounds = element.getBoundingClientRect();
          return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
        };
        const header = document.querySelector(".topbar").getBoundingClientRect();
        return {
          headerHeight: header.height,
          brand: rect(".brand"),
          actions: rect(".nav-actions"),
          links: rect(".nav-links"),
          viewportWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        };
      });

      for (const phase of ["disconnected", "connected"]) {
        if (phase === "connected") await connect(page);
        if (phase === "disconnected") {
          await expect(page.locator("[data-wallet-header-connect]")).toBeVisible();
          await expect(page.locator("[data-wallet-header-disconnect]")).toBeHidden();
        } else {
          await expect(page.locator("[data-wallet-header-connect]")).toBeHidden();
          await expect(page.locator("[data-wallet-header-disconnect]")).toBeVisible();
        }
        const geometry = await readGeometry();
        const overlaps = (left, right) => (
          left.left < right.right
          && left.right > right.left
          && left.top < right.bottom
          && left.bottom > right.top
        );
        expect(geometry.scrollWidth, `${surface.name} ${phase} horizontal overflow`).toBe(geometry.viewportWidth);
        expect(overlaps(geometry.brand, geometry.actions), `${surface.name} ${phase} brand/actions overlap`).toBe(false);
        expect(overlaps(geometry.brand, geometry.links), `${surface.name} ${phase} brand/links overlap`).toBe(false);
        expect(overlaps(geometry.actions, geometry.links), `${surface.name} ${phase} actions/links overlap`).toBe(false);
        expect(geometry.headerHeight, `${surface.name} ${phase} header is too tall`).toBeLessThanOrEqual(140);
      }
      expect(pageErrors, surface.name).toEqual([]);
    } finally {
      await context.close();
    }
  }
});

test("Web3 header has no overlap and 44px targets with the install control visible", async ({ browser }) => {
  // SM-T835 Chrome portrait reported 711 CSS px; the tablet-width brand used to
  // overflow its grid track and run under the Install App button.
  const viewports = [
    { width: 711, height: 970 },
    { width: 820, height: 1180 },
    { width: 1180, height: 820 },
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ];
  for (const viewport of viewports) {
    const { context, page, pageErrors } = await preparePage(browser, { contextOptions: { viewport } });
    try {
      await page.goto("/web3/", { waitUntil: "domcontentloaded" });
      for (const phase of ["disconnected", "connected"]) {
        if (phase === "connected") await connect(page);
        // Legacy Android (SM-T835 ships Android 9) renders the longest label.
        await page.evaluate(() => {
          document.querySelectorAll(".nav-actions [data-install-app]").forEach((button) => {
            button.hidden = false;
            button.textContent = "App requirements";
          });
        });
        const geometry = await page.evaluate(() => {
          const visible = (element) => {
            const style = getComputedStyle(element);
            const bounds = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
          };
          const box = (element) => {
            const bounds = element.getBoundingClientRect();
            return {
              label: (element.textContent || element.getAttribute("alt") || "").trim(),
              left: bounds.left,
              right: bounds.right,
              top: bounds.top,
              bottom: bounds.bottom,
              width: bounds.width,
              height: bounds.height,
              clipped: element.scrollWidth > element.clientWidth + 1,
            };
          };
          const links = document.querySelector(".nav-links");
          return {
            brandContent: [...document.querySelectorAll(".brand img, .brand-main, .brand-tag")].map(box),
            actions: [...document.querySelectorAll(".nav-actions > *")].filter(visible).map(box),
            targets: [document.querySelector(".brand"), ...document.querySelectorAll(".nav-links a")].map(box),
            linksClipped: links.scrollWidth > links.clientWidth + 1,
            viewportWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
          };
        });
        const where = `${viewport.width}x${viewport.height} ${phase}`;
        const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        expect(geometry.scrollWidth, `${where} horizontal overflow`).toBe(geometry.viewportWidth);
        expect(geometry.linksClipped, `${where} navigation links clipped`).toBe(false);
        expect(geometry.actions.map((action) => action.label), where).toContain(
          viewport.width > 680 ? "App requirements" : (phase === "connected" ? "Disconnect" : "Connect Wallet"),
        );
        for (const content of geometry.brandContent) {
          for (const action of geometry.actions) {
            expect(overlaps(content, action), `${where} ${content.label} overlaps ${action.label}`).toBe(false);
          }
        }
        for (const target of [...geometry.targets, ...geometry.actions]) {
          expect(target.width, `${where} ${target.label} width`).toBeGreaterThanOrEqual(44);
          expect(target.height, `${where} ${target.label} height`).toBeGreaterThanOrEqual(44);
          expect(target.clipped, `${where} ${target.label} text clipped`).toBe(false);
        }
      }
      expect(pageErrors, `${viewport.width}x${viewport.height}`).toEqual([]);
    } finally {
      await context.close();
    }
  }
});

const WC_PENDING_MOCK_MODULE = `
  const state = { pending: null, provider: null, uriCount: 0 };
  function makeProvider() {
    const listeners = new Map();
    const emit = (event, value) => (listeners.get(event) || []).forEach((fn) => fn(value));
    const provider = {
      session: null,
      accounts: [],
      enable: function() {
        state.uriCount += 1;
        emit("display_uri", "wc:mock-uri-" + state.uriCount);
        return new Promise((resolve, reject) => { state.pending = { resolve, reject, provider }; });
      },
      request: async ({ method }) => {
        if (method === "eth_accounts" || method === "eth_requestAccounts") return provider.accounts;
        if (method === "eth_chainId") return "0x1";
        if (method === "net_version") return "1";
        if (method === "eth_getBalance") return "0x0";
        if (method === "eth_blockNumber") return "0x10";
        if (method === "eth_call") return "0x" + "0".repeat(64);
        return null;
      },
      on: (event, fn) => listeners.set(event, (listeners.get(event) || []).concat(fn)),
      removeListener: (event, fn) => listeners.set(event, (listeners.get(event) || []).filter((f) => f !== fn)),
      disconnect: async () => { state.disconnects += 1; },
      emit,
    };
    state.provider = provider;
    return provider;
  }
  state.disconnects = 0;
  window.__wcMock = {
    uriCount: () => state.uriCount,
    disconnects: () => state.disconnects,
    approve: (address, emitConnect) => {
      const pending = state.pending;
      if (!pending) return;
      pending.provider.accounts = [address];
      pending.provider.session = { topic: "mock" };
      if (emitConnect) pending.provider.emit("connect", { chainId: "0x1" });
      pending.resolve([address]);
    },
  };
  export const EthereumProvider = { init: async () => makeProvider() };
`;

test("closing a pending tablet WalletConnect dialog cancels it and a retry still connects", async ({ browser }) => {
  const context = await newRoutedContext(browser, {
    serviceWorkers: "block",
    viewport: { width: 711, height: 970 },
    userAgent: "Mozilla/5.0 (Linux; Android 9; SM-T835) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    isMobile: true,
    hasTouch: true,
  });
  const pageErrors = [];
  try {
    await context.route("**/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js", (route) => route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: WC_PENDING_MOCK_MODULE,
    }));
    await context.route("https://eth.llamarpc.com/**", async (route) => {
      let payload;
      try {
        payload = route.request().postDataJSON();
      } catch {
        return route.abort();
      }
      const respond = (item) => ({ jsonrpc: "2.0", id: item.id, result: `0x${"0".repeat(64)}` });
      const body = Array.isArray(payload) ? payload.map(respond) : respond(payload);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.clock.install();
    await page.goto("/web3/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.IFRWallet && typeof window.IFRWallet.cancelWalletConnect === "function");

    const button = page.locator(".nav-actions [data-wallet-connect]");
    const walletState = page.locator("[data-wallet-state]").first();
    const walletDialog = page.locator("[data-wallet-dialog]");
    const walletConnectOption = page.locator('[data-wallet-option="walletconnect"]');

    await button.click();
    await walletConnectOption.click();
    await expect(walletDialog).toHaveClass(/is-open/);
    await expect.poll(() => page.evaluate(() => window.__wcMock && window.__wcMock.uriCount())).toBe(1);
    await expect(button).toBeDisabled();

    await page.locator("[data-wallet-dialog-close]").click();
    expect(await walletState.textContent()).toBe("Cancelled · retry");
    await expect(walletDialog).not.toHaveClass(/is-open/);
    await expect(button).toBeEnabled();
    await expect(button).toHaveText("Connect Wallet");
    expect(await page.evaluate(() => window.__wcMock.disconnects())).toBe(1);

    // Late approval and the 45 s watchdog of the cancelled attempt must not
    // overwrite the cancelled state or claim a connection.
    await page.evaluate((address) => window.__wcMock.approve(address, true), ACCOUNT);
    await page.clock.fastForward(46_000);
    await expect(walletState).toHaveText("Cancelled · retry");
    expect(await page.evaluate(() => window.IFRWallet.isConnected())).toBe(false);
    await expect(button).toHaveText("Connect Wallet");

    await button.click();
    await walletConnectOption.click();
    await expect.poll(() => page.evaluate(() => window.__wcMock.uriCount())).toBe(2);
    await page.evaluate((address) => window.__wcMock.approve(address, false), ACCOUNT);
    await expect(walletState).toContainText("Connected", { timeout: 10_000 });
    await expect(walletDialog).not.toHaveClass(/is-open/);
    expect(await page.evaluate(() => window.IFRWallet.isConnected())).toBe(true);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

// Every EthereumProvider.init() stays pending until the test resolves it, so a
// cancel can land while no provider exists yet.
const WC_DEFERRED_INIT_MOCK_MODULE = WC_PENDING_MOCK_MODULE
  .replace("const state = { pending: null, provider: null, uriCount: 0 };", `
  const state = { pending: null, provider: null, uriCount: 0, inits: [], providers: [] };`)
  .replace("state.provider = provider;", `state.provider = provider;
    provider.id = state.providers.push(provider);`)
  .replace("disconnect: async () => { state.disconnects += 1; },", `disconnect: async () => {
        state.disconnects += 1;
        provider.disconnected = true;
      },`)
  .replace("uriCount: () => state.uriCount,", `uriCount: () => state.uriCount,
    initCount: () => state.inits.length,
    resolveInit: (index) => state.inits[index](makeProvider()),
    providerState: () => state.providers.map((p) => ({ id: p.id, disconnected: Boolean(p.disconnected) })),
    pendingProviderId: () => state.pending && state.pending.provider.id,`)
  .replace("export const EthereumProvider = { init: async () => makeProvider() };",
    "export const EthereumProvider = { init: () => new Promise((resolve) => { state.inits.push(resolve); }) };");

test("cancelling while WalletConnect init is pending drops the late provider and a retry pairs fresh", async ({ browser }) => {
  expect(WC_DEFERRED_INIT_MOCK_MODULE).toContain("state.inits.push(resolve)");
  expect(WC_DEFERRED_INIT_MOCK_MODULE).toContain("provider.disconnected = true");
  const context = await newRoutedContext(browser, {
    serviceWorkers: "block",
    viewport: { width: 711, height: 970 },
    userAgent: "Mozilla/5.0 (Linux; Android 9; SM-T835) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    isMobile: true,
    hasTouch: true,
  });
  const pageErrors = [];
  try {
    await context.route("**/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js", (route) => route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: WC_DEFERRED_INIT_MOCK_MODULE,
    }));
    await context.route("https://eth.llamarpc.com/**", async (route) => {
      let payload;
      try {
        payload = route.request().postDataJSON();
      } catch {
        return route.abort();
      }
      const respond = (item) => ({ jsonrpc: "2.0", id: item.id, result: `0x${"0".repeat(64)}` });
      const body = Array.isArray(payload) ? payload.map(respond) : respond(payload);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/web3/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.IFRWallet && typeof window.IFRWallet.cancelWalletConnect === "function");

    const button = page.locator(".nav-actions [data-wallet-connect]");
    const walletState = page.locator("[data-wallet-state]").first();
    const walletDialog = page.locator("[data-wallet-dialog]");
    const walletConnectOption = page.locator('[data-wallet-option="walletconnect"]');
    const mock = (fn) => page.evaluate(fn);

    await button.click();
    await walletConnectOption.click();
    await expect(walletDialog).toHaveClass(/is-open/);
    await expect.poll(() => mock(() => window.__wcMock && window.__wcMock.initCount())).toBe(1);

    // Cancel while init #1 is still pending: no provider exists yet.
    await page.locator("[data-wallet-dialog-close]").click();
    expect(await walletState.textContent()).toBe("Cancelled · retry");
    await expect(button).toBeEnabled();

    // Retry before the stale init resolves: it must start its own init
    // instead of joining the cancelled one.
    await button.click();
    await walletConnectOption.click();
    await expect.poll(() => mock(() => window.__wcMock.initCount())).toBe(2);

    // The late provider of the cancelled attempt is disconnected and never pairs.
    await mock(() => window.__wcMock.resolveInit(0));
    await expect.poll(() => mock(() => window.__wcMock.providerState()))
      .toEqual([{ id: 1, disconnected: true }]);
    expect(await mock(() => window.__wcMock.uriCount())).toBe(0);

    await mock(() => window.__wcMock.resolveInit(1));
    await expect.poll(() => mock(() => window.__wcMock.uriCount())).toBe(1);
    expect(await mock(() => window.__wcMock.pendingProviderId())).toBe(2);
    await page.evaluate((address) => window.__wcMock.approve(address, false), ACCOUNT);
    await expect(walletState).toContainText("Connected", { timeout: 10_000 });
    expect(await mock(() => window.IFRWallet.isConnected())).toBe(true);
    expect(await mock(() => window.__wcMock.providerState()))
      .toEqual([{ id: 1, disconnected: true }, { id: 2, disconnected: false }]);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("WalletConnect initialization can be retried after a transient loader failure", async ({ browser }) => {
  const context = await newRoutedContext(browser, { serviceWorkers: "block" });
  const warnings = [];
  try {
    await context.route("**/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: "export const unavailable = true;",
      });
    });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "warning" && message.text().includes("EthereumProvider not found")) warnings.push(message.text());
    });
    await page.goto("/web3/", { waitUntil: "domcontentloaded" });
    const results = await page.evaluate(async () => {
      const attempts = [];
      for (let index = 0; index < 2; index += 1) {
        try {
          await window.IFRWallet.connectWalletConnect();
          attempts.push("connected");
        } catch (error) {
          attempts.push(error.message);
        }
      }
      return attempts;
    });
    expect(results).toEqual(["NO_WALLETCONNECT", "NO_WALLETCONNECT"]);
    expect(warnings).toHaveLength(2);
  } finally {
    await context.close();
  }
});

test("WalletConnect session authorizes ethers message signing", () => {
  const source = readFileSync("docs/web3-wallet-core.js", "utf8");
  expect(source).toContain('methods: ["eth_sendTransaction", "personal_sign"]');
});

test("Web3 connect flow uses the guarded wallet-state loader", () => {
  const source = readFileSync("docs/web3/index.html", "utf8");
  expect(source).toContain("await loadConnectedWallet(address);");
  expect(source).not.toContain("const state = await IFRState.load(address);\n        renderState(state);");
});

test("persisted WalletConnect wrong-network recovery fails closed without an unhandled rejection", async ({ browser }) => {
  const context = await newRoutedContext(browser, { serviceWorkers: "block" });
  const pageErrors = [];
  try {
    await context.route("**/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: `
          const listeners = new Map();
          const provider = {
            session: { topic: "test-session" },
            accounts: ["${ACCOUNT}"],
            enable: async () => ["${ACCOUNT}"],
            request: async ({ method }) => {
              if (method === "eth_chainId") return "0xaa36a7";
              if (method === "wallet_switchEthereumChain") {
                const error = new Error("User rejected network switch");
                error.code = 4001;
                throw error;
              }
              return null;
            },
            on: (event, listener) => listeners.set(event, listener),
            removeListener: (event) => listeners.delete(event),
            disconnect: async () => null,
          };
          window.__wcTestEmit = (event) => {
            const listener = listeners.get(event);
            if (listener) listener();
          };
          export const EthereumProvider = { init: async () => provider };
        `,
      });
    });

    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/web3/", { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => typeof window.IFRWallet)).toBe("object");

    const connectCode = await page.evaluate(async () => {
      try {
        await window.IFRWallet.connect();
        return "NO_ERROR";
      } catch (error) {
        return error.code || error.message;
      }
    });
    expect(connectCode).toBe("WRONG_NETWORK");

    await page.evaluate(() => window.__wcTestEmit("connect"));
    await page.waitForTimeout(100);
    const recovered = await page.evaluate(async () => {
      localStorage.setItem("ifr_web3_wallet_connected", "0x3333333333333333333333333333333333333333");
      return window.IFRWallet.autoReconnect();
    });

    expect(recovered).toBe(false);
    expect(await page.evaluate(() => window.IFRWallet.isConnected())).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem("ifr_web3_wallet_connected"))).toBeNull();
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("IFRLock exact approve and typed lock submit only on Mainnet", async ({ browser }) => {
  const { context, page, writes, pageErrors } = await preparePage(browser);
  await page.goto("/web3/?action=access-lock", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-access-lock-dialog]")).toHaveClass(/is-open/);
  await selectInjectedWallet(page);
  await page.locator("[data-access-lock-amount]").fill("1000");
  await page.locator("[data-access-lock-type]").selectOption("premium");
  await page.locator("[data-access-lock-submit]").click();
  await expect.poll(() => writes.length, { timeout: 15_000 }).toBe(2);
  expect(writes.map(({ action, amount }) => ({ action, amount }))).toEqual([
    { action: "approve", amount: 1000n * UNIT },
    { action: "access-lock", amount: 1000n * UNIT },
  ]);
  expect(await page.evaluate(() => window.__web3TestChainId)).toBe("0x1");
  expect(pageErrors).toEqual([]);
  await context.close();
});

test("existing IFRLock balance can be unlocked without another approval", async ({ browser }) => {
  const { context, page, writes, pageErrors } = await preparePage(browser, { locked: 1000n * UNIT });
  await page.goto("/web3/?action=access-lock", { waitUntil: "domcontentloaded" });
  await selectInjectedWallet(page);
  await expect(page.locator("[data-access-lock-unlock]")).toBeEnabled();
  await page.locator("[data-access-lock-unlock]").click();
  await expect.poll(() => writes.length, { timeout: 15_000 }).toBe(1);
  expect(writes[0].action).toBe("access-unlock");
  expect(pageErrors).toEqual([]);
  await context.close();
});

// T-273: LendingVault V1 was retired by owner decision (3 October 2026). The former
// lending-create assertion is replaced on purpose: the create/increase path must now send no
// transaction at all, while the lender withdraw path must still send withdrawOffer for the
// full available amount.
test("CommitmentVault time-only writes preserve IFR base units; retired LendingVault refuses new offers and keeps full withdraw (T-273)", async ({ browser }) => {
  const { context, page, writes, pageErrors } = await preparePage(browser, { feeExemptV2: true, lenderOffer: true });
  await page.goto("/web3/", { waitUntil: "domcontentloaded" });
  await connect(page);

  await page.locator("[data-open-lock]").first().click();
  await page.locator("[data-lock-amount]").fill("250");
  await page.locator("[data-lock-submit]").click();
  await expect.poll(() => writes.length, { timeout: 15_000 }).toBe(2);
  expect(writes[0].action).toBe("approve");
  expect(writes[0].amount).toBe(250n * UNIT);
  expect(writes[1].action).toBe("commitment-lock-v2");
  expect(writes[1].amount).toBe(250n * UNIT);

  await page.locator("[data-lock-close]").click();
  // No visible entry point still offers to create or increase an offer.
  await expect(page.getByRole("button", { name: /create offer|increase offer/i })).toHaveCount(0);
  await page.locator("[data-open-lending]").first().click();
  await expect(page.locator("#lending-title")).toHaveText("Withdraw offer");
  await expect(page.locator("[data-lending-retired]")).toContainText("V1 retired by owner decision (3 October 2026)");
  await expect(page.locator("[data-lending-retired]")).toContainText("those IFR are not lost");
  await expect(page.locator("[data-lending-deposit]")).toBeHidden();
  await expect(page.locator("[data-lending-mode]")).toHaveValue("Offer #0 active");

  // Even if the hidden, disabled create path is re-enabled and triggered, it refuses before any wallet call.
  await page.locator("[data-lending-amount]").fill("500");
  await expect(page.locator("[data-lending-deposit]")).toBeDisabled();
  await page.locator("[data-lending-deposit]").evaluate((button) => {
    button.hidden = false;
    button.disabled = false;
    button.click();
  });
  await expect(page.locator("[data-lending-status]")).toContainText("LendingVault V1 is retired");
  await page.waitForTimeout(500);
  expect(writes.length).toBe(2);
  expect(writes.some((write) => /^lending-(create|increase)$/.test(write.action))).toBe(false);

  // Withdraw of the full available amount still sends withdrawOffer, with no approval.
  await page.locator("[data-lending-max]").click();
  await expect(page.locator("[data-lending-amount]")).toHaveValue("1000.0");
  await expect(page.locator("[data-lending-withdraw]")).toBeEnabled();
  await page.locator("[data-lending-withdraw]").click();
  await expect.poll(() => writes.length, { timeout: 15_000 }).toBe(3);
  expect(writes[2].action).toBe("lending-withdraw");
  expect(writes[2].amount).toBe(1000n * UNIT);
  expect(pageErrors).toEqual([]);
  await context.close();
});

test("CommitmentVault V1 offers only TIME_ONLY and refuses forged price conditions before any wallet write (CV-01)", async ({ browser }) => {
  const { context, page, writes, pageErrors } = await preparePage(browser, { feeExemptV2: true });
  await page.goto("/web3/", { waitUntil: "domcontentloaded" });
  await connect(page);
  await page.locator("[data-open-lock]").first().click();

  const condition = page.locator("[data-lock-condition]");
  await expect(condition.locator("option")).toHaveCount(1);
  await expect(condition.locator("option")).toHaveAttribute("value", "0");
  await expect(page.locator("[data-price-locks-disabled]")).toContainText("Price-based locks are disabled");

  for (const forged of ["1", "2", "3"]) {
    await condition.evaluate((select, value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = `forged ${value}`;
      select.appendChild(option);
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }, forged);
    await page.locator("[data-lock-amount]").fill("250");
    await page.locator("[data-lock-submit]").click();
    await expect(page.locator("[data-lock-status]")).toContainText("Price-based locks are disabled", { timeout: 10_000 });
  }
  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
  await context.close();
});

test("wiki CommitmentVault widget exposes only TIME_ONLY and pins cType 0 at the lock call (CV-01)", async ({ browser }) => {
  const context = await newRoutedContext(browser, { serviceWorkers: "block" });
  const page = await context.newPage();
  await page.goto("/wiki/commitment-vault.html", { waitUntil: "domcontentloaded" });
  const condition = page.locator("#cv-condition-type");
  await expect(condition.locator("option")).toHaveCount(1);
  await expect(condition.locator("option")).toHaveAttribute("value", "0");
  await expect(page.locator("#cv-price-disabled-banner")).toBeVisible();
  await expect(page.locator("#cv-price-disabled-banner")).toContainText("Price-based locks are disabled");
  await expect(page.locator("#cv-price-disabled-notice")).toContainText("Price-based locks are disabled");
  await expect(page.locator("body")).not.toContainText("lock widget below is functional");
  const source = readFileSync("docs/wiki/commitment-vault.html", "utf8");
  expect(source).toContain('if (cType !== 0) throw new Error("Price-based locks are disabled');
  expect(source).toContain("cv.lock(plan.amounts[i], 0, plan.unlockTime, 0)");
  expect(source).not.toMatch(/<option value="[123]">[A-D]\) (Price|Time OR|Time AND)/);
  const web3 = readFileSync("docs/web3/index.html", "utf8");
  expect(web3).toContain("commitmentV2.lock(plan.amounts[i], 0, plan.unlockTime, 0)");
  expect(web3).not.toMatch(/commitmentV1\.lock\(/);
  expect(source).toContain('var cv = new ethers.Contract(CV_V2_ADDR, CV_ABI, cvSigner);');
  expect(source).toContain("token.approve(CV_V2_ADDR, plan.totalAmount)");
  expect(source).not.toMatch(/approve\(CV_V1_ADDR/);
  // Static copy before any wallet read: V2 is fee-exempt since #17, but the button still waits for the on-chain read (T-262 D4).
  await expect(page.locator("#cv-v2-gate")).toContainText("CommitmentVault V2 is fee-exempt since Governance proposal #17");
  await expect(page.locator("#cv-v2-gate")).toContainText("only after a connected wallet reads feeExempt(V2) as true on-chain");
  await expect(page.locator("#cv-lock-btn")).toBeDisabled();
  expect(web3).toContain("<p class=\"protocol-note\" data-lock-note>CommitmentVault V2 is fee-exempt since Governance proposal #17.");
  expect(web3).not.toContain("The lock button stays disabled until Governance proposal #17 is executed");
  expect(web3).not.toContain("Price-condition locks are available");
  await context.close();
});

for (const [label, feeExemptV2] of [["fee exemption not executed", false], ["fee exemption unreadable", "error"]]) {
  test(`CommitmentVault V2 locking stays disabled with no V1 fallback when the ${label} (T-220)`, async ({ browser }) => {
    const { context, page, writes, pageErrors } = await preparePage(browser, { feeExemptV2 });
    await page.goto("/web3/", { waitUntil: "domcontentloaded" });
    await connect(page);
    await page.locator("[data-open-lock]").first().click();
    await expect(page.locator("[data-lock-status]")).toContainText("New CommitmentVault V2 time locks stay disabled until this app confirms feeExempt(V2) on-chain", { timeout: 15_000 });
    await expect(page.locator("[data-lock-submit]")).toBeDisabled();
    await expect(page.locator("[data-lock-note]")).toContainText("Governance proposal #17");
    await page.locator("[data-lock-amount]").fill("250");
    await page.locator("[data-lock-submit]").evaluate((button) => { button.disabled = false; button.click(); });
    await expect(page.locator("[data-lock-status]")).toContainText("New CommitmentVault V2 time locks stay disabled", { timeout: 10_000 });
    expect(writes).toEqual([]);
    expect(pageErrors).toEqual([]);
    await context.close();
  });
}

test("CommitmentVault V2 approve and lock target V2 with cType 0 once the fee exemption is active (T-220)", async ({ browser }) => {
  const { context, page, writes, pageErrors } = await preparePage(browser, { feeExemptV2: true });
  await page.goto("/web3/", { waitUntil: "domcontentloaded" });
  await connect(page);
  await page.locator("[data-open-lock]").first().click();
  await expect(page.locator("[data-lock-submit]")).toBeEnabled({ timeout: 15_000 });
  await page.locator("[data-lock-amount]").fill("100");
  await page.locator("[data-lock-submit]").click();
  await expect.poll(() => writes.length, { timeout: 15_000 }).toBe(2);
  expect(writes[0].action).toBe("approve");
  expect(String(writes[0].data).toLowerCase()).toContain(COMMITMENT_V2.slice(2).toLowerCase());
  expect(writes[1]).toMatchObject({ action: "commitment-lock-v2", amount: 100n * UNIT, cType: 0n, p0Multiplier: 0n });
  expect(writes.some((w) => w.action === "commitment-lock")).toBe(false);
  expect(pageErrors).toEqual([]);
  await context.close();
});

test("existing CommitmentVault V1 time tranche still unlocks through V1 while V2 is closed (T-220)", async ({ browser }) => {
  const { context, page, writes, pageErrors } = await preparePage(browser, { v1Tranche: true });
  await page.goto("/web3/", { waitUntil: "domcontentloaded" });
  await connect(page);
  await page.locator("[data-open-lock]").first().click();
  const unlock = page.locator('[data-unlock-vault="v1"][data-unlock-tranche="0"]');
  await expect(unlock).toBeEnabled({ timeout: 15_000 });
  await expect(page.locator("[data-lock-tranches]")).toContainText("V1 · Tranche #0");
  await unlock.click();
  await expect.poll(() => writes.length, { timeout: 15_000 }).toBe(1);
  expect(writes[0]).toMatchObject({ action: "commitment-unlock-v1", amount: 0n });
  expect(pageErrors).toEqual([]);
  await context.close();
});

for (const feeExemptV2 of [false, true]) {
  test(`wiki CommitmentVault widget gates new locks on feeExempt(V2)=${feeExemptV2} and lists V1 tranches (T-220)`, async ({ browser }) => {
    const { context, page, writes, pageErrors } = await preparePage(browser, { feeExemptV2, v1Tranche: true });
    await page.goto("/wiki/commitment-vault.html", { waitUntil: "domcontentloaded" });
    await page.locator("#cv-connect-btn").click();
    const injected = page.locator('[data-wallet-option-type="injected"]').first();
    if (await injected.isVisible().catch(() => false)) await injected.click();
    await expect(page.locator("#cv-tranches-list")).toContainText("V1 · Tranche #0", { timeout: 15_000 });
    await page.locator("#cv-amount").fill("100");
    await page.locator("#cv-amount").dispatchEvent("input");
    if (feeExemptV2) {
      await expect(page.locator("#cv-lock-btn")).toBeEnabled();
      await expect(page.locator("#cv-v2-gate")).toContainText("New time locks go to CommitmentVault V2");
      await page.locator("#cv-lock-btn").click();
      await expect.poll(() => writes.length, { timeout: 15_000 }).toBe(2);
      expect(writes[0].action).toBe("approve");
      expect(String(writes[0].data).toLowerCase()).toContain(COMMITMENT_V2.slice(2).toLowerCase());
      expect(writes[1]).toMatchObject({ action: "commitment-lock-v2", amount: 100n * UNIT, cType: 0n, p0Multiplier: 0n });
    } else {
      await expect(page.locator("#cv-lock-btn")).toBeDisabled();
      await expect(page.locator("#cv-v2-gate")).toContainText("New CommitmentVault V2 time locks stay disabled until this app confirms feeExempt(V2) on-chain");
      await page.locator("#cv-lock-btn").evaluate((button) => { button.disabled = false; button.click(); });
      await page.waitForTimeout(1500);
      expect(writes).toEqual([]);
      await page.locator('[data-unlock-vault="v1"][data-unlock-tranche="0"]').click();
      await expect.poll(() => writes.length, { timeout: 15_000 }).toBe(1);
      expect(writes[0]).toMatchObject({ action: "commitment-unlock-v1" });
    }
    expect(pageErrors).toEqual([]);
    await context.close();
  });
}

// T-240: V1 warning above the V1 area, V2 as the only path for new TIME_ONLY locks, V1 exits preserved.
async function expectStackedAbove(page, selectors) {
  const boxes = [];
  for (const selector of selectors) {
    const box = await page.locator(selector).first().boundingBox();
    expect(box, `${selector} must be rendered`).not.toBeNull();
    boxes.push({ selector, ...box });
  }
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i - 1].y + boxes[i - 1].height, `${boxes[i - 1].selector} above ${boxes[i].selector}`).toBeLessThanOrEqual(boxes[i].y + 0.5);
  }
}

test("landing wizard lock branch deep-links new time locks to the V2 entry, not a price or V1 form (T-240)", async ({ browser }) => {
  const { context, page, pageErrors } = await preparePage(browser);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.wzGo("lock"));
  const options = page.locator("#wz-box a.wz-option");
  const newLock = options.filter({ hasText: "New CommitmentVault time lock" });
  const manage = options.filter({ hasText: "Manage existing tranches" });
  await expect(newLock).toHaveCount(1);
  await expect(newLock).toHaveAttribute("href", "https://web3.ifrunit.tech/?action=commitment-lock#access");
  await expect(newLock).toContainText("CommitmentVault V2");
  await expect(manage).toHaveAttribute("href", "https://web3.ifrunit.tech/?action=commitment-lock#access");
  await expect(manage).toContainText("each unlocks through its own vault");
  const branchText = await page.locator("#wz-box").innerText();
  expect(branchText).not.toMatch(/price-|combined-|indefinite-lock|create .*price/i);
  expect(branchText).toContain("no price locks");
  expect(pageErrors).toEqual([]);
  await context.close();
});

test("web3 lock deep link opens the V2 entry under the V1 warning; V2 lock targets V2 and V1 unlock targets V1 (T-240)", async ({ browser }) => {
  const { context, page, writes, pageErrors } = await preparePage(browser, { feeExemptV2: true, v1Tranche: true });
  await page.goto("/web3/?action=commitment-lock#access", { waitUntil: "domcontentloaded" });
  await selectInjectedWallet(page);
  const dialog = page.locator("[data-lock-dialog]");
  await expect(dialog.locator("[data-v1-warning]")).toBeVisible({ timeout: 15_000 });
  await expect(dialog.locator("[data-v1-warning]")).toContainText("Do not create new CommitmentVault V1 locks");
  await expect(dialog.locator("[data-v1-warning]")).toContainText("can never unlock");
  await expect(dialog.locator("[data-v2-path]")).toContainText("New time locks: CommitmentVault V2 only");
  await expect(dialog.locator("[data-v2-path]")).toContainText("No price lock is available");
  await expect(dialog.locator("[data-lock-condition] option")).toHaveCount(1);
  await expect(dialog.locator("[data-lock-condition] option")).toHaveAttribute("value", "0");
  const unlockV1 = page.locator('[data-unlock-vault="v1"][data-unlock-tranche="0"]');
  await expect(unlockV1).toBeEnabled({ timeout: 15_000 });
  await expectStackedAbove(page, ["[data-lock-dialog] [data-v1-warning]", "[data-lock-dialog] [data-v2-path]", "[data-lock-dialog] .protocol-form", "[data-lock-tranches]"]);
  await expect(page.locator("[data-lock-submit]")).toBeEnabled({ timeout: 15_000 });
  await page.locator("[data-lock-amount]").fill("100");
  await page.locator("[data-lock-submit]").click();
  await expect.poll(() => writes.length, { timeout: 15_000 }).toBe(2);
  expect(writes[0].action).toBe("approve");
  expect(String(writes[0].data).toLowerCase()).toContain(COMMITMENT_V2.slice(2).toLowerCase());
  expect(writes[1]).toMatchObject({ action: "commitment-lock-v2", amount: 100n * UNIT, cType: 0n, p0Multiplier: 0n });
  expect(String(writes[1].to).toLowerCase()).toBe(COMMITMENT_V2.toLowerCase());
  await expect(page.locator('[data-unlock-vault="v1"][data-unlock-tranche="0"]')).toBeEnabled({ timeout: 15_000 });
  await page.locator('[data-unlock-vault="v1"][data-unlock-tranche="0"]').click();
  await expect.poll(() => writes.length, { timeout: 15_000 }).toBe(3);
  expect(writes[2]).toMatchObject({ action: "commitment-unlock-v1" });
  expect(String(writes[2].to).toLowerCase()).toBe(COMMITMENT.toLowerCase());
  expect(writes.some((w) => w.action === "commitment-lock")).toBe(false);
  expect(pageErrors).toEqual([]);
  await context.close();
});

for (const [label, options] of [
  ["feeExempt(V2) is false", { feeExemptV2: false }],
  ["feeExempt(V2) is unreadable", { feeExemptV2: "error" }],
  ["the read RPC reports the wrong chain", { feeExemptV2: true, readChainId: "0x5" }],
  ["the wallet stays on the wrong chain", { feeExemptV2: true, chainId: "0x5", rejectSwitch: true }],
]) {
  test(`web3 V2 approval and lock stay blocked when ${label}; the V1 warning stays visible (T-240)`, async ({ browser }) => {
    const { context, page, writes, pageErrors } = await preparePage(browser, { v1Tranche: true, ...options });
    await page.goto("/web3/?action=commitment-lock#access", { waitUntil: "domcontentloaded" });
    await selectInjectedWallet(page).catch(() => null);
    await expect(page.locator("[data-lock-dialog] [data-v1-warning]")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    await expect(page.locator("[data-lock-submit]")).toBeDisabled();
    await page.locator("[data-lock-amount]").fill("100");
    await page.locator("[data-lock-submit]").evaluate((button) => { button.disabled = false; button.click(); });
    await page.waitForTimeout(1500);
    expect(writes).toEqual([]);
    // The forced click re-enabled the button; a read-side gate closes it again, a wallet-side refusal throws first.
    if (!options.rejectSwitch) await expect(page.locator("[data-lock-submit]")).toBeDisabled();
    expect(pageErrors).toEqual([]);
    await context.close();
  });
}

test("wiki lock widget shows the V1 warning above the V2-only path and keeps price modes absent (T-240)", async ({ browser }) => {
  const { context, page, writes, pageErrors } = await preparePage(browser, { feeExemptV2: false, v1Tranche: true });
  await page.goto("/wiki/commitment-vault.html#lock-widget", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#cv-v1-warning")).toBeVisible();
  await expect(page.locator("#cv-v1-warning")).toContainText("Do not create new CommitmentVault V1 locks");
  await expect(page.locator("#cv-v2-path")).toContainText("New time locks: CommitmentVault V2 only");
  await expect(page.locator("#cv-condition-type option")).toHaveCount(1);
  await expect(page.locator("#cv-condition-type option")).toHaveAttribute("value", "0");
  await page.locator("#cv-connect-btn").click();
  const injected = page.locator('[data-wallet-option-type="injected"]').first();
  if (await injected.isVisible().catch(() => false)) await injected.click();
  await expect(page.locator("#cv-tranches-list")).toContainText("V1 · Tranche #0", { timeout: 15_000 });
  await expectStackedAbove(page, ["#cv-v1-warning", "#cv-v2-path", "#cv-connect-section", "#cv-config-section", "#cv-dashboard-section"]);
  await expect(page.locator("#cv-lock-btn")).toBeDisabled();
  await page.locator('[data-unlock-vault="v1"][data-unlock-tranche="0"]').click();
  await expect.poll(() => writes.length, { timeout: 15_000 }).toBe(1);
  expect(writes[0]).toMatchObject({ action: "commitment-unlock-v1" });
  expect(String(writes[0].to).toLowerCase()).toBe(COMMITMENT.toLowerCase());
  expect(pageErrors).toEqual([]);
  await context.close();
});

// MAX_TRANCHES (50) is per vault: a full V1 must not block a V2 lock, a full V2 must (T-240, CodeRabbit #188).
for (const [label, counts, allowed] of [
  ["a full V1 does not block a new V2 lock", { v1TrancheCount: 50n, v2TrancheCount: 0n }, true],
  ["a full V2 blocks a new V2 lock", { v1TrancheCount: 0n, v2TrancheCount: 50n }, false],
]) {
  test(`wiki tranche limit is checked against V2 only: ${label} (T-240)`, async ({ browser }) => {
    const { context, page, writes, pageErrors } = await preparePage(browser, { feeExemptV2: true, v1Tranche: true, ...counts });
    await page.goto("/wiki/commitment-vault.html", { waitUntil: "domcontentloaded" });
    await page.locator("#cv-connect-btn").click();
    const injected = page.locator('[data-wallet-option-type="injected"]').first();
    if (await injected.isVisible().catch(() => false)) await injected.click();
    await expect(page.locator("#cv-tranches-list")).toContainText("V1 · Tranche #0", { timeout: 15_000 });
    await page.locator("#cv-amount").fill("100");
    await page.locator("#cv-amount").dispatchEvent("input");
    await expect(page.locator("#cv-lock-btn")).toBeEnabled();
    await page.locator("#cv-lock-btn").click();
    if (allowed) {
      await expect.poll(() => writes.length, { timeout: 15_000 }).toBe(2);
      expect(writes[1]).toMatchObject({ action: "commitment-lock-v2", amount: 100n * UNIT, cType: 0n });
      expect(String(writes[1].to).toLowerCase()).toBe(COMMITMENT_V2.toLowerCase());
    } else {
      await expect(page.locator("#cv-lock-status")).toContainText("50 tranche limit", { timeout: 15_000 });
      expect(writes).toEqual([]);
    }
    expect(pageErrors).toEqual([]);
    await context.close();
  });
}

test("LendingVault borrowing remains transaction-disabled while price is zero", async ({ browser }) => {
  const { context, page, writes, pageErrors } = await preparePage(browser, { offerAvailable: true });
  await page.goto("/web3/?action=borrow", { waitUntil: "domcontentloaded" });
  await selectInjectedWallet(page);
  await expect(page.locator("[data-borrow-offer] option")).toHaveCount(1);
  await expect(page.locator("[data-borrow-offer-count]")).toHaveText("1 / 1");
  await expect(page.locator("[data-borrow-price]")).toHaveText("Disabled");
  await expect(page.locator("[data-borrow-submit]")).toBeDisabled();
  await expect(page.locator("[data-borrow-status]")).toContainText("disabled");
  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
  await context.close();
});

test("Web3 runtime uses the self-hosted Ethers asset", async ({ browser }) => {
  const context = await newRoutedContext(browser, { serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    const externalEthersRequests = [];
    page.on("request", (request) => {
      if (/cdn\.jsdelivr\.net\/npm\/ethers/i.test(request.url())) externalEthersRequests.push(request.url());
    });
    await page.goto("/web3/", { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => typeof window.ethers)).toBe("object");
    expect(externalEthersRequests).toEqual([]);
    await expect(page.locator('script[src="/assets/vendor/ethers-6.17.0.umd.min.js"]')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => window.ethers.version)).toBe("6.17.0");
  } finally {
    await context.close();
  }
});

test("self-hosted Ethers asset matches the published 6.17.0 bundle", () => {
  const asset = readFileSync("docs/assets/vendor/ethers-6.17.0.umd.min.js");
  expect(createHash("sha256").update(asset).digest("hex")).toBe(
    "532950515fd29ae9f7a21ceb2b68100815024d7944c3d5a92246d5b900bd703b",
  );
});

test("self-hosted WalletConnect artifact matches the recorded 2.25.0 build", () => {
  const asset = readFileSync("docs/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js");
  expect(createHash("sha256").update(asset).digest("hex")).toBe(
    "77843c24c6c5aa5b4f743af3f2dd3a9d94e16b15bb8c5ff1bba58db2b14cd63e",
  );
});

test("self-hosted WalletConnect artifact executes in the browser and exposes EthereumProvider", async ({ browser }) => {
  const context = await newRoutedContext(browser, { serviceWorkers: "block" });
  const pageErrors = [];
  try {
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/web3/", { waitUntil: "domcontentloaded" });
    const shape = await page.evaluate(async () => {
      const mod = await import("/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js");
      const EthereumProvider = mod.EthereumProvider || mod.default;
      return {
        hasExport: Boolean(EthereumProvider),
        hasInit: Boolean(EthereumProvider && typeof EthereumProvider.init === "function"),
      };
    });
    expect(shape).toEqual({ hasExport: true, hasInit: true });
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("WalletConnect connect loads the provider only from the pinned same-origin artifact", async ({ browser }) => {
  const context = await newRoutedContext(browser, { serviceWorkers: "block" });
  const pageErrors = [];
  try {
    const artifactRequests = [];
    const thirdPartyScriptRequests = [];
    await context.route("**/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js", async (route) => {
      artifactRequests.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: `
          const provider = {
            session: null,
            accounts: ["${ACCOUNT}"],
            enable: async () => ["${ACCOUNT}"],
            request: async ({ method }) => {
              if (method === "eth_chainId") return "0x1";
              if (method === "eth_accounts" || method === "eth_requestAccounts") return ["${ACCOUNT}"];
              if (method === "net_version") return "1";
              if (method === "eth_blockNumber") return "0x1";
              if (method === "eth_getBalance") return "0x0";
              if (method === "eth_call") return "0x" + "00".repeat(32);
              return null;
            },
            on: () => {},
            removeListener: () => {},
            disconnect: async () => null,
          };
          export const EthereumProvider = { init: async () => provider };
        `,
      });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => {
      const url = request.url();
      if (request.resourceType() === "script" && !url.startsWith("http://localhost:8787")) {
        thirdPartyScriptRequests.push(url);
      }
      if (/esm\.sh|jsdelivr|unpkg|cdnjs/i.test(url)) thirdPartyScriptRequests.push(url);
    });
    await page.goto("/web3/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => { delete window.ethereum; });
    const address = await page.evaluate(() => window.IFRWallet.connectWalletConnect());
    expect(address).toBe(ACCOUNT);
    expect(artifactRequests).toEqual(["http://localhost:8787/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js"]);
    expect(thirdPartyScriptRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("Add IFR to wallet submits the canonical token metadata", async ({ browser }) => {
  const { context, page, writes, pageErrors } = await preparePage(browser);
  await page.goto("/web3/", { waitUntil: "domcontentloaded" });
  await connect(page);
  await page.locator("[data-add-token]").click();
  await expect(page.locator("[data-wallet-state]").first()).toHaveText("Token added");
  const watchAssets = await page.evaluate(() => window.__web3WatchAssets);
  expect(watchAssets).toHaveLength(1);
  expect(watchAssets[0].type).toBe("ERC20");
  expect(ethers.getAddress(watchAssets[0].options.address)).toBe(ethers.getAddress(TOKEN));
  expect({ ...watchAssets[0].options, address: undefined }).toEqual({
    address: undefined,
    symbol: "IFR",
    decimals: 9,
    image: "https://ifrunit.tech/assets/ifr_icon_256.png",
  });
  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
  await context.close();
});

test("Android 9 stays in browser mode instead of launching an incompatible WebAPK", async ({ browser }) => {
  const context = await newRoutedContext(browser, {
    viewport: { width: 360, height: 640 },
    userAgent: "Mozilla/5.0 (Linux; Android 9; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  });
  const page = await context.newPage();
  await page.goto("/web3/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    window.__web3LegacyInstallPrompted = false;
    const event = new Event("beforeinstallprompt");
    event.prompt = async () => { window.__web3LegacyInstallPrompted = true; };
    event.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
    window.dispatchEvent(event);
  });
  const installButton = page.locator("[data-install-app]:visible").first();
  await expect(installButton).toHaveText("App requirements");
  await installButton.click();
  await expect(page.locator("[data-install-copy]")).toContainText("remains fully usable in this browser tab");
  expect(await page.evaluate(() => window.__web3LegacyInstallPrompted)).toBe(false);
  await context.close();
});

test("Web3 service worker bounds offline navigation before using the cache", () => {
  const source = readFileSync("docs/web3-sw.js", "utf8");
  const html = readFileSync("docs/web3/index.html", "utf8");
  expect(source).toContain('const CACHE_NAME = "ifr-web3-v22"');
  expect(source).toContain('"/web3-wallet-core.js?v=20261004-rpc-fallback-v6"');
  expect(html).toContain('<script src="/web3-wallet-core.js?v=20261004-rpc-fallback-v6"></script>');
  expect(html).toContain('updateViaCache: "none"');
  expect(source).toContain("const NAVIGATION_TIMEOUT_MS = 5000");
  expect(source).toContain("fetchNavigation(request)");
  expect(source).toContain('fetch(request, { cache: "no-store", signal: controller.signal })');
  expect(source).toContain("if (response.ok)");
  expect(source).toContain("event.waitUntil(navigationResponse");
});

test("Web3 app shell reloads from the service-worker cache while offline", async ({ browser }) => {
  const context = await newRoutedContext(browser, { serviceWorkers: "allow" });
  const page = await context.newPage();
  await page.goto("/web3/", { waitUntil: "networkidle" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("h1")).toContainText("Lock IFR");
  await context.setOffline(false);
  await context.close();
});

/* ──────────────────────────────────────────────────────────
   T-121 header regression: the single-row nav band above
   980px let .nav-links shrink (min-width: 0) and paint its
   centered links over the brand tags and the install button
   ("$IFRp" / "Add to Home Screen" overlap on iPad widths).
   ────────────────────────────────────────────────────────── */
const IPAD_UA =
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1";

const HEADER_CASES = [
  { name: "1280x800", width: 1280, height: 800, ua: IPAD_UA },
  { name: "820x1180", width: 820, height: 1180, ua: IPAD_UA },
  { name: "1180x820", width: 1180, height: 820, ua: IPAD_UA },
  { name: "768x1024", width: 768, height: 1024, ua: IPAD_UA },
  { name: "1024x768", width: 1024, height: 768, ua: IPAD_UA },
  { name: "390x844", width: 390, height: 844, ua: IPHONE_UA },
];

function measureHeaderGeometry() {
  const items = [];
  const push = (name, el) => {
    if (!el) return;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || cs.display === "none" || cs.visibility === "hidden") return;
    items.push({ name, left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height });
  };
  push("brand", document.querySelector(".nav .brand"));
  document.querySelectorAll(".nav .nav-links a").forEach((a, index) => push(`link-${index}`, a));
  document.querySelectorAll(".nav .nav-actions > *").forEach((el, index) => push(`action-${index}`, el));
  const overlaps = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (x > 0.5 && y > 0.5) overlaps.push(`${a.name} x ${b.name}`);
    }
  }
  const install = document.querySelector(".nav-actions [data-install-app]");
  const installRect = install ? install.getBoundingClientRect() : { width: 0 };
  return {
    innerWidth: window.innerWidth,
    pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
    overlaps,
    actionHeights: items.filter((item) => item.name.startsWith("action-")).map((item) => item.height),
    installVisible: Boolean(install && !install.hidden && installRect.width > 0 && getComputedStyle(install).display !== "none"),
    installLabel: install ? install.textContent.trim() : null,
  };
}

for (const standalone of [false, true]) {
  for (const device of HEADER_CASES) {
    test(`Web3 header shows no overlap or overflow at ${device.name} (${standalone ? "standalone" : "browser tab"})`, async ({ browser }) => {
      const context = await newRoutedContext(browser, {
        viewport: { width: device.width, height: device.height },
        userAgent: device.ua,
        hasTouch: true,
        isMobile: true,
        serviceWorkers: "block",
      });
      if (standalone) {
        await context.addInitScript(() => {
          Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true });
        });
      }
      const page = await context.newPage();
      await page.goto("/web3/", { waitUntil: "domcontentloaded" });
      await expect(page.locator(".nav-actions [data-wallet-connect]")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(measureHeaderGeometry);
      expect(geometry.innerWidth).toBe(device.width);
      expect(geometry.overlaps).toEqual([]);
      expect(geometry.pageOverflow).toBeLessThanOrEqual(0);
      for (const height of geometry.actionHeights) expect(height).toBeGreaterThanOrEqual(44);
      if (standalone) {
        expect(geometry.installVisible).toBe(false);
      } else if (device.width > 680) {
        expect(geometry.installVisible).toBe(true);
        expect(geometry.installLabel).toBe("Add to Home Screen");
      }
      await context.close();
    });
  }
}

/* ──────────────────────────────────────────────────────────
   T-121 wallet regression: WalletConnect module load failures
   must surface an honest, recoverable error.
   Class 1 (fetch failure): the browser caches a failed dynamic
   import for the document lifetime, so recovery is a reload —
   the failure must not poison anything else.
   Class 2 (init failure, e.g. storage unavailable): the module
   stays cached, so the next user tap must retry init instead of
   serving the permanently cached null.
   ────────────────────────────────────────────────────────── */
const WC_GOOD_MODULE = `
  const provider = {
    session: null,
    accounts: [],
    enable: async () => {
      provider.accounts = ["${ACCOUNT}"];
      return provider.accounts;
    },
    request: async ({ method }) => {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return provider.accounts;
      if (method === "eth_chainId") return "0x1";
      if (method === "net_version") return "1";
      if (method === "eth_getBalance") return "0x0";
      if (method === "eth_blockNumber") return "0x10";
      if (method === "eth_call") return "0x" + "0".repeat(64);
      return null;
    },
    on: () => {},
    removeListener: () => {},
    disconnect: async () => null,
  };
  export const EthereumProvider = { init: async () => provider };
`;

const WC_FLAKY_INIT_MODULE = `
  let initAttempts = 0;
  ${WC_GOOD_MODULE.replace("export const EthereumProvider = { init: async () => provider };", `
  export const EthereumProvider = {
    init: async () => {
      initAttempts += 1;
      if (initAttempts === 1) throw new Error("transient init failure");
      return provider;
    },
  };`)}
`;

async function routeWalletConnectModule(context, shouldFail, body) {
  await context.route("**/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js", async (route) => {
    if (shouldFail()) return route.abort();
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      headers: { "Access-Control-Allow-Origin": "*" },
      body,
    });
  });
}

test("WalletConnect fetch failure shows an honest error and recovers after reload", async ({ browser }) => {
  const context = await newRoutedContext(browser, { serviceWorkers: "block" });
  const pageErrors = [];
  let failImport = true;
  try {
    await routeWalletConnectModule(context, () => failImport, WC_GOOD_MODULE);
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/web3/", { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => typeof window.IFRWallet)).toBe("object");

    await page.locator("[data-wallet-connect]").first().click();
    await page.locator('[data-wallet-option="walletconnect"]').click();
    await expect(page.locator("#ifr-wallet-help-modal")).toBeVisible();
    await expect(page.locator("[data-wallet-state]").first()).toHaveText("Connect failed");
    expect(await page.evaluate(() => window.IFRWallet.isConnected())).toBe(false);

    failImport = false;
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => typeof window.IFRWallet)).toBe("object");
    await page.locator("[data-wallet-connect]").first().click();
    await page.locator('[data-wallet-option="walletconnect"]').click();
    await expect(page.locator("[data-wallet-state]").first()).toContainText("Connected", { timeout: 10_000 });
    expect(await page.evaluate(() => window.IFRWallet.isConnected())).toBe(true);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("WalletConnect init failure stays recoverable on the next attempt", async ({ browser }) => {
  const context = await newRoutedContext(browser, { serviceWorkers: "block" });
  const pageErrors = [];
  try {
    await routeWalletConnectModule(context, () => false, WC_FLAKY_INIT_MODULE);
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/web3/", { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => typeof window.IFRWallet)).toBe("object");

    // First attempt: init throws once — honest fallback, no connection.
    await page.locator("[data-wallet-connect]").first().click();
    await page.locator('[data-wallet-option="walletconnect"]').click();
    await expect(page.locator("#ifr-wallet-help-modal")).toBeVisible();
    await expect(page.locator("[data-wallet-state]").first()).toHaveText("Connect failed");
    expect(await page.evaluate(() => window.IFRWallet.isConnected())).toBe(false);
    await page.locator("#ifr-wallet-help-close").click();
    await expect(page.locator("#ifr-wallet-help-modal")).toHaveCount(0);

    // The next user tap must retry init (module itself stays cached).
    await page.locator("[data-wallet-connect]").first().click();
    await page.locator('[data-wallet-option="walletconnect"]').click();
    await expect(page.locator("[data-wallet-state]").first()).toContainText("Connected", { timeout: 10_000 });
    expect(await page.evaluate(() => window.IFRWallet.isConnected())).toBe(true);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

// Codex review of #188: feeExempt(V2) is re-read fail-closed before EVERY approve/lock, and a change
// after approval or between tranches aborts the remaining sequence (frontend cannot make it atomic).
for (const [label, flip, split, expected] of [
  ["turns false after the approval", { afterSends: 1, to: false }, false, ["approve"]],
  ["becomes unreadable after the approval", { afterSends: 1, to: "error" }, false, ["approve"]],
  ["turns false between two tranches", { afterSends: 2, to: false }, true, ["approve", "commitment-lock-v2"]],
]) {
  test(`web3 V2 lock sequence stops when feeExempt(V2) ${label} (T-220)`, async ({ browser }) => {
    const { context, page, writes, pageErrors } = await preparePage(browser, { feeExemptV2: true, feeExemptFlip: flip });
    await page.goto("/web3/", { waitUntil: "domcontentloaded" });
    await connect(page);
    await page.locator("[data-open-lock]").first().click();
    await expect(page.locator("[data-lock-submit]")).toBeEnabled({ timeout: 15_000 });
    await page.locator("[data-lock-amount]").fill("100");
    if (split) await page.locator("[data-lock-split]").check();
    await page.locator("[data-lock-submit]").click();
    await expect(page.locator("[data-lock-status]")).toContainText("New CommitmentVault V2 time locks stay disabled", { timeout: 15_000 });
    await page.waitForTimeout(1000);
    expect(writes.map((w) => w.action)).toEqual(expected);
    await expect(page.locator("[data-lock-submit]")).toBeDisabled();
    await expect(page.locator("[data-lock-note]")).toContainText("New CommitmentVault V2 time locks stay disabled");
    expect(pageErrors).toEqual([]);
    await context.close();
  });
}

test("web3 V2 split lock proceeds through all tranches while feeExempt(V2) stays true (T-220)", async ({ browser }) => {
  const { context, page, writes, pageErrors } = await preparePage(browser, { feeExemptV2: true });
  await page.goto("/web3/", { waitUntil: "domcontentloaded" });
  await connect(page);
  await page.locator("[data-open-lock]").first().click();
  await expect(page.locator("[data-lock-submit]")).toBeEnabled({ timeout: 15_000 });
  await page.locator("[data-lock-amount]").fill("100");
  await page.locator("[data-lock-split]").check();
  await page.locator("[data-lock-submit]").click();
  await expect.poll(() => writes.length, { timeout: 30_000 }).toBe(11);
  expect(writes[0].action).toBe("approve");
  expect(writes.slice(1).every((w) => w.action === "commitment-lock-v2" && w.cType === 0n)).toBe(true);
  expect(pageErrors).toEqual([]);
  await context.close();
});

test("web3 lock button closes when a panel refresh fails after V2 was open (T-220)", async ({ browser }) => {
  const { context, page, pageErrors } = await preparePage(browser, { feeExemptV2: true });
  await page.goto("/web3/", { waitUntil: "domcontentloaded" });
  await connect(page);
  await page.locator("[data-open-lock]").first().click();
  await expect(page.locator("[data-lock-submit]")).toBeEnabled({ timeout: 15_000 });
  await page.evaluate(() => { window.ethereum.request = async () => { throw new Error("rpc down (test)"); }; });
  await page.locator("[data-lock-refresh]").click();
  await expect(page.locator("[data-lock-submit]")).toBeDisabled({ timeout: 15_000 });
  expect(pageErrors).toEqual([]);
  await context.close();
});

for (const [label, flip, split, expected] of [
  ["turns false after the approval", { afterSends: 1, to: false }, false, ["approve"]],
  ["turns false between two tranches", { afterSends: 2, to: false }, true, ["approve", "commitment-lock-v2"]],
  ["becomes unreadable between two tranches", { afterSends: 2, to: "error" }, true, ["approve", "commitment-lock-v2"]],
]) {
  test(`wiki V2 lock sequence stops when feeExempt(V2) ${label} (T-220)`, async ({ browser }) => {
    const { context, page, writes, pageErrors } = await preparePage(browser, { feeExemptV2: true, feeExemptFlip: flip });
    await page.goto("/wiki/commitment-vault.html", { waitUntil: "domcontentloaded" });
    await page.locator("#cv-connect-btn").click();
    const injected = page.locator('[data-wallet-option-type="injected"]').first();
    if (await injected.isVisible().catch(() => false)) await injected.click();
    await expect(page.locator("#cv-v2-gate")).toContainText("New time locks go to CommitmentVault V2", { timeout: 15_000 });
    await page.locator("#cv-amount").fill("100");
    await page.locator("#cv-amount").dispatchEvent("input");
    if (split) await page.locator("#cv-split-tranches").check();
    await expect(page.locator("#cv-lock-btn")).toBeEnabled();
    await page.locator("#cv-lock-btn").click();
    await expect(page.locator("#cv-v2-gate")).toContainText("New CommitmentVault V2 time locks stay disabled", { timeout: 15_000 });
    await page.waitForTimeout(1000);
    expect(writes.map((w) => w.action)).toEqual(expected);
    await expect(page.locator("#cv-lock-btn")).toBeDisabled();
    expect(pageErrors).toEqual([]);
    await context.close();
  });
}

test("connected-wallet summaries read through the chain-pinned read provider, never the wallet provider", async ({ browser }) => {
  const readLog = [];
  const { context, page, pageErrors } = await preparePage(browser, {
    locked: 5_000n * UNIT,
    // A compromised or wrong-network wallet provider answers with fake data; it must never be displayed.
    walletResultsOverride: { [selectors.accessLocked]: uintResult(999_999n * UNIT) },
    readLog,
  });
  try {
    await page.goto("/web3/", { waitUntil: "domcontentloaded" });
    await connect(page);
    await expect(page.locator("[data-access-lock-balance]")).toHaveText("5,000 IFR", { timeout: 15_000 });
    await expect(page.locator("[data-access-lock-note]")).toHaveText("Premium ready");
    const walletCalls = await page.evaluate(() => window.__web3RequestCounts.eth_call || 0);
    expect(walletCalls).toBe(0);
    expect(readLog).toContain("eth_chainId");
    expect(readLog).toContain("eth_call");
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("read RPCs on the wrong chain show no data and never fall back to the wallet provider", async ({ browser }) => {
  const readLog = [];
  const { context, page, pageErrors } = await preparePage(browser, {
    readChainId: "0x5",
    walletResultsOverride: { [selectors.accessLocked]: uintResult(999_999n * UNIT) },
    readLog,
  });
  try {
    await page.goto("/web3/", { waitUntil: "domcontentloaded" });
    await connect(page);
    await expect(page.locator("#ifr-rpc-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-access-lock-balance]")).not.toContainText("999,999");
    const walletCalls = await page.evaluate(() => window.__web3RequestCounts.eth_call || 0);
    expect(walletCalls).toBe(0);
    // Only chain checks reached the wrong-chain endpoints; no data call was sent to them.
    expect(readLog.filter((method) => method !== "eth_chainId")).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

for (const [width, height] of [[1440, 1000], [1180, 820], [820, 1180], [390, 844]]) {
  test(`RPC outage notice fits without overlap at ${width}x${height} and clears on recovery`, async ({ browser }) => {
    const context = await browser.newContext({ serviceWorkers: "block", viewport: { width, height } });
    let healthy = false;
    const results = buildCallResults();
    try {
      const handler = async (route) => {
        if (!healthy) return route.abort("failed");
        let payload;
        try { payload = route.request().postDataJSON(); } catch { return route.abort(); }
        const respond = (item) => ({
          jsonrpc: "2.0",
          id: item.id,
          result: item.method === "eth_chainId" ? "0x1"
            : item.method === "eth_blockNumber" ? "0x10"
            : item.method === "eth_call" ? (results[String((item.params && item.params[0] && item.params[0].data) || "0x").slice(0, 10).toLowerCase()] || `0x${"0".repeat(64)}`)
            : null,
        });
        const body = Array.isArray(payload) ? payload.map(respond) : respond(payload);
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      };
      for (const pattern of READ_RPC_PATTERNS) await context.route(pattern, handler);
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.goto("/web3/", { waitUntil: "domcontentloaded" });
      await page.evaluate(() => window.IFRWallet.getReadProvider());
      const notice = page.locator("#ifr-rpc-error");
      await expect(notice).toBeVisible({ timeout: 20_000 });

      const layout = await page.evaluate(() => {
        const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
        const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const bar = document.getElementById("ifr-rpc-error");
        const n = box(bar);
        const visible = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0; };
        const controls = [...document.querySelectorAll("[data-wallet-connect], [data-wallet-state], button, a")]
          .filter((el) => el !== bar && !bar.contains(el) && visible(el) && getComputedStyle(el).position === "fixed");
        const fixedOverlaps = controls.filter((el) => overlaps(n, box(el))).map((el) => el.outerHTML.slice(0, 80));
        const close = bar.querySelector("button");
        return {
          inViewport: n.left >= 0 && n.right <= window.innerWidth && n.top >= 0 && n.bottom <= window.innerHeight,
          pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
          closeTarget: close ? box(close) : null,
          fixedOverlaps,
        };
      });
      expect(layout.inViewport).toBe(true);
      expect(layout.pageOverflow).toBe(false);
      expect(layout.fixedOverlaps).toEqual([]);
      expect(layout.closeTarget.width).toBeGreaterThanOrEqual(44);
      expect(layout.closeTarget.height).toBeGreaterThanOrEqual(44);
      if (process.env.WEB3_RPC_NOTICE_SHOTS) {
        await page.screenshot({ path: `${process.env.WEB3_RPC_NOTICE_SHOTS}/t221-rpc-outage-${width}x${height}.png` });
      }

      healthy = true;
      await page.evaluate(() => window.IFRWallet.getReadProvider().getBlockNumber());
      await expect(notice).toHaveCount(0, { timeout: 20_000 });
      if (process.env.WEB3_RPC_NOTICE_SHOTS) {
        await page.screenshot({ path: `${process.env.WEB3_RPC_NOTICE_SHOTS}/t221-rpc-recovered-${width}x${height}.png` });
      }
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

// T-240 follow-up: the fixed Copilot launcher must never sit on visible text or controls of the active lock task.
// Because the launcher is fixed, every part of the task passes its position while scrolling, so the check walks the
// whole task region and measures the real launcher rect against rendered text boxes and interactive targets. A hidden
// launcher (visibility) is allowed inside the task; it must be visible again once the task is out of the way.
async function expectLauncherClearOfTask(page, taskSelector) {
  const result = await page.evaluate(async (selector) => {
    const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const launcher = document.querySelector("#ifr-btn");
    const shown = () => {
      const s = getComputedStyle(launcher);
      return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0;
    };
    const roots = () => Array.from(document.querySelectorAll(selector)).filter((el) => el.getClientRects().length > 0);
    const boxes = roots().map((el) => el.getBoundingClientRect());
    const top = Math.min(...boxes.map((b) => b.top)) + window.scrollY;
    const bottom = Math.max(...boxes.map((b) => b.bottom)) + window.scrollY;
    const hits = [];
    for (let y = Math.max(0, Math.floor(top - window.innerHeight)); y <= bottom; y += 24) {
      window.scrollTo({ top: y, behavior: "instant" });
      await settle();
      if (!shown()) continue;
      const z = launcher.getBoundingClientRect();
      const overlaps = (r) => r.width > 0 && r.height > 0 && r.left < z.right && r.right > z.left && r.top < z.bottom && r.bottom > z.top;
      for (const root of roots()) {
        for (const el of root.querySelectorAll("a, button, input, select, label, [role=button]")) {
          if (el.getClientRects().length && overlaps(el.getBoundingClientRect())) hits.push(`${window.scrollY}: target ${el.textContent.trim().slice(0, 40)}`);
        }
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          if (Array.from(range.getClientRects()).some(overlaps)) hits.push(`${window.scrollY}: text ${node.textContent.trim().slice(0, 40)}`);
        }
      }
    }
    window.scrollTo({ top: 0, behavior: "instant" });
    await settle();
    return { hits, reachable: shown() };
  }, taskSelector);
  expect(result.hits, "Copilot launcher covers visible task text or controls").toEqual([]);
  expect(result.reachable, "Copilot launcher stays reachable outside the task").toBe(true);
}

// T-240 visual gate: V1 warning and V2 path fit without overlap, clipping or horizontal overflow.
async function measureLockLayout(page, containerSelector, stackSelectors, targetSelectors) {
  return page.evaluate(({ containerSelector, stackSelectors, targetSelectors }) => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const container = document.querySelector(containerSelector);
    const c = rect(container);
    const stack = stackSelectors.map((selector) => {
      const el = document.querySelector(selector);
      return { selector, ...rect(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });
    const targets = targetSelectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => ({ selector, ...rect(el) })));
    return {
      docOverflow: document.documentElement.scrollWidth - window.innerWidth,
      container: c,
      stack,
      targets,
    };
  }, { containerSelector, stackSelectors, targetSelectors });
}

function assertLockLayout(layout) {
  expect(layout.docOverflow, "no horizontal page overflow").toBeLessThanOrEqual(0);
  for (const box of layout.stack) {
    expect(box.width, `${box.selector} rendered`).toBeGreaterThan(0);
    expect(box.scrollWidth, `${box.selector} text stays inside`).toBeLessThanOrEqual(box.clientWidth + 1);
    expect(box.left, `${box.selector} inside container (left)`).toBeGreaterThanOrEqual(layout.container.left - 0.5);
    expect(box.right, `${box.selector} inside container (right)`).toBeLessThanOrEqual(layout.container.right + 0.5);
  }
  for (let i = 1; i < layout.stack.length; i++) {
    expect(layout.stack[i - 1].bottom, `${layout.stack[i - 1].selector} does not overlap ${layout.stack[i].selector}`).toBeLessThanOrEqual(layout.stack[i].top + 0.5);
  }
  for (const target of layout.targets) {
    expect(target.height, `${target.selector} touch height`).toBeGreaterThanOrEqual(44);
    expect(target.width, `${target.selector} touch width`).toBeGreaterThanOrEqual(44);
  }
}

for (const [width, height] of [[1440, 1000], [1180, 820], [820, 1180], [390, 844]]) {
  for (const state of ["gated", "ready"]) {
    test(`T-240 lock surfaces fit at ${width}x${height} (${state})`, async ({ browser }) => {
      const shots = process.env.T240_SHOTS;
      const { context, page, pageErrors } = await preparePage(browser, {
        feeExemptV2: state === "ready",
        v1Tranche: true,
        contextOptions: { viewport: { width, height } },
      });
      try {
        await page.goto("/web3/?action=commitment-lock#access", { waitUntil: "domcontentloaded" });
        await selectInjectedWallet(page);
        await expect(page.locator('[data-unlock-vault="v1"][data-unlock-tranche="0"]')).toBeEnabled({ timeout: 15_000 });
        if (state === "ready") await expect(page.locator("[data-lock-submit]")).toBeEnabled();
        else await expect(page.locator("[data-lock-submit]")).toBeDisabled();
        const web3 = await measureLockLayout(page, "[data-lock-dialog] .protocol-card",
          ["[data-lock-dialog] header", "[data-lock-dialog] [data-v1-warning]", "[data-lock-dialog] [data-v2-path]", "[data-lock-dialog] .protocol-grid", "[data-lock-dialog] .protocol-form", "[data-lock-dialog] .protocol-actions", "[data-lock-tranches]"],
          ["[data-lock-dialog] .protocol-actions .btn", "[data-lock-tranches] [data-unlock-vault]"]);
        assertLockLayout(web3);
        if (shots) {
          await page.locator("[data-lock-dialog] [data-v1-warning]").scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${shots}/t240-web3-${state}-${width}x${height}.png` });
        }

        await page.goto("/wiki/commitment-vault.html#lock-widget", { waitUntil: "domcontentloaded" });
        await page.locator("#cv-connect-btn").click();
        const injected = page.locator('[data-wallet-option-type="injected"]').first();
        if (await injected.isVisible().catch(() => false)) await injected.click();
        await expect(page.locator("#cv-tranches-list")).toContainText("V1 · Tranche #0", { timeout: 15_000 });
        await page.locator("#cv-amount").fill("100");
        await page.locator("#cv-amount").dispatchEvent("input");
        if (state === "ready") await expect(page.locator("#cv-lock-btn")).toBeEnabled();
        else await expect(page.locator("#cv-lock-btn")).toBeDisabled();
        const wiki = await measureLockLayout(page, "#cv-v1-warning",
          ["#cv-v1-warning"], []);
        assertLockLayout(wiki);
        const wikiStack = await measureLockLayout(page, "main, .content, body",
          ["#lock-widget", "#cv-v1-warning", "#cv-v2-path", "#cv-connect-section", "#cv-config-section", "#cv-dashboard-section"], []);
        assertLockLayout({ ...wikiStack, stack: wikiStack.stack.map((box) => ({ ...box, left: Math.max(box.left, wikiStack.container.left), right: Math.min(box.right, wikiStack.container.right) })) });
        expect(wikiStack.stack[1].left).toBeGreaterThanOrEqual(0);
        expect(wikiStack.stack[1].right).toBeLessThanOrEqual(width);
        await expectLauncherClearOfTask(page, "#cv-v1-warning, #cv-v2-path, #cv-connect-section, #cv-config-section, #cv-dashboard-section");
        if (shots) {
          await page.locator("#cv-v1-warning").scrollIntoViewIfNeeded();
          await page.evaluate(() => window.scrollBy(0, -80));
          await page.screenshot({ path: `${shots}/t240-wiki-${state}-${width}x${height}.png` });
        }

        if (state === "gated") {
          await page.goto("/", { waitUntil: "domcontentloaded" });
          await page.evaluate(() => window.wzGo("lock"));
          await page.waitForTimeout(600);
          const landing = await measureLockLayout(page, "#wz-box",
            Array.from({ length: 4 }, (_, i) => `#wz-box a.wz-option:nth-of-type(${i + 1})`), ["#wz-box a.wz-option"]);
          assertLockLayout(landing);
          await expectLauncherClearOfTask(page, "#wz-box");
          if (shots) {
            await page.locator("#wz-box").scrollIntoViewIfNeeded();
            await page.screenshot({ path: `${shots}/t240-landing-wizard-lock-${width}x${height}.png` });
          }
        }
        expect(pageErrors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
}
