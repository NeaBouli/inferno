import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { InfernoTokenABI, IFRLockABI } from '../src/config/abis.js';
import { rpcResponse } from './compat-rpc-fixture.mjs';
import './test-compat-wallet.mjs';

const address = '0x1111111111111111111111111111111111111111';
const token = new ethers.Interface(InfernoTokenABI);
const lock = new ethers.Interface(IFRLockABI);
const call = (data, state) => rpcResponse({ jsonrpc: '2.0', id: 7, method: 'eth_call',
  params: [{ to: address, data }] }, state);
const balance = call(token.encodeFunctionData('balanceOf', [address]));
assert.equal(balance.id, 7);
assert.equal(token.decodeFunctionResult('balanceOf', balance.result)[0], 12345678901234n);
const locked = call(lock.encodeFunctionData('lockedBalance', [address]));
assert.equal(lock.decodeFunctionResult('lockedBalance', locked.result)[0], 1000000000000n);
assert.ok(call(token.encodeFunctionData('transfer', [address, 1n])).error,
  'even eth_call must deny a mutating selector');
assert.ok(call('0xdeadbeef').error);
assert.ok(call(token.encodeFunctionData('name'), 'error').error);
for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_sign',
  'personal_sign', 'eth_getTransactionReceipt', '__proto__']) {
  assert.ok(rpcResponse({ jsonrpc: '2.0', id: 9, method }).error, method);
}
assert.ok(rpcResponse(null).error);
console.log(JSON.stringify({ result: 'PASS', syntheticOnly: true,
  deniedSigningAndBroadcast: true, remoteSdkFetchBlocked: true,
  rpcRedirectsOnlyToLoopback: true, foreignProviderFiltered: true,
  actualAbiNineDecimalValues: true, mutatingAbiSelectorsDenied: true,
  realProviderDeviceOrChainAcceptance: false }, null, 2));
