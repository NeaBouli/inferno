/**
 * captcha middleware unit tests.
 * Tests the requireCaptcha middleware with various scenarios.
 *
 * Run: npx tsx src/__tests__/captcha.test.ts
 */

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

async function run() {
  console.log("\n🤖 Captcha Middleware Tests\n");

  // Test 1: no CAPTCHA_SECRET → skip (dev bypass)
  // CAPTCHA_SECRET is not set in test env by default
  {
    const { requireCaptcha } = await import("../middleware/captcha.js");
    const req = { body: {} } as any;
    const res = mockRes();
    let nextCalled = false;
    await requireCaptcha(req, res as any, () => { nextCalled = true; });
    assert(nextCalled, "dev bypass: next() called when CAPTCHA_SECRET is empty");
    assert(res.statusCode === 0, "dev bypass: no status code set");
  }

  // Test 2: no captchaToken in body → still bypassed in dev mode
  {
    const { requireCaptcha } = await import("../middleware/captcha.js");
    const req = { body: { captchaToken: undefined } } as any;
    const res = mockRes();
    let nextCalled = false;
    await requireCaptcha(req, res as any, () => { nextCalled = true; });
    assert(nextCalled, "dev bypass: no token still passes without CAPTCHA_SECRET");
  }

  // Test 3: empty body → still bypassed in dev mode
  {
    const { requireCaptcha } = await import("../middleware/captcha.js");
    const req = { body: undefined } as any;
    const res = mockRes();
    let nextCalled = false;
    await requireCaptcha(req, res as any, () => { nextCalled = true; });
    assert(nextCalled, "dev bypass: undefined body still passes without CAPTCHA_SECRET");
  }

  // Test 4: middleware function exists and is async
  {
    const { requireCaptcha } = await import("../middleware/captcha.js");
    assert(typeof requireCaptcha === "function", "requireCaptcha is a function");
    const result = requireCaptcha({ body: {} } as any, mockRes() as any, () => {});
    assert(result instanceof Promise, "requireCaptcha returns a Promise");
    await result;
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
