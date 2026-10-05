import cors from "cors";
import express from "express";
import { TRUSTED_PROXY_HOPS, generalRateLimit } from "./middleware/rate-limit.js";
import authRoutes from "./routes/auth.js";
import pointsRoutes from "./routes/points.js";
import voucherRoutes from "./routes/voucher.js";

const app = express();
app.set("trust proxy", TRUSTED_PROXY_HOPS);

/**
 * CORS allowlist. ALLOWED_ORIGINS wins when set. Without it, production fails closed (no
 * cross-origin access at all) and only non-production gets the local development origin (T-212b-10).
 */
export function resolveAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = (env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
  if (configured.length > 0) return configured;
  if (env.NODE_ENV === "production") {
    console.warn("[cors] ALLOWED_ORIGINS is not set in production; cross-origin requests are refused");
    return [];
  }
  return ["http://localhost:3004"];
}

app.use(cors({ origin: resolveAllowedOrigins() }));
app.use(express.json({ limit: "10kb" }));
app.use(generalRateLimit);

app.use("/auth", authRoutes);
app.use("/points", pointsRoutes);
app.use("/voucher", voucherRoutes);

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

export default app;
