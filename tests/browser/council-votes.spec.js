// @ts-check
// Lane 6: the public Council vote record renders every ballot, tally and proof link from
// docs/data/council-votes.json, without JavaScript and without horizontal overflow.
const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "docs", "data", "council-votes.json"), "utf8"));

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
  test(`council votes render at ${viewport.width}px`, async ({ page }) => {
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
    await page.setViewportSize(viewport);
    await page.goto("/wiki/council-votes.html");
    for (const ballot of data.ballots) {
      const card = page.locator(`#${ballot.id.toLowerCase()}`);
      await expect(card).toBeVisible();
      await expect(card.locator("h3")).toContainText(ballot.id);
      const rows = card.locator("tbody tr");
      await expect(rows).toHaveCount(ballot.eligible.length);
      for (const vote of data.votes.filter((v) => v.ballot === ballot.id)) {
        const row = rows.filter({ hasText: vote.signer });
        await expect(row).toContainText(vote.choice);
        if (!vote.signature) {
          // No signature over this ballot's published text: shown as unverified, never counted.
          await expect(row).toContainText("unverified");
          await expect(row).toContainText("not counted");
          await expect(row.locator("a[href*=\"verifySig\"]")).toHaveCount(0);
        } else {
          await expect(row.locator(`a[href="${vote.etherscan}"]`)).toHaveCount(1);
          await expect(row).toContainText(`signed: ${ballot.id} ${vote.choice} text`);
        }
      }
    }
    await expect(page.locator("#cv-01 h3")).toContainText("Open");
    await expect(page.locator("#cv-01")).toContainText("YES: 2");
    await expect(page.locator("#cv-01")).toContainText("abstentions: 0 · unverified (not counted): 1");
    await expect(page.locator("#ex-01")).toContainText("YES: 3");
    await expect(page.locator("#ex-01 h3")).toContainText("Approved");
    await expect(page.locator("#ex-02 h3")).toContainText("Open");
    await expect(page.locator("#ex-02")).toContainText("abstentions: 3");
    await expect(page.locator("#ex-02 details")).toContainText("Vote: ABSTAIN");
    // Abstention texts are not republished; only hash and link are shown.
    await expect(page.locator("body")).not.toContainText("belong to my wallets");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
