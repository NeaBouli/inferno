// @ts-check
const { test, expect } = require("@playwright/test");
const { ethers } = require("ethers");

/**
 * Landing/Wiki wallet browser suite.
 *
 * Covers the current wallet contract of docs/index.html, docs/wiki/*.html
 * and docs/assets/wallet-core.js (v4.2.2):
 *   - Desktop + MetaMask extension: classic connect/disconnect flow.
 *     Landing button is `#connect`, wiki button is `#lp-header-connect-btn`.
 *   - Desktop without extension: WalletConnect QR path; with the self-hosted
 *     WalletConnect provider artifact unavailable the landing honestly falls
 *     back to "Install MetaMask".
 *   - Mobile/Tablet: connect is blocked with MOBILE_NOT_SUPPORTED and the
 *     "Desktop browser only" modal (#ifr-desktop-only-modal). Mobile
 *     deep-link fallbacks were removed in wallet-core v4.2.1 — the tests
 *     assert that NO metamask.app.link navigation happens.
 *   - Bootstrap status (CWA-48): RPC failure renders an explicit unavailable
 *     state and keeps claim/refund write controls hidden.
 *
 * No signatures, no transactions, no external writes. The mock EIP-1193
 * provider only answers read calls.
 */

// Valid all-lowercase mock address: ethers treats all-lowercase addresses as
// checksummed-neutral, so state loading (getBalance/eth_call) produces no
// "bad address checksum" noise.
const MOCK_ADDR = "0x71c7656ec7ab88b098defb751b7401b5f6d8976f";
// lpUpdateUI renders "\u2B24 " + addr.slice(0, 6)
const MOCK_SHORT = "⬤ 0x71c7";

// 32 zero bytes: decodes as uint256 0 / bool false for every single-value
// eth_call. Multi-return calls (getBootstrapStatus) fail decoding and take
// the documented per-call fallback inside ifr-state.js — both paths stay
// read-only and error-free.
const ZERO32 = "0x" + "00".repeat(32);

// Mock MetaMask provider factory (read-only EIP-1193 fake)
function mockMetaMask(address) {
  return `
    window.ethereum = {
      isMetaMask: true,
      _address: "${address}",
      request: async function(req) {
        if (req.method === "eth_requestAccounts") return ["${address}"];
        if (req.method === "eth_accounts") return ["${address}"];
        if (req.method === "eth_chainId") return "0x1";
        if (req.method === "net_version") return "1";
        if (req.method === "eth_blockNumber") return "0x1";
        if (req.method === "eth_getBalance") return "0x0";
        if (req.method === "eth_call") return "${ZERO32}";
        if (req.method === "wallet_switchEthereumChain") return null;
        return null;
      },
      on: function() {},
      removeListener: function() {},
    };
  `;
}

// Filters out expected network noise from live CDN/RPC reads; real JS
// errors still fail the test.
function isBenignNetError(m) {
  return (
    m.includes("Failed to fetch") ||
    m.includes("NetworkError") ||
    m.includes("net::ERR") ||
    m.includes("Load failed")
  );
}

function monitorPageErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return () => {
    expect(errors.filter((message) => !isBenignNetError(message))).toEqual([]);
  };
}

async function waitForWalletRuntime(page) {
  await page.waitForFunction(
    () =>
      typeof window.ethers !== "undefined" &&
      typeof window.IFRWallet !== "undefined" &&
      typeof window.IFRState !== "undefined",
    null,
    { timeout: 15000 }
  );
}

async function gotoWalletPage(page, path) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await waitForWalletRuntime(page);
}

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1";
const TABLET_UA =
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

async function newMobilePage(
  browser,
  viewport = { width: 390, height: 844 },
  userAgent = MOBILE_UA
) {
  const context = await browser.newContext({
    viewport,
    userAgent,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const deeplinks = [];
  await context.route("**/metamask.app.link/**", (route) => {
    deeplinks.push(route.request().url());
    route.abort();
  });
  return { context, page, deeplinks };
}

/* ══════════════════════════════════════════════════════════
   Scenario 1 — Landing, Desktop: Connect + Disconnect
   ══════════════════════════════════════════════════════════ */
test.describe("S1: Desktop Connect + Disconnect", () => {
  test("connect with mock wallet, then disconnect resets UI", async ({ page }) => {
    const assertNoPageErrors = monitorPageErrors(page);
    await gotoWalletPage(page, "/");

    // Inject mock MetaMask
    await page.evaluate(mockMetaMask(MOCK_ADDR));

    // Click connect — current landing button id is #connect
    const btn = page.locator("#connect");
    await expect(btn).toBeVisible();
    await btn.click();

    // Wait for connected state
    const connectedDiv = page.locator("#lp-header-connected");
    await expect(connectedDiv).toBeVisible({ timeout: 10000 });

    // Verify short address shown ("⬤ 0x71c7")
    const addrEl = page.locator("#lp-header-addr");
    await expect(addrEl).toHaveText(MOCK_SHORT);

    // The inactive action must disappear once the connected wallet pill is ready.
    await expect(btn).toBeHidden();

    // Now disconnect
    await page.evaluate(() => window.lpDisconnect());

    // Connect button should be back
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    await expect(btn).toHaveText("Connect Wallet");

    // Connected div should be hidden
    await expect(connectedDiv).not.toBeVisible();
    assertNoPageErrors();
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 2 — Landing, Desktop: no extension + WalletConnect
   provider artifact unreachable → honest "Install MetaMask"
   fallback
   ══════════════════════════════════════════════════════════ */
test.describe("S2: No wallet provider", () => {
  test("button changes to Install MetaMask when the WC artifact is unreachable", async ({ page }) => {
    // Make the self-hosted WalletConnect artifact import fail deterministically
    // so wallet-core throws NO_METAMASK instead of waiting on the QR modal.
    await page.route("**/assets/vendor/walletconnect-ethereum-provider-*.esm.js", (route) => route.abort());
    const assertNoPageErrors = monitorPageErrors(page);
    await gotoWalletPage(page, "/");

    // Ensure no injected provider
    await page.evaluate(() => { delete window.ethereum; });

    const btn = page.locator("#connect");
    await expect(btn).toBeVisible();
    await btn.click();

    // Honest desktop fallback: "⚠️ Install MetaMask"
    await expect(btn).toContainText("Install MetaMask", { timeout: 15000 });
    await expect(btn).toBeEnabled();
    assertNoPageErrors();
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 3 — Multi-wallet: Exodus + MetaMask → MetaMask
   ══════════════════════════════════════════════════════════ */
test.describe("S3: Multi-wallet detection", () => {
  test("selects real MetaMask over Exodus imposter", async ({ page }) => {
    const assertNoPageErrors = monitorPageErrors(page);
    await gotoWalletPage(page, "/");

    const result = await page.evaluate(async (zero32) => {
      const addr = "0xaa00000000000000000000000000000000000001";
      const mockMM = {
        isMetaMask: true,
        request: async function(req) {
          if (req.method === "eth_requestAccounts") return [addr];
          if (req.method === "eth_accounts") return [addr];
          if (req.method === "eth_chainId") return "0x1";
          if (req.method === "eth_getBalance") return "0x0";
          if (req.method === "eth_call") return zero32;
          return null;
        },
        on: function() {},
        removeListener: function() {},
      };
      const mockExodus = { isMetaMask: true, isExodus: true };
      window.ethereum = {
        providers: [mockExodus, mockMM],
        request: async function() { return []; },
        on: function() {},
      };
      try {
        return await window.IFRWallet.connect();
      } catch (e) { return "ERROR:" + e.message; }
    }, ZERO32);

    expect(result).toBe("0xaa00000000000000000000000000000000000001");
    assertNoPageErrors();
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 4 — Landing Disconnect: button immediately resets
   ══════════════════════════════════════════════════════════ */
test.describe("S4: Disconnect instant reset", () => {
  test("button text resets to Connect Wallet, not Connecting...", async ({ page }) => {
    const assertNoPageErrors = monitorPageErrors(page);
    await gotoWalletPage(page, "/");
    await page.evaluate(mockMetaMask(MOCK_ADDR));

    // Connect
    await page.locator("#connect").click();
    await expect(page.locator("#lp-header-connected")).toBeVisible({ timeout: 10000 });

    // Disconnect
    await page.evaluate(() => window.lpDisconnect());

    // Button must show "Connect Wallet" immediately — not "Connecting..."
    const btn = page.locator("#connect");
    const text = await btn.textContent();
    expect(text).not.toContain("Connecting");
    expect(text).toContain("Connect Wallet");
    expect(await btn.isEnabled()).toBe(true);
    assertNoPageErrors();
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 5 — autoReconnect after reload (desktop only)
   ══════════════════════════════════════════════════════════ */
test.describe("S5: autoReconnect", () => {
  test("reconnects after page reload without extra click", async ({ page }) => {
    const assertNoPageErrors = monitorPageErrors(page);
    await gotoWalletPage(page, "/");
    await page.evaluate(mockMetaMask(MOCK_ADDR));

    // Connect first
    await page.locator("#connect").click();
    await expect(page.locator("#lp-header-connected")).toBeVisible({ timeout: 10000 });

    // Inject mock again before reload (so it's available on new page)
    await page.addInitScript(mockMetaMask(MOCK_ADDR));
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForWalletRuntime(page);

    // Should auto-reconnect — connected div visible without clicking
    await expect(page.locator("#lp-header-connected")).toBeVisible({ timeout: 10000 });
    assertNoPageErrors();
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 6 — Mobile/Tablet, Landing: honest failure with
   MOBILE_NOT_SUPPORTED + "Desktop browser only" modal,
   and NO metamask.app.link deep-link navigation
   ══════════════════════════════════════════════════════════ */
test.describe("S6: Mobile landing block", () => {
  test("mobile connect shows Desktop-only modal, no deep-link", async ({ browser }) => {
    const { context, page, deeplinks } = await newMobilePage(browser);
    try {
      const assertNoPageErrors = monitorPageErrors(page);
      await gotoWalletPage(page, "/");

    // No injected wallet on this phone
    await page.evaluate(() => { delete window.ethereum; });

    // Click the real button — modal must appear
    const btn = page.locator("#connect");
    await expect(btn).toBeVisible();
    await btn.click();

    const modal = page.locator("#ifr-desktop-only-modal");
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal).toContainText("Desktop browser only");
    // Modal points mobile users at the web3 surface
    await expect(modal).toContainText("web3.ifrunit.tech");

    // The link has no native disabled state; its final text proves the error
    // handler completed instead of remaining stuck on "Connecting...".
    await expect(btn).toHaveText("Retry", { timeout: 5000 });

    // Modal closes via "Got it"
    await page.locator("#ifr-desktop-modal-close").click();
    await expect(modal).not.toBeVisible();

    // Direct contract check: connect() rejects with MOBILE_NOT_SUPPORTED
    // (re-opens the modal, which is fine — the test ends here).
    const code = await page.evaluate(async () => {
      try {
        await window.IFRWallet.connect();
        return "NO_ERROR";
      } catch (e) {
        return e.code || e.message;
      }
    });
    expect(code).toBe("MOBILE_NOT_SUPPORTED");

    // wallet-core v4.2.1 removed mobile deep-link fallbacks
    await page.waitForTimeout(500);
    expect(deeplinks).toEqual([]);
      assertNoPageErrors();
    } finally {
      await context.close();
    }
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 7 — Mobile/Tablet, Wiki: same honest block on the
   wiki top-bar button (#lp-header-connect-btn)
   ══════════════════════════════════════════════════════════ */
test.describe("S7: Mobile wiki block", () => {
  const devices = [
    { name: "phone", viewport: { width: 390, height: 844 }, userAgent: MOBILE_UA },
    { name: "tablet", viewport: { width: 820, height: 1180 }, userAgent: TABLET_UA },
  ];

  for (const device of devices) {
    test(`wiki connect on ${device.name} stays reachable and shows Desktop-only modal`, async ({ browser }) => {
      const { context, page, deeplinks } = await newMobilePage(
        browser,
        device.viewport,
        device.userAgent
      );
      try {
        const assertNoPageErrors = monitorPageErrors(page);
        await gotoWalletPage(page, "/wiki/tokenomics.html");

      await page.evaluate(() => { delete window.ethereum; });

      const btn = page.locator("#lp-header-connect-btn");
      await expect(btn).toBeVisible();

      // The real control must remain fully reachable inside the viewport.
      const geometry = await btn.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, viewport: window.innerWidth };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);

      await btn.click();

      const modal = page.locator("#ifr-desktop-only-modal");
      await expect(modal).toBeVisible({ timeout: 5000 });
      await expect(modal).toContainText("Desktop browser only");

      // Wiki lpConnect resets the button on error
      await expect(btn).toHaveText("Connect Wallet", { timeout: 5000 });
      await expect(btn).toBeEnabled();

      await page.waitForTimeout(500);
      expect(deeplinks).toEqual([]);
        assertNoPageErrors();
      } finally {
        await context.close();
      }
    });
  }
});

/* ══════════════════════════════════════════════════════════
   Scenario 8 — Narrow desktop viewport (no touch): dropdown
   is positioned fixed below the connected pill
   ══════════════════════════════════════════════════════════ */
test.describe("S8: Narrow-viewport dropdown position", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("dropdown appears below button on narrow viewport", async ({ page }) => {
    const assertNoPageErrors = monitorPageErrors(page);
    await gotoWalletPage(page, "/");
    await page.evaluate(mockMetaMask(MOCK_ADDR));

    // Connect (desktop UA without touch → extension flow allowed)
    await page.locator("#connect").click();
    await expect(page.locator("#lp-header-connected")).toBeVisible({ timeout: 10000 });

    // Open dropdown
    await page.locator("#lp-header-connected div").first().click();

    const dd = page.locator("#lp-header-dropdown");
    await expect(dd).toBeVisible();

    // Verify position is fixed and below the connected pill
    const style = await dd.evaluate((el) => ({
      position: el.style.position,
      top: parseInt(el.style.top, 10),
    }));
    expect(style.position).toBe("fixed");
    expect(style.top).toBeGreaterThan(30);
    assertNoPageErrors();
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 9 — Wiki pages: current top-bar button styling
   (solid #B0481E background, white text — see
   docs/assets/redesign-skin.css and inline styles)
   ══════════════════════════════════════════════════════════ */
test.describe("S9: Wiki button consistency", () => {
  const wikiPages = [
    "/wiki/tokenomics.html",
    "/wiki/roadmap.html",
    "/wiki/faq.html",
  ];

  for (const wikiPage of wikiPages) {
    test(`${wikiPage} has connect button in top-bar`, async ({ page }) => {
      const assertNoPageErrors = monitorPageErrors(page);
      await gotoWalletPage(page, wikiPage);

      // Button exists with current styling: solid orange bg + white text
      const btn = page.locator("#lp-header-connect-btn");
      await expect(btn).toBeVisible();
      await expect(btn).toHaveText("Connect Wallet");
      const bg = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).toBe("rgb(176, 72, 30)"); // #B0481E
      const color = await btn.evaluate((el) => getComputedStyle(el).color);
      expect(color).toBe("rgb(255, 255, 255)");

      // Top-bar exists
      await expect(page.locator("#wiki-wallet-bar")).toBeVisible();

      // lpConnect globally available
      const hasFn = await page.evaluate(() => typeof window.lpConnect === "function");
      expect(hasFn).toBe(true);
      assertNoPageErrors();
    });
  }
});

for (const path of [
  "/wiki/bootstrap.html",
  "/wiki/commitment-vault.html",
  "/wiki/lending-vault.html",
  "/wiki/lending-market.html",
  "/wiki/transparency.html",
]) {
  test(`Ethers 6 runtime initializes and connects on ${path}`, async ({ page }) => {
    const assertNoPageErrors = monitorPageErrors(page);
    await page.addInitScript(mockMetaMask(MOCK_ADDR));
    await gotoWalletPage(page, path);
    await expect.poll(() => page.evaluate(() => window.ethers.version)).toBe("6.17.0");
    await expect.poll(() => page.evaluate(() => window.IFRWallet.connect())).toBe(MOCK_ADDR);
    assertNoPageErrors();
  });
}

/* ══════════════════════════════════════════════════════════
   Scenario 10 — Bootstrap: stats + wallet notice
   ══════════════════════════════════════════════════════════ */
test.describe("S10: Bootstrap page", () => {
  test("stats load and wallet notice shown", async ({ page }) => {
    const assertNoPageErrors = monitorPageErrors(page);
    await gotoWalletPage(page, "/wiki/bootstrap.html");

    // Wallet notice visible
    await expect(page.locator("#bw-wallet-notice")).toBeVisible();

    // Old connect sections removed
    await expect(page.locator("#bw-connect-section")).toHaveCount(0);
    await expect(page.locator("#bw-connected-section")).toHaveCount(0);

    // Stats countdown exists
    await expect(page.locator("#bw-countdown")).toBeVisible();

    // Top-bar connect button
    await expect(page.locator("#lp-header-connect-btn")).toBeVisible();
    assertNoPageErrors();
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 11 — Wiki disconnect: button resets properly
   ══════════════════════════════════════════════════════════ */
test.describe("S11: Wiki disconnect reset", () => {
  test("disconnect on wiki page resets button to Connect Wallet", async ({ page }) => {
    const assertNoPageErrors = monitorPageErrors(page);
    await gotoWalletPage(page, "/wiki/tokenomics.html");
    await page.evaluate(mockMetaMask(MOCK_ADDR));

    // Connect
    await page.locator("#lp-header-connect-btn").click();
    await expect(page.locator("#lp-header-connected")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#lp-header-addr")).toHaveText(MOCK_SHORT);

    // Disconnect
    await page.evaluate(() => window.lpDisconnect());

    // Button must show "Connect Wallet" not "Connecting..."
    const btn = page.locator("#lp-header-connect-btn");
    await expect(btn).toBeVisible();
    const text = await btn.textContent();
    expect(text).toContain("Connect Wallet");
    expect(text).not.toContain("Connecting");
    assertNoPageErrors();
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 13 — Bootstrap page, RPC failure (CWA-48): the
   bootstrap status must render as explicitly unavailable,
   never as a fabricated zero/not-finalized chain value, and
   the claim/refund write controls must stay hidden
   ══════════════════════════════════════════════════════════ */

// Bootstrap reads that must fail in this scenario (aggregate + individual),
// while contributions()/claimed() keep answering so the wallet-specific UI
// reaches the claim section with a real contribution.
const BW_FAIL_SELECTORS = ["0xab0f8db3", "0x28f5c7b3", "0x8a1bb1a8", "0x78e97925", "0x3197cbb6", "0x214bb60f"];
const BW_CONTRIB_SELECTOR = "0x42e94c90";
const BW_CLAIMED_SELECTOR = "0xc884ef83";
const BW_CONTRIB_WORD = "0x0000000000000000000000000000000000000000000000000011c37937e08000"; // 0.005 ETH
const BW_VAULT = "0xf72565c4cdb9575c9d3aee6b9ae3fdbd7f56e141";

function mockBootstrapRpcFailure(address) {
  return `
    window.ethereum = {
      isMetaMask: true,
      request: async function(req) {
        if (req.method === "eth_requestAccounts") return ["${address}"];
        if (req.method === "eth_accounts") return ["${address}"];
        if (req.method === "eth_chainId") return "0x1";
        if (req.method === "net_version") return "1";
        if (req.method === "eth_blockNumber") return "0x1";
        if (req.method === "eth_getBalance") return "0x0";
        if (req.method === "eth_call") {
          const call = (req.params && req.params[0]) || {};
          const to = String(call.to || "").toLowerCase();
          const selector = String(call.data || "").slice(0, 10).toLowerCase();
          if (to === "${BW_VAULT}") {
            if (${JSON.stringify(BW_FAIL_SELECTORS)}.includes(selector)) {
              throw new Error("RPC unreachable");
            }
            if (selector === "${BW_CONTRIB_SELECTOR}") return "${BW_CONTRIB_WORD}";
            if (selector === "${BW_CLAIMED_SELECTOR}") return "${ZERO32}";
          }
          return "${ZERO32}";
        }
        if (req.method === "wallet_switchEthereumChain") return null;
        return null;
      },
      on: function() {},
      removeListener: function() {},
    };
  `;
}

test.describe("S13: Bootstrap RPC failure renders unavailable, writes fail closed", () => {
  test("unavailable status shows no fabricated values and hides claim/refund", async ({ page }) => {
    const assertNoPageErrors = monitorPageErrors(page);
    // Deterministic offline environment: both public RPC paths are dead.
    await page.route("**/eth.llamarpc.com/**", (route) => route.abort());
    await page.route("**/ethereum-rpc.publicnode.com/**", (route) => route.abort());
    await page.addInitScript(mockBootstrapRpcFailure(MOCK_ADDR));
    await gotoWalletPage(page, "/wiki/bootstrap.html");

    // Initial public read failed too: stats must be unavailable, not "0 ETH".
    await expect(page.locator("#bw-total-eth")).toHaveText("—", { timeout: 15000 });
    await expect(page.locator("#bw-contributors")).toHaveText("—");
    await expect(page.locator("#bw-ifr-per-eth")).toHaveText("—");

    // Connect the wallet (contribution read succeeds, status reads keep failing).
    await page.locator("#lp-header-connect-btn").click();
    await expect(page.locator("#lp-header-connected")).toBeVisible({ timeout: 10000 });

    // Claim section appears (bootstrap ended, contribution exists) but must
    // show the honest unavailable state with every write control hidden.
    await expect(page.locator("#bw-claim-section")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#bw-claim-title")).toContainText("Status unavailable");
    await expect(page.locator("#bw-claim-btn")).toBeHidden();
    await expect(page.locator("#bw-refund-btn")).toBeHidden();
    await expect(page.locator("#bw-total-eth")).toHaveText("—");
    await expect(page.locator("#bw-contribution-ifr")).toHaveText("—");

    // No estimate can be computed without a real total — it must stay hidden.
    // (The estimate input lives in the contribute section, hidden since the
    // bootstrap ended; the guard is exercised directly.)
    await page.evaluate(() => {
      const input = document.getElementById("bw-eth-input");
      input.value = "0.5";
      bwUpdateEstimate();
    });
    await expect(page.locator("#bw-estimate")).toBeHidden();
    assertNoPageErrors();
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 14 — Wallet surfaces execute only same-origin code
   (CWA-47): no third-party script/CDN request may fire while
   loading the landing and wiki wallet runtime
   ══════════════════════════════════════════════════════════ */
test.describe("S14: No third-party executable requests", () => {
  for (const path of ["/", "/wiki/bootstrap.html", "/wiki/verify.html"]) {
    test(`${path} fires no third-party script or CDN requests`, async ({ page }) => {
      const thirdParty = [];
      page.on("request", (request) => {
        const url = request.url();
        if (/esm\.sh|jsdelivr|unpkg|cdnjs|esm\.run/i.test(url)) thirdParty.push(url);
        if (request.resourceType() === "script" && !url.startsWith("http://localhost:8787")) thirdParty.push(url);
      });
      const assertNoPageErrors = monitorPageErrors(page);
      await gotoWalletPage(page, path);
      await page.waitForTimeout(500);
      expect(thirdParty).toEqual([]);
      assertNoPageErrors();
    });
  }
});

/* ══════════════════════════════════════════════════════════
   Scenario 15 — Web3 tablet WalletConnect retry lifecycle
   ══════════════════════════════════════════════════════════ */
const WC_MOCK_MODULE = `
  const state = { pending: null, provider: null, uriCount: 0 };
  function makeProvider() {
    const listeners = new Map();
    const provider = {
      session: null,
      accounts: [],
      enable: function() {
        state.uriCount += 1;
        (listeners.get("display_uri") || []).forEach((fn) => fn("wc:mock-uri-" + state.uriCount));
        return new Promise((resolve, reject) => { state.pending = { resolve, reject }; });
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
      disconnect: async () => null,
    };
    state.provider = provider;
    return provider;
  }
  window.__wcMock = {
    uriCount: () => state.uriCount,
    approve: (address) => {
      if (state.provider) state.provider.accounts = [address];
      if (state.pending) state.pending.resolve([address]);
    },
    reject: (error) => state.pending && state.pending.reject(error),
  };
  export const EthereumProvider = { init: async () => makeProvider() };
`;

test.describe("S15: Web3 tablet pending WalletConnect session", () => {
  test("cancel, re-tap, approve, disconnect and reconnect stay usable", async ({ browser }) => {
    const { context, page, deeplinks } = await newMobilePage(
      browser,
      { width: 820, height: 1180 },
      TABLET_UA
    );
    try {
      const assertNoPageErrors = monitorPageErrors(page);
      await context.route("**/assets/vendor/walletconnect-ethereum-provider-2.25.0.esm.js", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/javascript",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: WC_MOCK_MODULE,
        });
      });
      await gotoWalletPage(page, "/web3/");
      await page.evaluate(() => { delete window.ethereum; });

      const btn = page.locator(".nav-actions [data-wallet-connect]");
      const walletState = page.locator("[data-wallet-state]").first();
      const walletDialog = page.locator("[data-wallet-dialog]");
      const walletChooser = page.locator("[data-wallet-chooser]");
      const walletConnectOption = page.locator('[data-wallet-option="walletconnect"]');

      await btn.click();
      await expect(walletChooser).toHaveClass(/is-open/);
      await walletConnectOption.click();
      await expect(walletDialog).toHaveClass(/is-open/);
      await expect.poll(() => page.evaluate(() => Boolean(window.__wcMock))).toBe(true);
      await expect.poll(() => page.evaluate(() => window.__wcMock.uriCount())).toBe(1);

      await page.evaluate(() => {
        const error = new Error("User rejected.");
        error.code = 4001;
        window.__wcMock.reject(error);
      });
      await expect(walletState).toHaveText("Rejected");
      await expect(btn).toBeEnabled();
      await expect(btn).toHaveText("Connect Wallet");

      await page.locator("[data-wallet-dialog-close]").click();
      await expect(walletDialog).not.toHaveClass(/is-open/);
      await btn.click();
      await walletConnectOption.click();
      await expect.poll(() => page.evaluate(() => window.__wcMock.uriCount())).toBe(2);

      await page.evaluate((addr) => window.__wcMock.approve(addr), MOCK_ADDR);
      await expect(walletState).toContainText("Connected", { timeout: 10000 });
      await expect(btn).toHaveText(/connected/i);
      expect(await page.evaluate(() => window.IFRWallet.isConnected())).toBe(true);

      await page.evaluate(() => window.IFRWallet.disconnect());
      expect(await page.evaluate(() => window.IFRWallet.isConnected())).toBe(false);
      await btn.click();
      await walletConnectOption.click();
      await expect.poll(() => page.evaluate(() => window.__wcMock.uriCount())).toBe(3);
      await page.evaluate((addr) => window.__wcMock.approve(addr), MOCK_ADDR);
      await expect(walletState).toContainText("Connected", { timeout: 10000 });

      expect(deeplinks).toEqual([]);
      assertNoPageErrors();
    } finally {
      await context.close();
    }
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 16 — Web3 tablet injected-session reload
   ══════════════════════════════════════════════════════════ */
test.describe("S16: Web3 tablet session reload", () => {
  test("reload with existing injected session auto-reconnects", async ({ browser }) => {
    const { context, page } = await newMobilePage(
      browser,
      { width: 820, height: 1180 },
      TABLET_UA
    );
    try {
      const assertNoPageErrors = monitorPageErrors(page);
      await context.addInitScript(mockMetaMask(MOCK_ADDR));
      await gotoWalletPage(page, "/web3/");

      await page.locator(".nav-actions [data-wallet-connect]").click();
      await page.locator('[data-wallet-option-type="injected"]').first().click();
      await expect(page.locator("[data-wallet-state]").first()).toContainText("Connected", { timeout: 10000 });

      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForWalletRuntime(page);
      await expect(page.locator("[data-wallet-state]").first()).toContainText("Connected", { timeout: 10000 });
      expect(await page.evaluate(() => window.IFRWallet.isConnected())).toBe(true);
      assertNoPageErrors();
    } finally {
      await context.close();
    }
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 12 — Quick Connect→Disconnect→Connect
   ══════════════════════════════════════════════════════════ */
test.describe("S12: Rapid connect/disconnect cycle", () => {
  test("connect→disconnect→connect works without refresh", async ({ page }) => {
    const assertNoPageErrors = monitorPageErrors(page);
    await gotoWalletPage(page, "/");
    await page.evaluate(mockMetaMask(MOCK_ADDR));

    const btn = page.locator("#connect");
    const connectedDiv = page.locator("#lp-header-connected");

    // Connect #1
    await btn.click();
    await expect(connectedDiv).toBeVisible({ timeout: 10000 });

    // Disconnect
    await page.evaluate(() => window.lpDisconnect());
    await expect(btn).toBeVisible();

    // Re-inject mock (disconnect cleared _ethereumProvider)
    await page.evaluate(mockMetaMask(MOCK_ADDR));

    // Connect #2
    await btn.click();
    await expect(connectedDiv).toBeVisible({ timeout: 10000 });

    // Verify short address still correct
    const addr = await page.locator("#lp-header-addr").textContent();
    expect(addr).toBe(MOCK_SHORT);
    assertNoPageErrors();
  });
});
