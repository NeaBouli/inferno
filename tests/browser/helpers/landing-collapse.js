const { expect } = require('@playwright/test');

async function expandLandingSections(page, ...ids) {
  for (const id of ids) {
    const toggle = page.locator(`#${id} > .landing-collapse-heading > .landing-collapse-toggle`);
    await expect(toggle).toHaveCount(1);
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }
}

async function expandLandingAddresses(page, ...selectors) {
  for (const selector of selectors) {
    const tile = page.locator('[data-landing-address]').filter({ has: page.locator(selector) });
    const toggle = tile.locator(':scope > .landing-collapse-heading > button');
    await expect(toggle).toHaveCount(1);
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    await expect(page.locator(selector)).toBeVisible();
  }
}

module.exports = { expandLandingSections, expandLandingAddresses };
