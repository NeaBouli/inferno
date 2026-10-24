import type { RequestHandler } from "express";

/** Runs before parsers and limiters so wallet lookup errors also forbid HTTP storage. */
export const walletLookupNoStore: RequestHandler = (req, res, next) => {
  const walletPath = /^\/api\/(?:builders\/check|commitment\/(?:tranches|status)|lending\/(?:loans|lender))\/[^/]+\/?$/i;
  if (walletPath.test(req.path) || /^\/api\/ifr\/check\/?$/i.test(req.path)
    || (/^\/api\/locks\/events\/?$/i.test(req.path)
      && Object.keys(req.query).some((key) => /^q(?:\[.*\])?$/.test(key)))) {
    // Treat every search as sensitive, including partial addresses and parser array forms.
    res.set("Cache-Control", "private, no-store");
  }
  next();
};

const safeCodes = new Set([
  "UNKNOWN_ERROR", "NETWORK_ERROR", "SERVER_ERROR", "TIMEOUT", "BAD_DATA",
  "CALL_EXCEPTION", "INVALID_ARGUMENT", "UNSUPPORTED_OPERATION", "OFFCHAIN_FAULT",
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND",
]);

/** Omit wallets, calldata, messages, stacks, URLs and nested provider/request objects entirely. */
export function safeLookupError(error: unknown): { code: string } {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return { code: typeof code === "string" && safeCodes.has(code) ? code : "UNKNOWN_ERROR" };
}
