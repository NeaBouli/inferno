/** @type {import('next').NextConfig} */
const benefitsApiInternalUrl = process.env.BENEFITS_API_INTERNAL_URL || 'http://localhost:3001';

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${benefitsApiInternalUrl}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
