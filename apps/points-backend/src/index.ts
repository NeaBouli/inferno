import "dotenv/config";
import app from "./app.js";
import { pointsSecurityConfig, verifyLockProofRuntime } from "./config/security.js";

const PORT = parseInt(process.env.PORT || "3004", 10);

async function start(): Promise<void> {
  await verifyLockProofRuntime();
  console.log(
    `[security] lock proof pinned to chain ${pointsSecurityConfig.chainId} at ${pointsSecurityConfig.ifrLockAddress}`,
  );

  app.listen(PORT, () => {
    console.log(`Points Backend on :${PORT}`);
  });
}

void start().catch((error: unknown) => {
  console.error("Points Backend startup failed:", error);
  process.exitCode = 1;
});
