import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { ethers } from 'ethers';
import * as abis from '../src/config/abis.js';

globalThis.fetch = async () => { throw new Error('external network forbidden in contract fixture'); };
const account = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const methods = [];
const transport = {
  async request({ method }) {
    methods.push(method);
    if (method === 'eth_chainId') return '0xaa36a7';
    if (method === 'eth_accounts') return [account];
    throw new Error('fixture forbids wallet operation: ' + method);
  },
};
const source = await readFile(new URL('../src/hooks/useEthersSigner.js', import.meta.url), 'utf8');
const signerFunction = source.match(/async function clientToSigner\(client\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(signerFunction, 'test must exercise the actual existing adapter');
const clientToSigner = vm.runInNewContext('(' + signerFunction + ')', { ethers });
const signer = await clientToSigner({
  account: { address: account },
  chain: {
    id: 11155111,
    name: 'Sepolia fixture',
    contracts: { ensRegistry: { address: other } },
  },
  transport,
});
assert.equal(await signer.getAddress(), account);
assert.equal((await signer.provider.getNetwork()).chainId, 11155111n);
assert.ok(methods.includes('eth_accounts'));
assert.ok(!methods.some((method) => /send|sign/i.test(method)));

await assert.rejects(() => clientToSigner({
  account: { address: account },
  chain: { id: 11155111, name: 'Sepolia fixture' },
  transport: {
    async request({ method }) {
      if (method === 'eth_chainId') return '0xaa36a7';
      if (method === 'eth_accounts') return [other];
      throw Object.assign(new Error('synthetic permission denied'), { code: 4001 });
    },
  },
}));

const names = [
  ['token', 'InfernoToken'],
  ['governance', 'Governance'],
  ['burnReserve', 'BurnReserve'],
  ['buybackVault', 'BuybackVault'],
  ['liquidityReserve', 'LiquidityReserve'],
  ['vesting', 'Vesting'],
  ['ifrLock', 'IFRLock'],
  ['partnerVault', 'PartnerVault'],
  ['feeRouter', 'FeeRouter'],
];
const addresses = Object.fromEntries(names.map(([, name], index) => [
  name, '0x' + (index + 1).toString(16).padStart(40, '0'),
]));
const reader = { call: async () => { throw new Error('read fixture forbids external RPC'); } };
let fallbackCalls = 0;
const contractSource = await readFile(new URL('../src/hooks/useContracts.js', import.meta.url), 'utf8');
const contractFunction = contractSource.slice(contractSource.indexOf('export function useContracts'))
  .replace('export function', 'function');
const useContracts = vm.runInNewContext('(' + contractFunction + ')', {
  ethers,
  ...abis,
  ADDRESSES: addresses,
  useMemo: (factory) => factory(),
  getReadProvider: () => { fallbackCalls += 1; return reader; },
});
const connected = useContracts(signer);
assert.deepEqual(Object.keys(connected), names.map(([name]) => name));
for (const [name, addressKey] of names) {
  assert.equal(connected[name].target.toLowerCase(), addresses[addressKey]);
  assert.equal(connected[name].runner, signer);
}
assert.equal(fallbackCalls, 0);
const readOnly = useContracts(undefined);
assert.equal(fallbackCalls, 1);
for (const [name] of names) assert.equal(readOnly[name].runner, reader);

const amount = ethers.parseUnits('123.000000001', 9);
const unsigned = await connected.token.transfer.populateTransaction(other, amount);
const decoded = connected.token.interface.decodeFunctionData('transfer', unsigned.data);
assert.equal(decoded[0].toLowerCase(), other);
assert.equal(decoded[1], 123000000001n);
assert.ok(!methods.some((method) => /send|sign/i.test(method)));
signer.provider.destroy();
console.log(JSON.stringify({
  result: 'PASS',
  actualAdapterSourceExercised: true,
  actualContractBuilderSourceExercised: true,
  contractHandles: names.length,
  mismatchedAccountDenied: true,
  readOnlyFallbackPreserved: true,
  unsignedBaseUnits: amount.toString(),
  walletMethods: methods,
  realRpcOrSignatureOrTransaction: false,
}, null, 2));
