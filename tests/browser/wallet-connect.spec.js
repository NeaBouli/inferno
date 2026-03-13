// @ts-check
const { test, expect } = require("@playwright/test");

/* ──────────────────────────────────────────────────────────────
   Suite 1 — Landing Page (docs/index.html)
   ────────────────────────────────────────────────────────────── */
test.describe("Landing Page", () => {
  test.beforeEach(async ({ page }) => {
    // Collect console errors
    page._jsErrors = [];
    page.on("pageerror", (err) => page._jsErrors.push(err.message));
    await page.goto("/", { waitUntil: "networkidle" });
  });

  test("page loads without JS errors", async ({ page }) => {
    // Allow known RPC/network errors but no syntax/reference errors
    const critical = page._jsErrors.filter(
      (m) => !m.includes("Failed to fetch") && !m.includes("NetworkError") && !m.includes("net::ERR")
    );
    expect(critical).toEqual([]);
  });

  test("ethers.js is loaded", async ({ page }) => {
    const hasEthers = await page.evaluate(() => typeof window.ethers !== "undefined");
    expect(hasEthers).toBe(true);
  });

  test("IFRWallet module is loaded", async ({ page }) => {
    const hasWallet = await page.evaluate(() => typeof window.IFRWallet !== "undefined");
    expect(hasWallet).toBe(true);
  });

  test("IFRState module is loaded", async ({ page }) => {
    const hasState = await page.evaluate(() => typeof window.IFRState !== "undefined");
    expect(hasState).toBe(true);
  });

  test("connect button exists and is visible", async ({ page }) => {
    const btn = page.locator("#lp-header-connect-btn");
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  test("lpConnect function is globally accessible", async ({ page }) => {
    const hasFn = await page.evaluate(() => typeof window.lpConnect === "function");
    expect(hasFn).toBe(true);
  });

  test("connect button clickable without crash (no wallet)", async ({ page }) => {
    // Should show alert or change button — NOT crash
    page.on("dialog", (d) => d.dismiss());
    const btn = page.locator("#lp-header-connect-btn");
    await btn.click();
    // Page should still be alive (no unhandled exception crash)
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });

  test("IFRWallet has correct public API", async ({ page }) => {
    const api = await page.evaluate(() => {
      const w = window.IFRWallet;
      return {
        connect: typeof w.connect,
        disconnect: typeof w.disconnect,
        autoReconnect: typeof w.autoReconnect,
        isConnected: typeof w.isConnected,
        getAddress: typeof w.getAddress,
        getShortAddress: typeof w.getShortAddress,
        getSigner: typeof w.getSigner,
        getProvider: typeof w.getProvider,
        on: typeof w.on,
        off: typeof w.off,
      };
    });
    for (const [key, val] of Object.entries(api)) {
      expect(val, `IFRWallet.${key} should be a function`).toBe("function");
    }
  });

  test("IFRState has correct public API", async ({ page }) => {
    const api = await page.evaluate(() => {
      const s = window.IFRState;
      return {
        load: typeof s.load,
        getCache: typeof s.getCache,
        hasAccess: typeof s.hasAccess,
        startAutoRefresh: typeof s.startAutoRefresh,
        stopAutoRefresh: typeof s.stopAutoRefresh,
        on: typeof s.on,
        CONTRACTS: typeof s.CONTRACTS,
      };
    });
    expect(api.load).toBe("function");
    expect(api.getCache).toBe("function");
    expect(api.hasAccess).toBe("function");
    expect(api.CONTRACTS).toBe("object");
  });

  test("IFRState.CONTRACTS has correct mainnet addresses", async ({ page }) => {
    const contracts = await page.evaluate(() => window.IFRState.CONTRACTS);
    expect(contracts.token).toBe("0x77e99917Eca8539c62F509ED1193ac36580A6e7B");
    expect(contracts.lock).toBe("0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb");
    expect(contracts.bootstrap).toBe("0xf72565C4cDB9575c9D3aEE6B9AE3fDBd7F56e141");
  });
});

/* ──────────────────────────────────────────────────────────────
   Suite 2 — Bootstrap Page (docs/wiki/bootstrap.html)
   ────────────────────────────────────────────────────────────── */
test.describe("Bootstrap Page", () => {
  test.beforeEach(async ({ page }) => {
    page._jsErrors = [];
    page.on("pageerror", (err) => page._jsErrors.push(err.message));
    await page.goto("/wiki/bootstrap.html", { waitUntil: "networkidle" });
  });

  test("page loads without JS errors", async ({ page }) => {
    const critical = page._jsErrors.filter(
      (m) => !m.includes("Failed to fetch") && !m.includes("NetworkError") && !m.includes("net::ERR")
    );
    expect(critical).toEqual([]);
  });

  test("ethers + IFRWallet + IFRState loaded", async ({ page }) => {
    const loaded = await page.evaluate(() => ({
      ethers: typeof window.ethers !== "undefined",
      wallet: typeof window.IFRWallet !== "undefined",
      state: typeof window.IFRState !== "undefined",
    }));
    expect(loaded.ethers).toBe(true);
    expect(loaded.wallet).toBe(true);
    expect(loaded.state).toBe(true);
  });

  test("sidebar connect button exists and styled", async ({ page }) => {
    const btn = page.locator("#lp-header-connect-btn");
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
    const bg = await btn.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg).toContain("gradient");
  });

  test("wallet notice replaces old connect section", async ({ page }) => {
    await expect(page.locator("#bw-wallet-notice")).toBeVisible();
    await expect(page.locator("#bw-connect-section")).toHaveCount(0);
    await expect(page.locator("#bw-connected-section")).toHaveCount(0);
  });

  test("bwConnect function is globally accessible", async ({ page }) => {
    const hasFn = await page.evaluate(() => typeof window.bwConnect === "function");
    expect(hasFn).toBe(true);
  });

  test("bootstrap stats elements exist", async ({ page }) => {
    await expect(page.locator("#bw-countdown")).toBeVisible();
  });

  test("sidebar connect click without crash (no wallet)", async ({ page }) => {
    page.on("dialog", (d) => d.dismiss());
    const btn = page.locator("#lp-header-connect-btn");
    await btn.click();
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });
});

/* ──────────────────────────────────────────────────────────────
   Suite 3 — Multi-Wallet Detection (unit-style, in-page)
   ────────────────────────────────────────────────────────────── */
test.describe("Multi-Wallet Detection", () => {
  test("IFRWallet.connect rejects cleanly when no ethereum", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const result = await page.evaluate(async () => {
      // Ensure no ethereum
      delete window.ethereum;
      try {
        await window.IFRWallet.connect();
        return "no_error";
      } catch (e) {
        return e.message;
      }
    });
    expect(result).toBe("NO_METAMASK");
  });

  test("IFRWallet.connect finds MetaMask in providers array", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const result = await page.evaluate(async () => {
      // Simulate multi-wallet environment (EIP-5749)
      const mockMM = {
        isMetaMask: true,
        request: async ({ method }) => {
          if (method === "eth_requestAccounts") return ["0x1234567890abcdef1234567890abcdef12345678"];
          if (method === "eth_accounts") return ["0x1234567890abcdef1234567890abcdef12345678"];
          if (method === "eth_chainId") return "0x1";
          return null;
        },
        on: () => {},
        removeListener: () => {},
      };
      const mockExodus = { isMetaMask: true, isExodus: true };
      window.ethereum = {
        providers: [mockExodus, mockMM],
        request: async () => [],
        on: () => {},
      };
      try {
        const addr = await window.IFRWallet.connect();
        return addr;
      } catch (e) {
        return "ERROR:" + e.message;
      }
    });
    expect(result).toBe("0x1234567890abcdef1234567890abcdef12345678");
  });
});
