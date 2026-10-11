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
requireText("apps/points-backend/README.md", [
  "currently 5 bps (0.05%)",
  "Vouchers never affect the IFR token transfer fee or burn.",
]);
// T-289: the issuer signs the contract's type and caps the discount at the live on-chain fee.
requireText("apps/points-backend/src/services/voucher-eip712.ts", ["DiscountVoucher: ["]);
requireText("apps/points-backend/src/routes/voucher.ts", [
  "capVoucherDiscountBps(POINTS_CONFIG.voucher, await getProtocolFeeBps())",
]);

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
  "no Council voting contract is deployed",
]);
// T-279: the token-flow diagram carries no hardcoded current values. Before the live read it shows
// "loading", after a failed read "unavailable"; the old dated fallbacks must not return.
{
  const landing = read("docs/index.html");
  const flowStart = landing.indexOf('<section id="token-flow"');
  const flowEnd = landing.indexOf("</section>", flowStart);
  assert.ok(flowStart > 0 && flowEnd > flowStart, "token-flow section missing");
  const flow = landing.slice(flowStart, flowEnd);
  for (const stale of [
    "997.571M", "2.429M", "371.544K", "11.899M IFR", "0.254 ETH", "400.6M IFR", "200M held",
    "0 IFR &middot; 3-of-5", "7.9M &middot;", "40M &middot;", "150M locked", "1.38M", "52.2M",
    "IFR fees held", "Phase 3 &mdash; via Controller",
  ]) {
    assert.ok(!flow.includes(stale), `token-flow retains hardcoded or stale value: ${stale}`);
  }
  for (const key of [
    "flow-snapshot-supply", "flow-snapshot-lp", "supply-flow", "lp-flow", "feerouter-flow",
    "flow-lpreserve", "flow-liqres", "flow-treasury", "flow-community", "flow-partner", "flow-vesting",
    "flow-burnres", "flow-controller", "flow-fee-total", "flow-fee-split", "flow-pool-edge",
    "flow-feerouter-bps", "commitment-flow", "lending-flow",
  ]) {
    assert.ok(flow.includes(`data-live-key="${key}"`), `token-flow live key missing: ${key}`);
  }
  assert.ok(flow.includes(">BuybackController</text>"), "token-flow must show BuybackController");
  assert.ok(!/>Buyback<\/text>|BuybackVault/.test(flow), "token-flow must not show the legacy BuybackVault");
  assert.ok(landing.includes("function fmtFlow(n, suffix) { return isNum(n) ? fmt(n) + (suffix || '') : 'unavailable'; }"),
    "token-flow labels must fail closed to 'unavailable'");
}
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
  "does not pass the connected wallet or its on-chain state to the Copilot chat",
]);
forbidText("docs/wiki/agent.html", [
  "?wallet=",
  "Premium Copilot Active",
  "more personalized guidance",
  "wallet balance, lock status, tier, and on-chain context",
]);
forbidText("docs/wiki/open-audit.html", ["document.getElementById('deflation-dot')"]);
requireText("docs/builder.html", ['id="scNum">90</div>']);
forbidText("docs/wiki/governance.html", ["On-chain verified via <code>RatVoting.sol</code>"]);
requireText("docs/wiki/dao-governance.html", [
  "Architecture specification, not a live service.",
  "None is deployed or available for voting today.",
]);

// CWA-78: no public surface may promise the Copilot wallet, balance, lock or tier context.
// Scope is the maintained public files only; published audit reports are immutable evidence
// and are deliberately excluded from this sweep.
const copilotClaimSurfaces = [
  "docs/index.html",
  "docs/wiki/agent.html",
  "docs/wiki/roadmap.html",
  "docs/assets/ifr-state.js",
];
const staleCopilotClaims = [
  "AI Copilot Premium",
  "AI Copilot Gate",
  "Premium Copilot",
  "Premium guidance",
  "Premium Access",
  "Premium Locked",
  "Lock 1,000 IFR for Premium",
  "&#x26A1; Premium",
  "Premium &#x2197;",
  "Free/Premium tier",
  "more personalized",
  "personalized responses",
  "wallet and lock context",
  "verify wallet context",
  "tier via URL params",
  "copilotPremium",
  "?wallet=",
];
for (const relative of copilotClaimSurfaces) {
  forbidText(relative, staleCopilotClaims);
}

const copilotBoundary =
  "The AI Copilot chat stays documentation-only and receives no wallet, balance, lock or tier context.";
requireText("docs/index.html", [
  copilotBoundary,
  '{"@type":"PropertyValue","name":"IFRLock Access","value":"Lock 1,000 IFR in IFRLock for refundable first-party IFRLock access.',
  "documentation-only AI Copilot guidance",
  "Lock &ge;1,000 IFR in IFRLock to activate IFRLock access. Refundable anytime",
  "Lock 1,000 IFR for IFRLock Access",
  "&#x26A1; IFRLock Access Active",
  "Lock &ge; 1,000 IFR &rarr; refundable IFRLock access for first-party lock-gated features.",
  "The chat is documentation-only and receives no wallet, balance, lock or tier context.",
  "connecting a wallet or locking IFR does not change them",
  "Does locking IFR or connecting a wallet change what the AI Copilot knows?",
]);
// The refundable first-party 1,000 IFR IFRLock access action must stay intact.
requireText("docs/index.html", [
  'id="lp-premium-lock-btn"',
  'onclick="lpLockPremium()"',
  'onclick="lpUnlockPremium()"',
  "Unlock all IFRLock",
]);
requireText("docs/wiki/agent.html", [
  "The chat is documentation-only and receives no wallet, balance, lock or tier context.",
  "&#x26A1; IFRLock Access</span>",
  "IFRLock access &#x2197;",
]);
requireText("docs/wiki/roadmap.html", [
  "Copilot privacy boundary implemented",
  "no wallet address, balance, lock status or tier is passed to the Copilot chat",
  "local IFRLock access status display from an on-chain read, shown on the page only",
  "Gated content platform &mdash; separate future product concept, not part of the Copilot chat and without an activation schedule",
  "&#x26A1; IFRLock Access</span>",
]);
const ifrState = read("docs/assets/ifr-state.js");
assert.ok(ifrState.includes("copilotFree: true"), "ifr-state.js must keep the free copilot flag");
assert.ok(ifrState.includes("result.isLocked1000 = locked >="), "ifr-state.js must keep the IFRLock read");

// CWA-15: the LiquidityReserve 50M cap is an owner-settable parameter; only the period is immutable.
const liquidityReserve = requireText("contracts/liquidity/LiquidityReserve.sol", [
  "uint256 public immutable periodDuration;",
  "function setMaxWithdrawPerPeriod(uint256 _max) external onlyOwner",
]);
assert.ok(!/immutable\s+maxWithdrawPerPeriod/.test(liquidityReserve));
requireText("README.md", ["a Governance parameter (`setMaxWithdrawPerPeriod`, 48h timelock), not an immutable limit"]);
requireText("docs/llms.txt", ["the 50M cap is a Governance parameter changeable via setMaxWithdrawPerPeriod"]);
requireText("docs/wiki/security.html", ["The 50M cap is a Governance parameter (<code>setMaxWithdrawPerPeriod</code>, 48h timelock), not an immutable invariant"]);
requireText("docs/wiki/contracts.html", ["The per-period maximum is owner-settable via <code>setMaxWithdrawPerPeriod</code>"]);
requireText("docs/TRANSPARENCY.md", ["Governance parameter via `setMaxWithdrawPerPeriod`, 48h timelock; period length immutable"]);
forbidText("docs/wiki/security.html", ["the contract limits withdrawals to 50M IFR per 90-day period"]);
forbidText("docs/wiki/contracts.html", ["(e.g. 50M per quarter)"]);

// CWA-20: chain-verified values (block 26,065,893) for vesting start, PartnerVault rate/throttle,
// Community Safe custody, fee exemptions and the README burn qualifier.
forbidText("docs/wiki/vesting.html", ["1741168424"]);
requireText("docs/wiki/vesting.html", ["start:         1772670647"]);
forbidText("docs/DOCS.md", ["rewardBps=1000 (10%)"]);
forbidText("docs/TOKENOMICS_MODEL.md", ["rewardBps: 1000 (10%)"]);
requireText("docs/wiki/lock-mechanism.html", ["On Mainnet <code>ifrLock</code> is unset (address(0))"]);
requireText("docs/wiki/contracts.html", ["Mainnet <code>ifrLock</code> is unset (address(0))"]);
forbidText("docs/wiki/integration.html", ["The remaining 57.9M IFR (6%) is reserved"]);
forbidText("docs/wiki/faq.html", ["holds the 6% Community &amp; Grants allocation (60M IFR)"]);
requireText("docs/wiki/fee-design.html", [
  "returned <code>true</code> at block 26,065,893",
  "<td>FeeRouterV1</td>",
  "<td>Vesting</td>",
  "<td>BootstrapVaultV3</td>",
  "<td>Treasury Safe</td>",
  "<td>Community Safe</td>",
  "<td>Deployer EOA</td>",
  "Governance, BuilderRegistry and the LP Reserve Safe",
]);
forbidText("README.md", ["Every transfer burns 2.5%", "2.5% burned per transfer ("]);

// CWA-23: the Mainnet manifest lists exactly the contracts of the DEPLOYMENTS.md Mainnet table;
// unknown provenance stays null and the recorded BuybackController deployment stays intact.
const mainnetTable = read("docs/DEPLOYMENTS.md").split("## Ethereum Mainnet")[1].split("Legacy deployment")[0];
const documentedContracts = Object.fromEntries(
  [...mainnetTable.matchAll(/\| \d+ \| \*\*(\w+)\*\* \| \[`(0x[0-9a-fA-F]{40})`\]/g)].map((match) => [match[1], match[2]])
);
const manifest = JSON.parse(read("deployments/mainnet.json"));
const { _manifest: manifestMeta, ...manifestContracts } = manifest;
assert.equal(manifestMeta.chainId, 1);
assert.deepEqual(Object.keys(manifestContracts).sort(), Object.keys(documentedContracts).sort());
for (const [name, entry] of Object.entries(manifestContracts)) {
  assert.equal(entry.address, documentedContracts[name], `${name} manifest address must match DEPLOYMENTS.md`);
  assert.equal(entry.network, "mainnet");
  assert.ok(fs.existsSync(path.join(root, entry.source)), `${name} source must exist`);
  assert.ok(entry.abi === null || fs.existsSync(path.join(root, entry.abi)), `${name} ABI path must exist`);
  assert.ok(entry.tx === null || /^0x[0-9a-f]{64}$/.test(entry.tx), `${name} tx must be a hash or null`);
  if (entry.tx === null) {
    assert.equal(entry.deployer, null, `${name} deployer must stay unknown without a tx record`);
    assert.match(entry.provenance, /deployment transaction unknown/);
  }
}
assert.equal(
  manifestContracts.BuybackController.tx,
  "0x761ee37c87d528317c5f7da13a2581e037f2fe39c71bfc58ce83a32930391677"
);

// CWA-51 and CWA-52: README separates allocation intent from current custody and states the
// FeeRouterV1 sink instead of a BuybackVault/BurnReserve flywheel.
requireText("README.md", [
  "Current custody: the Treasury Safe holds 0 IFR",
  "Current custody: 50M funded BootstrapVaultV3",
  "it does not hold the Treasury or Community allocations",
  "Custody figures verified on-chain at block 26,065,893",
  "which has no IFR withdrawal or forwarding function",
]);
forbidText("README.md", [
  "BuybackVault and BurnReserve accumulate from the 1% protocol pool fee",
  "| Gnosis Safe multisig (0x5ad6193...). Funded",
]);
const feeRouter = read("contracts/FeeRouterV1.sol");
assert.ok(!/function\s+(withdraw|sweep|rescue|recover)\w*\s*\(/i.test(feeRouter), "FeeRouterV1 gained an IFR exit; update CWA-52 copy");

// CWA-53: secret-handling copy stays limited to the controls each Copilot surface ships.
forbidText("README.md", ["Automatic seed phrase / private key detection"]);
forbidText("apps/ai-copilot/README.md", ["Automatic seed phrase / private key detection"]);
requireText("README.md", ["No surface runs an automatic seed-phrase or private-key detector."]);
requireText("apps/ai-copilot/src/components/IFRCopilot.tsx", [
  'const SAFETY_WORDS = ["seed phrase", "private key", "mnemonic", "secret recovery"];',
]);
assert.ok(
  !/SAFETY_WORDS|checkSafety|detectSecret|containsSecret/.test(read("apps/ai-copilot/server/index.ts")),
  "served widget gained a secret check; update CWA-53 copy"
);

// CWA-06: neutral custody/activation wording; no private backend address or unproven "never held" claim.
const CWA06_ACTIVATION =
  "Mainnet execution was performed by the Safe signers. Backend activation was performed by owner-authorized automation, according to the operator report.";
const CWA06_BACKGROUND =
  "The former on-chain voucher signer was also a Safe owner. The reviewed pre-rotation backend configuration reported a different active signer; this does not establish deployment of the Safe-owner private key.";
const CWA06_CUSTODY =
  "Based on the reviewed backend configuration, no Safe-owner key rotation is required by this voucher-signer change. Owner confirmation that the key was not otherwise exposed remains pending.";
requireText("docs/VOUCHER_SIGNER_ROTATION.md", [CWA06_ACTIVATION, CWA06_BACKGROUND, CWA06_CUSTODY]);
requireText("docs/community-audits/CWA_REMEDIATION_REGISTER.md", [CWA06_CUSTODY]);
for (const relative of ["docs/VOUCHER_SIGNER_ROTATION.md", "docs/community-audits/cwa-remediation-register.json", "docs/community-audits/CWA_REMEDIATION_REGISTER.md"]) {
  forbidText(relative, ["never held", "never by automation", "held a different key", "exposure elsewhere"]);
  assert.ok(!/0x[dD]9[aA]0/.test(read(relative)), `${relative} publishes the private backend signer address`);
}
const cwa06 = JSON.parse(read("docs/community-audits/cwa-remediation-register.json")).findings.find((entry) => entry.id === "CWA-06");
assert.ok(cwa06.nextAction.includes(CWA06_CUSTODY), "CWA-06 nextAction must carry the custody wording");
assert.ok(cwa06.verification.includes(CWA06_ACTIVATION), "CWA-06 verification must carry the activation wording");

const register = JSON.parse(read("docs/community-audits/cwa-remediation-register.json"));
for (let number = 57; number <= 73; number += 1) {
  const id = `CWA-${number}`;
  const finding = register.findings.find((entry) => entry.id === id);
  assert.ok(finding, `missing ${id}`);
  assert.equal(finding.disposition, "fixed_and_verified", `${id} status must match evidence`);
}

// CWA-02 recovery (7 October 2026, tx 0x5dc641c7..., block 26143797): the IFR held by FeeRouterV1 was recovered to
// the Treasury Safe, so permanently lost IFR is CV-01 only. Current surfaces must not keep the superseded
// combined total, the "stays lost" claims or a circulation label for totalSupply minus CV-01. A clearly dated
// "History: until 7 October 2026 / 07.10.2026 ..." sentence may still name the old total.
const CWA02_TX = "0x5dc641c7414f4d0f83cd53fbf2dce782cb9bbffd8393ab8246f3ac47932e2881";
function withoutDatedHistory(content) {
  return content.replace(/History: until (?:7 October 2026|07\.10\.2026)[\s\S]*?block 26,124,660\)\./g, "");
}
const cwa02CurrentSurfaces = [
  "README.md",
  "docs/index.html",
  "docs/llms.txt",
  "docs/TRANSPARENCY.md",
  "docs/FEE_DESIGN.md",
  "docs/POOL_FEE_RECEIVER.md",
  "docs/wiki/transparency.html",
  "docs/wiki/tokenomics.html",
  "docs/wiki/fee-design.html",
  "docs/wiki/governance.html",
  "docs/wiki/press-kit.html",
  "apps/ai-copilot/src/context/system-prompts.ts",
];
const cwa02StaleClaims = [
  "27,153,013",
  "27153013",
  "2.724%",
  "IFR already in FeeRouterV1 stays lost",
  "stays lost (CWA-02)",
  "stay there.",
  "these fees stay there as a de-facto sink",
  "permanently lost, CWA-02",
  "CWA-02, permanently lost",
  "pool fees in FeeRouterV1 (CWA-02)",
  "Governance is reviewing options",
  "has no IFR withdrawal path",
  "Supply that can still move",
  "IFR already stranded in FeeRouterV1 stay there",
];
function assertNoCurrentCwa02Sink(content, relative) {
  const current = withoutDatedHistory(content);
  for (const marker of cwa02StaleClaims) {
    assert.ok(!current.includes(marker), `${relative} retains superseded CWA-02 claim: ${marker}`);
  }
}
for (const relative of cwa02CurrentSurfaces) {
  assertNoCurrentCwa02Sink(read(relative), relative);
}
// F4: an earlier date in the paragraph must not excuse a present-tense sink assertion.
assert.throws(() => assertNoCurrentCwa02Sink(
  'Until 5 October 2026 fees accrued to FeeRouterV1: these fees stay there as a de-facto sink.',
  'README sink regression'
), { name: 'AssertionError' });
assertNoCurrentCwa02Sink(
  'History: until 7 October 2026 these fees stay there as a de-facto sink (block 26,124,660).',
  'preserved dated history fixture'
);
requireText('README.md', [
  'historical de-facto sink classification',
  'the 734,545.074097347 IFR held by FeeRouterV1',
  'The recovery amount is not proof that every recovered IFR unit came from pool fees.',
  'block 26,143,797', 'block 26,151,369', 'unallocated',
]);
for (const relative of ["docs/llms.txt", "docs/TRANSPARENCY.md", "docs/FEE_DESIGN.md", "docs/wiki/transparency.html", "apps/ai-copilot/src/context/system-prompts.ts"]) {
  requireText(relative, ["26,418,467.994338353", "2.651%", relative.endsWith(".ts") ? "block 26151369" : "block 26,151,369"]);
}
for (const relative of ["docs/llms.txt", "docs/TRANSPARENCY.md", "docs/FEE_DESIGN.md", "docs/DEPLOYMENTS.md", "docs/POOL_FEE_RECEIVER.md", "docs/wiki/fee-design.html", "docs/wiki/transparency.html", "docs/community-audits/cwa-remediation-register.json"]) {
  requireText(relative, [CWA02_TX]);
}
for (const relative of ["docs/llms.txt", "docs/TRANSPARENCY.md", "docs/FEE_DESIGN.md", "docs/wiki/transparency.html", "docs/wiki/tokenomics.html", "README.md", "apps/ai-copilot/src/context/system-prompts.ts"]) {
  requireText(relative, ["unallocated"]);
}
// The Landing lost-IFR card and its client logic count CV-01 only: no FeeRouterV1 floor, and the older API
// fields that still add the FeeRouterV1 balance are never used.
const landing = requireText("docs/index.html", [
  '<div data-lost-ifr-value style="font-size:32px;font-weight:700;color:#ff6a00;">26,418,467.99 IFR</div>',
  'data-lost-ifr-ledger style="color:inherit;">26.4M IFR</a>',
  "var LOST_IFR = { cv01Raw: '26418467994338353', block: 26151369, date: '2026-10-09' };",
  "not classified as permanently lost",
]);
for (const marker of ["feeRouterRaw: '734545074097347'", "effectiveFeeRouter", "supply.permanentlyLostRaw", "supply.liveSupplyRaw", "CV-01 + FeeRouterV1", "data-lost-ifr-feerouter", "Balance: 0 IFR. No deployed mechanism automatically refills this Safe."]) {
  assert.ok(!landing.includes(marker), `docs/index.html retains pre-CWA-02-recovery lost-IFR logic: ${marker}`);
}
for (const relative of ["docs/TRANSPARENCY.md", "docs/wiki/transparency.html"]) {
  const content = requireText(relative, ["Not classified as permanently lost"]);
  // totalSupply minus CV-01 is only ever introduced by the neutral label, never as circulating/liquid/spendable.
  for (const match of content.matchAll(/970,241,903/g)) {
    const lead = content.slice(Math.max(0, match.index - 90), match.index);
    assert.ok(/not classified as permanently lost/i.test(lead), `${relative} labels totalSupply minus CV-01 without the neutral label`);
    assert.ok(!/(circulating|liquid|spendable)/i.test(lead), `${relative} labels totalSupply minus CV-01 as circulating`);
  }
}
const cwa02Entry = JSON.parse(read("docs/community-audits/cwa-remediation-register.json")).findings.find((f) => f.id === "CWA-02");
assert.ok(cwa02Entry, "missing CWA-02");
assert.ok(cwa02Entry.verification.includes("were recovered to the Treasury Safe") && cwa02Entry.verification.includes(CWA02_TX),
  "CWA-02 register verification must record the executed recovery");
for (const marker of ["stay permanently lost", "27,153,013", "as permanently lost (dated balance, read live)"]) {
  assert.ok(!`${cwa02Entry.nextAction} ${cwa02Entry.verification}`.includes(marker), `CWA-02 register retains superseded claim: ${marker}`);
}

{
  // Supply excluding CV-01 includes unallocated Treasury IFR: never present it as a circulating/live supply.
  const landingSupply = read("docs/index.html");
  assert.ok(!landingSupply.includes('<div style="font-size:11px;color:var(--text-muted);">Current Supply</div>\n              <div id="donut-live-supply"'),
    "Donut centre must not label the CV-01 remainder as Current Supply");
  for (const stale of ["label: 'Live Supply'", "'Live ' + fmt(data.liveSupply)", "'Not classified as lost ' + fmt(data.liveSupply)"]) {
    assert.ok(!landingSupply.includes(stale), `Landing still labels supply excl. CV-01 as live/circulating: ${stale}`);
  }
  assert.ok(landingSupply.includes("label: 'Not classified as permanently lost'") && landingSupply.includes("not a circulating, liquid or spendable figure"),
    "Landing must label totalSupply minus CV-01 neutrally and state it is not a circulating, liquid or spendable figure");
}

console.log("[cwa-content-coherence] PASS - CWA-06 custody wording, CWA-15, CWA-20, CWA-23, CWA-51...CWA-53, CWA-57...CWA-73 plus CWA-78 source, math, copy and status evidence; CWA-02 recovery copy");
