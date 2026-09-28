import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  classifyDynamicIntent,
  buildDynamicDataFallback,
  DYNAMIC_DATA_HANDOFF_CODE,
} from "../server/dynamic-intent.js";
import { SYSTEM_PROMPTS } from "../src/context/system-prompts.js";

const ACCEPTANCE_PROMPT =
  "I want to add 0.1 ETH liquidity to the IFR/WETH pool. How much IFR do I need?";

// ── 1) Classifier: every listed current-state intent class is intercepted ──
const interceptCases: Array<[string, string[]]> = [
  ["pair", [
    ACCEPTANCE_PROMPT,
    "How much IFR do I need to add 0.1 ETH of liquidity?",
    "How much IFR for 0.5 ETH?",
    "What is the current IFR price?",
    "What's the IFR/WETH ratio right now?",
    "How deep is the pool today?",
    "Show me the live reserves of the pair",
    "Wie viel IFR brauche ich aktuell für 0.1 ETH Liquidität?",
    "Wie viel IFR brauche ich für 0,1 ETH?",
    "How many IFR tokens per ETH?",
    "What is IFR worth in USD?",
    "0.1 ETH liquidity: IFR amount?",
    // A concrete ETH amount cancels the historical-word suppression.
    "How much IFR for 0.1 ETH in the pool, the one launched in June?",
    // Round-2 review: symmetric ETH-for-IFR / IFR-in-ETH direction.
    "How much ETH do I need for 1M IFR?",
    "How much is 1000 IFR in ETH?",
    "Wie viel ETH brauche ich für 1M IFR?",
    // Round-2 review: market cap and pool TVL are current market state.
    "IFR market cap?",
    "IFR TVL in the pool?",
    "What is the current IFR market cap?",
    // CodeRabbit round 3: procedural wording does not hide a named current
    // quantity or a concrete ETH amount.
    "How do I add liquidity at the current ratio?",
    "How do I check the current pool reserves?",
    "How to provide 0.1 ETH of liquidity today?",
    "How can I see the IFR price right now?",
    "Wie kann ich aktuell 0,1 ETH Liquidität bereitstellen?",
  ]],
  ["balance", [
    "What is my IFR balance?",
    "How much IFR does the treasury hold?",
    "Check the current balance of wallet 0x1234abcdef",
    // Round-2 review: treasury holdings without "balance" wording.
    "How many IFR are in the treasury?",
    "What is the treasury balance?",
  ]],
  ["ifrlock", [
    "Is my IFR still locked?",
    "How much IFR is currently locked in IFRLock?",
    "What is my lock status?",
  ]],
  ["lending", [
    "What lending offers are available right now?",
    "What is the current LendingVault interest rate?",
    "How much can I borrow now?",
  ]],
  ["supply", [
    "What is the total supply of IFR?",
    "How much IFR is in circulation now?",
    "What was the total supply?",
  ]],
  ["burned", [
    "How many IFR have been burned so far?",
    "What is the current burned supply?",
    // Round-2 review: past tense alone must not hide the current total.
    "How many tokens were burned?",
    "How much IFR was burned?",
  ]],
];
for (const [intent, prompts] of interceptCases) {
  for (const prompt of prompts) {
    assert.equal(classifyDynamicIntent(prompt), intent, `intercept: ${prompt}`);
  }
}

// ── 2) Classifier: documentation, historical and conceptual questions pass ──
const allowCases = [
  "What was the bootstrap ratio?",
  "How much ETH was raised in the bootstrap?",
  "How does the fee burn work?",
  "What is impermanent loss?",
  "How do I add liquidity on Uniswap?",
  "What is the interest rate range of the LendingVault?",
  "How much IFR do I need to lock for Premium tier?",
  "What was the genesis supply?",
  "What is the total IFR minted at launch?",
  "Explain the lock mechanism.",
  "How do I create a lending offer?",
  "Has the LendingVault launched?",
  "What is the IFR token contract address?",
  "How does the Copilot Premium tier work?",
  // Narrow pair interception: generic price/ratio/add terms without pool or
  // IFR/ETH current-value context must pass through to documentation.
  "What is the price of Copilot Premium?",
  "What is the Uniswap price impact of a trade?",
  "What is the fee ratio between burn and pool fee?",
  "Can I add LP tokens to the lock?",
  // Round-2 review: conceptual value/price-determination documentation.
  "What value does IFR provide to holders?",
  "What is the value proposition of IFR?",
  "How is the IFR price determined?",
  // Historical burn/supply and governance questions stay on the docs path.
  "How many IFR were burned in the bootstrap?",
  "Who controls the treasury multisig?",
  "How many signers does the treasury multisig have?",
  "What was the IFR price in June?",
  // CodeRabbit round 3: procedural liquidity questions with time wording
  // are documentation questions, not current-state data requests.
  "How do I add liquidity today?",
  "How to provide liquidity currently?",
  "How can I add liquidity right now?",
  "How do I provide liquidity to the IFR/WETH pool now?",
  "Wie füge ich aktuell Liquidität hinzu?",
  "Wie kann ich jetzt Liquidität bereitstellen?",
  "Wie stelle ich derzeit Liquidität bereit?",
];
for (const prompt of allowCases) {
  assert.equal(classifyDynamicIntent(prompt), null, `allow: ${prompt}`);
}
assert.equal(classifyDynamicIntent(""), null);

// ── 3) Fallback text invariants: refusal + typed handoff, labelled history ──
const ALL_INTENTS = ["pair", "balance", "ifrlock", "lending", "supply", "burned"] as const;
const HANDOFF_ROUTES: Record<(typeof ALL_INTENTS)[number], RegExp> = {
  pair: /wiki\/liquidity\.html|uniswap|geckoterminal|getReserves/i,
  balance: /balanceOf|etherscan|web3\.ifrunit\.tech/i,
  ifrlock: /totalLocked|web3\.ifrunit\.tech|transparency/i,
  lending: /getOffer|getInterestRate|\/api\/lending\/stats|web3\.ifrunit\.tech/i,
  supply: /totalSupply|\/api\/ifr\/supply|etherscan/i,
  burned: /totalSupply|\/api\/ifr\/supply|etherscan/i,
};
for (const intent of ALL_INTENTS) {
  const fallback = buildDynamicDataFallback(intent);
  assert.match(fallback, /can't|cannot/i, `${intent}: refusal wording`);
  assert.match(fallback, HANDOFF_ROUTES[intent], `${intent}: typed handoff route`);
  assert.match(fallback, /not financial advice/i, `${intent}: advice disclaimer`);
  assert.doesNotMatch(fallback, /0x[0-9a-fA-F]{40}/, `${intent}: no raw contract address`);
}
// Historical-example wording: the pair fallback labels Bootstrap as history
// and never substitutes a Bootstrap-derived amount for the current ratio.
const pairFallback = buildDynamicDataFallback("pair");
assert.match(pairFallback, /historical record/i);
assert.match(pairFallback, /not the current pool ratio/i);
assert.ok(!pairFallback.includes("333"), "pair fallback must not contain the Bootstrap-derived 0.1 ETH figure");
// Staleness handling is explicit for supply.
assert.match(buildDynamicDataFallback("supply"), /stale/i);
assert.match(buildDynamicDataFallback("supply"), /documented history/i);

// ── 4) Answer policy: every mode carries the dynamic-data policy block ──
for (const mode of ["explorer", "user", "dev", "customer", "partner", "developer"]) {
  assert.match(SYSTEM_PROMPTS[mode], /DYNAMIC DATA — DOCUMENTATION-ONLY MODE/, mode);
  assert.match(SYSTEM_PROMPTS[mode], /explicitly labelled as historical/, mode);
}

// ── 5) Server integration: fail-closed without any provider configuration ──
// No ANTHROPIC_API_KEY: guarded intents still get their typed handoff (200),
// while unguarded questions reach the provider gate (500). This proves the
// safe answer never depends on provider availability, budget or model calls.
const appRoot = new URL("../", import.meta.url);
const port = await new Promise<number>((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    assert.ok(address && typeof address === "object");
    probe.close(() => resolve(address.port));
  });
});
const voteDirectory = await mkdtemp(path.join(os.tmpdir(), "ifr-copilot-guard-"));
const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  cwd: appRoot.pathname,
  env: {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    ANTHROPIC_API_KEY: "",
    RAILWAY_VOLUME_MOUNT_PATH: voteDirectory,
    BOOTSTRAP_VOTES: "",
  },
  stdio: ["ignore", "ignore", "pipe"],
});
let childStderr = "";
child.stderr.on("data", (chunk) => { childStderr += chunk.toString(); });

let requestCounter = 0;
async function postChat(content: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      // Unique source IP per request: the anti-abuse minute cap stays intact
      // and each case is evaluated on its own bucket.
      requestCounter += 1;
      const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": `10.0.0.${requestCounter}`,
        },
        body: JSON.stringify({
          messages: [{ role: "user", content }],
          mode: "explorer",
          surface: "standalone",
        }),
      });
      return { status: response.status, body: await response.json() };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError ?? new Error("Copilot server did not start in time");
}

try {
  // The exact acceptance prompt never reaches the model and never returns a
  // Bootstrap-derived amount as current.
  const acceptance = await postChat(ACCEPTANCE_PROMPT);
  assert.equal(acceptance.status, 200);
  assert.equal(acceptance.body.code, DYNAMIC_DATA_HANDOFF_CODE);
  assert.equal(acceptance.body.intent, "pair");
  assert.equal(acceptance.body.reply, pairFallback);

  // One representative current-state prompt per remaining intent class.
  const serverIntents: Array<[string, string]> = [
    ["What is my IFR balance?", "balance"],
    ["How much IFR is currently locked in IFRLock?", "ifrlock"],
    ["What lending offers are available right now?", "lending"],
    ["What is the total supply of IFR?", "supply"],
    ["What is the current burned supply?", "burned"],
    // Round-2 review probes.
    ["How much ETH do I need for 1M IFR?", "pair"],
    ["How much is 1000 IFR in ETH?", "pair"],
    ["IFR market cap?", "pair"],
    ["IFR TVL in the pool?", "pair"],
    ["How many IFR are in the treasury?", "balance"],
    ["How many tokens were burned?", "burned"],
    ["How do I check the current pool reserves?", "pair"],
  ];
  for (const [prompt, intent] of serverIntents) {
    const result = await postChat(prompt);
    assert.equal(result.status, 200, prompt);
    assert.equal(result.body.code, DYNAMIC_DATA_HANDOFF_CODE, prompt);
    assert.equal(result.body.intent, intent, prompt);
    assert.equal(result.body.reply, buildDynamicDataFallback(intent as (typeof ALL_INTENTS)[number]), prompt);
  }

  // Documentation and historical questions are not intercepted: without a
  // provider key they reach the normal provider gate instead of a fallback.
  const allowedPrompts = [
    "What was the bootstrap ratio?",
    "How does the fee burn work?",
    // Narrowed pair interception: product pricing stays on the docs path.
    "What is the price of Copilot Premium?",
    // Round-2 review: conceptual questions stay on the docs path.
    "What value does IFR provide to holders?",
    "What is the value proposition of IFR?",
    "How is the IFR price determined?",
    "How do I add liquidity today?",
  ];
  for (const prompt of allowedPrompts) {
    const result = await postChat(prompt);
    assert.equal(result.status, 500, prompt);
    assert.equal(result.body.reply, "ANTHROPIC_API_KEY not configured.", prompt);
    assert.equal(result.body.code, undefined, prompt);
  }
} catch (error) {
  if (childStderr) console.error(childStderr);
  throw error;
} finally {
  child.kill("SIGKILL");
  await rm(voteDirectory, { recursive: true, force: true });
}

console.log("[dynamic-intent-test] PASS: all intent classes fail closed; no model calls");
