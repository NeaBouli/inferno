// Browser policy for the Express chat document and API responses, including errors.
// The chat is intentionally embedded by these public IFR surfaces. X-Frame-Options
// has no multi-origin allowlist; frame-ancestors is authoritative on this service.
export const securityHeaders = {
  "Content-Security-Policy": [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'self' https://ifrunit.tech https://www.ifrunit.tech https://web3.ifrunit.tech https://shop.ifrunit.tech https://neabouli.github.io",
  ].join('; '),
  "Strict-Transport-Security": "max-age=63072000",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};
