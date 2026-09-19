#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function requireText(relative, markers) {
  const content = read(relative);
  for (const marker of markers) {
    assert.ok(content.includes(marker), `${relative} missing marker: ${marker}`);
  }
  return content;
}

function forbidText(relative, markers) {
  const content = read(relative);
  for (const marker of markers) {
    assert.ok(!content.includes(marker), `${relative} retains stale claim: ${marker}`);
  }
}

// CWA-57: the issuer must not create a voucher the deployed router rejects.
const pointsConfig = requireText("apps/points-backend/src/config/points.ts", [
  "discountBps: 5",
  "maxDiscountBps: 5",
]);
assert.ok(!pointsConfig.includes("discountBps: 15"));
requireText("contracts/FeeRouterV1.sol", [
  'require(voucher.discountBps <= protocolFeeBps, "Discount exceeds fee")',
  "uint16 public protocolFeeBps = 5",
]);
forbidText("docs/E2E_FLOW.md", ["15 bps", '"discountBps": 15']);
forbidText("docs/POINTS_BACKEND_MIGRATION.md", ["15 BPS Discount"]);
forbidText("docs/CHATGPT_AUDIT_PROMPT_V2.md", ["max 15 bps"]);
requireText("docs/POINTS_BACKEND_MIGRATION.md", ["5 BPS Discount"]);
requireText("docs/CHATGPT_AUDIT_PROMPT_V2.md", ["Voucher discount: 5 bps"]);
requireText("apps/points-backend/README.md", ["0.05% protocol fee discount (5 bps"]);

// CWA-58 and CWA-59: current lending and fee-flow copy follows deployed source.
requireText("docs/wiki/lending-vault.html", [
  "50% &rarr; the configured <code>protocolFeeReceiver</code>",
  "V1 has no automatic",
]);
requireText("contracts/vault/LendingVault.sol", [
  "uint256 lenderInterest = interest * LENDER_INTEREST_PCT / 100",
  "ifrToken.transfer(protocolFeeReceiver, protocolInterest)",
]);
forbidText("docs/wiki/ecosystem.html", ["ETH interest via Lending"]);
forbidText("docs/wiki/contracts.html", ["Buyback system fully active"]);
forbidText("docs/FEE_DESIGN.md", ["Protocol pool fees flow directly"]);
requireText("docs/wiki/protocol-plan.html", [
  "No deployed mechanism automatically refills this Safe",
  "It has no PartnerVault refill, operating-pool",
]);
requireText("docs/PARTNERVAULT_REWARD_MEMO_2026-09-15.md", [
  "CWA-59-Prüfung hat bestätigt",
  "keinen PartnerVault-Refill, keinen 70/30-Split",
]);
requireText("docs/wiki/transparency.html", [
  "Accumulated IFR pool fees; no automatic IFR forwarding path",
]);

// CWA-60 and CWA-61: network labels and transaction links cannot imply false targets.
const contractsPage = requireText("docs/wiki/contracts.html", [
  "See the canonical Sepolia deployment registry",
]);
assert.ok(
  contractsPage.split("See the canonical Sepolia deployment registry").length - 1 >= 4,
  "contracts page must defer drifting Sepolia addresses to the canonical registry"
);
for (const relative of [
  "docs/wiki/governance.html",
  "docs/wiki/deployment.html",
  "docs/wiki/transparency.html",
  "docs/wiki/bootstrap.html",
  "docs/wiki/mainnet-checklist.html",
  "docs/CHANGELOG.md",
  "docs/DEPLOYMENTS.md",
]) {
  const shortTxUrl = /https:\/\/(?:sepolia\.)?etherscan\.io\/tx\/0x[0-9a-fA-F]{1,63}(?![0-9a-fA-F])/;
  assert.ok(!shortTxUrl.test(read(relative)), `${relative} contains a truncated transaction URL`);
}

// CWA-62 through CWA-65: governance exceptions, roles and exact custody reconcile.
requireText("docs/wiki/governance.html", [
  "untimelocked",
  "<code>setGuardian</code>",
  "guardian can cancel",
]);
requireText("docs/wiki/tokenomics.html", [
  "0x6b36687b0cd4386fb14cf565B67D7862110Fed67",
  "active disclosed governance-controlled exception",
]);
requireText("docs/MAINNET_CHECKLIST.md", [
  "later re-enabled by executed Proposal #7",
  "changed to BuybackController by executed Proposal #14",
]);
requireText("docs/FAIR-LAUNCH-MIGRATION.md", [
  "Executed Governance Proposal #7 later re-enabled the Deployer EOA",
  "Executed Proposal #7 subsequently restored the exemption",
]);
requireText("docs/ROADMAP.md", [
  "Deployer EOA was later re-enabled by executed Proposal #7",
]);
requireText("docs/wiki/deployment.html", [
  "The Deployer exemption was re-enabled by executed Governance Proposal #7",
  "active, disclosed governance-controlled exception",
]);
requireText("docs/wiki/mainnet-checklist.html", [
  "later re-enabled by executed Proposal #7 on 18.03.2026",
]);
forbidText("docs/wiki/deployment.html", ["Deployer fee exemption is revoked"]);
requireText("docs/DEPLOYMENTS.md", [
  "| PartnerVault | `admin()` | Governance |",
  "| BuybackController | `owner()` | Governance",
]);
requireText("docs/SECURITY_AUDIT_SKYWALKER.md", [
  "W18 is not current",
  "transferGuardian(address)",
]);

const totalSupply = 997571140022456196n;
const burned = 2428859977543804n;
const custodyBalances = {
  lpReserveSafe: 400600000000000000n,
  liquidityReserve: 200000000000000000n,
  vesting: 150000000000000000n,
  communitySafe: 7900000000000000n,
  partnerVault: 40000000000000000n,
  uniswapPair: 11899172061166225n,
  commitmentVault: 47952476871794375n,
  lendingVault: 52155440952845656n,
  feeRouter: 371543991017522n,
  ifrLock: 2000000000000n,
  treasurySafe: 0n,
};
const namedBalances = Object.values(custodyBalances).reduce((sum, balance) => sum + balance, 0n);
const otherBalances = 86690506145632418n;
assert.equal(namedBalances, 910880633876823778n);
assert.equal(namedBalances + otherBalances, totalSupply);
assert.equal(totalSupply + burned, 1_000_000_000_000_000_000n);
requireText("docs/wiki/transparency.html", [
  "400,600,000",
  "200,000,000",
  "150,000,000",
  "7,900,000",
  "40,000,000",
  "11,899,172.061166225",
  "47,952,476.871794375",
  "52,155,440.952845656",
  "371,543.991017522",
  "2,000",
  "997,571,140.022456196",
  "2,428,859.977543804",
  "86,690,506.145632418",
  "371,543.991017522 IFR at block 26,013,776",
  "2,000 IFR at block 26,013,776",
]);

// CWA-66 and CWA-67: constant-product examples and P0 denomination are deterministic.
const actualWethReserve = 30_000_000_000_000_000n;
const illustrativeWethReserve = 1_500_000_000_000_000_000n;
assert.equal(actualWethReserve * 99n, 2_970_000_000_000_000_000n);
assert.equal(illustrativeWethReserve * 99n, 148_500_000_000_000_000_000n);
requireText("docs/wiki/lp-strategy.html", [
  "300,000,000 wei per IFR",
  "2.97 ETH",
  "148.5 ETH",
  "99 &times; y",
  "an IFR amount alone is not a liquidity-depth",
]);
forbidText("docs/wiki/lp-strategy.html", ["400M IFR for $80", "100,000,000x more liquidity"]);
requireText("docs/wiki/commitment-vault.html", [
  "0.030 ETH / 100,000,000 IFR = 300,000,000 wei per IFR",
]);

// CWA-68: public examples match the current interfaces and routes.
const integration = requireText("docs/wiki/integration.html", [
  "recordLockReward(bytes32 partnerId, uint256 lockAmount, address wallet)",
  "POST /auth/siwe/nonce",
  "function swapWithFee(",
  "function isVoucherValid(",
  'id="creator-gateway"',
  'id="e2e-flow"',
  'href="integration.html#creator-gateway"',
  'href="integration.html#e2e-flow"',
]);
assert.ok(integration.includes('"function lockInfo(address user) view returns (uint256 amount, uint256 lockedAt)"'));
requireText("contracts/partner/PartnerVault.sol", [
  "function recordLockReward(",
  "bytes32 partnerId,",
  "uint256 lockAmount,",
  "address wallet",
]);

// CWA-69 through CWA-72: status, counts, fallbacks and Bootstrap figures stay aligned.
requireText("docs/wiki/governance.html", [
  "Current: 3-of-5 Safe",
  "Proposal #16",
  "Executed 09.06.2026",
]);
requireText("docs/wiki/testnet.html", [
  "The 11 deployment entries listed above",
  "six executed and four cancelled",
]);
requireText("docs/wiki/roadmap.html", ["36 Wiki HTML pages"]);
requireText("docs/index.html", [
  "997.571M supply",
  "2.429M burned",
  "371.544K IFR fees held",
  "LP 11.899M IFR + 0.254 ETH",
  ">11.899M IFR + 0.254 ETH</text>",
  "no Council voting contract is deployed",
]);
requireText("docs/social/x-tokenflow-burn-vs-burnreserve.md", [
  "~2.429M IFR burned at Ethereum block 26,013,776",
]);
forbidText("docs/social/x-tokenflow-burn-vs-burnreserve.md", ["~2.3M IFR burned"]);
requireText("docs/wiki/bootstrap.html", [
  "30 focused BootstrapVaultV3 tests",
  "(your_ETH / total_ETH) &times; 100,000,000 IFR",
  "V1 opened 07.03.2026; V3 deployed 08.03.2026",
  "144.75M + 50M + 5.25M IFR",
  "0x6f08eaa67cf7562af2f9098d3bdfd177ac86cb00a365b354881accf3aa41d5b0",
  "0x4394bec13c809084a4e669d2bb51fb35a4d2c2c050963c156c525fdb1cfbbf1c",
  "0x47e9a6096b2088ffafaa1d04f2d435aa59777c29a26078d1b2e4b07106083fc0",
]);
for (const relative of [
  "README.md",
  "docs/index.html",
  "docs/wiki/tokenomics.html",
  "docs/wiki/fair-launch.html",
]) {
  forbidText(relative, ["Refills via protocol fees"]);
}
requireText("docs/CHANGELOG.md", [
  "final funded total 200,000,000 IFR",
  "144.75M initial + 5.25M top-up",
]);

// CWA-73: implementation claims stay no stronger than the shipped behavior.
requireText("docs/wiki/commitment-vault.html", [
  "<strong>Conditions are checked at execution.</strong>",
  "does not bypass the condition check",
]);
requireText("docs/web3/index.html", ["The current hero uses a static optimized image"]);
requireText("apps/ai-copilot/src/context/system-prompts.ts", [
  "Execution is trigger-, cooldown-, pause- and balance-dependent",
  "IFR transfer-pool fees held by FeeRouterV1 are not forwarded automatically",
]);
forbidText("apps/ai-copilot/src/context/system-prompts.ts", ["fully active"]);
requireText("docs/wiki/agent.html", [
  "maintained same-project Wiki context",
  "a page-specific citation is not guaranteed on every answer",
]);
forbidText("docs/wiki/open-audit.html", ["document.getElementById('deflation-dot')"]);
requireText("docs/builder.html", ['id="scNum">90</div>']);
forbidText("docs/wiki/governance.html", ["On-chain verified via <code>RatVoting.sol</code>"]);
requireText("docs/wiki/dao-governance.html", [
  "Architecture specification, not a live service.",
  "None is deployed or available for voting today.",
]);

const register = JSON.parse(read("docs/community-audits/cwa-remediation-register.json"));
for (let number = 57; number <= 73; number += 1) {
  const id = `CWA-${number}`;
  const finding = register.findings.find((entry) => entry.id === id);
  assert.ok(finding, `missing ${id}`);
  assert.equal(finding.disposition, "fixed_and_verified", `${id} status must match evidence`);
}

console.log("[cwa-content-coherence] PASS - CWA-57...CWA-73 source, math, copy and status evidence");
