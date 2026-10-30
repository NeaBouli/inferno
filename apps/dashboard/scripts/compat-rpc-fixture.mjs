import { ethers } from 'ethers';
import * as abis from '../src/config/abis.js';

const interfaces = Object.values(abis).map((abi) => new ethers.Interface(abi));
const owner = '0x2222222222222222222222222222222222222222';
const guardian = '0x3333333333333333333333333333333333333333';

function contractCall(transaction, state) {
  if (!/^0x[0-9a-f]{40}$/i.test(transaction?.to || '')) throw new Error('Synthetic address required');
  const data = transaction.data || transaction.input;
  for (const contract of interfaces) {
    let parsed;
    try { parsed = contract.parseTransaction({ data }); } catch { continue; }
    if (!parsed) continue;
    if (!['view', 'pure'].includes(parsed.fragment.stateMutability)) {
      throw new Error('Synthetic fixture rejects mutating ABI selector');
    }
    const values = {
      name: state === 'long' ? 'Inferno Synthetic Very Long Token Name For Layout Inspection' : 'Inferno (Fixture)',
      symbol: 'IFR', decimals: 9, totalSupply: ethers.parseUnits('990000000', 9),
      balanceOf: ethers.parseUnits('12345.678901234', 9),
      senderBurnBps: 200n, recipientBurnBps: 50n, poolFeeBps: 100n,
      owner, guardian, poolFeeReceiver: guardian, protocolFeeBps: 100n,
      totalLocked: ethers.parseUnits('2500', 9), lockedBalance: ethers.parseUnits('1000', 9),
      allowance: ethers.MaxUint256, rewardBps: 1000n, totalRewarded: ethers.parseUnits('42', 9),
      proposalCount: 0n, delay: 3600n, paused: false, totalBurned: ethers.parseUnits('10000000', 9),
      pendingBurn: ethers.parseUnits('1', 9), isLocked: true,
    };
    const result = parsed.fragment.outputs.map((output) => {
      if (Object.hasOwn(values, parsed.name) && parsed.fragment.outputs.length === 1) return values[parsed.name];
      if (output.type === 'address') return owner;
      if (output.type === 'bool') return false;
      if (output.type === 'string') return '';
      if (output.type === 'bytes') return '0x';
      if (/^u?int\d*$/.test(output.type)) return 0n;
      throw new Error('Unsupported synthetic ABI output');
    });
    return contract.encodeFunctionResult(parsed.fragment, result);
  }
  throw new Error('Unknown synthetic ABI selector');
}

export function rpcResponse(call, state = 'connected') {
  const id = call?.id ?? null;
  try {
    if (call?.jsonrpc !== '2.0' || typeof call.method !== 'string') throw new Error('Invalid synthetic RPC');
    if (/sign|send|submit|broadcast/i.test(call.method)) throw new Error('Synthetic fixture denies mutation');
    if (state === 'error') throw new Error('Synthetic RPC error state');
    const methods = {
      eth_chainId: () => '0xaa36a7', net_version: () => '11155111',
      eth_blockNumber: () => '0x123456', eth_getBalance: () => ethers.toQuantity(ethers.parseEther('1')),
      eth_getLogs: () => [], eth_getCode: () => '0x',
      eth_call: () => contractCall(call.params?.[0], state),
    };
    if (!Object.hasOwn(methods, call.method)) throw new Error('Unsupported synthetic RPC method');
    return { jsonrpc: '2.0', id, result: methods[call.method]() };
  } catch (error) {
    return { jsonrpc: '2.0', id, error: { code: -32000, message: error.message } };
  }
}
