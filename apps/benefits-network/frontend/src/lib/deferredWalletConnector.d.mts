import type { CreateConnectorFn } from 'wagmi';

export declare const RECENT_CONNECTOR_STORAGE_KEY: 'recentConnectorId';
export declare const SDK_SESSION_STORAGE_KEY: 'deferredSdkConnectorId';

export declare function deferUntilChosen<T extends CreateConnectorFn>(
  connectorFn: T,
  options?: { preGetProvider?: () => void },
): T;
