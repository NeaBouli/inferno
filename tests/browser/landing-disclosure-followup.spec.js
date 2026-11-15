const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

test.describe.configure({ timeout: 60000 });
test.use({ serviceWorkers: 'block', acceptDownloads: false });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

for (const [width, height] of [[375, 812], [390, 844], [820, 1180], [1180, 820], [1440, 1000]]) {
  test(`changed Landing disclosures render and operate at ${width}x${height}`, async ({ page }, info) => {
    const errors = [], fontTasks = [], fontFailures = [], observations = [];
    const remoteFonts = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
    let blockedRequests = 0;
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.name));
    page.on('requestfailed', request => {
      if (remoteFonts.has(new URL(request.url()).hostname)) fontFailures.push('FONT_REQUEST_FAILED');
    });
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
      const usedFonts = await section(id).evaluate(async root => {
        const samples = new Map();
        for (const element of [document.body, ...root.querySelectorAll('h2,h3,h4,p,li,a,.lp-faq-q')]) {
          const box = element.getBoundingClientRect();
          if (box.width <= 0 || box.height <= 0) continue;
          const style = getComputedStyle(element), family = style.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
          const spec = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${JSON.stringify(family)}`;
          const sample = element === document.body ? 'Aa0' : element.textContent.trim().slice(0, 2048);
          samples.set(spec, { family, text: ((samples.get(spec)?.text || '') + sample).slice(0, 4096) || 'Aa0' });
        }
        const rows = [];
        for (const [spec, sample] of samples) {
          const faces = await document.fonts.load(spec, sample.text);
          rows.push({ family: sample.family, spec, faces: faces.length,
            loaded: faces.length > 0 && faces.every(face => face.status === 'loaded' && face.family.replace(/^["']|["']$/g, '') === sample.family),
            checked: document.fonts.check(spec, sample.text) });
        }
        await document.fonts.ready;
        return rows;
      });
      expect(usedFonts.length).toBeGreaterThan(0);
      expect(usedFonts.every(font => font.loaded && font.checked), 'each actually used heading/body custom font must load').toBe(true);
      expect(fontFailures).toEqual([]);
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
      observations.push({ id, capture: filename, usedFonts, ...geometry });
      await page.screenshot({ path: info.outputPath(filename), animations: 'disabled' });
    };
    try {
      await page.goto('/');
      const loadedFonts = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter(font => font.status === 'loaded').length; });
      expect(loadedFonts, 'real Google fonts must load; fallback-only captures are not acceptance').toBeGreaterThan(0);
      for (const id of ['partners', 'roadmap', 'token-flow', 'faq']) await expect(toggle(id)).toHaveAttribute('aria-expanded', 'false');
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
      await expect(page.locator('main > section').last()).toHaveAttribute('id', 'faq');
      await expect(page.locator('main + footer')).toHaveCount(1);
      await expect(toggle('faq')).toHaveAccessibleName('FREQUENTLY ASKED QUESTIONS');
      await inspect('faq', false, 'faq-closed.png');
      await toggle('faq').click();
      await expect(section('faq').locator(':scope > .landing-collapse-panel')).toBeVisible();
      await expect(section('faq').locator('.lp-faq-q')).toHaveCount(10);
      const question = section('faq').locator('#faq-col-left .lp-faq-q').first();
      await question.press('Enter');
      await expect(question).toHaveAttribute('aria-expanded', 'true');
      await expect(section('faq').locator('.lp-faq-item.open')).toHaveCount(1);
      await inspect('faq', true, 'faq-open.png');
      const questionGeometry = await section('faq').locator('.lp-faq-q').evaluateAll(buttons => buttons.map(button => {
        const box = button.getBoundingClientRect(), range = document.createRange();
        range.selectNodeContents(button.querySelector('span'));
        return { width: box.width, height: box.height, textFits: button.scrollWidth <= button.clientWidth &&
          [...range.getClientRects()].every(rect => rect.left >= box.left && rect.right <= box.right) };
      }));
      expect(questionGeometry).toHaveLength(10);
      for (const geometry of questionGeometry) {
        expect(geometry.width).toBeGreaterThanOrEqual(44);
        expect(geometry.height).toBeGreaterThanOrEqual(44);
        expect(geometry.textFits).toBe(true);
      }
      expect(await question.evaluate(button => {
        const box = button.getBoundingClientRect(), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return !!hit && (hit === button || button.contains(hit));
      })).toBe(true);
      await page.locator('footer').evaluate(footer => window.scrollTo({
        top: window.scrollY + footer.getBoundingClientRect().top - innerHeight / 2, behavior: 'instant',
      }));
      const boundary = await section('faq').evaluate(root => {
        const main = root.parentElement, footer = document.querySelector('footer');
        const content = [...main.children].filter(node => !['SCRIPT', 'STYLE', 'TEMPLATE'].includes(node.tagName));
        const faqBox = root.getBoundingClientRect(), footerBox = footer.getBoundingClientRect();
        const tail = [...root.querySelectorAll('a[href]')].at(-1).getBoundingClientRect();
        const navBottom = document.querySelector('nav').getBoundingClientRect().bottom;
        return { width: innerWidth, height: innerHeight, lastContent: content.at(-1).id,
          footerNext: main.nextElementSibling === footer, faqBottom: faqBox.bottom, footerTop: footerBox.top,
          gap: footerBox.top - faqBox.bottom, overflow: document.documentElement.scrollWidth - innerWidth,
          tailVisible: tail.top >= navBottom && tail.bottom <= innerHeight && tail.left >= 0 && tail.right <= innerWidth,
          footerStartVisible: footerBox.top >= navBottom && footerBox.top < innerHeight };
      });
      expect(boundary.width).toBe(width); expect(boundary.height).toBe(height);
      expect(boundary.lastContent).toBe('faq'); expect(boundary.footerNext).toBe(true);
      expect(boundary.gap).toBeGreaterThanOrEqual(-1); expect(boundary.gap).toBeLessThanOrEqual(1);
      expect(boundary.overflow).toBe(0); expect(boundary.tailVisible).toBe(true); expect(boundary.footerStartVisible).toBe(true);
      observations.push({ id: 'faq', capture: 'faq-footer-adjacency.png', questionGeometry, ...boundary });
      await page.screenshot({ path: info.outputPath('faq-footer-adjacency.png'), animations: 'disabled' });
      await toggle('faq').press('Space');
      await expect(toggle('faq')).toHaveAttribute('aria-expanded', 'false');
      await expect(section('faq').locator(':scope > .landing-collapse-panel')).toBeHidden();
      const fonts = await Promise.all(fontTasks);
      expect(fonts.length).toBeGreaterThan(0); expect(fonts.every(font => font.status === 200 && typeof font.sha256 === 'string')).toBe(true);
      expect(fontFailures).toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      fs.writeFileSync(info.outputPath('observations.json'), JSON.stringify({ eventSHA: process.env.GITHUB_SHA || null,
        htmlSHA256: hash(fs.readFileSync(path.join(__dirname, '../../docs/index.html'))),
        disclosureSHA256: hash(fs.readFileSync(path.join(__dirname, '../../docs/assets/landing-collapse.js'))),
        viewport: { width, height }, observations, fonts: await Promise.all(fontTasks), fontFailures, pageErrors: errors,
        blockedRequests, state: 'SYNTHETIC_OFFLINE_DATA_REAL_FONTS', walletOrProviderAction: false }, null, 2));
    }
  });
}
