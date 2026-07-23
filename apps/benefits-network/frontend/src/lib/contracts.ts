export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 1);

export const IFR_TOKEN_ADDRESS = (
  process.env.NEXT_PUBLIC_IFR_TOKEN_ADDRESS ||
  (CHAIN_ID === 1 ? '0x77e99917Eca8539c62F509ED1193ac36580A6e7B' : '')
) as `0x${string}` | '';

export const IFRLOCK_ADDRESS = (
  process.env.NEXT_PUBLIC_IFRLOCK_ADDRESS ||
  (CHAIN_ID === 1 ? '0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb' : '')
) as `0x${string}` | '';

export const COMMITMENT_VAULT_ADDRESS = (
  process.env.NEXT_PUBLIC_COMMITMENT_VAULT_ADDRESS ||
  (CHAIN_ID === 1 ? '0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3' : '')
) as `0x${string}` | '';

export const IFR_DECIMALS = 9;

export const IFRLOCK_ABI = [
  {
    type: 'function',
    name: 'token',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'lockedBalance',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'lock',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'unlock',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
] as const;

export const COMMITMENT_VAULT_ABI = [
  {
    type: 'function',
    name: 'ifrToken',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'getTranches',
    stateMutability: 'view',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [{
      name: '',
      type: 'tuple[]',
      components: [
        { name: 'amount', type: 'uint256' },
        { name: 'cType', type: 'uint8' },
        { name: 'unlockTime', type: 'uint256' },
        { name: 'p0Multiplier', type: 'uint256' },
        { name: 'unlocked', type: 'bool' },
        { name: 'conditionMetAt', type: 'uint256' },
      ],
    }],
  },
] as const;

export const IFR_TOKEN_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export function formatIFR(raw?: bigint): string {
  if (raw === undefined) return '0';
  const divisor = BigInt(10) ** BigInt(IFR_DECIMALS);
  const whole = raw / divisor;
  const fraction = raw % divisor;
  const fractionText = fraction.toString().padStart(IFR_DECIMALS, '0').slice(0, 3);
  return `${whole.toLocaleString('en-US')}.${fractionText}`;
}
