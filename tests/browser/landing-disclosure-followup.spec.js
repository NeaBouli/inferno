const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

test.describe.configure({ timeout: 60000 });
test.use({ serviceWorkers: 'block', acceptDownloads: false });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

for (const [width, height] of [[375, 812], [390, 844], [820, 1180], [1180, 820], [1440, 1000]]) {
  test(`changed Landing disclosures render and operate at ${width}x${height}`, async ({ page }, info) => {
    const errors = [], fontTasks = [], observations = [];
    const remoteFonts = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
    let blockedRequests = 0;
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.name));
    page.on('response', response => {
      if (remoteFonts.has(new URL(response.url()).hostname)) {
        fontTasks.push(response.body().then(bytes => ({ url: response.url(), status: response.status(), bytes: bytes.length, sha256: hash(bytes) }))
          .catch(() => ({ url: response.url(), status: response.status(), error: 'FONT_BODY_UNAVAILABLE' })));
      }
    });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.protocol === 'https:' && remoteFonts.has(url.hostname)) return route.continue();
      blockedRequests++;
      return route.abort();
    });
    const section = id => page.locator(`#${id}`);
    const toggle = id => section(id).locator(':scope > .landing-collapse-heading > button');
    const align = async id => {
      await section(id).evaluate(element => {
        const navBottom = Math.max(0, document.querySelector('nav')?.getBoundingClientRect().bottom || 0);
        window.scrollTo({ top: Math.max(0, window.scrollY + element.getBoundingClientRect().top - navBottom - 16), behavior: 'instant' });
      });
    };
    const inspect = async (id, state, filename) => {
      await align(id);
      const geometry = await toggle(id).evaluate(button => {
        const b = button.getBoundingClientRect(), heading = button.parentElement, h = heading.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(heading.querySelector('h2'));
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return { width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth,
          targetWidth: b.width, targetHeight: b.height, unobstructed: !!hit && (hit === button || button.contains(hit)),
          titleFits: [...range.getClientRects()].every(r => r.left >= h.left && r.right <= h.right),
          expanded: button.getAttribute('aria-expanded'), panelHidden: document.getElementById(button.getAttribute('aria-controls')).hidden };
      });
      expect(geometry.width).toBe(width); expect(geometry.height).toBe(height);
      expect(geometry.overflow).toBe(0); expect(geometry.targetWidth).toBeGreaterThanOrEqual(44);
      expect(geometry.targetHeight).toBeGreaterThanOrEqual(44); expect(geometry.unobstructed).toBe(true);
      expect(geometry.titleFits).toBe(true); expect(geometry.expanded).toBe(String(state)); expect(geometry.panelHidden).toBe(!state);
      observations.push({ id, ...geometry });
      await page.screenshot({ path: info.outputPath(filename), animations: 'disabled' });
    };
    try {
      await page.goto('/');
      const loadedFonts = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(font => font.status === 'loaded').length; });
      expect(loadedFonts, 'real Google fonts must load; fallback-only captures are not acceptance').toBeGreaterThan(0);
      for (const id of ['partners', 'roadmap', 'token-flow']) await expect(toggle(id)).toHaveAttribute('aria-expanded', 'false');
      await expect(toggle('partners')).toHaveAccessibleName('Directory Builders & Creators');
      await expect(toggle('ecosystem')).toHaveAccessibleName('Ecosystem One Token. Many Products.');
      await inspect('token-flow', false, '00-closed-headers.png');
      if (width === 375 || width === 1440) await inspect('roadmap', false, '00-roadmap-closed.png');
      for (const id of ['partners', 'roadmap', 'token-flow']) {
        await toggle(id).click();
        await expect(section(id).locator(':scope > .landing-collapse-panel')).toBeVisible();
        await inspect(id, true, `${id}-open.png`);
        await toggle(id).press('Space');
        await expect(toggle(id)).toHaveAttribute('aria-expanded', 'false');
        await expect(section(id).locator(':scope > .landing-collapse-panel')).toBeHidden();
      }
      const fonts = await Promise.all(fontTasks);
      expect(fonts.length).toBeGreaterThan(0); expect(fonts.every(font => font.status === 200 && typeof font.sha256 === 'string')).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      fs.writeFileSync(info.outputPath('observations.json'), JSON.stringify({ eventSHA: process.env.GITHUB_SHA || null,
        htmlSHA256: hash(fs.readFileSync(path.join(__dirname, '../../docs/index.html'))),
        disclosureSHA256: hash(fs.readFileSync(path.join(__dirname, '../../docs/assets/landing-collapse.js'))),
        viewport: { width, height }, observations, fonts: await Promise.all(fontTasks), pageErrors: errors,
        blockedRequests, state: 'SYNTHETIC_OFFLINE_DATA_REAL_FONTS', walletOrProviderAction: false }, null, 2));
    }
  });
}
