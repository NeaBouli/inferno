// @ts-check
const { test, expect } = require("@playwright/test");

// Mock MetaMask provider factory
function mockMetaMask(address) {
  return `
    window.ethereum = {
      isMetaMask: true,
      _address: "${address}",
      request: async function(req) {
        if (req.method === "eth_requestAccounts") return ["${address}"];
        if (req.method === "eth_accounts") return ["${address}"];
        if (req.method === "eth_chainId") return "0x1";
        if (req.method === "wallet_switchEthereumChain") return null;
        if (req.method === "net_version") return "1";
        return null;
      },
      on: function() {},
      removeListener: function() {},
    };
  `;
}

const MOCK_ADDR = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf01";
const MOCK_SHORT = "0xAbCd...Ef01";

/* ══════════════════════════════════════════════════════════
   Scenario 1 — Desktop: Connect + Disconnect
   ══════════════════════════════════════════════════════════ */
test.describe("S1: Desktop Connect + Disconnect", () => {
  test("connect with mock wallet, then disconnect resets UI", async ({ page }) => {
    page.on("pageerror", () => {}); // suppress RPC errors
    await page.goto("/", { waitUntil: "networkidle" });

    // Inject mock MetaMask
    await page.evaluate(mockMetaMask(MOCK_ADDR));

    // Click connect
    const btn = page.locator("#lp-header-connect-btn");
    await expect(btn).toBeVisible();
    await btn.click();

    // Wait for connected state
    const connectedDiv = page.locator("#lp-header-connected");
    await expect(connectedDiv).toBeVisible({ timeout: 10000 });

    // Verify address shown
    const addrEl = page.locator("#lp-header-addr");
    await expect(addrEl).toHaveText(MOCK_SHORT);

    // Now disconnect
    await page.evaluate(() => window.lpDisconnect());

    // Connect button should be back
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    const text = await btn.textContent();
    expect(text).toContain("Connect");

    // Connected div should be hidden
    await expect(connectedDiv).not.toBeVisible();
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 2 — Desktop: No MetaMask → "Install MetaMask"
   ══════════════════════════════════════════════════════════ */
test.describe("S2: No MetaMask installed", () => {
  test("button changes to Install MetaMask on desktop", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // Ensure no ethereum
    await page.evaluate(() => { delete window.ethereum; });

    const btn = page.locator("#lp-header-connect-btn");
    page.on("dialog", (d) => d.dismiss());
    await btn.click();

    // Should show "Install MetaMask"
    await expect(btn).toContainText("Install MetaMask", { timeout: 5000 });
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 3 — Multi-wallet: Exodus + MetaMask → MetaMask
   ══════════════════════════════════════════════════════════ */
test.describe("S3: Multi-wallet detection", () => {
  test("selects real MetaMask over Exodus imposter", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    const result = await page.evaluate(async () => {
      const mockMM = {
        isMetaMask: true,
        request: async function(req) {
          if (req.method === "eth_requestAccounts") return ["0xAA00000000000000000000000000000000000001"];
          if (req.method === "eth_accounts") return ["0xAA00000000000000000000000000000000000001"];
          if (req.method === "eth_chainId") return "0x1";
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
    });

    expect(result).toBe("0xAA00000000000000000000000000000000000001");
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 4 — Disconnect: button immediately resets
   ══════════════════════════════════════════════════════════ */
test.describe("S4: Disconnect instant reset", () => {
  test("button text resets to Connect, not Connecting...", async ({ page }) => {
    page.on("pageerror", () => {});
    await page.goto("/", { waitUntil: "networkidle" });
    await page.evaluate(mockMetaMask(MOCK_ADDR));

    // Connect
    await page.locator("#lp-header-connect-btn").click();
    await expect(page.locator("#lp-header-connected")).toBeVisible({ timeout: 10000 });

    // Disconnect
    await page.evaluate(() => window.lpDisconnect());

    // Button must show "Connect" immediately — not "Connecting..."
    const btn = page.locator("#lp-header-connect-btn");
    const text = await btn.textContent();
    expect(text).not.toContain("Connecting");
    expect(text).toContain("Connect");
    expect(await btn.isEnabled()).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 5 — autoReconnect after reload
   ══════════════════════════════════════════════════════════ */
test.describe("S5: autoReconnect", () => {
  test("reconnects after page reload without extra click", async ({ page }) => {
    page.on("pageerror", () => {});
    await page.goto("/", { waitUntil: "networkidle" });
    await page.evaluate(mockMetaMask(MOCK_ADDR));

    // Connect first
    await page.locator("#lp-header-connect-btn").click();
    await expect(page.locator("#lp-header-connected")).toBeVisible({ timeout: 10000 });

    // Inject mock again before reload (so it's available on new page)
    await page.addInitScript(mockMetaMask(MOCK_ADDR));
    await page.reload({ waitUntil: "networkidle" });

    // Should auto-reconnect — connected div visible without clicking
    await expect(page.locator("#lp-header-connected")).toBeVisible({ timeout: 10000 });
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 6 — Mobile viewport: Connect button visible
   ══════════════════════════════════════════════════════════ */
test.describe("S6: Mobile viewport", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("connect button visible on mobile", async ({ page }) => {
    page._jsErrors = [];
    page.on("pageerror", (err) => page._jsErrors.push(err.message));
    await page.goto("/", { waitUntil: "networkidle" });

    const btn = page.locator("#lp-header-connect-btn");
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 7 — Mobile: dropdown positioned under button
   ══════════════════════════════════════════════════════════ */
test.describe("S7: Mobile dropdown position", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("dropdown appears below button on mobile", async ({ page }) => {
    page.on("pageerror", () => {});
    await page.goto("/", { waitUntil: "networkidle" });
    await page.evaluate(mockMetaMask(MOCK_ADDR));

    // Connect
    await page.locator("#lp-header-connect-btn").click();
    await expect(page.locator("#lp-header-connected")).toBeVisible({ timeout: 10000 });

    // Open dropdown
    await page.locator("#lp-header-connected div").first().click();

    const dd = page.locator("#lp-header-dropdown");
    await expect(dd).toBeVisible();

    // Verify position is fixed and below button
    const style = await dd.evaluate((el) => ({
      position: el.style.position,
      top: parseInt(el.style.top),
    }));
    expect(style.position).toBe("fixed");
    expect(style.top).toBeGreaterThan(30);
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 8 — Mobile: No MetaMask → deeplink redirect
   ══════════════════════════════════════════════════════════ */
test.describe("S8: Mobile deeplink", () => {
  test("lpConnect calls deeplink on mobile without MetaMask", async ({ browser }) => {
    // Create context with mobile userAgent
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
    });
    const page = await context.newPage();

    // Intercept navigation to metamask deeplink
    let deeplink = null;
    await page.route("**/metamask.app.link/**", (route) => {
      deeplink = route.request().url();
      route.abort();
    });

    page.on("pageerror", () => {});
    await page.goto("http://localhost:8787/", { waitUntil: "networkidle" });

    // Remove ethereum so NO_METAMASK fires
    await page.evaluate(() => { delete window.ethereum; });

    // Click connect — should trigger deeplink navigation
    await page.locator("#lp-header-connect-btn").click().catch(() => {});

    // Give it a moment for the navigation to fire
    await page.waitForTimeout(1000);

    expect(deeplink).toContain("metamask.app.link");
    await context.close();
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 9 — Wiki pages: identical button style
   ══════════════════════════════════════════════════════════ */
test.describe("S9: Wiki button consistency", () => {
  const wikiPages = [
    "/wiki/tokenomics.html",
    "/wiki/roadmap.html",
    "/wiki/faq.html",
  ];

  for (const wikiPage of wikiPages) {
    test(`${wikiPage} has connect button in top-bar`, async ({ page }) => {
      page._jsErrors = [];
      page.on("pageerror", (err) => page._jsErrors.push(err.message));
      await page.goto(wikiPage, { waitUntil: "networkidle" });

      // No JS errors
      const critical = page._jsErrors.filter(
        (m) => !m.includes("Failed to fetch") && !m.includes("NetworkError") && !m.includes("net::ERR")
      );
      expect(critical).toEqual([]);

      // Button exists and styled with transparent background + orange border
      const btn = page.locator("#lp-header-connect-btn");
      await expect(btn).toBeVisible();
      const bg = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).toBe("rgba(0, 0, 0, 0)");
      const border = await btn.evaluate((el) => getComputedStyle(el).borderColor);
      expect(border).toContain("249");

      // Top-bar exists
      await expect(page.locator("#wiki-wallet-bar")).toBeVisible();

      // lpConnect globally available
      const hasFn = await page.evaluate(() => typeof window.lpConnect === "function");
      expect(hasFn).toBe(true);
    });
  }
});

/* ══════════════════════════════════════════════════════════
   Scenario 10 — Bootstrap: stats + wallet notice
   ══════════════════════════════════════════════════════════ */
test.describe("S10: Bootstrap page", () => {
  test("stats load and wallet notice shown", async ({ page }) => {
    page._jsErrors = [];
    page.on("pageerror", (err) => page._jsErrors.push(err.message));
    await page.goto("/wiki/bootstrap.html", { waitUntil: "networkidle" });

    const critical = page._jsErrors.filter(
      (m) => !m.includes("Failed to fetch") && !m.includes("NetworkError") && !m.includes("net::ERR")
    );
    expect(critical).toEqual([]);

    // Wallet notice visible
    await expect(page.locator("#bw-wallet-notice")).toBeVisible();

    // Old connect sections removed
    await expect(page.locator("#bw-connect-section")).toHaveCount(0);
    await expect(page.locator("#bw-connected-section")).toHaveCount(0);

    // Stats countdown exists
    await expect(page.locator("#bw-countdown")).toBeVisible();

    // Top-bar connect button
    await expect(page.locator("#lp-header-connect-btn")).toBeVisible();
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 11 — Wiki disconnect: button resets properly
   ══════════════════════════════════════════════════════════ */
test.describe("S11: Wiki disconnect reset", () => {
  test("disconnect on wiki page resets button to Connect", async ({ page }) => {
    page.on("pageerror", () => {});
    await page.goto("/wiki/tokenomics.html", { waitUntil: "networkidle" });
    await page.evaluate(mockMetaMask(MOCK_ADDR));

    // Connect
    await page.locator("#lp-header-connect-btn").click();
    await expect(page.locator("#lp-header-connected")).toBeVisible({ timeout: 10000 });

    // Disconnect
    await page.evaluate(() => window.lpDisconnect());

    // Button must show "Connect" not "Connecting..."
    const btn = page.locator("#lp-header-connect-btn");
    await expect(btn).toBeVisible();
    const text = await btn.textContent();
    expect(text).toContain("Connect");
    expect(text).not.toContain("Connecting");
  });
});

/* ══════════════════════════════════════════════════════════
   Scenario 12 — Quick Connect→Disconnect→Connect
   ══════════════════════════════════════════════════════════ */
test.describe("S12: Rapid connect/disconnect cycle", () => {
  test("connect→disconnect→connect works without refresh", async ({ page }) => {
    page.on("pageerror", () => {});
    await page.goto("/", { waitUntil: "networkidle" });
    await page.evaluate(mockMetaMask(MOCK_ADDR));

    const btn = page.locator("#lp-header-connect-btn");
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

    // Verify address still correct
    const addr = await page.locator("#lp-header-addr").textContent();
    expect(addr).toBe(MOCK_ADDR.slice(0, 6) + "..." + MOCK_ADDR.slice(-4));
  });
});
