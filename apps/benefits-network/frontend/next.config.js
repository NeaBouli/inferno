/** @type {import('next').NextConfig} */
const benefitsApiInternalUrl = process.env.BENEFITS_API_INTERNAL_URL || 'http://localhost:3001';

const nextConfig = {
  reactStrictMode: true,
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
};

module.exports = nextConfig;
