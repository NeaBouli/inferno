// Trusted client IP, rate limits, single-flight cache and upstream concurrency (T-216).
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  Semaphore,
  SingleFlightCache,
  SlidingWindowLimiter,
  TRUSTED_PROXY_HOPS,
  clientIp,
  ipRateLimit,
  positiveIntEnv,
  rateLimitKey,
} from "../server/request-guard.ts";

// ── Sliding window limiter ──
{
  const limiter = new SlidingWindowLimiter([{ windowMs: 1_000, max: 2 }, { windowMs: 10_000, max: 3 }]);
  assert.equal(limiter.check("a", 0), true);
  assert.equal(limiter.check("a", 1), true);
  assert.equal(limiter.check("a", 2), false, "short window full");
  assert.equal(limiter.check("a", 1_500), true, "short window slid");
  assert.equal(limiter.check("a", 3_000), false, "long window full");
  assert.equal(limiter.check("b", 3_000), true, "keys are independent");
  const bounded = new SlidingWindowLimiter([{ windowMs: 60_000, max: 1 }], 3);
  for (let i = 0; i < 10; i++) bounded.check(`k${i}`, 0);
  assert.ok(bounded.size <= 3, "tracked keys are bounded");
}

// ── Single-flight cache with stale fallback ──
{
  let now = 0;
  let calls = 0;
  const cache = new SingleFlightCache<number>(100, 1_000, 2);
  let release!: (v: number) => void;
  const load = () => {
    calls++;
    return new Promise<number>((resolve) => (release = resolve));
  };
  const p1 = cache.get("x", load, () => now);
  const p2 = cache.get("x", load, () => now);
  release(42);
  assert.deepEqual(await p1, { data: 42, stale: false });
  assert.deepEqual(await p2, { data: 42, stale: false });
  assert.equal(calls, 1, "concurrent misses share one upstream call");
  assert.deepEqual(await cache.get("x", async () => { calls++; return 0; }, () => now), { data: 42, stale: false });
  assert.equal(calls, 1, "fresh entry served from cache");
  now = 500;
  const stale = await cache.get("x", async () => { throw new Error("upstream down"); }, () => now);
  assert.deepEqual(stale, { data: 42, stale: true }, "stale copy served when upstream fails");
  now = 5_000;
  await assert.rejects(cache.get("x", async () => { throw new Error("upstream down"); }, () => now), /upstream down/,
    "too-old copy is not served");
  for (const k of ["a", "b", "c"]) await cache.get(k, async () => 1, () => now);
  assert.ok(cache.size <= 2, "entries are bounded");
}

// ── Semaphore never exceeds its limit ──
{
  const sem = new Semaphore(2);
  let peak = 0;
  const task = () => sem.run(async () => {
    peak = Math.max(peak, sem.inUse);
    await new Promise((r) => setTimeout(r, 5));
  });
  await Promise.all(Array.from({ length: 10 }, task));
  assert.equal(peak, 2, "at most two concurrent upstream calls");
  assert.equal(sem.inUse, 0);
}

// ── positiveIntEnv ──
assert.equal(positiveIntEnv("X", 7, {}), 7);
assert.equal(positiveIntEnv("X", 7, { X: "12" }), 12);
assert.throws(() => positiveIntEnv("X", 7, { X: "0" }), /positive integer/);
assert.throws(() => positiveIntEnv("X", 7, { X: "1e3" }), /positive integer/);

// ── Express: spoofed left-most X-Forwarded-For entries cannot rotate the client key ──
{
  const app = express();
  app.set("trust proxy", TRUSTED_PROXY_HOPS);
  app.get("/limited", ipRateLimit(new SlidingWindowLimiter([{ windowMs: 60_000, max: 3 }]), "slow down"),
    (req, res) => res.json({ ip: clientIp(req) }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // The reverse proxy appends the real client (203.0.113.7); the client controls only the entries before it.
  const hit = (spoof: string, real = "203.0.113.7") =>
    fetch(`${base}/limited`, { headers: { "X-Forwarded-For": `${spoof}, ${real}` } });
  const first = await hit("1.1.1.1");
  assert.equal(first.status, 200);
  assert.equal((await first.json() as { ip: string }).ip, "203.0.113.7", "req.ip is the proxy-appended hop");
  assert.equal((await hit("2.2.2.2")).status, 200);
  assert.equal((await hit("3.3.3.3")).status, 200);
  assert.equal((await hit("4.4.4.4")).status, 429, "rotating the spoofed entry does not reset the limit");
  assert.equal((await hit("5.5.5.5", "198.51.100.9")).status, 200, "a different real client has its own budget");
  server.close();
}

// ── Rate-limit keys: IPv4 single address, IPv4-mapped == IPv4, IPv6 /64 (T-259) ──
{
  assert.equal(rateLimitKey("203.0.113.7"), "203.0.113.7");
  assert.equal(rateLimitKey("::ffff:203.0.113.7"), "203.0.113.7", "IPv4-mapped equals IPv4");
  assert.equal(rateLimitKey("::FFFF:cb00:7107"), "203.0.113.7", "hex IPv4-mapped equals IPv4");
  assert.equal(rateLimitKey("0:0:0:0:0:ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(rateLimitKey("2001:db8:abcd:ef01::1"), "2001:db8:abcd:ef01::/64");
  assert.equal(rateLimitKey("2001:0DB8:abcd:ef01:ffff:1:2:3"), "2001:db8:abcd:ef01::/64", "same /64 shares a key");
  assert.equal(rateLimitKey("2001:db8:abcd:ef01::5%eth0"), "2001:db8:abcd:ef01::/64", "zone id ignored");
  assert.notEqual(rateLimitKey("2001:db8:abcd:ef02::1"), rateLimitKey("2001:db8:abcd:ef01::1"), "different /64");
  assert.equal(rateLimitKey("2001:db8::"), "2001:db8:0:0::/64");
  assert.equal(rateLimitKey("::1"), "0:0:0:0::/64");
  assert.equal(rateLimitKey("unknown"), "unknown", "non-IP passes through");
}

// ── Sliding window limiter reports which window is full ──
{
  const limiter = new SlidingWindowLimiter([{ windowMs: 1_000, max: 1 }, { windowMs: 10_000, max: 2 }]);
  assert.equal(limiter.hit("a", 0), -1);
  assert.equal(limiter.hit("a", 1), 0, "short window full");
  assert.equal(limiter.hit("a", 1_500), -1);
  assert.equal(limiter.hit("a", 3_000), 1, "long window full");
}

// ── Map bound evicts oldest keys first ──
{
  const bounded = new SlidingWindowLimiter([{ windowMs: 60_000, max: 1 }], 2);
  bounded.check("old", 0);
  bounded.check("mid", 1);
  bounded.check("new", 2);
  assert.equal(bounded.size, 2);
  assert.equal(bounded.check("old", 3), true, "oldest key was evicted (fresh budget)");
  assert.equal(bounded.check("new", 4), false, "newest key survived eviction");
}

// ── Express: rotating IPv6 addresses inside one /64 share one bucket ──
{
  const app = express();
  app.set("trust proxy", TRUSTED_PROXY_HOPS);
  app.get("/limited", ipRateLimit(new SlidingWindowLimiter([{ windowMs: 60_000, max: 3 }]), "slow down"),
    (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const hit = async (client: string) =>
    (await fetch(`${base}/limited`, { headers: { "X-Forwarded-For": client } })).status;
  const rotated: number[] = [];
  for (let i = 1; i <= 12; i++) rotated.push(await hit(`2001:db8:abcd:ef01::${i.toString(16)}`));
  assert.deepEqual(rotated.slice(0, 3), [200, 200, 200]);
  assert.ok(rotated.slice(3).every((s) => s === 429), "rotation within one /64 is capped");
  assert.equal(await hit("2001:db8:abcd:ef02::1"), 200, "a different /64 has its own budget");
  for (let i = 0; i < 3; i++) await hit("198.51.100.20");
  assert.equal(await hit("::ffff:198.51.100.20"), 429, "IPv4-mapped shares the IPv4 bucket");
  server.close();
}

console.log("[request-guard] PASS - trusted client IP, limits, single-flight cache, upstream concurrency");
