import { afterAll, beforeEach, expect, test, vi, type MockedFunction } from 'vitest';
import { verifyRpcChain } from '../startup';

const rpcUrl = 'https://rpc.example.invalid/SENTINEL-PROVIDER-KEY';
const savedFetch = global.fetch;
const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
beforeEach(() => { global.fetch = mockFetch; mockFetch.mockReset(); });
afterAll(() => { global.fetch = savedFetch; });

test('verifies eth_chainId before production starts, with a bounded request', async () => {
  mockFetch.mockResolvedValue(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1' })));
  await expect(verifyRpcChain(rpcUrl, 1)).resolves.toBeUndefined();
  expect(mockFetch).toHaveBeenCalledWith(rpcUrl, expect.objectContaining({
    method: 'POST', redirect: 'error', signal: expect.any(AbortSignal),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
  }));
});

test.each([
  { result: '0xaa36a7' }, { result: '1' }, { error: { message: 'SENTINEL-SECRET' } },
  { result: '0x1', error: { message: 'SENTINEL-SECRET' } }, {}, null,
])('refuses wrong-chain and malformed RPC replies without disclosing the reply', async (body) => {
  mockFetch.mockResolvedValue(new Response(JSON.stringify(body)));
  await expect(verifyRpcChain(rpcUrl, 1)).rejects.toThrow('RPC_URL chain check failed; refusing to start');
});

test('HTTP failures fail closed even with a matching result', async () => {
  mockFetch.mockResolvedValue(new Response(JSON.stringify({ result: '0x1' }), { status: 503 }));
  await expect(verifyRpcChain(rpcUrl, 1)).rejects.toThrow('RPC_URL chain check failed');
});

test('network/timeout errors cannot print embedded provider credentials', async () => {
  mockFetch.mockRejectedValue(new Error(`request failed: ${rpcUrl}`));
  await expect(verifyRpcChain(rpcUrl, 1)).rejects.toThrow(/^RPC_URL chain check failed; refusing to start$/);
});
