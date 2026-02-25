import "dotenv/config";
import express from "express";
import cors from "cors";
import { generalRateLimit } from "./middleware/rate-limit";
import authRoutes from "./routes/auth";
import pointsRoutes from "./routes/points";
import voucherRoutes from "./routes/voucher";

const app = express();
const PORT = parseInt(process.env.PORT || "3004", 10);

app.use(cors());
app.use(express.json());
app.use(generalRateLimit);

// Routes
app.use("/auth", authRoutes);
app.use("/points", pointsRoutes);
app.use("/voucher", voucherRoutes);

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`Points Backend on :${PORT}`);
});

export default app;
