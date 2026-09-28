// Test fixtures only — dummy values, never real secrets.
// Required because config fails closed when these are absent.
process.env.JWT_SECRET ??= 'test-jwt-secret-fixture';
process.env.SIWE_DOMAIN ??= 'localhost';
process.env.SIWE_URI ??= 'http://localhost:3005';
