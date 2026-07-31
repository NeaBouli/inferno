const assert = require("node:assert/strict");
const path = require("node:path");

const distDirectory = process.argv[2];
if (!distDirectory) throw new Error("Compiled Builder directory argument is required");

const { generateCode } = require(path.join(distDirectory, "CodeGenerator.js"));
const { validateConfig } = require(path.join(distDirectory, "ConfigValidator.js"));
const { calculateSecurityScore } = require(path.join(distDirectory, "SecurityScorer.js"));

const validConfig = {
  productName: "Source Test",
  productUrl: "https://example.com",
  minAmount: 1000,
  hardLock: true,
  lockDuration: 30,
  tierSystem: true,
  tier1Amount: 500,
  tier2Amount: 2000,
  tier3Amount: 10000,
  cooldown: true,
  cooldownHours: 24,
  apiCheck: false,
};

const generated = generateCode(validConfig);

assert.match(generated.sdkSnippet, /const access = await ifr\.checkAccess/);
assert.match(generated.sdkSnippet, /const \{ tier \} = await ifr\.getTier/);
assert.match(generated.sdkSnippet, /if \(access\.hasAccess\) enableAccess/);
assert.match(generated.sdkSnippet, /https:\/\/copilot-api\.ifrunit\.tech\/api\/ifr\/check/);
assert.doesNotMatch(generated.sdkSnippet, /npm install ifr-sdk/);
assert.match(generated.deployGuide, /npm registry publication is pending/);
assert.doesNotMatch(generated.deployGuide, /npm install ifr-sdk/);

assert.equal(validateConfig(validConfig).valid, true);
assert.equal(validateConfig({ ...validConfig, cooldownHours: 1 }).valid, true);
assert.equal(validateConfig({ ...validConfig, cooldownHours: 720 }).valid, true);
assert.match(
  validateConfig({ ...validConfig, cooldownHours: 0 }).errors.join("\n"),
  /cooldownHours must be between 1 and 720/
);
assert.match(
  validateConfig({ ...validConfig, cooldownHours: 721 }).errors.join("\n"),
  /cooldownHours must be between 1 and 720/
);
assert.match(
  validateConfig({
    ...validConfig,
    tier1Amount: 1000,
    tier2Amount: 500,
    tier3Amount: 200,
  }).errors.join("\n"),
  /Tier thresholds must be ascending/
);

const safeScore = calculateSecurityScore({
  ...validConfig,
  lockDuration: 90,
  minAmount: 10000,
});
assert.equal(safeScore.score, 100);
assert.equal(safeScore.level, "SAFE");

const riskyScore = calculateSecurityScore({
  ...validConfig,
  minAmount: 10,
  hardLock: false,
  tierSystem: false,
  cooldown: false,
  apiCheck: true,
});
assert.equal(riskyScore.level, "RISKY");
assert.equal(riskyScore.score, 5);
assert.equal(riskyScore.breakdown.length, 5);
assert.deepEqual(riskyScore.recommendations, [
  "Enable Hard Lock to prevent flash access",
  "Enable Cooldown for anti-gaming protection",
  "Increase minimum to >=500 IFR",
  "Add Tier System for graduated access",
  "Switch to on-chain verification for trustless security",
]);

console.log("[builder-source-test] PASS");
