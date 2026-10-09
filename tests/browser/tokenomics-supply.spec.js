// @ts-check
// Web3 e90 follow-up (F2): the tokenomics wiki live-supply widget reads IFR totalSupply() through wallet-core's
// chain-pinned Mainnet read provider instead of the Copilot API. The Web3 host CSP does not allow the API in
// connect-src and the API sends no Access-Control-Allow-Origin for the Web3 origin, so the widget must work with the
// providers both hosts already allow. The page is served here under its real origins: the apex (GitHub Pages, no CSP)
// and web3.ifrunit.tech with the repository CSP from infra/web3/web3-security-headers.conf. All RPC answers are explicit
// fixtures, never current chain facts; every other external request is aborted.
const { test, expect } = require("@playwright/test");
const { ethers } = require("ethers");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");

test.describe.configure({ timeout: 90000 });

const DOCS = path.join(__dirname, "..", "..", "docs");
const WEB3_CSP = readFileSync(path.join(__dirname, "..", "..", "infra", "web3", "web3-security-headers.conf"), "utf8")
  .match(/add_header Content-Security-Policy "([^"]+)"/)[1];
const HOSTS = [
  { name: "apex", origin: "https://ifrunit.tech", csp: null },
  { name: "web3", origin: "https://web3.ifrunit.tech", csp: WEB3_CSP },
];
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
  ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };

const RPC_HOSTS = /^https:\/\/(ethereum-rpc\.publicnode\.com|eth\.drpc\.org|1rpc\.io)\//;
const IFR = "0x77e99917eca8539c62f509ed1193ac36580a6e7b";
const TOTAL_SUPPLY = ethers.id("totalSupply()").slice(0, 10);
const word = (v) => ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [v]);
// Fixture: 997,061,342.123456789 IFR in base units (above 2^53, so float math would lose the low digits).
const SUPPLY = 997_061_342_123_456_789n;

/**
 * Serves docs/ under the host origin (CSP header only on the Web3 host) and answers the three wallet-core endpoints.
 * rpc.mode: "ok" | "fail" (HTTP 500) | "wrong-chain" (eth_chainId 0x5); rpc.supply overrides the fixture.
 */
async function preparePage(page, host, options = {}) {
  const rpc = { mode: options.mode || "ok", supply: options.supply ?? SUPPLY, methods: [], calls: [] };
  const apiRequests = [];
  page.on("request", (request) => {
    if (/copilot-api\.ifrunit\.tech\/api\//.test(request.url())) apiRequests.push(request.url());
  });
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__cspViolations.push(`${e.effectiveDirective} ${e.blockedURI}`);
    });
    // A wallet is present but must never be used for displayed values (no wallet fallback).
    window.__walletMethods = [];
    window.ethereum = {
      isMetaMask: true,
      request: async ({ method }) => {
        window.__walletMethods.push(method);
        if (method === "eth_chainId") return "0x1";
        if (method === "eth_accounts") return [];
        throw new Error(`wallet mock: ${method} not available`);
      },
      on() {},
      removeListener() {},
    };
  });
  await page.route(/^https?:\/\//, (route) => route.abort());
  await page.route(`${host.origin}/**`, async (route) => {
    const url = new URL(route.request().url());
    const file = path.join(DOCS, decodeURIComponent(url.pathname));
    if (!file.startsWith(DOCS) || !existsSync(file)) return route.fulfill({ status: 404, body: "not found" });
    if (options.walletCore && url.pathname === "/assets/wallet-core.js") {
      return options.walletCore === "blocked"
        ? route.abort()
        : route.fulfill({ status: 200, contentType: "text/javascript", body: options.walletCore });
    }
    const headers = { "content-type": TYPES[path.extname(file)] || "application/octet-stream" };
    if (host.csp && path.extname(file) === ".html") headers["content-security-policy"] = host.csp;
    await route.fulfill({ status: 200, headers, body: readFileSync(file) });
  });
  await page.route(RPC_HOSTS, async (route) => {
    if (rpc.mode === "fail") return route.fulfill({ status: 500, contentType: "text/plain", body: "upstream down" });
    const body = route.request().postDataJSON();
    const one = (req) => {
      rpc.methods.push(req.method);
      if (req.method === "eth_chainId") return { jsonrpc: "2.0", id: req.id, result: rpc.mode === "wrong-chain" ? "0x5" : "0x1" };
      if (req.method === "eth_blockNumber") return { jsonrpc: "2.0", id: req.id, result: "0x100" };
      if (req.method === "eth_call") {
        const tx = req.params[0];
        rpc.calls.push(`${String(tx.to).toLowerCase()}:${String(tx.data).slice(0, 10)}`);
        if (String(tx.to).toLowerCase() === IFR && String(tx.data).slice(0, 10) === TOTAL_SUPPLY) {
          return { jsonrpc: "2.0", id: req.id, result: word(rpc.supply) };
        }
        return { jsonrpc: "2.0", id: req.id, result: word(0n) };
      }
      return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "not mocked" } };
    };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)) });
  });
  return { rpc, apiRequests };
}

const widget = (page) => page.locator("[data-supply-widget]");
const values = (page) => page.locator("#live-total-supply, #live-burned, #live-burn-pct");

async function expectLive(page) {
  await expect(widget(page)).toHaveAttribute("data-supply-state", "live", { timeout: 30000 });
  await expect(page.locator("#live-total-supply")).toHaveText("997,061,342 IFR");
  // burned = genesis - current supply = 2,938,657.876543211 IFR -> 2,938,658 IFR; 0.29386578...% -> 0.2939%
  await expect(page.locator("#live-burned")).toHaveText("2,938,658 IFR");
  await expect(page.locator("#live-burn-pct")).toHaveText("0.2939%");
  await expect(page.locator("#live-tokenomics-timestamp")).toContainText("Live from Ethereum Mainnet");
}

async function expectNoNumbers(page) {
  for (const text of await values(page).allTextContents()) expect(text, "no live number without a verified read").not.toMatch(/\d/);
}

/** Shared invariants: no API call, no CSP connect violation, no wallet data read. */
async function expectReadPathClean(page, apiRequests) {
  expect(apiRequests, "the widget never calls the Copilot API").toEqual([]);
  const violations = await page.evaluate(() => window.__cspViolations);
  expect(violations.filter((v) => v.startsWith("connect-src")), "no CSP connect-src violation").toEqual([]);
  const walletMethods = await page.evaluate(() => window.__walletMethods);
  expect(walletMethods.filter((m) => m === "eth_call" || m === "eth_getBalance"), "no wallet fallback for data reads").toEqual([]);
}

for (const host of HOSTS) {
  test.describe(`tokenomics live supply on the ${host.name} host`, () => {
    test("normal: renders chain-pinned totalSupply with genesis-minus-supply burned", async ({ page }) => {
      const { rpc, apiRequests } = await preparePage(page, host);
      await page.goto(`${host.origin}/wiki/tokenomics.html`);
      await expectLive(page);
      expect(rpc.methods[0], "the endpoint is chain-checked before any data request").toBe("eth_chainId");
      expect(rpc.calls).toContain(`${IFR}:${TOTAL_SUPPLY}`);
      await expectReadPathClean(page, apiRequests);
      if (host.csp) {
        // Harness check: the Web3 CSP really is enforced here, so the old API path would have been blocked.
        const blocked = await page.evaluate(() => fetch("https://copilot-api.ifrunit.tech/api/ifr/supply").then(() => "fetched", () => "blocked"));
        expect(blocked).toBe("blocked");
        await expect.poll(() => page.evaluate(() => window.__cspViolations.filter((v) => v.startsWith("connect-src")).length)).toBe(1);
      }
    });

    test("wrong chain: endpoints answering 0x5 get no data request and no numbers render", async ({ page }) => {
      const { rpc, apiRequests } = await preparePage(page, host, { mode: "wrong-chain" });
      await page.goto(`${host.origin}/wiki/tokenomics.html`);
      await expect(widget(page)).toHaveAttribute("data-supply-state", "error", { timeout: 30000 });
      await expect(page.locator("#live-tokenomics-timestamp")).toContainText("unavailable");
      await expectNoNumbers(page);
      expect(rpc.methods.length, "the chain check was attempted").toBeGreaterThan(0);
      expect([...new Set(rpc.methods)], "a wrong-chain endpoint receives nothing but eth_chainId").toEqual(["eth_chainId"]);
      await expectReadPathClean(page, apiRequests);
    });

    test("RPC failure then recovery on the next refresh", async ({ page }) => {
      await page.clock.install();
      const { rpc, apiRequests } = await preparePage(page, host, { mode: "fail" });
      await page.goto(`${host.origin}/wiki/tokenomics.html`);
      await expect(widget(page)).toHaveAttribute("data-supply-state", "error", { timeout: 30000 });
      await expect(page.locator("#live-tokenomics-timestamp")).toContainText("retry in 60s");
      await expectNoNumbers(page);
      rpc.mode = "ok";
      await page.clock.fastForward(60_000);
      await expectLive(page);
      await expectReadPathClean(page, apiRequests);
    });

    test("missing provider: blocked wallet-core leaves the widget unavailable, no fallback read", async ({ page }) => {
      const { rpc, apiRequests } = await preparePage(page, host, { walletCore: "blocked" });
      await page.goto(`${host.origin}/wiki/tokenomics.html`);
      await expect(widget(page)).toHaveAttribute("data-supply-state", "unavailable", { timeout: 30000 });
      await expect(page.locator("#live-tokenomics-timestamp")).toContainText("read provider did not load");
      await expectNoNumbers(page);
      expect(rpc.methods, "no provider of its own").toEqual([]);
      await expectReadPathClean(page, apiRequests);
    });

    test("missing provider: an old wallet-core without getReadProvider is not replaced by the wallet", async ({ page }) => {
      const stub = "window.IFRWallet = { on: function() {}, off: function() {}, isConnected: function() { return false; }, " +
        "getProvider: function() { return null; }, autoReconnect: function() { return Promise.resolve(false); } };";
      const { rpc, apiRequests } = await preparePage(page, host, { walletCore: stub });
      await page.goto(`${host.origin}/wiki/tokenomics.html`);
      await expect(widget(page)).toHaveAttribute("data-supply-state", "unavailable", { timeout: 30000 });
      await expectNoNumbers(page);
      expect(rpc.methods, "no provider of its own").toEqual([]);
      await expectReadPathClean(page, apiRequests);
    });

    test("an impossible supply above genesis fails closed", async ({ page }) => {
      const { apiRequests } = await preparePage(page, host, { supply: 1_000_000_001n * 10n ** 9n });
      await page.goto(`${host.origin}/wiki/tokenomics.html`);
      await expect(widget(page)).toHaveAttribute("data-supply-state", "error", { timeout: 30000 });
      await expectNoNumbers(page);
      await expectReadPathClean(page, apiRequests);
    });
  });
}

// Visual gate (opt-in with TOKENOMICS_SHOTS=<dir>): the widget in the live and error states on the Web3 host fits the
// viewport at every release width, without document overflow and with all three values on screen.
for (const [width, height] of [[305, 720], [375, 812], [820, 1180], [1180, 820], [1440, 1000]]) {
  for (const mode of ["ok", "fail"]) {
    test(`visual: tokenomics supply widget ${mode === "ok" ? "live" : "error"} at ${width}x${height}`, async ({ page }) => {
      test.skip(!process.env.TOKENOMICS_SHOTS, "screenshots only on request");
      await page.setViewportSize({ width, height });
      const { apiRequests } = await preparePage(page, HOSTS[1], { mode });
      await page.goto(`${HOSTS[1].origin}/wiki/tokenomics.html`);
      await expect(widget(page)).toHaveAttribute("data-supply-state", mode === "ok" ? "live" : "error", { timeout: 30000 });
      await page.evaluate(() => document.fonts.ready);
      // The global RPC outage notice (error state) has its own T-221 gate; dismiss it so the widget is visible.
      if (await page.locator("#ifr-rpc-error").count()) await page.locator("#ifr-rpc-error button").click();
      await widget(page).scrollIntoViewIfNeeded();
      const layout = await page.evaluate(() => {
        const box = document.querySelector("[data-supply-widget]").getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        const valueBoxes = [...document.querySelectorAll("#live-total-supply, #live-burned, #live-burn-pct")].map((el) => {
          const r = el.getBoundingClientRect();
          return { text: el.textContent, left: Math.round(r.left), right: Math.round(r.right) };
        });
        return { vw, scrollWidth: document.documentElement.scrollWidth, widgetLeft: Math.round(box.left), widgetRight: Math.round(box.right), valueBoxes };
      });
      expect(layout.scrollWidth, "no horizontal document overflow").toBeLessThanOrEqual(layout.vw);
      expect(layout.widgetLeft).toBeGreaterThanOrEqual(0);
      expect(layout.widgetRight).toBeLessThanOrEqual(layout.vw);
      for (const v of layout.valueBoxes) expect(v.right, `${v.text} stays inside the viewport`).toBeLessThanOrEqual(layout.vw);
      await expectReadPathClean(page, apiRequests);
      const fs = require("node:fs");
      const name = `tokenomics-web3-${mode === "ok" ? "live" : "error"}-${width}x${height}`;
      await widget(page).screenshot({ path: `${process.env.TOKENOMICS_SHOTS}/${name}-widget.png` });
      await page.screenshot({ path: `${process.env.TOKENOMICS_SHOTS}/${name}.png` });
      fs.writeFileSync(`${process.env.TOKENOMICS_SHOTS}/${name}.json`, JSON.stringify(layout, null, 1));
    });
  }
}
