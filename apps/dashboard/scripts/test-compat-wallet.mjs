import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const calls = [];
const window = new EventTarget();
window.location = new URL('http://127.0.0.1:4178/?fixture=disconnected');
window.fetch = async (url, options) => {
  calls.push({ url: String(url), options });
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x0' }));
};
const navigator = {};
const source = await readFile(new URL('./compat-wallet-fixture.js', import.meta.url), 'utf8');
vm.runInNewContext(source, { window, navigator, URL, Request, Response, CustomEvent, console });
const fixture = window.__IFR_DASHBOARD_FIXTURE__;
const wallet = window.ethereum;
assert.equal(fixture.syntheticOnly, true);
assert.equal(Object.getOwnPropertyDescriptor(window, 'ethereum').writable, false);
assert.equal(Object.getOwnPropertyDescriptor(window, 'ethereum').configurable, false);
assert.equal((await wallet.request({ method: 'eth_accounts' })).length, 0);
assert.equal((await wallet.request({ method: 'eth_requestAccounts' }))[0],
  '0x1111111111111111111111111111111111111111');
for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_sign',
  'personal_sign', 'eth_signTypedData_v4', 'wallet_sendCalls']) {
  await assert.rejects(wallet.request({ method }), /Synthetic fixture denies/);
}
await assert.rejects(wallet.request({ method: 'wallet_switchEthereumChain',
  params: [{ chainId: '0x1' }] }), /Synthetic fixture denies/);
fixture.setState('unsupported');
assert.equal(await wallet.request({ method: 'eth_chainId' }), '0x7a69');
await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] });
assert.equal(await wallet.request({ method: 'eth_chainId' }), '0xaa36a7');
fixture.setState('owner');
assert.equal((await wallet.request({ method: 'eth_accounts' }))[0],
  '0x2222222222222222222222222222222222222222');
await wallet.request({ method: 'wallet_revokePermissions' });
assert.equal((await wallet.request({ method: 'eth_accounts' })).length, 0);
await window.fetch('https://rpc.example.invalid', { method: 'POST',
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [] }) });
assert.ok(calls.at(-1).url.startsWith('/__compat__/rpc?fixture='));
const binaryBody = new TextEncoder().encode(JSON.stringify({
  jsonrpc: '2.0', id: 2, method: 'eth_getBalance', params: [],
}));
await window.fetch('https://rpc.example.invalid', { method: 'POST', body: binaryBody });
assert.ok(calls.at(-1).url.startsWith('/__compat__/rpc?fixture='));
await window.fetch(new Request('https://rpc.example.invalid', { method: 'POST', body: binaryBody }));
assert.ok(calls.at(-1).url.startsWith('/__compat__/rpc?fixture='));
await assert.rejects(window.fetch('https://relay.example.invalid/analytics'), /Synthetic fixture denies/);
assert.throws(() => new window.WebSocket('wss://relay.example.invalid'), /Synthetic fixture denies/);
assert.throws(() => new window.EventSource('https://relay.example.invalid'), /Synthetic fixture denies/);
assert.equal(navigator.sendBeacon('https://relay.example.invalid', 'data'), false);
let discovered = 0;
window.addEventListener('eip6963:announceProvider', () => { discovered += 1; });
window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { provider: {} } }));
assert.equal(discovered, 0, 'foreign real-wallet announcements must be filtered');
window.dispatchEvent(new Event('eip6963:requestProvider'));
assert.equal(discovered, 1);
assert.ok(calls.every(({ url }) => url.startsWith('/__compat__/rpc')),
  'no fixture safety test may emit an external fetch');

function listenerTrace(emitter) {
  let count = 0;
  const renew = () => {
    count += 1;
    assert.ok(count <= 4, 'one emission must not repeatedly re-enter a re-registered listener');
    emitter.off('accountsChanged', renew);
    emitter.on('accountsChanged', renew);
  };
  emitter.on('accountsChanged', renew);
  emitter.emit(); const first = count;
  emitter.emit(); const next = count;
  emitter.off('accountsChanged', renew); emitter.emit();
  const afterUnsubscribe = count;
  const added = [];
  const later = () => added.push('later');
  let registered = false;
  const initial = () => {
    added.push('initial');
    if (!registered) { emitter.on('accountsChanged', later); registered = true; }
  };
  emitter.on('accountsChanged', initial);
  emitter.emit(); const addedFirst = [...added];
  added.length = 0; emitter.emit(); const addedNext = [...added];
  emitter.off('accountsChanged', initial); emitter.off('accountsChanged', later);
  const removed = [];
  const second = () => removed.push('second');
  const removeSecond = () => { removed.push('first'); emitter.off('accountsChanged', second); };
  emitter.on('accountsChanged', removeSecond); emitter.on('accountsChanged', second);
  emitter.emit(); const removedFirst = [...removed];
  removed.length = 0; emitter.emit(); const removedNext = [...removed];
  emitter.off('accountsChanged', removeSecond); emitter.off('accountsChanged', second);
  return { first, next, afterUnsubscribe, addedFirst, addedNext, removedFirst, removedNext };
}
const reference = new EventEmitter();
const expectedTrace = listenerTrace({
  on: (...args) => reference.on(...args), off: (...args) => reference.removeListener(...args),
  emit: () => reference.emit('accountsChanged', ['0x1111111111111111111111111111111111111111']),
});
const actualTrace = listenerTrace({
  on: (...args) => wallet.on(...args), off: (...args) => wallet.removeListener(...args),
  emit: () => fixture.setState('connected'),
});
assert.deepEqual(actualTrace, expectedTrace, 'listener mutation must match snapshot emission');

console.log(JSON.stringify({ result: 'PASS', syntheticWalletSafety: true,
  deniedSigningAndBroadcast: true, remoteSdkFetchBlocked: true,
  rpcRedirectsOnlyToLoopback: true, foreignProviderFiltered: true,
  listenerSnapshotMatchesEventEmitter: true, listenerTrace: actualTrace,
  realProviderDeviceOrChainAcceptance: false }, null, 2));
