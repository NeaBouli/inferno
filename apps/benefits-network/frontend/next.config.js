/** @type {import('next').NextConfig} */
const benefitsApiInternalUrl = process.env.BENEFITS_API_INTERNAL_URL || 'http://localhost:3001';
// Next 15's development webpack source-map plugin wraps modules in eval().
// Production bundles do not use that plugin; never permit eval in production.
const developmentScriptSource = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '';
// Keep these origins aligned with wagmi.ts and the pinned WalletConnect/Coinbase SDKs.
// Only public browser destinations belong here; the internal API rewrite is server-side.
const connectOrigins = [
  "'self'",
  'https://ethereum-rpc.publicnode.com',
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://rpc.walletconnect.org',
  'https://relay.walletconnect.org',
  'wss://relay.walletconnect.org',
  'https://verify.walletconnect.com',
  'https://verify.walletconnect.org',
  'https://api.web3modal.org',
  'https://www.walletlink.org',
  'wss://www.walletlink.org',
  'https://rpc.wallet.coinbase.com',
];
for (const value of [process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL, process.env.NEXT_PUBLIC_API_URL]) {
  if (value?.trim().startsWith('https://')) connectOrigins.push(new URL(value.trim()).origin);
}
const contentSecurityPolicy = [
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');
// Keep the origin/main enforcement baseline until the JUL-11 real-wallet matrix passes.
const contentSecurityPolicyReportOnly = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // Next's App Router hydration and JSON-LD currently use inline scripts.
  `script-src 'self' 'unsafe-inline'${developmentScriptSource}`,
  "style-src 'self' 'unsafe-inline'",
  // Seller logos accept arbitrary HTTPS URLs (BusinessLogo.tsx).
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.reown.com",
  `connect-src ${[...new Set(connectOrigins)].join(' ')}`,
  // qr-scanner creates a blob worker from the bundled decoder.
  "worker-src 'self' blob:",
  "frame-src 'self' https://copilot-api.ifrunit.tech https://verify.walletconnect.com https://verify.walletconnect.org",
  "media-src 'self' blob:",
  "manifest-src 'self'",
].join('; ');
const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'Content-Security-Policy-Report-Only', value: contentSecurityPolicyReportOnly },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
      'pino-pretty': false,
    };
    return config;
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${benefitsApiInternalUrl}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
