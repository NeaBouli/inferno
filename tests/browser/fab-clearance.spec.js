// @ts-check
// The fixed Copilot launcher (#ifr-btn on Landing/Wiki, .copilot-launcher on Web3) must not
// cover footer links when a visitor scrolls to the very end of the page.
const { test, expect } = require("@playwright/test");

const PAGES = ["/", "/wiki/open-audit.html", "/wiki/faq.html", "/web3/"];
const VIEWPORTS = [[1440, 1000], [1180, 820], [820, 1180], [390, 844]];

// PR261: measure the real unavailable state, not an injected notice or a centered-only view.
for (const [width, height] of [[375, 812], ...VIEWPORTS]) {
  test(`RPC notice and wizard stay clear at uncentered positions at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const failedRpc = new Set();
    const rpcHosts = ["ethereum-rpc.publicnode.com", "eth.drpc.org", "1rpc.io"];
    await page.route(/^https?:\/\/(?!localhost)/, (route) => {
      const host = new URL(route.request().url()).hostname;
      if (rpcHosts.includes(host) && route.request().method() === "POST") failedRpc.add(host);
      return route.abort();
    });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const notice = page.locator("#ifr-rpc-error");
    await expect(notice).toBeVisible({ timeout: 15000 });
    await expect(notice).toHaveAttribute("role", "alert");
    await expect(notice).toContainText("no public RPC endpoint answered for Mainnet");
    expect([...failedRpc].sort(), "all real public RPC endpoints failed").toEqual([...rpcHosts].sort());
    expect(await notice.evaluate((el) => el.nextElementSibling && el.nextElementSibling.id)).toBe("wz-progress");
    expect(await notice.evaluate((el) => getComputedStyle(el).position)).toBe("static");

    // Only native navigation clicks; geometry is then checked away from Playwright's click centering.
    for (const path of [[], ["lock"], ["lend_choice"], ["benefits", "benefits_customer"], ["benefits", "benefits_seller"]]) {
      await page.locator('#wizard button[onclick="wzReset()"]').click();
      for (const step of path) await page.locator(`#wz-box button[onclick="wzGo('${step}')"]`).click();
      await expect(notice).toBeVisible();
      await expect(page.locator("#wz-box .wz-option").first()).toBeVisible();
      await page.locator("#ifr-btn").hover();
      const result = await page.evaluate(async () => {
        const wizard = document.querySelector("#wizard");
        const launcher = document.querySelector("#ifr-btn");
        const alert = document.querySelector("#ifr-rpc-error");
        const progress = document.querySelector("#wz-progress");
        if (!wizard || !launcher || !alert || !progress) return { hits: ["missing wizard, launcher, alert or progress"] };
        const hits = [];
        const controls = [...wizard.querySelectorAll("button, a")].filter((el) => el.getClientRects().length);
        const ranges = [];
        const walker = document.createTreeWalker(wizard, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          if (range.getClientRects().length) ranges.push(range);
        }
        const targets = [alert, ...controls];
        const positions = [window.scrollY];
        const z = launcher.getBoundingClientRect();
        for (const target of targets) {
          const r = target.getBoundingClientRect();
          for (const offset of [-12, z.height / 2, z.height + 12]) {
            positions.push(window.scrollY + r.top - z.top - offset);
          }
        }
        for (const range of ranges) {
          const r = range.getBoundingClientRect();
          positions.push(window.scrollY + r.top - z.top - z.height / 2);
        }
        for (const top of positions) {
          window.scrollTo({ top, behavior: "instant" });
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const l = launcher.getBoundingClientRect();
          const a = alert.getBoundingClientRect();
          const state = getComputedStyle(launcher);
          if (state.display === "none" || state.visibility !== "visible" || Number(state.opacity) !== 1 || l.width < 44 || l.height < 44) hits.push("launcher hidden or undersized");
          if (a.bottom > progress.getBoundingClientRect().top) hits.push("alert overlaps progress");
          const overlaps = (r, other) => r.width > 0 && r.height > 0 && r.left < other.right && r.right > other.left && r.top < other.bottom && r.bottom > other.top;
          for (const control of controls) {
            const r = control.getBoundingClientRect();
            if (r.width < 44 || r.height < 44) hits.push(`undersized ${control.textContent.trim()}`);
            if (overlaps(r, l)) hits.push(`launcher/control at ${window.scrollY}`);
            if (!alert.contains(control) && overlaps(r, a)) hits.push(`alert/control at ${window.scrollY}`);
            if (r.right > l.left && r.left < l.right) hits.push("control enters launcher band");
            if (control.scrollWidth > control.clientWidth + 1 || control.scrollHeight > control.clientHeight + 1) hits.push("control content overflow");
          }
          for (const range of ranges) {
            const parent = range.startContainer.parentElement;
            const container = parent && parent.closest(".wz-option, #ifr-rpc-error, #wz-box, #wz-progress, #wizard > div");
            if (!container) { hits.push("text without measured container"); continue; }
            const box = container.getBoundingClientRect();
            for (const r of range.getClientRects()) {
              if (!r.width || !r.height) continue;
              if (overlaps(r, l)) hits.push(`launcher/text at ${window.scrollY}`);
              if (!alert.contains(parent) && overlaps(r, a)) hits.push(`alert/text at ${window.scrollY}`);
              if (r.right > l.left && r.left < l.right) hits.push("text enters launcher band");
              if (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1) hits.push("text outside container");
            }
          }
          if (document.documentElement.scrollWidth > document.documentElement.clientWidth) hits.push("horizontal document overflow");
        }
        return { hits, positions: positions.length };
      });
      expect(result.hits, `wizard path ${path.join(" -> ") || "start"}`).toEqual([]);
      expect(result.positions, "multiple uncentered positions measured").toBeGreaterThan(3);
    }
    await notice.getByRole("button", { name: "Dismiss network notice" }).click();
    await expect(notice).toHaveCount(0);
    await expect(page.locator("#wz-box .wz-option").first()).toBeVisible();
    await expect(page.locator("#ifr-btn")).toBeVisible();
  });

  test(`changed FAQ answers and native toggles stay clear at uncentered positions at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
    await page.goto("/wiki/faq.html");
    await page.evaluate(() => document.fonts.ready);
    expect(await page.locator(".faq-q").evaluateAll((buttons) => buttons.every((btn) => btn.getAttribute("aria-expanded") === "false"))).toBe(true);
    const items = page.locator(".faq-item").filter({ hasText: /700 contract tests|ADVISORY|Phase 4 design option|Privacy changes await/ });
    expect(await items.count(), "changed count, governance and privacy answers are present").toBeGreaterThanOrEqual(5);
    for (let index = 0; index < await items.count(); index += 1) {
      const item = items.nth(index);
      const button = item.locator(".faq-q");
      const answer = item.locator(".faq-a");
      const icon = button.locator(".icon");
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await expect(answer).toBeVisible();
      await expect(icon).toHaveText("\u2212");
      await expect(icon).toHaveAttribute("aria-hidden", "true");
      expect(await icon.evaluate((el) => getComputedStyle(el).transform)).toBe("none");
      await page.locator("#ifr-btn").hover();
      const result = await item.evaluate(async (el) => {
        const launcher = document.querySelector("#ifr-btn");
        const answer = el.querySelector(".faq-a");
        const question = el.querySelector(".faq-q");
        const icon = el.querySelector(".icon");
        if (!launcher || !answer || !question || !icon) return { hits: ["missing FAQ answer, question, icon or launcher"] };
        const hits = [];
        const controls = [...el.querySelectorAll("button, a")].filter((node) => node.getClientRects().length);
        const ranges = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          for (let i = 0; i < range.getClientRects().length; i += 1) ranges.push({ range, index: i });
        }
        const l = launcher.getBoundingClientRect();
        const positions = [window.scrollY];
        for (const { range, index } of ranges) {
          const r = range.getClientRects()[index];
          positions.push(window.scrollY + r.top - l.top - l.height / 2);
        }
        for (const target of controls) {
          const r = target.getBoundingClientRect();
          for (const offset of [-12, l.height / 2, l.height + 12]) positions.push(window.scrollY + r.top - l.top - offset);
        }
        for (const top of positions) {
          window.scrollTo({ top, behavior: "instant" });
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const z = launcher.getBoundingClientRect();
          const style = getComputedStyle(launcher);
          if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) !== 1 || z.width < 44 || z.height < 44) hits.push("launcher hidden or undersized");
          const overlaps = (r) => r.width > 0 && r.height > 0 && r.left < z.right && r.right > z.left && r.top < z.bottom && r.bottom > z.top;
          const box = el.getBoundingClientRect();
          for (const control of controls) {
            const r = control.getBoundingClientRect();
            if (overlaps(r)) hits.push(`launcher/control at ${window.scrollY}`);
            if (r.right > z.left && r.left < z.right) hits.push("control enters launcher band");
            if (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1) hits.push("control outside FAQ");
          }
          const q = question.getBoundingClientRect();
          const i = icon.getBoundingClientRect();
          if (q.width < 44 || q.height < 44) hits.push("undersized native question");
          if (i.width < 18 || i.height < 18 || i.left < q.left || i.right > q.right || i.top < q.top || i.bottom > q.bottom) hits.push("clipped or undersized icon");
          if (question.scrollWidth > question.clientWidth + 1 || answer.scrollWidth > answer.clientWidth + 1 || answer.scrollHeight > answer.clientHeight + 1) hits.push("FAQ content overflow");
          for (const { range, index } of ranges) {
            const r = range.getClientRects()[index];
            if (!r.width || !r.height) continue;
            if (overlaps(r)) hits.push(`launcher/text at ${window.scrollY}`);
            if (r.right > z.left && r.left < z.right) hits.push("text enters launcher band");
            if (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1) hits.push("text outside FAQ");
          }
          if (document.documentElement.scrollWidth > document.documentElement.clientWidth) hits.push("horizontal document overflow");
        }
        return { hits, positions: positions.length };
      });
      expect(result.hits, await button.textContent()).toEqual([]);
      expect(result.positions, "answer lines measured at uncentered positions").toBeGreaterThan(3);
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await expect(answer).toBeHidden();
      await expect(icon).toHaveText("+");
      expect(await icon.evaluate((el) => getComputedStyle(el).transform)).toBe("none");
    }
    await page.locator(".faq-q").first().focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".faq-q").first()).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Space");
    await expect(page.locator(".faq-q").first()).toHaveAttribute("aria-expanded", "false");
  });
}

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

// T-287: on narrow phones the hero body text and the full-width access-panel buttons pass the fixed launcher while
// scrolling. Disconnected baseline here; the connected and degraded wallet states run in web3-write.spec.js (mock wallet).
for (const [width, height] of [[305, 720], [320, 740], [375, 812]]) {
  test(`Web3 hero copy and access-panel buttons stay clear of the Copilot launcher band at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
    await page.goto("/web3/");
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(() => {
      const launcher = document.querySelector(".copilot-launcher");
      const buttons = [...document.querySelectorAll(".access-panel .panel-actions .btn")].filter((el) => el.getClientRects().length);
      if (!launcher || !buttons.length) return { hits: ["missing launcher or panel buttons"], shown: false };
      const s = getComputedStyle(launcher);
      const z = launcher.getBoundingClientRect();
      const inBand = (r) => r.width > 0 && r.left < z.right && r.right > z.left;
      const hits = buttons.filter((el) => inBand(el.getBoundingClientRect())).map((el) => `button ${el.textContent.trim()}`);
      for (const el of document.querySelectorAll(".hero .hero-copy, .access-panel .panel-foot")) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          if ([...range.getClientRects()].some(inBand)) hits.push(`text ${el.className}`);
        }
      }
      return {
        hits,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        shown: s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0,
      };
    });
    expect(result.hits).toEqual([]);
    expect(result.overflow, "no horizontal document overflow").toBeLessThanOrEqual(0);
    expect(result.shown, "the launcher stays available for chat").toBe(true);
  });
}
