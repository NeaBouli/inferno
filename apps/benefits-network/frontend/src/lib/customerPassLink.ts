export type CustomerPassLinkResult =
  | { ok: true; passId: string }
  | { ok: false; message: string };

export function parseCustomerPassQrPayload(value: string, expectedOrigin: string): CustomerPassLinkResult {
  try {
    const url = new URL(value.trim());
    if (url.origin !== expectedOrigin || url.username || url.password || url.search || url.hash) {
      return { ok: false, message: 'This is not a canonical IFR customer pass.' };
    }
    const match = url.pathname.match(/^\/p\/([A-Za-z0-9_-]{32})\/?$/);
    if (!match) return { ok: false, message: 'This QR is not an IFR customer checkout pass.' };
    return { ok: true, passId: match[1] };
  } catch {
    return { ok: false, message: 'This QR does not contain a valid HTTPS customer pass link.' };
  }
}
