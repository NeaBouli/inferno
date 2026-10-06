import { SiweErrorType } from "siwe";
import { isDatabaseError } from "./voucher-log.js";

/** Fixed log categories for SIWE verification failures. Nothing else from an error reaches the log. */
export type SiweErrorCategory =
  | "siwe_error:parse"
  | "siwe_error:expired"
  | "siwe_error:not_yet_valid"
  | "siwe_error:invalid_signature"
  | "siwe_error:context_mismatch"
  | "siwe_error:invalid_message"
  | "siwe_error:database"
  | "siwe_error:unknown";

/** Where in /auth/siwe/verify the failure happened. */
export type SiweStage = "parse" | "verify" | "persist";

const SIWE_TYPE_CATEGORIES: ReadonlyMap<string, SiweErrorCategory> = new Map<string, SiweErrorCategory>([
  [SiweErrorType.EXPIRED_MESSAGE, "siwe_error:expired"],
  [SiweErrorType.NOT_YET_VALID_MESSAGE, "siwe_error:not_yet_valid"],
  [SiweErrorType.INVALID_SIGNATURE, "siwe_error:invalid_signature"],
  [SiweErrorType.SCHEME_MISMATCH, "siwe_error:context_mismatch"],
  [SiweErrorType.DOMAIN_MISMATCH, "siwe_error:context_mismatch"],
  [SiweErrorType.NONCE_MISMATCH, "siwe_error:context_mismatch"],
  [SiweErrorType.INVALID_DOMAIN, "siwe_error:invalid_message"],
  [SiweErrorType.INVALID_ADDRESS, "siwe_error:invalid_message"],
  [SiweErrorType.INVALID_URI, "siwe_error:invalid_message"],
  [SiweErrorType.INVALID_NONCE, "siwe_error:invalid_message"],
  [SiweErrorType.INVALID_TIME_FORMAT, "siwe_error:invalid_message"],
  [SiweErrorType.INVALID_MESSAGE_VERSION, "siwe_error:invalid_message"],
  [SiweErrorType.UNABLE_TO_PARSE, "siwe_error:invalid_message"],
]);

function siweErrorType(err: unknown): unknown {
  if (typeof err !== "object" || err === null) return undefined;
  // siwe rejects verify() with a SiweResponse { success, data, error: SiweError { type, ... } }.
  const inner = (err as { error?: unknown }).error;
  const source = typeof inner === "object" && inner !== null ? inner : err;
  return (source as { type?: unknown }).type;
}

/**
 * Map a SIWE verification failure to a constant log category. Only the stage, the siwe
 * error-type enum and Prisma class names are inspected; the message, address, signature,
 * expected/received values and any other free-form content are never returned.
 */
export function categorizeSiweError(err: unknown, stage: SiweStage): SiweErrorCategory {
  if (stage === "parse") return "siwe_error:parse";
  if (isDatabaseError(err)) return "siwe_error:database";
  const type = siweErrorType(err);
  if (typeof type === "string") return SIWE_TYPE_CATEGORIES.get(type) ?? "siwe_error:unknown";
  return "siwe_error:unknown";
}

/** Fixed log categories for captcha verification failures. */
export type CaptchaErrorCategory =
  | "captcha_error:timeout"
  | "captcha_error:network"
  | "captcha_error:bad_response"
  | "captcha_error:unknown";

/**
 * Map a captcha verification failure to a constant log category. Only error class names
 * are inspected; message text, URLs, tokens and secrets are never returned.
 */
export function categorizeCaptchaError(err: unknown): CaptchaErrorCategory {
  if (!(err instanceof Error)) return "captcha_error:unknown";
  if (err.name === "TimeoutError" || err.name === "AbortError") return "captcha_error:timeout";
  // response.json() on a non-JSON body.
  if (err instanceof SyntaxError) return "captcha_error:bad_response";
  // undici fetch() rejects transport failures with TypeError("fetch failed").
  if (err instanceof TypeError) return "captcha_error:network";
  return "captcha_error:unknown";
}
