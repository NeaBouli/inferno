/**
 * CWA-12: Aggregate daily Copilot cost budget (fail-closed).
 *
 * - Integer micro-USD accounting only (1 USD = 1_000_000 micro-USD). No floats.
 * - UTC day boundary: spend resets at 00:00:00 UTC, never on server-local time.
 * - Concurrency-safe: a conservative maximum request cost is reserved
 *   synchronously BEFORE the upstream Anthropic call, so concurrent requests
 *   cannot all pass the same remaining-budget check. The reservation is
 *   settled against actual token usage after success. Once dispatch starts,
 *   ambiguous failures are settled at the full reservation by the caller.
 * - Invalid COPILOT_DAILY_BUDGET_USD configuration is rejected (throw) instead
 *   of silently disabling the budget.
 *
 * Pricing constants (claude-haiku-4-5): $1 / 1M input tokens, $5 / 1M output
 * tokens — i.e. exactly 1 micro-USD per input token and 5 micro-USD per
 * output token.
 */

export const MICRO_USD_PER_USD = 1_000_000;

/** Preserve the previous 1 USD warning threshold as a hard daily cutoff. */
export const DEFAULT_DAILY_BUDGET_MICRO_USD = 1 * MICRO_USD_PER_USD;

/** Sanity ceiling: anything above 1000 USD/day is treated as misconfiguration. */
export const MAX_DAILY_BUDGET_MICRO_USD = 1_000 * MICRO_USD_PER_USD;

/** micro-USD charged per token (Haiku 4.5 list prices). */
export const MICRO_USD_PER_INPUT_TOKEN = 1;
export const MICRO_USD_PER_OUTPUT_TOKEN = 5;

/** max_tokens sent to the Anthropic API for chat completions. */
export const CHAT_MAX_OUTPUT_TOKENS = 500;

function utcDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Parse COPILOT_DAILY_BUDGET_USD into integer micro-USD.
 * Accepts dollars with an optional 1-2 decimal fraction ("5", "2.5", "0.75").
 * Throws on any invalid value — the budget is never silently disabled.
 */
export function parseDailyBudgetMicroUsd(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_DAILY_BUDGET_MICRO_USD;
  const trimmed = raw.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) {
    throw new Error(
      `Invalid COPILOT_DAILY_BUDGET_USD: ${JSON.stringify(raw)} — expected a positive dollar amount with at most 2 decimals (e.g. "5" or "2.50").`
    );
  }
  const dollars = parseInt(match[1], 10);
  const cents = match[2] ? parseInt(match[2].padEnd(2, "0"), 10) : 0;
  const microUsd = dollars * MICRO_USD_PER_USD + cents * (MICRO_USD_PER_USD / 100);
  if (!Number.isSafeInteger(microUsd) || microUsd <= 0 || microUsd > MAX_DAILY_BUDGET_MICRO_USD) {
    throw new Error(
      `Invalid COPILOT_DAILY_BUDGET_USD: ${JSON.stringify(raw)} — must be > 0 and <= ${MAX_DAILY_BUDGET_MICRO_USD / MICRO_USD_PER_USD} USD.`
    );
  }
  return microUsd;
}

/**
 * Conservative maximum reservation for one chat request, in micro-USD.
 * The serialized UTF-8 request body is an upper bound for BPE input tokens:
 * every input token represents at least one byte. Output is bounded by the
 * max_tokens value sent with the same request.
 */
export function estimateReservationMicroUsd(
  requestBodyUtf8Bytes: number,
  maxOutputTokens: number = CHAT_MAX_OUTPUT_TOKENS
): number {
  if (!Number.isSafeInteger(requestBodyUtf8Bytes) || requestBodyUtf8Bytes < 0) {
    throw new RangeError("Request body byte count must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 0) {
    throw new RangeError("Maximum output token count must be a non-negative safe integer");
  }
  return (
    requestBodyUtf8Bytes * MICRO_USD_PER_INPUT_TOKEN +
    maxOutputTokens * MICRO_USD_PER_OUTPUT_TOKEN
  );
}

/** Actual cost of a completed call, in integer micro-USD. */
export function actualCostMicroUsd(inputTokens: number, outputTokens: number): number {
  if (
    !Number.isSafeInteger(inputTokens) || inputTokens < 0 ||
    !Number.isSafeInteger(outputTokens) || outputTokens < 0
  ) {
    throw new RangeError("Token counts must be non-negative safe integers");
  }
  return (
    inputTokens * MICRO_USD_PER_INPUT_TOKEN +
    outputTokens * MICRO_USD_PER_OUTPUT_TOKEN
  );
}

export interface BudgetReservation {
  readonly id: number;
  readonly amountMicroUsd: number;
  /** False once the reservation has been settled or released exactly once. */
  open: boolean;
}

export interface BudgetSnapshot {
  readonly dayUtc: string;
  readonly budgetMicroUsd: number;
  readonly spentMicroUsd: number;
  readonly reservedMicroUsd: number;
}

export class DailyBudget {
  private readonly budgetMicroUsd: number;
  private readonly now: () => number;
  private dayUtc: string;
  private spentMicroUsd = 0;
  private reservedMicroUsd = 0;
  private nextReservationId = 1;

  constructor(dailyBudgetMicroUsd: number, now: () => number = Date.now) {
    if (!Number.isSafeInteger(dailyBudgetMicroUsd) || dailyBudgetMicroUsd <= 0) {
      throw new RangeError("Daily budget must be a positive safe integer (micro-USD)");
    }
    this.budgetMicroUsd = dailyBudgetMicroUsd;
    this.now = now;
    this.dayUtc = utcDayKey(this.now());
  }

  /** Reset spend at the UTC day boundary. Outstanding reservations carry over. */
  private rollDay(): void {
    const today = utcDayKey(this.now());
    if (today !== this.dayUtc) {
      this.dayUtc = today;
      this.spentMicroUsd = 0;
    }
  }

  /**
   * Synchronously reserve amountMicroUsd before any await point.
   * Returns null when the reservation would exceed the daily budget — in that
   * case the caller MUST NOT call the upstream model.
   * Invariant kept at all times: spent + reserved <= budget.
   */
  tryReserve(amountMicroUsd: number): BudgetReservation | null {
    if (!Number.isSafeInteger(amountMicroUsd) || amountMicroUsd <= 0) {
      throw new RangeError("Reservation amount must be a positive safe integer (micro-USD)");
    }
    this.rollDay();
    if (this.spentMicroUsd + this.reservedMicroUsd + amountMicroUsd > this.budgetMicroUsd) {
      return null;
    }
    this.reservedMicroUsd += amountMicroUsd;
    return { id: this.nextReservationId++, amountMicroUsd, open: true };
  }

  /**
   * Settle after upstream success: drop the reservation and charge the actual
   * cost. When actualMicroUsd is missing/invalid (upstream gave no usage),
   * the full reservation is charged — fail-safe, never under-count.
   */
  settle(reservation: BudgetReservation, actualMicroUsd?: number): void {
    if (!reservation.open) return;
    reservation.open = false;
    this.rollDay();
    this.reservedMicroUsd -= reservation.amountMicroUsd;
    const charge =
      actualMicroUsd !== undefined &&
      Number.isSafeInteger(actualMicroUsd) &&
      actualMicroUsd >= 0
        ? actualMicroUsd
        : reservation.amountMicroUsd;
    this.spentMicroUsd += charge;
  }

  /** Release only when the caller proves the request was not dispatched. */
  release(reservation: BudgetReservation): void {
    if (!reservation.open) return;
    reservation.open = false;
    this.reservedMicroUsd -= reservation.amountMicroUsd;
  }

  /** Seconds until the next UTC midnight — the public retry boundary. */
  retryAfterSeconds(): number {
    const nowMs = this.now();
    const nextMidnightMs = Date.parse(`${utcDayKey(nowMs)}T00:00:00.000Z`) + 86_400_000;
    return Math.max(1, Math.ceil((nextMidnightMs - nowMs) / 1000));
  }

  /** Server-side observability only — never expose to clients. */
  snapshot(): BudgetSnapshot {
    this.rollDay();
    return {
      dayUtc: this.dayUtc,
      budgetMicroUsd: this.budgetMicroUsd,
      spentMicroUsd: this.spentMicroUsd,
      reservedMicroUsd: this.reservedMicroUsd,
    };
  }
}
