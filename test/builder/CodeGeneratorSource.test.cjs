const assert = require("node:assert/strict");
const path = require("node:path");

const distDirectory = process.argv[2];
if (!distDirectory) throw new Error("Compiled Builder directory argument is required");

const { generateCode } = require(path.join(distDirectory, "CodeGenerator.js"));
const generated = generateCode({
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
});

assert.match(generated.sdkSnippet, /const access = await ifr\.checkAccess/);
assert.match(generated.sdkSnippet, /const \{ tier \} = await ifr\.getTier/);
assert.match(generated.sdkSnippet, /if \(access\.hasAccess\) enableAccess/);
assert.match(generated.sdkSnippet, /https:\/\/copilot-api\.ifrunit\.tech\/api\/ifr\/check/);
assert.doesNotMatch(generated.sdkSnippet, /npm install ifr-sdk/);
assert.match(generated.deployGuide, /npm registry publication is pending/);
assert.doesNotMatch(generated.deployGuide, /npm install ifr-sdk/);

console.log("[builder-source-test] PASS");
