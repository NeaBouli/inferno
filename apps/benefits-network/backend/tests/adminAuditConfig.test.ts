import { afterEach, beforeEach, expect, test, vi } from 'vitest';
// Exercise startup validation without loading environment files or opening a listener.
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

const originalEnv = process.env;
const testKey = 'test-audit-hmac-key-0123456789abcdef';
const loadConfig = async () => {
  vi.resetModules();
  return (await import('../src/config')).config;
};

beforeEach(() => {
  process.env = {
    NODE_ENV: 'production', CHAIN_ID: '11155111', SELLER_AUTH_DOMAIN: 'shop.example.test',
    RPC_URL: 'https://rpc.example.test', ADMIN_SECRET: 'test-admin-secret-0123456789abcdef0123456789',
    IFR_TOKEN_ADDRESS: `0x${'1'.repeat(40)}`, IFRLOCK_ADDRESS: `0x${'2'.repeat(40)}`,
    COMMITMENT_VAULT_ADDRESS: `0x${'3'.repeat(40)}`,
  };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('startup refused'); });
});
afterEach(() => { process.env = originalEnv; vi.restoreAllMocks(); });

test.each([undefined, '', '   ', 'short'])('production refuses missing/invalid audit key %p', async (key) => {
  if (key !== undefined) process.env.ADMIN_AUDIT_HMAC_KEY = key;
  await expect(loadConfig()).rejects.toThrow('startup refused');
  expect(process.exit).toHaveBeenCalledWith(1);
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain('ADMIN_AUDIT_HMAC_KEY');
});

test('production accepts a separate audit key without exposing it', async () => {
  process.env.ADMIN_AUDIT_HMAC_KEY = testKey;
  expect((await loadConfig()).ADMIN_AUDIT_HMAC_KEY).toBe(testKey);
  expect(process.exit).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
});

test.each([undefined, '', 'prodution', 'staging'])('unknown/non-development mode %p refuses a missing audit key', async (mode) => {
  if (mode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = mode;
  await expect(loadConfig()).rejects.toThrow('startup refused');
  expect(process.exit).toHaveBeenCalledWith(1);
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain('ADMIN_AUDIT_HMAC_KEY');
});

test.each(['development', 'test'])('explicit %s uses an ephemeral key when no key is configured', async (mode) => {
  process.env.NODE_ENV = mode;
  const first = (await loadConfig()).ADMIN_AUDIT_HMAC_KEY;
  expect(first).toMatch(/^[a-f0-9]{64}$/);
  expect((await loadConfig()).ADMIN_AUDIT_HMAC_KEY).not.toBe(first);
  expect(process.exit).not.toHaveBeenCalled();
});
