import { coinbaseWallet } from 'wagmi/connectors/coinbaseWallet';
import { injected } from 'wagmi/connectors/injected';
import { walletConnect } from 'wagmi/connectors/walletConnect';
import { deferUntilChosen } from '../src/lib/deferredWalletConnector.mjs';
import { installWalletConnectTelemetryGuard } from '../src/lib/wallet-telemetry-guard.mjs';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

// Typecheck only: never constructs a provider or evaluates an SDK.
export function connectorInference(
  wc: ReturnType<typeof walletConnect>,
  cb: ReturnType<typeof coinbaseWallet>,
  browser: ReturnType<typeof injected>,
) {
  const guarded = deferUntilChosen(wc, { preGetProvider: installWalletConnectTelemetryGuard });
  const plain = deferUntilChosen(cb);
  const deferredBrowser = deferUntilChosen(browser);
  const checks: [
    Expect<Equal<typeof guarded, typeof wc>>,
    Expect<Equal<typeof plain, typeof cb>>,
    Expect<Equal<typeof deferredBrowser, typeof browser>>,
  ] = [true, true, true];
  return checks;
}
