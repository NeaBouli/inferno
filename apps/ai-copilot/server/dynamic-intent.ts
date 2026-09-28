// Fail-closed guard for current-state (dynamic) financial questions.
//
// The Copilot chat is documentation-only: it has no live chain read, no
// wallet context and no tool access. For dynamic intents the only safe
// outcomes are a validated live read (not available in chat) or a clear
// refusal plus a question-specific verified handoff. This module classifies
// the last user message deterministically and provides the typed fallback
// text, so the safe outcome never depends on model compliance.

export type DynamicDataIntent =
  | "pair"
  | "balance"
  | "ifrlock"
  | "lending"
  | "supply"
  | "burned";

export const DYNAMIC_DATA_HANDOFF_CODE = "dynamic_data_handoff";

// Explicit "as of now" markers cancel a historical/documentation suppression
// (e.g. "How much was burned so far?" is still a current-total question).
const EXPLICIT_CURRENT =
  /\b(current|currently|now|today|live|latest|right now|so far|to date|up to date|aktuell|aktuelle|jetzt|derzeit)\b/i;

// A concrete ETH amount marks a calculation request and cancels suppression
// too: "...0.1 ETH in the pool, the one launched in June?" is current-state
// even with a historical word in it.
const ETH_AMOUNT = /\b\d+(?:[.,]\d+)?\s*w?eth\b/i;

const HISTORICAL =
  /\b(bootstrap|genesis|initial|originally|original|historical|history|example|illustrat|launch|launched|deploy|deployed|finalis|finaliz|raised|past|ago)\b/i;

// Past-tense verbs alone are weak history markers: they suppress most rules,
// but not the burned/supply totals ("How many tokens were burned?" asks for
// the current cumulative figure).
const PAST_TENSE = /\b(was|were|did)\b/i;

const DOCUMENTATION =
  /\b(how does|how do|how to|what is impermanent|what are the risks|explain|mechanism|concept|guide|tutorial|why|range|difference between|price impact|fee ratio|value proposition|what value (?:does|do|can|will)|determined?|determines)\b/i;

// Procedural "how do I / how to" questions stay documentation even with
// time wording ("How do I add liquidity today?"): the time word describes
// when the user acts, not a current value. A named quantity or a concrete
// ETH amount keeps the question on the fail-closed path.
const PROCEDURAL =
  /\b(how (?:do|can|should|would) (?:i|we|you|one)|how to|wie (?:kann|muss|soll|füge|stelle) ich)\b/i;

const CURRENT_QUANTITY =
  /\b(reserves?|ratio|amount|depth|tvl|price|spot|quote|worth|value|market ?cap|mcap|fdv|how much|how many|wie viele?|kurs|preis|wert|menge|betrag|balance|guthaben|supply|burn(?:ed|t)?|locked|rate|apr|apy)\b/i;

interface IntentRule {
  intent: DynamicDataIntent;
  topic: RegExp;
  value: RegExp;
  // Cumulative totals stay current even in past tense.
  ignoresPastTense?: boolean;
}

const RULES: IntentRule[] = [
  {
    // ETH-denominated IFR amount questions are pool-ratio questions even
    // without explicit pool wording ("How much IFR for 0.5 ETH?",
    // "How many IFR tokens per ETH?", "Wie viel IFR für 0,1 ETH?").
    intent: "pair",
    topic: /\b(how much|how many|wie viele?)\s+ifr\b/i,
    value: /\b(eth|weth)\b/i,
  },
  {
    // Symmetric direction: ETH needed for, or IFR expressed in, ETH
    // ("How much ETH do I need for 1M IFR?", "How much is 1000 IFR in ETH?").
    intent: "pair",
    topic: /\b(how much|how many|wie viele?)\s+w?eth\b|\bifr\s+(in|to|into)\s+w?eth\b/i,
    value: /\bifr\b/i,
  },
  {
    // Pool price/ratio/reserves/depth and liquidity-amount calculations.
    // The topic must name the pool or the IFR/ETH pair itself — a generic
    // "price", "ratio" or "add" alone must not intercept product pricing
    // or LP-lock documentation questions.
    intent: "pair",
    topic:
      /\b(liquidity|liquidit[äa]t|pools?|pairs?|uniswap|reserves?|depth|geckoterminal)\b|ifr\s*\/\s*w?eth|\bw?eth\s*\/\s*ifr/i,
    value:
      /\b(price|ratio|reserves?|depth|spot|quote|worth|value|tvl|market ?cap|mcap|fdv|how much|how many|do i need|will i need|would i need|should i|calculate|estimate|deposit|add|provide|amount|current|now|today|live|latest|kurs|preis|wie viele?|menge|betrag)\b|\b\d+(?:[.,]\d+)?\s*w?eth\b/i,
  },
  {
    // IFR price/worth/market-value phrasings without pool wording ("IFR
    // price?", "What is IFR worth in USD?", "IFR market cap?", "IFR Kurs?").
    // Product prices never match: the topic requires the IFR token itself.
    intent: "pair",
    topic: /\bifr\b/i,
    value: /\b(price|worth|value|tvl|market ?cap|mcap|fdv|kurs|preis|wert)\b/i,
  },
  {
    // LendingVault live offers, loans, utilization and current rates.
    intent: "lending",
    topic: /\b(lending|lender|borrow|loan|offer|lendingvault)\b/i,
    value:
      /\b(current|currently|now|today|live|available|active|utilization|apr|apy|rate|stats|how much|how many)\b/i,
  },
  {
    // IFRLock live state: own status or protocol totals (tier thresholds are
    // static documentation and intentionally not matched here).
    intent: "ifrlock",
    topic: /\b(ifrlock|locked|lock|unlock|locktype)\b/i,
    value: /\b(current|currently|now|status|state|total|still|active|right now)\b/i,
  },
  {
    // Current wallet or protocol-address balances.
    intent: "balance",
    topic: /\b(balance|balanceof|holdings?|holds?|own)\b/i,
    value:
      /\b(my|current|currently|now|live|how much|how many|treasury|vault|reserve|safe|wallet|guthaben|0x[0-9a-f]{4,})\b/i,
  },
  {
    // Current treasury holdings, also without "balance" wording ("How many
    // IFR are in the treasury?"). Governance questions about the treasury
    // (signers, address, control) name no amount and pass.
    intent: "balance",
    topic: /\b(treasury|multisig)\b/i,
    value:
      /\b(how much|how many)\s+(ifr|w?eth|usd|tokens?|funds?)\b|\b(balance|holdings?|holds?|funds?|worth|value)\b/i,
  },
  {
    // Current burned total (checked before supply: "burned supply" belongs
    // to the burn handoff).
    intent: "burned",
    topic: /\b(burn|burned|burnt|burning|dead address|verbrannt)\b/i,
    value:
      /\b(current|currently|now|today|total|so far|how much|how many|supply|latest)\b/i,
    ignoresPastTense: true,
  },
  {
    // Current total / circulating supply (genesis mint is static history).
    intent: "supply",
    topic: /\b(supply|circulating|circulation|minted|mint)\b/i,
    value:
      /\b(current|currently|now|today|live|total|circulating|how much|how many|latest)\b/i,
    ignoresPastTense: true,
  },
];

/**
 * Classify a user message as a current-state (dynamic) financial intent.
 * Returns null for documentation, historical or conceptual questions.
 */
export function classifyDynamicIntent(message: string): DynamicDataIntent | null {
  if (!message || typeof message !== "string") return null;
  if (
    PROCEDURAL.test(message) &&
    !CURRENT_QUANTITY.test(message) &&
    !ETH_AMOUNT.test(message)
  ) {
    return null;
  }

  const current = EXPLICIT_CURRENT.test(message) || ETH_AMOUNT.test(message);
  if (!current && (HISTORICAL.test(message) || DOCUMENTATION.test(message))) {
    return null;
  }
  const pastTense = !current && PAST_TENSE.test(message);

  for (const rule of RULES) {
    if (pastTense && !rule.ignoresPastTense) continue;
    if (rule.topic.test(message) && rule.value.test(message)) {
      return rule.intent;
    }
  }
  return null;
}

const FALLBACKS: Record<DynamicDataIntent, string> = {
  pair: `I can't calculate that from documentation — the IFR/WETH ratio, IFR price, pool TVL and market cap move with every trade and this chat has no live pool read.
For the exact IFR amount matching your ETH, use the read-only ratio calculator at ifrunit.tech/wiki/liquidity.html (fresh same-block reserves; quotes expire after 3 minutes), the official Uniswap V2 add-liquidity interface (app.uniswap.org), or the GeckoTerminal IFR/WETH pool page. Developers can verify via getReserves on the pair contract (listed at ifrunit.tech/wiki/contracts.html).
Note: the Bootstrap pairing (100M IFR + 0.030 ETH, June 2026) is a historical record — not the current pool ratio.
This is not financial advice.`,
  balance: `I can't state current balances — this chat has no live chain read and no wallet context.
To check a current IFR balance, read balanceOf on the IFR token contract via Etherscan (contract list: ifrunit.tech/wiki/contracts.html), or connect the wallet at web3.ifrunit.tech. IFR uses 9 decimals.
This is not financial advice.`,
  ifrlock: `I can't see current lock state from documentation — no live or wallet context reaches this chat.
For your own lock status, connect at web3.ifrunit.tech. For protocol totals, read totalLocked on the IFRLock contract via Etherscan (ifrunit.tech/wiki/contracts.html) or see ifrunit.tech/wiki/transparency.html.
This is not financial advice.`,
  lending: `Current LendingVault offers, loans and rates are live data that documentation cannot provide.
Check the live market at web3.ifrunit.tech (Lending section), read the contract state (getOfferCount / getOffer / getInterestRate) via Etherscan (ifrunit.tech/wiki/contracts.html), or use the read-only endpoints copilot-api.ifrunit.tech/api/lending/stats and /api/lending/offers.
This is not financial advice.`,
  supply: `I can't quote the current supply from documentation — every transfer burns IFR, so any static number would be stale.
Read totalSupply on the IFR token contract via Etherscan (ifrunit.tech/wiki/contracts.html), or the timestamped read-only endpoint copilot-api.ifrunit.tech/api/ifr/supply. The genesis mint (1,000,000,000 IFR) is documented history, not the current figure.
This is not financial advice.`,
  burned: `I can't quote the current burned total from documentation — it is live chain state and changes with every transfer.
Read totalSupply and the burn-address balance of the IFR token via Etherscan (ifrunit.tech/wiki/contracts.html), or the timestamped read-only endpoint copilot-api.ifrunit.tech/api/ifr/supply (burned = genesis mint minus live totalSupply).
This is not financial advice.`,
};

/**
 * Typed documentation-only fallback for a classified dynamic intent:
 * refusal to calculate plus the question-specific verified handoff.
 */
export function buildDynamicDataFallback(intent: DynamicDataIntent): string {
  return FALLBACKS[intent];
}
