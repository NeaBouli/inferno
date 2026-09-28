// esbuild --inject shim: supplies the node globals that parts of the
// WalletConnect dependency tree reference unconditionally. Only the browser
// paths are ever executed, but the identifiers must exist at module scope.
import { Buffer } from "buffer/";
import * as processShim from "process/browser.js";

export { Buffer };
export { processShim as process };
export const global = globalThis;
