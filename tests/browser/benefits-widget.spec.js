// Serverless IFR Benefits widget (docs/widget/ifr-benefits-widget.js): mocked wallet, RPC and shop API.
// It must show met/unmet rules from chain data and fail closed (no benefit) on RPC or rules failure.
import { test, expect } from "@playwright/test";

const USER = "0x1111111111111111111111111111111111111111";
const RPC = "https://rpc.mock.test/";
const API = "https://shop.mock.test";
const hex = (ifr) => "0x" + (BigInt(ifr) * 10n ** 9n).toString(16).padStart(64, "0");

async function setup(page, { locked = 0, held = 0, rpcFail = false, rulesFail = false, chain = "0x1", rules } = {}) {
  await page.addInitScript((user) => {
    window.ethereum = { request: async ({ method }) => (method === "eth_requestAccounts" ? [user] : null) };
  }, USER);
  await page.route(RPC, async (route) => {
    if (rpcFail) return route.fulfill({ status: 503, body: "down" });
    const body = JSON.parse(route.request().postData());
    let result = chain;
    if (body.method === "eth_call") result = body.params[0].data.startsWith("0x9ae697bf") ? hex(locked) : hex(held);
    return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, result }) });
  });
  await page.route(`${API}/api/businesses/demo-shop/rules`, (route) => rulesFail
    ? route.fulfill({ status: 500, headers: { "access-control-allow-origin": "*" }, body: "{}" })
    : route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ rules }) }));
}

const RULES = [
  { id: "a", label: "Bronze", discountPercent: 10, requiredLockIFR: 1000, minIFRHeld: 0, lockSource: "ifrlock", productId: null, active: true },
  { id: "b", label: "Gold", discountPercent: 20, requiredLockIFR: 5000, minIFRHeld: 0, lockSource: "ifrlock", productId: null, active: true },
  { id: "c", label: "Vault", discountPercent: 15, requiredLockIFR: 1000, minIFRHeld: 0, lockSource: "commitment_time_only", productId: null, active: true },
];

async function open(page, business = "demo-shop") {
  await page.goto("/widget/ifr-benefits-widget.js"); // same origin as the served docs
  await page.setContent(`<!doctype html><html><head></head><body>
    <div id="w" data-ifr-benefits ${business ? `data-business="${business}"` : ""} data-rpc="${RPC}" data-api="${API}"></div>
    <script src="http://localhost:8787/widget/ifr-benefits-widget.js"></script></body></html>`);
  await page.getByRole("button", { name: "Check with my wallet" }).click();
}

const state = (page) => page.locator(".ifrbw").getAttribute("data-ifrbw-state");

test("qualifies for the highest met store-wide rule and marks CommitmentVault rules for checkout", async ({ page }) => {
  await setup(page, { locked: 2600, rules: RULES });
  await open(page);
  await expect(page.locator(".ifrbw")).toHaveAttribute("data-ifrbw-state", "qualified");
  await expect(page.locator(".ifrbw")).toContainText("You qualify for 10% (Bronze).");
  await expect(page.locator(".ifrbw li", { hasText: "Gold" })).toContainText("not met");
  await expect(page.locator(".ifrbw li", { hasText: "Vault" })).toContainText("checked at checkout");
  await expect(page.locator(".ifrbw")).toContainText("Display only");
});

test("insufficient lock shows no benefit", async ({ page }) => {
  await setup(page, { locked: 999, rules: RULES });
  await open(page);
  await expect(page.locator(".ifrbw")).toHaveAttribute("data-ifrbw-state", "not-qualified");
  await expect(page.locator(".ifrbw")).not.toContainText("You qualify");
});

test("RPC failure fails closed", async ({ page }) => {
  await setup(page, { rpcFail: true, rules: RULES });
  await open(page);
  expect(await state(page)).not.toBe("qualified");
  await expect(page.locator(".ifrbw")).toHaveAttribute("data-ifrbw-state", "rpc-failed");
  await expect(page.locator(".ifrbw")).toContainText("Could not verify");
  await expect(page.locator(".ifrbw")).not.toContainText("%");
});

test("wrong chain from the RPC fails closed", async ({ page }) => {
  await setup(page, { locked: 100000, chain: "0xaa36a7", rules: RULES });
  await open(page);
  await expect(page.locator(".ifrbw")).toHaveAttribute("data-ifrbw-state", "rpc-failed");
});

test("rules failure shows no benefit", async ({ page }) => {
  await setup(page, { locked: 100000, rulesFail: true });
  await open(page);
  await expect(page.locator(".ifrbw")).toHaveAttribute("data-ifrbw-state", "rules-failed");
  await expect(page.locator(".ifrbw")).not.toContainText("You qualify");
});

test("without a business it shows the shop tier ladder only", async ({ page }) => {
  await setup(page, { locked: 2500 });
  await open(page, "");
  await expect(page.locator(".ifrbw")).toHaveAttribute("data-ifrbw-state", "tier");
  await expect(page.locator(".ifrbw")).toContainText("Tier: Silver");
});

test("remote rule labels are rendered as text, never HTML", async ({ page }) => {
  await setup(page, { locked: 2000, rules: [{ ...RULES[0], label: "<img src=x onerror=window.pwned=1>" }] });
  await open(page);
  await expect(page.locator(".ifrbw")).toHaveAttribute("data-ifrbw-state", "qualified");
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  expect(await page.locator(".ifrbw img").count()).toBe(0);
});
