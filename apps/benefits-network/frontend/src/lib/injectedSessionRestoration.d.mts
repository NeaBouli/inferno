import type { Config } from 'wagmi';
import type { reconnect, watchConnectors } from 'wagmi/actions';

export function cancelInjectedSessionRestoration(config: Config): void;
export function startInjectedSessionRestoration(config: Config, adapters: {
  reconnect: typeof reconnect;
  watchConnectors: typeof watchConnectors;
  browser: Window;
}): () => void;
