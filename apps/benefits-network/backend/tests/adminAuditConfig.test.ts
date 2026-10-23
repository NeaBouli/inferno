// Exercise startup validation without loading environment files or opening a listener.
jest.mock('dotenv', () => ({ config: jest.fn() }));

const originalEnv = process.env;
const testKey = 'test-audit-hmac-key-0123456789abcdef';
const loadConfig = () => {
  let config: typeof import('../src/config').config | undefined;
  jest.isolateModules(() => { config = require('../src/config').config; });
  return config!;
};

beforeEach(() => {
  process.env = {
    NODE_ENV: 'production', CHAIN_ID: '11155111', SELLER_AUTH_DOMAIN: 'shop.example.test',
    RPC_URL: 'https://rpc.example.test', ADMIN_SECRET: 'test-admin-secret-0123456789abcdef0123456789',
    IFR_TOKEN_ADDRESS: `0x${'1'.repeat(40)}`, IFRLOCK_ADDRESS: `0x${'2'.repeat(40)}`,
    COMMITMENT_VAULT_ADDRESS: `0x${'3'.repeat(40)}`,
  };
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('startup refused'); });
});
afterEach(() => { process.env = originalEnv; jest.restoreAllMocks(); });

test.each([undefined, '', '   ', 'short'])('production refuses missing/invalid audit key %p', (key) => {
  if (key !== undefined) process.env.ADMIN_AUDIT_HMAC_KEY = key;
  expect(loadConfig).toThrow('startup refused');
  expect(process.exit).toHaveBeenCalledWith(1);
  expect(JSON.stringify(jest.mocked(console.error).mock.calls)).toContain('ADMIN_AUDIT_HMAC_KEY');
});

test('production accepts a separate audit key without exposing it', () => {
  process.env.ADMIN_AUDIT_HMAC_KEY = testKey;
  expect(loadConfig().ADMIN_AUDIT_HMAC_KEY).toBe(testKey);
  expect(process.exit).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
});

test('non-production uses an ephemeral key when no key is configured', () => {
  process.env.NODE_ENV = 'development';
  const first = loadConfig().ADMIN_AUDIT_HMAC_KEY;
  expect(first).toMatch(/^[a-f0-9]{64}$/);
  expect(loadConfig().ADMIN_AUDIT_HMAC_KEY).not.toBe(first);
  expect(process.exit).not.toHaveBeenCalled();
});
