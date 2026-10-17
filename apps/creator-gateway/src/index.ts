import 'dotenv/config';
import { CONFIG } from './config';
import { app } from './app';
import { verifyRpcChain } from './startup';

async function start(): Promise<void> {
  if (CONFIG.isProduction) await verifyRpcChain(CONFIG.rpcUrl, CONFIG.chainId);
  app.listen(CONFIG.port, '0.0.0.0', () =>
    console.log(`IFR Creator Gateway on :${CONFIG.port}`)
  );
}

start().catch(() => {
  console.error('Creator Gateway startup failed (RPC_URL chain check); refusing to listen');
  process.exitCode = 1;
});
