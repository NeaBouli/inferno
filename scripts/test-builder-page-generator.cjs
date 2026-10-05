#!/usr/bin/env node

// T-210: Regression checks for the live builder page generator (docs/builder.html).
// The page's inline gen()/score() is executed with a stub DOM and its output is
// asserted against the actual contract library layout in contracts/library/.
// Companion evidence: isolated solc 0.8.20 compilation of every combination is
// recorded in .fleet/reports/T-210-evidence-matrix.md.

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "docs/builder.html"), "utf8");
const failures = [];

function fail(message) {
  failures.push(message);
}

// --- Static page assertions -------------------------------------------------

if (!html.includes('id="scNum">90</div>')) {
  fail("default security score 90 missing (score math must stay stable)");
}
if (!html.includes("(heuristic checklist)")) {
  fail("score card must be labelled as a heuristic checklist");
}
if (!html.includes("not a security audit or certification")) {
  fail("score card disclaimer missing (heuristic must not read as certification)");
}
if (html.includes("@ifr/library")) {
  fail("page still references the unresolvable @ifr/library import prefix");
}

// --- Extract and run the inline generator -----------------------------------

const match = html.match(/<script>\n([\s\S]*?)<\/script>/);
if (!match) {
  fail("inline generator script block not found");
  reportAndExit();
}

const elements = {};
function element(id) {
  if (!elements[id]) {
    elements[id] = {
      value: "",
      textContent: "",
      innerHTML: "",
      style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      scrollIntoView() {},
    };
  }
  return elements[id];
}
const documentStub = {
  getElementById: element,
  querySelectorAll: () => [element("q0"), element("q1"), element("q2")],
  querySelector: () => element("qS"),
};
const factory = new Function(
  "document",
  "navigator",
  `${match[1]}\n;return { gen, score, C };`
);
const page = factory(documentStub, { clipboard: { writeText: async () => {} } });

const libraryDir = path.join(root, "contracts/library");

const combos = [
  { name: "default", cfg: { hardLock: true, tierSystem: true, cooldown: true, minAmount: 1000, lockDuration: 30 }, override: "override(BaseAccessModule, HardLockModule)", imports: ["HardLockModule", "TierModule", "CooldownModule"] },
  { name: "hardlock-no-tier", cfg: { hardLock: true, tierSystem: false, cooldown: true, minAmount: 1000, lockDuration: 30 }, override: "override(HardLockModule)", imports: ["HardLockModule", "CooldownModule"] },
  { name: "hardlock-no-tier-no-cd", cfg: { hardLock: true, tierSystem: false, cooldown: false, minAmount: 1000, lockDuration: 30 }, override: "override(HardLockModule)", imports: ["HardLockModule"] },
  { name: "balance-only", cfg: { hardLock: false, tierSystem: false, cooldown: false, minAmount: 100, lockDuration: 7 }, override: "override", imports: ["BaseAccessModule"] },
  { name: "balance-only-tier", cfg: { hardLock: false, tierSystem: true, cooldown: true, minAmount: 1000, lockDuration: 30 }, override: "override", imports: ["BaseAccessModule", "TierModule", "CooldownModule"] },
  { name: "rest-api", cfg: { hardLock: true, tierSystem: true, cooldown: true, minAmount: 1000, lockDuration: 30, apiCheck: true }, override: "override(BaseAccessModule, HardLockModule)", imports: ["HardLockModule", "TierModule", "CooldownModule"] },
];

for (const combo of combos) {
  Object.assign(page.C, {
    productName: "Demo",
    productUrl: "https://demo.example",
    apiCheck: false,
    ...combo.cfg,
  });
  element("pName").value = "Demo";
  element("pUrl").value = "https://demo.example";
  page.gen();
  const contract = element("t-contract").textContent;
  const sdk = element("t-sdk").textContent;
  const guide = element("t-guide").textContent;
  const where = `combination ${combo.name}`;

  if (contract.includes("@ifr/")) fail(`${where}: contract still imports @ifr/*`);
  for (const mod of combo.imports) {
    if (!contract.includes(`import "./library/${mod}.sol";`)) {
      fail(`${where}: missing relative import ./library/${mod}.sol`);
    }
    if (!fs.existsSync(path.join(libraryDir, `${mod}.sol`))) {
      fail(`${where}: contracts/library/${mod}.sol does not exist`);
    }
  }
  if (!contract.includes(`public view ${combo.override}\n`)) {
    fail(`${where}: hasAccess override must be ${combo.override}`);
  }
  const constructorMatch = contract.match(/BaseAccessModule\(\s*(0x[0-9a-fA-F]{40}),\s*(\d+)/);
  if (!constructorMatch) {
    fail(`${where}: BaseAccessModule constructor arguments not found`);
  } else {
    const expectedWei = BigInt(combo.cfg.minAmount) * 10n ** 9n;
    if (constructorMatch[2] !== expectedWei.toString()) {
      fail(`${where}: min amount ${constructorMatch[2]} != ${expectedWei} (9 decimals)`);
    }
  }
  if (combo.cfg.hardLock && !contract.includes(`minLockDuration = ${combo.cfg.lockDuration * 86400};`)) {
    fail(`${where}: minLockDuration not set from lock duration`);
  }

  if (sdk.includes("npm install ifr-sdk")) fail(`${where}: snippet must not claim registry availability`);
  if (!sdk.includes("npm pack --ignore-scripts")) fail(`${where}: snippet must use the documented pack flow`);
  if (!sdk.includes("copilot-api.ifrunit.tech/api/ifr/check")) fail(`${where}: REST endpoint missing`);
  if (!guide.includes("no Sepolia IFR token is deployed")) fail(`${where}: guide must state there is no Sepolia IFR deployment`);
  if (!guide.includes("the repository ships no generic")) fail(`${where}: guide must not reference a nonexistent deploy script`);
  if (!guide.includes("0xc43d48E7FDA576C5022d0670B652A622E8caD041")) fail(`${where}: guide must name the Mainnet governance address`);
}

// Contract identifiers from free-text product names: digit-leading, digit-only, symbol-only and
// reserved inputs must still yield a valid Solidity identifier; the readable name stays in the comment.
// (Compilation of these names is proven by test/builder/CodeGeneratorCompile.test.cjs via builder.html parity.)
const SOLIDITY_RESERVED = new Set(["contract", "function", "address", "mapping", "returns", "BaseAccessModule", "Ownable"]);
const nameCases = [
  { input: "3D Print Shop", expected: "IFR3DPrintShopAccess" },
  { input: "42", expected: "IFR42Access" },
  { input: "007 Agency", expected: "IFR007AgencyAccess" },
  { input: "!!! ###", expected: "MyProductAccess" },
  { input: "contract", expected: "contractAccess" },
  { input: "Demo", expected: "DemoAccess" },
];
for (const { input, expected } of nameCases) {
  Object.assign(page.C, { productName: input, productUrl: "https://demo.example", minAmount: 1000, hardLock: true, lockDuration: 30, tierSystem: true, cooldown: true, apiCheck: false });
  element("pName").value = input;
  element("pUrl").value = "https://demo.example";
  page.gen();
  const contract = element("t-contract").textContent;
  const declared = (contract.match(/^contract (\S+) is /m) || [])[1];
  const where = `product name ${JSON.stringify(input)}`;
  if (declared !== expected) fail(`${where}: contract name ${declared} != ${expected}`);
  if (!declared || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(declared) || SOLIDITY_RESERVED.has(declared)) {
    fail(`${where}: ${declared} is not a valid Solidity identifier`);
  }
  if (!contract.includes(`// Product: ${input}\n`)) fail(`${where}: readable product name must stay in the header comment`);
  if (!element("t-guide").textContent.includes(`contracts/${expected}.sol`)) fail(`${where}: deploy guide must use ${expected}.sol`);
}

// Score math stays as deployed: default configuration scores 90/SAFE.
Object.assign(page.C, { minAmount: 1000, hardLock: true, lockDuration: 30, tierSystem: true, cooldown: true, apiCheck: false });
const defaultScore = page.score();
if (defaultScore.score !== 90 || defaultScore.level !== "SAFE") {
  fail(`default score changed: ${defaultScore.score}/${defaultScore.level}, expected 90/SAFE`);
}

reportAndExit();

function reportAndExit() {
  if (failures.length) {
    console.error("Builder page generator checks failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`Builder page generator checks passed (${combos ? combos.length : 0} combinations).`);
}
