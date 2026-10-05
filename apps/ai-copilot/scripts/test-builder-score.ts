// Builder configuration score served by POST /api/builder/generate (T-272).
// The score is a configuration heuristic, never a security verdict: the output must use the
// same "Configuration Score" wording as docs/builder.html and apps/builder/engine/SecurityScorer.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { builderConfigurationScore, type BuilderGenConfig } from "../server/builder-score.ts";

const DISCLAIMER = "Configuration heuristic only — not audited, not a security audit or certification";
const FORBIDDEN = /\b(SAFE|MEDIUM|RISKY)\b|Security Score/;

const strong: BuilderGenConfig = { productName: "A", minAmount: 1000, hardLock: true, lockDuration: 30, tierSystem: true, cooldown: true, apiCheck: false };
const partial: BuilderGenConfig = { productName: "B", minAmount: 500, hardLock: true, lockDuration: 7, cooldown: true, apiCheck: false };
const weak: BuilderGenConfig = { productName: "C", minAmount: 100, apiCheck: true };

const cases: Array<[BuilderGenConfig, number, string, string, string]> = [
  [strong, 90, "strong", "Strong setup", "🟢"],
  [partial, 65, "partial", "Partial setup", "🟡"],
  [weak, 10, "weak", "Weak setup", "🔴"],
];

for (const [config, score, level, label, emoji] of cases) {
  const result = builderConfigurationScore(config);
  const serialized = JSON.stringify(result);
  // Scoring math is unchanged.
  assert.equal(result.score, score, `score for ${label}`);
  assert.equal(result.scoreName, "Configuration Score");
  assert.equal(result.level, level);
  assert.equal(result.label, label);
  assert.equal(result.emoji, emoji);
  assert.ok(result.disclaimer.startsWith(DISCLAIMER), "disclaimer present");
  assert.doesNotMatch(serialized, FORBIDDEN, `no security verdict in output: ${serialized}`);
}

assert.deepEqual(builderConfigurationScore(weak).recommendations, [
  "Enable Hard Lock to prevent flash access",
  "Enable Cooldown for anti-gaming protection",
  "Increase minimum to >=500 IFR",
  "Add Tier System for graduated access",
]);

// Copilot knowledge and system prompt describe the builder score with the same wording.
for (const file of ["../src/context/ifr-knowledge.ts", "../src/context/system-prompts.ts"]) {
  const text = readFileSync(new URL(file, import.meta.url), "utf8");
  assert.doesNotMatch(text, /Security Score|\b(SAFE|RISKY)\b/, `${file} must not describe the builder score as a security verdict`);
  assert.match(text, /Configuration Score/, `${file} names the Configuration Score`);
}

console.log("builder configuration score: OK");
