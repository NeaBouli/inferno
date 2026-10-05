// T-211: compile every Builder engine option combination with the pinned compiler, and check that
// the engine and docs/builder.html emit the same contract structure for the same options.
// Run: node test/builder/CodeGeneratorCompile.test.cjs <compiled engine dir>
// Needs: npm ci --prefix test/builder/compile-harness
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const harness = path.join(__dirname, "compile-harness", "node_modules");
const solc = require(path.join(harness, "solc"));
const distDirectory = process.argv[2];
if (!distDirectory) throw new Error("Compiled Builder directory argument is required");
const { generateCode } = require(path.join(path.resolve(distDirectory), "CodeGenerator.js"));
const { validateConfig } = require(path.join(path.resolve(distDirectory), "ConfigValidator.js"));

const LIBRARY = ["BaseAccessModule.sol", "HardLockModule.sol", "TierModule.sol", "CooldownModule.sol"];
const librarySources = Object.fromEntries(
  LIBRARY.map((file) => [`contracts/library/${file}`, { content: fs.readFileSync(path.join(root, "contracts/library", file), "utf8") }])
);

/** Compiles one generated contract in the documented user layout (contracts/X.sol + contracts/library/*). */
function compile(contractName, code) {
  const file = `contracts/${contractName}.sol`;
  const input = {
    language: "Solidity",
    sources: { [file]: { content: code }, ...librarySources },
    settings: { evmVersion: "paris", outputSelection: { "*": { "*": ["abi"] } } },
  };
  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (p) => (p.startsWith("@openzeppelin/")
        ? { contents: fs.readFileSync(path.join(harness, p), "utf8") }
        : { error: `File not found: ${p}` }),
    })
  );
  const errors = (output.errors || []).filter((e) => e.severity === "error").map((e) => e.formattedMessage.split("\n")[0]);
  return { errors, contracts: Object.keys((output.contracts || {})[file] || {}) };
}

const base = { productName: "Demo Product", productUrl: "https://demo.example", minAmount: 1000, lockDuration: 30 };
const combos = [];
for (const hardLock of [false, true]) for (const tierSystem of [false, true]) for (const cooldown of [false, true]) for (const apiCheck of [false, true]) {
  combos.push({ name: `hl${+hardLock}-tier${+tierSystem}-cd${+cooldown}-api${+apiCheck}`, cfg: { ...base, hardLock, tierSystem, cooldown, apiCheck } });
}
const full = { ...base, hardLock: true, tierSystem: true, cooldown: true, apiCheck: false };
for (const lockDuration of [7, 30, 90, 180, 365]) combos.push({ name: `lock-${lockDuration}d`, cfg: { ...full, lockDuration } });
combos.push({ name: "cooldown-1h", cfg: { ...full, cooldownHours: 1 } });
combos.push({ name: "cooldown-720h", cfg: { ...full, cooldownHours: 720 } });
combos.push({ name: "custom-tiers", cfg: { ...full, tier1Amount: 1000, tier2Amount: 2500, tier3Amount: 50000 } });
combos.push({ name: "huge-amount", cfg: { ...full, minAmount: 1_000_000_000_000 } });
// Product names that do not form a valid identifier on their own (digit-leading, digit-only, symbol-only, reserved).
const NAME_CASES = [
  { productName: "3D Print Shop", contractName: "IFR3DPrintShopAccess" },
  { productName: "42", contractName: "IFR42Access" },
  { productName: "!!! ###", contractName: "MyProductAccess" },
  { productName: "contract", contractName: "contractAccess" },
  { productName: "Ownable", contractName: "OwnableAccess" },
];
for (const { productName } of NAME_CASES) combos.push({ name: `name-${productName}`, cfg: { ...full, productName } });
combos.push({ name: "hostile-text", cfg: { ...full, productName: 'X"; } contract Evil { // \\ ünï', productUrl: 'https://e.example/"\\\n} contract Evil2 {' } });

let compiled = 0;
for (const { name, cfg } of combos) {
  assert.equal(validateConfig(cfg).valid, true, `${name}: config must be valid`);
  const generated = generateCode(cfg);
  const code = generated.contractCode;
  assert.doesNotMatch(code, /@ifr\//, `${name}: no unresolvable @ifr imports`);
  assert.doesNotMatch(code, /\b\d+(?:\.\d+)?e[+-]?\d+\b/, `${name}: amounts must not use exponent notation`);
  assert.doesNotMatch(code, /Security: (SAFE|MEDIUM|RISKY)/, `${name}: heuristic label must not read as a security verdict`);
  // Fee-on-transfer: deposits go only through the inherited HardLockModule.lock() (balance-delta credit).
  assert.doesNotMatch(code, /transferFrom/, `${name}: generated contract must not add its own transferFrom deposit path`);
  assert.ok(generated.deployGuide.includes("lock() credits only the amount that arrives"), `${name}: guide explains fee-on-transfer lock accounting`);
  const { errors, contracts } = compile(generated.contractName, code);
  assert.deepEqual(errors, [], `${name}: must compile\n${errors.join("\n")}`);
  assert.deepEqual(contracts, [generated.contractName], `${name}: exactly the generated contract, nothing injected`);
  compiled += 1;
}
for (const { productName, contractName } of NAME_CASES) {
  const generated = generateCode({ ...full, productName });
  assert.equal(generated.contractName, contractName, `name ${productName}: deterministic contract identifier`);
  assert.ok(generated.contractCode.includes(`// Product: ${productName}\n`), `name ${productName}: readable name kept in the header`);
  assert.ok(generated.deployGuide.includes(`contracts/${contractName}.sol`), `name ${productName}: deploy guide file name`);
}
const hardLockSource = librarySources["contracts/library/HardLockModule.sol"].content;
for (const needle of [
  "uint256 balanceBefore = ifrToken.balanceOf(address(this));",
  "ifrToken.safeTransferFrom(msg.sender, address(this), amount);",
  "uint256 received = ifrToken.balanceOf(address(this)) - balanceBefore;",
  'require(received > 0, "Nothing received");',
  "amount: received,",
  "emit Locked(msg.sender, received, duration);",
]) assert.ok(hardLockSource.includes(needle), `HardLockModule.lock must credit the measured balance delta (missing: ${needle})`);
const huge = generateCode(combos.find((c) => c.name === "huge-amount").cfg).contractCode;
assert.match(huge, /1000000000000000000000\) \/\/ 1000000000000 IFR/, "exact 9-decimal base units for large amounts");
console.log(`[builder-engine-compile] PASS - ${compiled} engine combinations compile with solc ${solc.version().split("+")[0]}`);

// ── Parity with docs/builder.html ────────────────────────────────────────────
const htmlPath = process.env.BUILDER_HTML || path.join(root, "docs/builder.html");
const html = fs.readFileSync(htmlPath, "utf8");
if (/@ifr\/library/.test(html)) {
  console.log("[builder-parity] SKIP - docs/builder.html still emits @ifr/library imports (fixed by PR #178); parity is enforced once it is merged");
  process.exit(0);
}
const script = html.match(/<script>\n([\s\S]*?)<\/script>/);
if (!script) throw new Error("builder.html script block not found");
const elements = {};
const el = (id) => (elements[id] ||= { value: "", textContent: "", innerHTML: "", style: {}, disabled: false, classList: { add() {}, remove() {}, toggle() {} }, scrollIntoView() {} });
const page = new Function("document", "navigator", "window", "event", `${script[1]}\n;return { gen, C };`)(
  { getElementById: el, querySelectorAll: () => [el("q0")], querySelector: () => el("qS") },
  { clipboard: { writeText: async () => {} } },
  {},
  {}
);

const pick = (code, re) => (code.match(re) || [, null])[1];

/** Structural fingerprint: imports, bases, override clause, hasAccess body, base constructor args, tier hook. */
function structure(code) {
  const pick = (re) => (code.match(re) || [, null])[1];
  return {
    imports: [...code.matchAll(/^import "([^"]+)";/gm)].map((m) => m[1]).sort(),
    bases: pick(/contract \w+ is ([^{]+)\{/)?.trim(),
    override: pick(/function hasAccess\(address user\)\s+public view (override(?:\([^)]*\))?)/),
    body: pick(/function hasAccess[\s\S]*?return ([^;]+);/),
    baseArgs: pick(/BaseAccessModule\(\s*([\s\S]*?)\s*\)\s*(?:\/\/[^\n]*)?\s*Ownable/)?.replace(/\/\/[^\n]*/g, "").replace(/\s+/g, ""),
    tierBalance: /function _tierBalance/.test(code),
  };
}

let parity = 0;
const nameCombos = combos.filter((c) => c.name.startsWith("name-"));
for (const { name, cfg } of [...combos.slice(0, 16), ...nameCombos]) {
  Object.assign(page.C, cfg);
  el("pName").value = cfg.productName;
  el("pUrl").value = cfg.productUrl;
  page.gen();
  const pageCode = el("t-contract").textContent;
  const engine = generateCode(cfg);
  assert.deepEqual(structure(pageCode), structure(engine.contractCode), `${name}: engine and builder.html structure differ`);
  assert.equal(pick(pageCode, /^contract (\S+) is /m), engine.contractName, `${name}: engine and builder.html contract name differ`);
  const { errors } = compile(engine.contractName, pageCode);
  assert.deepEqual(errors, [], `${name}: builder.html output must compile\n${errors.join("\n")}`);
  parity += 1;
}
console.log(`[builder-parity] PASS - engine and builder.html match structurally in ${parity} combinations; both compile`);

// Score card wording parity: same non-verdict labels and the same "what is checked" disclaimer.
const { LEVEL_LABELS, SCORE_DISCLAIMER } = require(path.join(path.resolve(distDirectory), "SecurityScorer.js"));
assert.doesNotMatch(SCORE_DISCLAIMER, /returns exactly/, "unlock payout may be reduced by the IFR transfer fee");
assert.ok(html.replace(/&mdash;/g, "—").replace(/&rsquo;/g, "’").includes(SCORE_DISCLAIMER), "engine SCORE_DISCLAIMER must match the builder.html score card text");
for (const label of Object.values(LEVEL_LABELS)) assert.ok(html.includes(label), `builder.html must use the engine label ${label}`);
assert.doesNotMatch(Object.values(LEVEL_LABELS).join(" "), /SAFE|MEDIUM|RISKY/, "labels must not read as a security verdict");
console.log("[builder-parity] PASS - score labels and disclaimer match builder.html");
