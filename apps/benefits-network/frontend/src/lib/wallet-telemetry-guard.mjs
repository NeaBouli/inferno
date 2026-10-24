// Narrow boundary for the app-owned SDK's known optional telemetry sinks.
// This is not a general network/privacy sandbox (other realms and sinks differ).
// Both lazy loaders use this same module URL; its state lasts for the document.
let installed = null;
let failed = false;

export function installWalletConnectTelemetryGuard() {
  const scope = globalThis;
  const navigator = scope.navigator;
  if (failed) throw new Error("WalletConnect telemetry guard unavailable");
  if (installed) {
    if (scope.fetch !== installed.fetch || navigator !== installed.navigator ||
        navigator.sendBeacon !== installed.sendBeacon) {
      throw new Error("WalletConnect telemetry guard replaced");
    }
    return;
  }

  // Any incomplete installation fails this document's WalletConnect path closed.
  failed = true;
  const nativeFetch = scope.fetch;
  const nativeBeacon = navigator && navigator.sendBeacon;
  const ResponseConstructor = scope.Response;
  if (typeof nativeFetch !== "function" || typeof nativeBeacon !== "function" ||
      typeof ResponseConstructor !== "function" || typeof scope.URL !== "function" ||
      typeof scope.Request !== "function") {
    throw new Error("WalletConnect telemetry guard unavailable");
  }

  function isPulse(input) {
    // Read only the destination, never bodies, init options or telemetry payloads.
    let url;
    if (typeof input === "string") url = input;
    else if (input instanceof scope.URL) url = input.href;
    else if (input instanceof scope.Request) url = input.url;
    else return false;
    try {
      return new scope.URL(url, scope.document.baseURI).origin === "https://pulse.walletconnect.org";
    } catch (_) {
      return false; // Leave invalid input/error semantics to the original transport.
    }
  }

  function guardedFetch(input) {
    if (isPulse(input)) {
      return Promise.resolve(new ResponseConstructor("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));
    }
    return Reflect.apply(nativeFetch, this, arguments);
  }

  function guardedBeacon(url) {
    if (isPulse(url)) return true;
    return Reflect.apply(nativeBeacon, this, arguments);
  }

  scope.fetch = guardedFetch;
  navigator.sendBeacon = guardedBeacon;
  if (scope.fetch !== guardedFetch || navigator.sendBeacon !== guardedBeacon) {
    throw new Error("WalletConnect telemetry guard installation failed");
  }
  installed = { fetch: guardedFetch, sendBeacon: guardedBeacon, navigator };
  failed = false;
}
