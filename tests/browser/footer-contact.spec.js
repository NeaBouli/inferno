// @ts-check
// Owner policy (2026-09-30): the Landing footer shows only "Core Dev Contact";
// the address is decoded on click and never exists in the page before that.
const { test, expect } = require("@playwright/test");

const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/;

test("footer contact reveals the address only after a click", async ({ page }) => {
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  await page.goto("/");
  const link = page.locator("#ifr-core-contact");
  await link.scrollIntoViewIfNeeded();
  await expect(link).toHaveText("Core Dev Contact");
  await expect(link).not.toHaveAttribute("href", /^mailto:/);
  const before = await page.content();
  expect(before).not.toMatch(/mailto:[^"'\s]+@/);
  expect(await page.locator("footer").innerText()).not.toMatch(/@/);
  await expect(link.locator("xpath=..")).toHaveAttribute("data-nosnippet", "");

  await link.click();
  await expect(link).toHaveText(EMAIL);
  await expect(link).toHaveAttribute("href", /^mailto:[^@\s]+@[^@\s]+$/);
  expect(page.url()).not.toContain("#core-dev-contact");
});
