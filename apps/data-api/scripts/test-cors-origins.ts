// T-212b-10: production must never fall back to localhost origins.
import assert from "node:assert/strict";
import { resolveAllowedOrigins } from "../server/cors-origins.js";

const prod = resolveAllowedOrigins({ NODE_ENV: "production" });
assert.ok(prod.length > 0, "production keeps the public origins");
assert.ok(prod.every((o) => o.startsWith("https://")), "production defaults are HTTPS only");
assert.ok(!prod.some((o) => o.includes("localhost")), "no localhost in production defaults");
assert.ok(resolveAllowedOrigins({ NODE_ENV: "development" }).some((o) => o.includes("localhost")), "development keeps local origins");
assert.deepEqual(resolveAllowedOrigins({ NODE_ENV: "production", ALLOWED_ORIGINS: " https://a.example , https://b.example " }), ["https://a.example", "https://b.example"]);
assert.ok(!resolveAllowedOrigins({ NODE_ENV: "production", ALLOWED_ORIGINS: " , " }).some((o) => o.includes("localhost")), "blank ALLOWED_ORIGINS falls back to production defaults");
console.log("[cors-origins] PASS");
