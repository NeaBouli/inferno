// Probe the actual upstream before opening the production listener. Never log
// request/response objects: RPC endpoints often embed provider credentials.
export async function verifyRpcChain(rpcUrl: string, chainId: number): Promise<void> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    const body: unknown = await response.json();
    if (!response.ok || !body || typeof body !== 'object' ||
        !('result' in body) || typeof body.result !== 'string' ||
        !/^0x[0-9a-f]+$/i.test(body.result) || BigInt(body.result) !== BigInt(chainId) ||
        ('error' in body && body.error != null)) throw new Error();
  } catch {
    throw new Error('RPC_URL chain check failed; refusing to start');
  }
}
