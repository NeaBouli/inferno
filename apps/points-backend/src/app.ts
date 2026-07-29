import cors from "cors";
import express from "express";
import { generalRateLimit } from "./middleware/rate-limit.js";
import authRoutes from "./routes/auth.js";
import pointsRoutes from "./routes/points.js";
import voucherRoutes from "./routes/voucher.js";

const app = express();

app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || "http://localhost:3004").split(","),
}));
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
