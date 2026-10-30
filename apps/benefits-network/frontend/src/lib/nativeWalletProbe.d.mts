export type ProbeMethod = 'eth_accounts' | 'eth_chainId' | 'wallet_getPermissions' |
  'wallet_requestPermissions' | 'eth_requestAccounts';
export type ProbeState = 'provider_waiting' | 'provider_waiting_long' | 'request_waiting' |
  'request_waiting_long' | 'provider_unavailable' | 'not_sent' | 'ordinary_busy' | 'answered' | 'error';
export type ProbeShape = 'array' | 'string' | 'object' | 'null' | 'number' | 'boolean' |
  'undefined' | 'unreadable';
export type NativeProbeConnector = {
  id: string;
  type?: string;
  uid?: string;
  getProvider?: () => Promise<unknown>;
};
export type ProbeRecord = Readonly<{
  method: ProbeMethod;
  state: ProbeState;
  startedMs: number;
  elapsedMs: number;
  shape: ProbeShape | null;
  count: number | null;
  errorCode: number | null;
}>;
export type ProbeSnapshot = Readonly<{
  pending: boolean;
  current: ProbeRecord | null;
  records: readonly ProbeRecord[];
}>;
export type NativeWalletProbeController = Readonly<{
  getSnapshot(): ProbeSnapshot;
  subscribe(listener: () => void): () => void;
  start(input: {
    method: ProbeMethod;
    connector: NativeProbeConnector;
    isCurrent(): boolean;
    isOrdinaryPending(): boolean;
  }): Promise<void>;
}>;
export const PROBE_METHODS: readonly Readonly<{ method: ProbeMethod; label: string; interactive: boolean }>[];
export function isEligibleNativeConnector(
  connector: NativeProbeConnector | undefined,
  liveRegistry?: readonly NativeProbeConnector[],
): boolean;
export function isOrdinaryWalletBusy(
  queryClient: { isMutating(filter: { mutationKey: string[]; exact: boolean }): number },
  config: { state: { status: string } },
): boolean;
export function createNativeWalletProbe(options?: {
  now?: () => number;
  schedule?: (callback: () => void, milliseconds: number) => unknown;
  cancelScheduled?: (handle: unknown) => void;
}): NativeWalletProbeController;
export const nativeWalletProbe: NativeWalletProbeController;
