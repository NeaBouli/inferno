// Deliberately synthetic fixtures. No external endpoint is contacted.
const production = {
  NODE_ENV: 'production',
  PORT: '3005',
  JWT_SECRET: 'fixture-jwt-secret-at-least-32-bytes',
  SIWE_DOMAIN: 'creator.example.invalid',
  SIWE_URI: 'https://creator.example.invalid',
  RPC_URL: 'https://rpc.example.invalid/provider-fixture',
  CHAIN_ID: '1',
  IFRLOCK_ADDRESS: '0x1234567890123456789012345678901234567890',
  ALLOWED_ORIGINS: 'https://creator.example.invalid,https://client.example.invalid',
  GOOGLE_CLIENT_ID: 'fixture-client',
  GOOGLE_CLIENT_SECRET: 'fixture-google-secret',
  GOOGLE_REDIRECT_URI: 'https://api.example.invalid/auth/google/callback',
  YOUTUBE_CHANNEL_ID: 'fixture-channel',
};
const savedEnv = process.env;
beforeEach(() => { process.env = { ...production }; });
afterEach(() => { process.env = savedEnv; });

function loadConfig() {
  let config: typeof import('../config').CONFIG | undefined;
  jest.isolateModules(() => { config = require('../config').CONFIG; });
  return config!;
}

test('accepts explicit production settings and exact origin allowlist', () => {
  const cfg = loadConfig();
  expect(cfg.chainId).toBe(1);
  expect(cfg.isProduction).toBe(true);
  expect(cfg.allowedOrigins).toEqual(['https://creator.example.invalid', 'https://client.example.invalid']);
});

test.each([
  'JWT_SECRET', 'SIWE_DOMAIN', 'SIWE_URI', 'RPC_URL', 'CHAIN_ID', 'IFRLOCK_ADDRESS',
  'ALLOWED_ORIGINS', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI',
  'YOUTUBE_CHANNEL_ID',
])('production requires %s without fallback', (name) => {
  delete process.env[name];
  expect(loadConfig).toThrow(name);
  process.env[name] = '   ';
  expect(loadConfig).toThrow(name);
});

test.each([
  ['JWT_SECRET', 'short'], ['JWT_SECRET', ' '.repeat(40)],
  ['CHAIN_ID', '11155111'], ['CHAIN_ID', '1e0'], ['CHAIN_ID', '1.5'],
  ['IFRLOCK_ADDRESS', 'not-an-address'],
  ['IFRLOCK_ADDRESS', '0x0000000000000000000000000000000000000000'],
  ['RPC_URL', 'http://rpc.example.invalid'], ['RPC_URL', 'file:///tmp/rpc'],
  ['RPC_URL', 'https://user:password@rpc.example.invalid'], ['RPC_URL', 'https://rpc.example.invalid/#secret'],
  ['RPC_URL', 'https://localhost'], ['RPC_URL', 'https://127.0.0.1'],
  ['ALLOWED_ORIGINS', '*'], ['ALLOWED_ORIGINS', 'https://*.example.invalid'],
  ['ALLOWED_ORIGINS', 'https://creator.example.invalid/'],
  ['ALLOWED_ORIGINS', 'https://creator.example.invalid/path'],
  ['ALLOWED_ORIGINS', 'http://creator.example.invalid'],
  ['ALLOWED_ORIGINS', 'https://creator.example.invalid,'],
  ['SIWE_DOMAIN', 'wrong.example.invalid'], ['SIWE_URI', 'http://creator.example.invalid'],
  ['GOOGLE_REDIRECT_URI', 'https://api.example.invalid/wrong'],
  ['GOOGLE_REDIRECT_URI', 'https://api.example.invalid/auth/google/callback?state=fixture'],
  ['PORT', '3005garbage'], ['PORT', '0'], ['PORT', '65536'],
  ['MIN_LOCK_IFR', '0'], ['MIN_LOCK_IFR', '0.0000000001'], ['MIN_LOCK_IFR', '1e3'],
])('rejects invalid %s configuration', (name, value) => {
  process.env[name] = value;
  expect(loadConfig).toThrow(name);
});

test('configuration failures do not disclose supplied URLs or credentials', () => {
  process.env.RPC_URL = 'https://fixture-user:SENTINEL-SECRET@rpc.example.invalid';
  try {
    loadConfig();
    throw new Error('expected failure');
  } catch (error) {
    expect((error as Error).message).toContain('RPC_URL');
    expect((error as Error).message).not.toContain('SENTINEL');
    expect((error as Error).message).not.toContain(process.env.RPC_URL);
  }
});

test('token thresholds retain all nine decimals as a string', () => {
  process.env.MIN_LOCK_IFR = '9007199254740993.000000001';
  expect(loadConfig().minLockIFR).toBe(process.env.MIN_LOCK_IFR);
});
