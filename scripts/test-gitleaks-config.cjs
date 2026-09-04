#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const config = fs.readFileSync(path.join(root, ".gitleaks.toml"), "utf8");
const ignored = fs.readFileSync(path.join(root, ".gitleaksignore"), "utf8");

const rules = config.split("[[rules]]");
const rule = rules.find((block) => /id\s*=\s*"eth-private-key"/.test(block));
const credentialRule = rules.find((block) =>
  /id\s*=\s*"eth-private-key-credential-file"/.test(block)
);

assert.ok(rule, "eth-private-key rule must exist");
assert.match(rule, /secretGroup\s*=\s*1/, "Ethereum rule must identify its secret capture group");

const source = rule.match(/regex\s*=\s*'''([\s\S]*?)'''/)?.[1];
assert.ok(source, "Ethereum rule must use a triple-quoted regex");

const caseInsensitive = source.startsWith("(?i)");
const expression = new RegExp(caseInsensitive ? source.slice(4) : source, caseInsensitive ? "i" : "");
const hex = "a".repeat(64);

for (const publicValue of [
  `transactionHash: 0x${hex}`,
  `calldata = 0x12345678${hex}`,
  `bytes32 publicConstant = 0x${hex}`,
  `https://etherscan.io/tx/0x${hex}`,
]) {
  assert.equal(expression.test(publicValue), false, `public chain data must not match: ${publicValue.slice(0, 24)}`);
}

for (const privateValue of [
  `PRIVATE_KEY=0x${hex}`,
  `deployer_private_key: ${hex}`,
  `DEPLOYER_KEY=${hex}`,
  `signerKey: 0x${hex}`,
  `privkey => ${hex}`,
  `wallet-secret-key => "0x${hex}"`,
  `private key = '${hex}'`,
]) {
  expression.lastIndex = 0;
  const match = expression.exec(privateValue);
  assert.ok(match, `labeled key material must match: ${privateValue.slice(0, 24)}`);
  assert.equal(match[1].replace(/^0x/i, ""), hex, "secretGroup 1 must contain only key material");
}

assert.ok(credentialRule, "credential-file Ethereum key rule must exist");
assert.match(
  credentialRule,
  /path\s*=\s*'''[\s\S]*\\\.env[\s\S]*'''/,
  "credential-file rule must be restricted to secret-bearing paths"
);
assert.match(
  credentialRule,
  /secretGroup\s*=\s*1/,
  "credential-file rule must identify its secret capture group"
);
assert.ok(
  !config.includes("regex = '''(?i)(0x[0-9a-fA-F]{64})'''"),
  "no rule may treat every bare Ethereum hash as a private key"
);

const rotatedFingerprint =
  "0fa04ccab430f5e3a27b5b26c77c48a54553c8fe:BRIDGE.md:telegram-bot-token:18";
assert.equal(
  ignored.split(/\r?\n/).filter((line) => line && !line.startsWith("#")).length,
  1,
  "only the reviewed historical finding may be baselined"
);
assert.ok(ignored.includes(rotatedFingerprint), "rotated historical Telegram finding must be baselined exactly");

const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/security-audit.yml"),
  "utf8"
);
assert.ok(workflow.includes("schedule:"), "weekly full-history security schedule must remain enabled");
assert.ok(workflow.includes("fetch-depth: 0"), "secret scan must retain full Git history");
assert.ok(
  workflow.includes("run: npm run test:gitleaks-config"),
  "Security Audit must validate the Gitleaks configuration"
);

console.log("[gitleaks-config] PASS");
