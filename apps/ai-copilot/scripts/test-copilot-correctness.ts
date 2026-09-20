import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  ACCESS_TIERS,
  ACCESS_TIER_SUMMARY,
  COPILOT_MESSAGE_LIMIT,
  IFR_BASE_UNITS_PER_TOKEN,
  getAccessTier,
} from "../src/context/copilot-policy.js";
import { getIFRKnowledge } from "../src/context/ifr-knowledge.js";
import { SYSTEM_PROMPTS } from "../src/context/system-prompts.js";

const appRoot = new URL("../", import.meta.url);
const sourcePaths = [
  "server/index.ts",
  "src/context/system-prompts.ts",
  "src/context/ifr-knowledge.ts",
  "src/components/IFRCopilot.tsx",
  "../../docs/wiki/agent.html",
];
const sourceEntries = await Promise.all(
  sourcePaths.map(async (relativePath) => [
    relativePath,
    await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8"),
  ] as const),
);
const source = Object.fromEntries(sourceEntries);

assert.equal(COPILOT_MESSAGE_LIMIT, 20);
assert.deepEqual(
  ACCESS_TIERS.map(({ id, name, minIFR }) => ({ id, name, minIFR })),
  [
    { id: 1, name: "Basic", minIFR: 500 },
    { id: 2, name: "Premium", minIFR: 2_000 },
    { id: 3, name: "Pro", minIFR: 10_000 },
  ],
);
assert.equal(getAccessTier(499n * IFR_BASE_UNITS_PER_TOKEN).name, "None");
assert.equal(getAccessTier(500n * IFR_BASE_UNITS_PER_TOKEN).name, "Basic");
assert.equal(getAccessTier(1_999n * IFR_BASE_UNITS_PER_TOKEN).name, "Basic");
assert.equal(getAccessTier(2_000n * IFR_BASE_UNITS_PER_TOKEN).name, "Premium");
assert.equal(getAccessTier(9_999n * IFR_BASE_UNITS_PER_TOKEN).name, "Premium");
assert.equal(getAccessTier(10_000n * IFR_BASE_UNITS_PER_TOKEN).name, "Pro");
assert.throws(() => getAccessTier(-1n), /cannot be negative/);

for (const [relativePath, contents] of sourceEntries) {
  assert.doesNotMatch(contents, /Bronze|Silver|Gold|Platinum/, `${relativePath} contains a legacy tier name`);
}
assert.match(SYSTEM_PROMPTS.user, new RegExp(ACCESS_TIER_SUMMARY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(SYSTEM_PROMPTS.explorer, /does not receive verified wallet balances, lock state or tier context/);
assert.match(SYSTEM_PROMPTS.user, /does not receive verified wallet or lock context/);
assert.doesNotMatch(SYSTEM_PROMPTS.dev, /NO CONTRACT ADDRESSES IN RESPONSES/);
assert.match(SYSTEM_PROMPTS.dev, /VERIFIED CONTRACT ADDRESSES FOR DEVELOPERS/);
assert.match(SYSTEM_PROMPTS.dev, /0x77e99917Eca8539c62F509ED1193ac36580A6e7B/);
assert.match(SYSTEM_PROMPTS.explorer, /NO CONTRACT ADDRESSES IN RESPONSES/);
assert.match(SYSTEM_PROMPTS.user, /NO CONTRACT ADDRESSES IN RESPONSES/);
assert.doesNotMatch(source["server/index.ts"], /x-wallet-address/);
assert.doesNotMatch(source["src/components/IFRCopilot.tsx"], /x-wallet-address|__IFR_WALLET_ADDRESS/);
assert.doesNotMatch(
  source["../../docs/wiki/agent.html"],
  /\?wallet=|Premium Copilot Active|more personalized guidance|wallet balance, lock status, tier, and on-chain context/,
);
assert.match(
  source["../../docs/wiki/agent.html"],
  /does not pass the connected wallet or its on-chain state to the Copilot chat/,
);

const knowledge = getIFRKnowledge();
assert.match(knowledge.aiCopilot.accessTiers, new RegExp(ACCESS_TIER_SUMMARY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(knowledge.tokenomics.currentSupply, /live \/api\/supply endpoint/);
assert.match(knowledge.governance.proposals, /#11-#16 executed/);
assert.ok(!("sepolia" in knowledge.builderRegistry), "Unverified BuilderRegistry Sepolia address must be absent");
assert.match(knowledge.builderRegistry.tests, /30\/30/);
assert.match(source["server/index.ts"], /messages\.length > COPILOT_MESSAGE_LIMIT/);
assert.match(source["server/index.ts"], /histories\[currentMode\]\.length >= \$\{COPILOT_MESSAGE_LIMIT\}/);
assert.doesNotMatch(source["server/index.ts"], /function checkHealth\(uint256 loanId\) view/);

const port = await new Promise<number>((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    assert.ok(address && typeof address === "object");
    probe.close(() => resolve(address.port));
  });
});
const voteDirectory = await mkdtemp(path.join(os.tmpdir(), "ifr-copilot-vote-"));
const voteFile = path.join(voteDirectory, "ifr_bootstrap_votes.json");
const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  cwd: appRoot.pathname,
  env: {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    ANTHROPIC_API_KEY: "correctness-test",
    ETHERSCAN_API_KEY: "correctness-test",
    RAILWAY_VOLUME_MOUNT_PATH: voteDirectory,
    BOOTSTRAP_VOTES: "",
  },
  stdio: ["ignore", "ignore", "pipe"],
});
let childStderr = "";
child.stderr.on("data", (chunk) => { childStderr += chunk.toString(); });

async function postRetiredVote(): Promise<Response> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await fetch(`http://127.0.0.1:${port}/api/bootstrap/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet: "0x1111111111111111111111111111111111111111",
          vote: "finalise",
        }),
      });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError ?? new Error("Copilot server did not start in time");
}

try {
  const response = await postRetiredVote();
  assert.equal(response.status, 410);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "Bootstrap voting closed after finalization on June 5, 2026.",
    code: "bootstrap_vote_closed",
  });
  await assert.rejects(stat(voteFile), { code: "ENOENT" });
} catch (error) {
  if (childStderr) console.error(childStderr);
  throw error;
} finally {
  child.kill("SIGKILL");
  await rm(voteDirectory, { recursive: true, force: true });
}

console.log("[copilot-correctness-test] PASS");
