/**
 * V2 deployment entry point. Defaults to manifest-only dry-run.
 * See docs/V2_ACTIVATION_RUNBOOK.md for explicit constructor inputs and activation gates.
 */
const { connectHardhat } = require("./lib/hardhat-runtime");
const { runV2Deployment } = require("./lib/v2-deployment");

(async () => {
  const runtime = await connectHardhat();
  try {
    await runV2Deployment(runtime);
  } finally {
    await runtime.connection.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
