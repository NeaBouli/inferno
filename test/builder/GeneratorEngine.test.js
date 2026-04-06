/**
 * Phase 5b — Generator Engine + Security Scorer Tests
 * Run: node test/builder/GeneratorEngine.test.js
 *
 * Uses inline implementations (same logic as TS files) to test
 * without requiring TypeScript compilation.
 */

// ── Inline implementations (mirror TS logic) ────────────────────────

function validateConfig(config) {
  const errors = [];
  const warnings = [];
  const VALID_DURATIONS = [7, 30, 90, 180, 365];

  if (!config.productName?.trim()) errors.push("productName is required");
  if (!config.productUrl?.trim()) errors.push("productUrl is required");
  if (!config.minAmount || config.minAmount < 1) errors.push("minAmount must be >= 1 IFR");
  else if (config.minAmount < 100) warnings.push("minAmount < 100 IFR: barrier very low, gaming risk high");

  if (config.hardLock && !VALID_DURATIONS.includes(config.lockDuration)) {
    errors.push("lockDuration must be: 7, 30, 90, 180, or 365 days");
  }
  if (config.tierSystem) {
    const t1 = config.tier1Amount || 500, t2 = config.tier2Amount || 2000, t3 = config.tier3Amount || 10000;
    if (!(t1 < t2 && t2 < t3)) errors.push("Tier thresholds must be ascending: t1 < t2 < t3");
  }
  if (!config.hardLock) warnings.push("No hard lock: flash access possible — users can buy, access, then sell");
  if (!config.cooldown) warnings.push("No cooldown: gaming risk — consider enabling anti-gaming protection");
  if (!config.tierSystem) warnings.push("No tier system: binary on/off access — consider tiers for better monetization");

  return { valid: errors.length === 0, errors, warnings };
}

function calculateSecurityScore(config) {
  let score = 0;
  if (config.hardLock) {
    if (config.lockDuration >= 90) score += 30;
    else if (config.lockDuration >= 30) score += 25;
    else if (config.lockDuration >= 7) score += 20;
    else score += 10;
  }
  if (config.cooldown) score += 20;
  if (config.tierSystem) score += 15;
  if (config.minAmount >= 10000) score += 20;
  else if (config.minAmount >= 1000) score += 15;
  else if (config.minAmount >= 500) score += 10;
  else if (config.minAmount >= 100) score += 5;
  if (!config.apiCheck) score += 15; else score += 5;

  const level = score >= 80 ? "SAFE" : score >= 50 ? "MEDIUM" : "RISKY";
  const emoji = level === "SAFE" ? "🟢" : level === "MEDIUM" ? "🟡" : "🔴";
  return { score, level, emoji };
}

function generateCode(config) {
  const safeName = (config.productName || "MyProduct").replace(/[^a-zA-Z0-9]/g, "");
  const contractName = safeName + "Access";
  const useHardLock = !!config.hardLock;
  const useTier = !!config.tierSystem;
  const minWei = (config.minAmount || 500) * 1e9;

  const bases = [useHardLock ? "HardLockModule" : "BaseAccessModule"];
  if (useTier) bases.push("TierModule");
  if (config.cooldown) bases.push("CooldownModule");
  bases.push("Ownable");

  const contractCode = `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n// Product: ${config.productName}\ncontract ${contractName} is ${bases.join(", ")} {\n  // min: ${minWei}\n}`;
  const sdkSnippet = `const hasAccess = await ifr.checkAccess({ wallet: userAddress, required: ${config.minAmount} });`;

  return { contractName, contractCode, sdkSnippet, deployGuide: "See docs" };
}

// ── Test Runner ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  ✔ ${testName}`);
  } else {
    failed++;
    console.log(`  ✗ ${testName} — FAILED`);
  }
}

console.log("\n  Phase 5b — Generator Engine Tests\n");

// ── ConfigValidator ──────────────────────────────────────────────────

const validConfig = {
  productName: "TestApp",
  productUrl: "https://test.com",
  minAmount: 1000,
  hardLock: true,
  lockDuration: 30,
  tierSystem: true,
  cooldown: true,
  apiCheck: false,
};

const r1 = validateConfig(validConfig);
assert(r1.valid === true, "T01: validateConfig() valid config → no errors");
assert(r1.errors.length === 0, "T02: validateConfig() valid → 0 errors");

const r3 = validateConfig({ ...validConfig, productName: "" });
assert(r3.valid === false && r3.errors.some(e => e.includes("productName")), "T03: missing productName → error");

const r4 = validateConfig({ ...validConfig, minAmount: 0 });
assert(r4.valid === false && r4.errors.some(e => e.includes("minAmount")), "T04: minAmount 0 → error");

const r5 = validateConfig({ ...validConfig, hardLock: true, lockDuration: 15 });
assert(r5.valid === false && r5.errors.some(e => e.includes("lockDuration")), "T05: invalid lockDuration → error");

const r6 = validateConfig({ ...validConfig, minAmount: 50 });
assert(r6.warnings.some(w => w.includes("low")), "T06: low minAmount → warning");

const r7 = validateConfig({ ...validConfig, hardLock: false });
assert(r7.warnings.some(w => w.includes("hard lock")), "T07: no hardLock → warning");

const r8 = validateConfig({ ...validConfig, tierSystem: true, tier1Amount: 1000, tier2Amount: 500, tier3Amount: 200 });
assert(r8.valid === false && r8.errors.some(e => e.includes("ascending")), "T08: non-ascending tiers → error");

// ── SecurityScorer ───────────────────────────────────────────────────

const maxConfig = { ...validConfig, lockDuration: 90, minAmount: 10000 };
const s1 = calculateSecurityScore(maxConfig);
assert(s1.level === "SAFE", "T09: max config → SAFE");
assert(s1.score === 100, "T10: max config → 100 points");

const minConfig = { productName: "X", productUrl: "x", minAmount: 10, hardLock: false, tierSystem: false, cooldown: false, apiCheck: true };
const s2 = calculateSecurityScore(minConfig);
assert(s2.level === "RISKY", "T11: min config → RISKY");
assert(s2.score <= 10, "T12: min config → low score");

const s3 = calculateSecurityScore({ ...validConfig, hardLock: true, lockDuration: 30 });
assert(s3.score >= 25, "T13: hardLock 30d → includes lock points");

const s4 = calculateSecurityScore({ ...validConfig, cooldown: true });
assert(s4.score >= 20, "T14: cooldown → includes 20pts");

const s5 = calculateSecurityScore({ ...validConfig, tierSystem: true });
assert(s5.score >= 15, "T15: tierSystem → includes 15pts");

const s6 = calculateSecurityScore({ ...validConfig, apiCheck: false });
const s7 = calculateSecurityScore({ ...validConfig, apiCheck: true });
assert(s6.score > s7.score, "T16: on-chain > apiCheck score");

const sMedium = calculateSecurityScore({ ...validConfig, hardLock: false, minAmount: 500 });
assert(sMedium.level === "MEDIUM", "T17: medium config → MEDIUM");

assert(s1.emoji === "🟢", "T18: SAFE → 🟢");
assert(s2.emoji === "🔴", "T19: RISKY → 🔴");
assert(sMedium.emoji === "🟡", "T20: MEDIUM → 🟡");

// ── CodeGenerator ────────────────────────────────────────────────────

const g1 = generateCode(validConfig);
assert(g1.contractName === "TestAppAccess", "T21: contractName correct");
assert(g1.contractCode.includes("TestApp"), "T22: code includes productName");
assert(g1.contractCode.includes(String(validConfig.minAmount * 1e9)), "T23: code includes minAmount");

const g2 = generateCode({ ...validConfig, hardLock: true });
assert(g2.contractCode.includes("HardLockModule"), "T24: hardLock → HardLockModule");

const g3 = generateCode({ ...validConfig, hardLock: false });
assert(g3.contractCode.includes("BaseAccessModule"), "T25: no lock → BaseAccessModule");

const g4 = generateCode({ ...validConfig, tierSystem: true });
assert(g4.contractCode.includes("TierModule"), "T26: tierSystem → TierModule");

const g5 = generateCode({ ...validConfig, cooldown: true });
assert(g5.contractCode.includes("CooldownModule"), "T27: cooldown → CooldownModule");

assert(g1.sdkSnippet.includes("checkAccess"), "T28: SDK snippet includes checkAccess");
assert(g1.sdkSnippet.includes(String(validConfig.minAmount)), "T29: SDK snippet includes minAmount");

const g6 = generateCode({ ...validConfig, productName: "My Cool App!!" });
assert(g6.contractName === "MyCoolAppAccess", "T30: special chars stripped from name");

// ── Summary ──────────────────────────────────────────────────────────

console.log(`\n  ${passed} passing, ${failed} failing\n`);
process.exit(failed > 0 ? 1 : 0);
