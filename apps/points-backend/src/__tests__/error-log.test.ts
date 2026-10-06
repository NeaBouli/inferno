/**
 * T-289d: request-path error logs carry only constant categories.
 * Covers the captcha middleware end to end (mocked Turnstile fetch) and the SIWE / captcha
 * category mappers with sentinel-laden errors. The SIWE route itself is covered in
 * points.test.ts, the lock proof middleware in lockProof.test.ts.
 *
 * Run: npx tsx src/__tests__/error-log.test.ts (standalone; sets its own test env)
 */

import { format } from "node:util";

// The captcha secret is read at module import time; set it before the dynamic import.
process.env.NODE_ENV = "test";
process.env.CAPTCHA_SECRET = "captcha-secret-SENTINEL-0000";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}`);
    failed++;
  }
}

interface MockRes {
  statusCode: number;
  body: Record<string, unknown> | null;
  status(code: number): MockRes;
  json(data: Record<string, unknown>): void;
}

function mockRes(): MockRes {
  const res: MockRes = {
    statusCode: 0,
    body: null,
    status(code: number) { res.statusCode = code; return res; },
    json(data: Record<string, unknown>) { res.body = data; },
  };
  return res;
}

const SENTINEL_API_KEY = "sk_live_FAKEKEY0000SENTINEL";
const SENTINEL_URL = "https://apiuser:hunter2sentinel@challenges.example/siteverify";
const SENTINEL_HEX_ADDRESS = "0x" + "c".repeat(40);
const SENTINEL_WALLET = "0x" + "e".repeat(40);
const SENTINEL_FREE_TEXT = "free text sentinel do not log";
const SENTINEL_TOKEN = "turnstile-token-SENTINEL-0000";
const SENTINEL_TEXT =
  `${SENTINEL_FREE_TEXT} key=${SENTINEL_API_KEY} url=${SENTINEL_URL} ` +
  `owner=${SENTINEL_HEX_ADDRESS} wallet=${SENTINEL_WALLET}`;
const SENTINELS = [
  SENTINEL_API_KEY,
  "hunter2sentinel",
  "apiuser",
  SENTINEL_HEX_ADDRESS.slice(2),
  SENTINEL_WALLET.slice(2),
  SENTINEL_FREE_TEXT,
  SENTINEL_TOKEN,
  process.env.CAPTCHA_SECRET as string,
];

function assertNoSentinels(text: string, label: string) {
  const lower = text.toLowerCase();
  const leaked = SENTINELS.filter((s) => lower.includes(s.toLowerCase()));
  assert(leaked.length === 0, `${label}: no sentinel in log`);
}

async function captureConsoleError(fn: () => Promise<void>): Promise<string[]> {
  const logs: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return logs.map((args) => format(...args));
}

async function run() {
  console.log("\n🧾 Error log redaction tests (T-289d)\n");

  const { requireCaptcha } = await import("../middleware/captcha.js");
  const { categorizeCaptchaError, categorizeSiweError } = await import("../services/request-error-log.js");
  const { SiweError, SiweErrorType } = await import("siwe");

  // ---- Captcha middleware, end to end ----
  const originalFetch = globalThis.fetch;
  const cases: Array<{ name: string; fetchImpl: typeof fetch; category: string }> = [
    {
      name: "transport failure",
      fetchImpl: (async () => {
        throw new TypeError("fetch failed", { cause: new Error(SENTINEL_TEXT) });
      }) as typeof fetch,
      category: "captcha_error:network",
    },
    {
      name: "non-JSON response",
      fetchImpl: (async () => ({
        json: async () => { throw new SyntaxError(`Unexpected token < in JSON: <html>${SENTINEL_TEXT}`); },
      })) as unknown as typeof fetch,
      category: "captcha_error:bad_response",
    },
    {
      name: "timeout",
      fetchImpl: (async () => {
        throw new DOMException(SENTINEL_TEXT, "TimeoutError");
      }) as typeof fetch,
      category: "captcha_error:timeout",
    },
    {
      name: "unexpected error",
      fetchImpl: (async () => {
        throw Object.assign(new Error(SENTINEL_TEXT), { secret: process.env.CAPTCHA_SECRET, url: SENTINEL_URL });
      }) as typeof fetch,
      category: "captcha_error:unknown",
    },
  ];
  try {
    for (const c of cases) {
      globalThis.fetch = c.fetchImpl;
      const res = mockRes();
      let nextCalled = false;
      const lines = await captureConsoleError(() =>
        requireCaptcha({ body: { captchaToken: SENTINEL_TOKEN } } as any, res as any, () => { nextCalled = true; }),
      );
      assert(res.statusCode === 503 && !nextCalled, `captcha ${c.name}: fails closed with 503`);
      assert(
        lines.length === 1 && lines[0] === `[CAPTCHA] verify_failed category=${c.category}`,
        `captcha ${c.name}: logs exactly "[CAPTCHA] verify_failed category=${c.category}"`,
      );
      assertNoSentinels(lines.join("\n"), `captcha ${c.name}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  // ---- Captcha mapper ----
  assert(categorizeCaptchaError(SENTINEL_TEXT) === "captcha_error:unknown", "captcha mapper: string -> unknown");
  assert(categorizeCaptchaError(null) === "captcha_error:unknown", "captcha mapper: null -> unknown");
  assert(
    categorizeCaptchaError({ name: "TimeoutError", message: SENTINEL_TEXT }) === "captcha_error:unknown",
    "captcha mapper: non-Error object -> unknown",
  );

  // ---- SIWE mapper ----
  const siweReject = (type: string) => ({
    success: false,
    data: { address: SENTINEL_WALLET, nonce: "abcdefgh12345678" },
    error: new SiweError(type, SENTINEL_TEXT, `0x${"ab".repeat(65)}`),
  });
  const siweCases: Array<[unknown, "parse" | "verify" | "persist", string]> = [
    [new Error(SENTINEL_TEXT), "parse", "siwe_error:parse"],
    [siweReject(SiweErrorType.INVALID_SIGNATURE), "verify", "siwe_error:invalid_signature"],
    [siweReject(SiweErrorType.EXPIRED_MESSAGE), "verify", "siwe_error:expired"],
    [siweReject(SiweErrorType.NOT_YET_VALID_MESSAGE), "verify", "siwe_error:not_yet_valid"],
    [siweReject(SiweErrorType.DOMAIN_MISMATCH), "verify", "siwe_error:context_mismatch"],
    [siweReject(SiweErrorType.INVALID_ADDRESS), "verify", "siwe_error:invalid_message"],
    [siweReject(SENTINEL_TEXT), "verify", "siwe_error:unknown"],
    [new SiweError(SiweErrorType.NONCE_MISMATCH, SENTINEL_TEXT, SENTINEL_WALLET), "verify", "siwe_error:context_mismatch"],
    [Object.assign(new Error(SENTINEL_TEXT), { name: "PrismaClientKnownRequestError" }), "persist", "siwe_error:database"],
    [new Error(SENTINEL_TEXT), "persist", "siwe_error:unknown"],
    [{ type: { toString: () => SENTINEL_TEXT } }, "verify", "siwe_error:unknown"],
    [SENTINEL_TEXT, "verify", "siwe_error:unknown"],
    [undefined, "verify", "siwe_error:unknown"],
  ];
  for (const [err, stage, expected] of siweCases) {
    const got = categorizeSiweError(err, stage);
    assert(got === expected, `siwe mapper: ${stage} -> ${expected}`);
    assertNoSentinels(got, `siwe mapper ${expected}`);
  }

  // ---- Summary ----
  console.log(`\n${"─".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
