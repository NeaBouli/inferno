export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 11155111);

export const IFR_TOKEN_ADDRESS = (
  process.env.NEXT_PUBLIC_IFR_TOKEN_ADDRESS ||
  (CHAIN_ID === 1 ? '0x77e99917Eca8539c62F509ED1193ac36580A6e7B' : '')
) as `0x${string}` | '';

export const IFRLOCK_ADDRESS = (
  process.env.NEXT_PUBLIC_IFRLOCK_ADDRESS ||
  (CHAIN_ID === 1 ? '0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb' : '')
) as `0x${string}` | '';

export const IFR_DECIMALS = 9;

export const IFRLOCK_ABI = [
  {
    type: 'function',
    name: 'lockedBalance',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
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
