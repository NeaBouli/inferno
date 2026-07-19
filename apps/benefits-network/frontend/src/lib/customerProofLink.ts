export const CANONICAL_SHOP_ORIGIN = 'https://shop.ifrunit.tech';

const MAX_PROOF_INPUT_LENGTH = 2048;
const SESSION_ID_PATTERN = /^[a-z][a-z0-9]{19,31}$/;

export type CustomerProofLinkResult =
  | {
      ok: true;
      sessionId: string;
      path: `/r/${string}`;
    }
  | {
      ok: false;
      code:
        | 'empty'
        | 'too_long'
        | 'invalid_format'
        | 'invalid_session'
        | 'foreign_origin'
        | 'insecure_origin'
        | 'unexpected_url_data';
      message: string;
    };

function isSessionId(value: string) {
  return SESSION_ID_PATTERN.test(value);
}

function success(sessionId: string): CustomerProofLinkResult {
  return {
    ok: true,
    sessionId,
    path: `/r/${sessionId}`,
  };
}

function failure(
  code: Extract<CustomerProofLinkResult, { ok: false }>['code'],
  message: string
): CustomerProofLinkResult {
  return { ok: false, code, message };
}

function safeDevelopmentOrigin(currentOrigin?: string) {
  if (!currentOrigin) return '';
  try {
    const url = new URL(currentOrigin);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return loopback && ['http:', 'https:'].includes(url.protocol) ? url.origin : '';
  } catch {
    return '';
  }
}

function parseProofUrl(raw: string, currentOrigin?: string): CustomerProofLinkResult {
  let url: URL;
  try {
    url = raw.startsWith('/') && !raw.startsWith('//')
      ? new URL(raw, CANONICAL_SHOP_ORIGIN)
      : new URL(raw);
  } catch {
    return failure('invalid_format', 'Enter an IFR Benefits customer proof link or session ID.');
  }

  const developmentOrigin = safeDevelopmentOrigin(currentOrigin);
  const isCurrentDevelopmentOrigin = Boolean(developmentOrigin) && url.origin === developmentOrigin;

  if (url.username || url.password || url.search || url.hash || (url.port && !isCurrentDevelopmentOrigin)) {
    return failure(
      'unexpected_url_data',
      'The proof link must not contain credentials, a custom port, query parameters or a fragment.'
    );
  }

  const originAllowed = url.origin === CANONICAL_SHOP_ORIGIN || isCurrentDevelopmentOrigin;
  if (!originAllowed) {
    if (url.hostname === 'shop.ifrunit.tech' && url.protocol !== 'https:') {
      return failure('insecure_origin', 'The IFR Benefits proof link must use HTTPS.');
    }
    return failure('foreign_origin', 'Only proof links from shop.ifrunit.tech are accepted.');
  }

  const match = url.pathname.match(/^\/r\/([a-z][a-z0-9]{19,31})$/);
  if (!match) {
    return failure('invalid_session', 'This is not a valid IFR Benefits customer proof link.');
  }

  return success(match[1]);
}

export function parseCustomerProofQrPayload(
  value: string,
  currentOrigin?: string
): CustomerProofLinkResult {
  const raw = value.trim();
  if (!raw) return failure('empty', 'Point the camera at an IFR Benefits customer proof QR.');
  if (raw.length > MAX_PROOF_INPUT_LENGTH) {
    return failure('too_long', 'The scanned QR payload is too long to be an IFR Benefits proof.');
  }
  return parseProofUrl(raw, currentOrigin);
}

export function parseCustomerProofManualInput(
  value: string,
  currentOrigin?: string
): CustomerProofLinkResult {
  const raw = value.trim();
  if (!raw) return failure('empty', 'Paste a customer proof link or session ID first.');
  if (raw.length > MAX_PROOF_INPUT_LENGTH) {
    return failure('too_long', 'The proof value is too long.');
  }

  const receiptMatch = raw.match(/^Session:\s*([^\s]+)\s*$/im);
  const sessionCandidate = receiptMatch?.[1] || raw;
  if (isSessionId(sessionCandidate)) return success(sessionCandidate);

  return parseProofUrl(raw, currentOrigin);
}
