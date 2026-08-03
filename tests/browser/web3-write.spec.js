// @ts-check
const { test, expect } = require("@playwright/test");
const { ethers } = require("ethers");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");

const ACCOUNT = "0x3333333333333333333333333333333333333333";
const TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const IFR_LOCK = "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb";
const COMMITMENT = "0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3";
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
  lendingCreate: selector("createOffer(uint256)"),
  lendingHasOffer: selector("hasOffer(address)"),
  lendingPrice: selector("ifrPriceWei()"),
  lendingRate: selector("getInterestRate()"),
  lendingOfferCount: selector("getOfferCount()"),
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
  if (to === LENDING.toLowerCase() && data.startsWith(selectors.lendingCreate)) {
    return { action: "lending-create", amount: decodeWord(data, 0) };
  }
  throw new Error(`Unexpected Web3 write: ${transaction.to} ${transaction.data}`);
}

async function installWallet(context, options = {}) {
  const chainId = options.chainId || "0x1";
  const rejectSwitch = options.rejectSwitch === true;
  const locked = options.locked || 0n;
  const callResults = {
    [selectors.balanceOf]: uintResult(10_000n * UNIT),
    [selectors.allowance]: uintResult(0n),
    [selectors.accessLocked]: uintResult(locked),
    [selectors.commitmentCount]: uintResult(0n),
    [selectors.commitmentPriceOracle]: addressResult(ethers.ZeroAddress),
    [selectors.lendingHasOffer]: uintResult(0n),
    [selectors.lendingPrice]: uintResult(0n),
    [selectors.lendingRate]: uintResult(200n),
    [selectors.lendingOfferCount]: uintResult(0n),
    [selectors.lendingLoanCount]: uintResult(0n),
  };

  await context.addInitScript(({ account, initialChainId, shouldRejectSwitch, results }) => {
    const listeners = new Map();
    const transactions = new Map();
    let activeChainId = initialChainId;

    Object.defineProperty(window, "__web3TestChainId", { get: () => activeChainId });
    Object.defineProperty(window, "__web3WatchAssets", { value: [] });
    Object.defineProperty(window, "ethereum", {
      configurable: true,
      value: {
        isMetaMask: true,
        request: async ({ method, params }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
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
            return results[data] || `0x${"0".repeat(64)}`;
          }
          if (method === "eth_sendTransaction") {
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
    results: callResults,
  });
}

async function preparePage(browser, options = {}) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await installWallet(context, options);
  const writes = [];
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
  await page.locator("[data-wallet-connect]").first().click();
  await expect(page.locator("[data-wallet-state]").first()).toContainText("Connected", { timeout: 10_000 });
}

test("wrong-chain rejection fails closed before connected state or writes", async ({ browser }) => {
  const { context, page, writes, pageErrors } = await preparePage(browser, {
    chainId: "0xaa36a7",
    rejectSwitch: true,
  });
  await page.goto("/web3/", { waitUntil: "domcontentloaded" });
  await page.locator("[data-wallet-connect]").first().click();
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

test("persisted WalletConnect wrong-network recovery fails closed without an unhandled rejection", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const pageErrors = [];
  try {
    await context.route("https://esm.sh/@walletconnect/ethereum-provider@2.17.3", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        headers: { "Access-Control-Allow-Origin": "*" },
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
  await expect(page.locator("[data-access-lock-unlock]")).toBeEnabled();
  await page.locator("[data-access-lock-unlock]").click();
  await expect.poll(() => writes.length, { timeout: 15_000 }).toBe(1);
  expect(writes[0].action).toBe("access-unlock");
  expect(pageErrors).toEqual([]);
  await context.close();
});

test("CommitmentVault time-only and LendingVault offer writes preserve IFR base units", async ({ browser }) => {
  const { context, page, writes, pageErrors } = await preparePage(browser);
  await page.goto("/web3/", { waitUntil: "domcontentloaded" });
  await connect(page);

  await page.locator("[data-open-lock]").first().click();
  await page.locator("[data-lock-amount]").fill("250");
  await page.locator("[data-lock-submit]").click();
  await expect.poll(() => writes.length, { timeout: 15_000 }).toBe(2);
  expect(writes[0].action).toBe("approve");
  expect(writes[0].amount).toBe(250n * UNIT);
  expect(writes[1].action).toBe("commitment-lock");
  expect(writes[1].amount).toBe(250n * UNIT);

  await page.locator("[data-lock-close]").click();
  await page.locator("[data-open-lending]").first().click();
  await page.locator("[data-lending-amount]").fill("500");
  await page.locator("[data-lending-deposit]").click();
  await expect.poll(() => writes.length, { timeout: 15_000 }).toBe(4);
  expect(writes[2].action).toBe("approve");
  expect(writes[2].amount).toBe(500n * UNIT);
  expect(writes[3].action).toBe("lending-create");
  expect(writes[3].amount).toBe(500n * UNIT);
  expect(pageErrors).toEqual([]);
  await context.close();
});

test("LendingVault borrowing remains transaction-disabled while price is zero", async ({ browser }) => {
  const { context, page, writes, pageErrors } = await preparePage(browser);
  await page.goto("/web3/?action=borrow", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-borrow-price]")).toHaveText("Disabled");
  await expect(page.locator("[data-borrow-submit]")).toBeDisabled();
  await expect(page.locator("[data-borrow-status]")).toContainText("disabled");
  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
  await context.close();
});

test("Web3 runtime uses the self-hosted Ethers asset", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    const externalEthersRequests = [];
    page.on("request", (request) => {
      if (/cdn\.jsdelivr\.net\/npm\/ethers/i.test(request.url())) externalEthersRequests.push(request.url());
    });
    await page.goto("/web3/", { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => typeof window.ethers)).toBe("object");
    expect(externalEthersRequests).toEqual([]);
    await expect(page.locator('script[src="/assets/vendor/ethers-5.7.2.umd.min.js"]')).toHaveCount(1);
  } finally {
    await context.close();
  }
});

test("self-hosted Ethers asset matches the published 5.7.2 bundle", () => {
  const asset = readFileSync("docs/assets/vendor/ethers-5.7.2.umd.min.js");
  expect(createHash("sha256").update(asset).digest("hex")).toBe(
    "a66293a6a2bb4dee061a68612be0be3c5c0ab7e4068ab8d98a4a357baf664c73",
  );
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
