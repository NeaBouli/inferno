const { expect } = require('@playwright/test');

async function expandLandingSections(page, ...ids) {
  for (const id of ids) {
    const toggle = page.locator(`#${id} > .landing-collapse-heading > .landing-collapse-toggle`);
    await expect(toggle).toHaveCount(1);
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }
}

module.exports = { expandLandingSections };
