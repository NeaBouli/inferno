// @ts-check
// The fixed Copilot launcher (#ifr-btn on Landing/Wiki, .copilot-launcher on Web3) must not
// cover footer links when a visitor scrolls to the very end of the page.
const { test, expect } = require("@playwright/test");

const PAGES = ["/", "/wiki/open-audit.html", "/wiki/faq.html", "/web3/"];
const VIEWPORTS = [[1440, 1000], [1180, 820], [820, 1180], [390, 844]];

for (const path of PAGES) {
  for (const [width, height] of VIEWPORTS) {
    test(`footer links stay clear of the Copilot launcher on ${path} at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      // Late content (live data, fonts, reveal effects) can grow the page after the first scroll.
      // Scroll to the end until the document height is stable, then measure at the true page end.
      for (let attempt = 0, stable = 0; attempt < 20 && stable < 2; attempt += 1) {
        const before = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(150);
        const after = await page.evaluate(() => document.documentElement.scrollHeight);
        stable = after === before ? stable + 1 : 0;
      }
      expect(
        await page.evaluate(() => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 1),
        "the test must measure at the very end of the page"
      ).toBe(true);
      const covered = await page.evaluate(() => {
        const footer = document.querySelector("footer, .wiki-footer, .footer");
        const launcher = document.querySelector("#ifr-btn, .copilot-launcher");
        if (!footer || !launcher) return ["missing footer or launcher"];
        const z = launcher.getBoundingClientRect();
        return [...footer.querySelectorAll("a, button")]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.left < z.right && r.right > z.left && r.top < z.bottom && r.bottom > z.top;
          })
          .map((el) => el.textContent.trim());
      });
      expect(covered).toEqual([]);
    });
  }
}

// Mid-page content scrolls under the fixed launcher too. Because the launcher is fixed, every vertical
// position of the lost-IFR card passes behind it while scrolling, so no rendered text of the card may enter
// the launcher's horizontal band (measured on the actual text boxes, not element boxes).
for (const [width, height] of VIEWPORTS) {
  test(`lost-IFR card text stays clear of the Copilot launcher band at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await page.locator("[data-lost-ifr-status]").scrollIntoViewIfNeeded();
    const covered = await page.evaluate(() => {
      const launcher = document.querySelector("#ifr-btn");
      const card = document.querySelector("[data-lost-ifr]");
      if (!launcher || !card) return ["missing launcher or card"];
      const z = launcher.getBoundingClientRect();
      const hits = [];
      for (const el of card.querySelectorAll("*")) {
        if (el.children.length) continue;
        const range = document.createRange();
        range.selectNodeContents(el);
        for (const r of range.getClientRects()) {
          if (r.width > 0 && r.left < z.right && r.right > z.left) hits.push(el.textContent.trim().slice(0, 40));
        }
      }
      return hits;
    });
    expect(covered).toEqual([]);
  });
}

// T-268: callout boxes on the business onboarding page keep their text out of the launcher band, like the
// lost-IFR and council-vote cards; the launcher itself stays visible for chat access.
for (const [width, height] of [[375, 812], [390, 844], [600, 900], [768, 1024]]) {
  test(`onboarding callout text stays clear of the Copilot launcher band at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
    await page.goto("/wiki/business-onboarding.html");
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(() => {
      const launcher = document.querySelector("#ifr-btn");
      const callouts = document.querySelectorAll(".callout");
      if (!launcher || !callouts.length) return { hits: ["missing launcher or callouts"], shown: false };
      const s = getComputedStyle(launcher);
      const z = launcher.getBoundingClientRect();
      const hits = [];
      for (const callout of callouts) {
        const walker = document.createTreeWalker(callout, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const r of range.getClientRects()) {
            if (r.width > 0 && r.left < z.right && r.right > z.left) hits.push(n.textContent.trim().slice(0, 40));
          }
        }
      }
      return { hits, shown: s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0 };
    });
    expect(result.hits).toEqual([]);
    expect(result.shown, "the launcher stays available for chat").toBe(true);
  });
}

// T-268: an open Web3 dialog is fixed to the viewport, so its fields cannot scroll away from the launcher.
// While a dialog is open the launcher must not sit on its text or controls; once it closes, chat is reachable again.
for (const [width, height] of [[375, 812], [375, 900], [390, 844]]) {
  test(`Web3 withdraw dialog stays clear of the Copilot launcher at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
    await page.goto("/web3/?action=lending-offer");
    await page.evaluate(() => document.fonts.ready);
    // The action opens the lending dialog and then, after an async wallet lookup, the wallet chooser on top of it.
    // Wait for that explicit state instead of a one-shot visibility check: a chooser that opens late would
    // otherwise intercept the close click below (T-278).
    const lendingDialog = page.locator("[data-lending-dialog]");
    const chooser = page.locator("[data-wallet-chooser]");
    await expect(lendingDialog).toHaveClass(/is-open/);
    await expect(chooser).toHaveClass(/is-open/);
    await page.locator("[data-wallet-chooser-close]").click();
    await expect(chooser).not.toHaveClass(/is-open/);
    await expect(lendingDialog).toHaveClass(/is-open/);
    const launcherVisibility = () =>
      page.locator(".copilot-launcher").evaluate((el) => getComputedStyle(el).visibility);
    // While the dialog is open the launcher steps back; poll the computed state, no fixed waits.
    await expect.poll(launcherVisibility).toBe("hidden");
    const covered = await page.evaluate(() => {
      const launcher = document.querySelector(".copilot-launcher");
      const card = document.querySelector("[data-lending-dialog] .protocol-card");
      if (!launcher || !card) return ["missing launcher or dialog"];
      const s = getComputedStyle(launcher);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return [];
      const z = launcher.getBoundingClientRect();
      const overlaps = (r) => r.width > 0 && r.height > 0 && r.left < z.right && r.right > z.left && r.top < z.bottom && r.bottom > z.top;
      const hits = [];
      for (const el of card.querySelectorAll("a, button, input, select, label, [role=button]")) {
        if (el.getClientRects().length && overlaps(el.getBoundingClientRect())) hits.push(`control ${el.textContent.trim().slice(0, 30) || el.tagName}`);
      }
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (overlaps(r)) hits.push(`text ${n.textContent.trim().slice(0, 30)}`);
      }
      return hits;
    });
    expect(covered).toEqual([]);
    await page.locator("[data-lending-close]").click();
    await expect(lendingDialog).not.toHaveClass(/is-open/);
    await expect.poll(launcherVisibility).toBe("visible");
    await expect(page.locator(".copilot-launcher")).toBeVisible();
    await page.locator(".copilot-launcher").click();
    await expect(page.locator("[data-copilot-panel]")).toHaveAttribute("aria-hidden", "false");
  });
}

// T-268: the Web3 hero buttons are full width on phones. Every scroll position moves them past the fixed
// launcher, so their boxes must end left of the launcher band; the launcher itself stays shown.
for (const [width, height] of [[375, 812], [390, 844], [680, 900], [820, 1180]]) {
  test(`Web3 hero buttons stay clear of the Copilot launcher band at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
    await page.goto("/web3/");
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(() => {
      const launcher = document.querySelector(".copilot-launcher");
      const buttons = [...document.querySelectorAll(".hero-actions .btn")].filter((el) => el.getClientRects().length);
      if (!launcher || !buttons.length) return { hits: ["missing launcher or hero buttons"], shown: false };
      const s = getComputedStyle(launcher);
      const z = launcher.getBoundingClientRect();
      const hits = buttons
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.left < z.right && r.right > z.left;
        })
        .map((el) => el.textContent.trim());
      return { hits, shown: s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0 };
    });
    expect(result.hits).toEqual([]);
    expect(result.shown, "the launcher stays available for chat").toBe(true);
  });
}

// T-268b: the informative wallet labels next to the hero (MetaMask … WalletConnect) pass the fixed launcher
// while scrolling too, so their text boxes must stay out of the launcher band on phones and tablets.
for (const [width, height] of [[375, 812], [390, 844], [680, 900], [820, 1180], [900, 1000], [980, 1000]]) {
  test(`Web3 wallet labels stay clear of the Copilot launcher band at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
    await page.goto("/web3/");
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(() => {
      const launcher = document.querySelector(".copilot-launcher");
      const chips = [...document.querySelectorAll(".wallet-strip .wallet-chip")].filter((el) => el.getClientRects().length);
      if (!launcher || !chips.length) return { hits: ["missing launcher or wallet labels"], shown: false };
      const s = getComputedStyle(launcher);
      const z = launcher.getBoundingClientRect();
      const hits = chips
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.left < z.right && r.right > z.left;
        })
        .map((el) => el.textContent.trim());
      return { hits, shown: s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0 };
    });
    expect(result.hits).toEqual([]);
    expect(result.shown, "the launcher stays available for chat").toBe(true);
  });
}
