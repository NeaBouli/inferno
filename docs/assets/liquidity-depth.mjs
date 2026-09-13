const ceil = (a, b) => (a + b - 1n) / b;
export function parseETH(text) {
  if (!/^(0|[1-9]\d{0,9})(\.\d{1,18})?$/.test(text)) throw new Error('Use a decimal point and up to 18 decimals.');
  const [whole, fraction = ''] = text.split('.');
  const amount = BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'));
  if (amount <= 0n) throw new Error('Enter an ETH amount greater than zero.');
  return amount;
}
export function capacity(reserve, bps) {
  if (reserve <= 0n || bps <= 0n || bps >= 10000n) throw new Error('Invalid depth inputs');
  return reserve * bps * 1000n / ((10000n - bps) * 997n);
}
export function depth(amount, eth, ifr) {
  if (amount <= 0n || eth <= 0n || ifr <= 0n) throw new Error('Invalid depth inputs');
  const required = ceil(amount * 997n * 9900n, 1000n * 100n);
  const missing = required > eth ? required - eth : 0n;
  return {
    required, missing, missingIFR: ceil(missing * ifr, eth),
    // Hundredths of a percent, rounded up so a warning is never understated.
    impactBps: ceil(amount * 997n * 10000n, eth * 1000n + amount * 997n),
    coverage: Number((eth > required ? required : eth) * 10000n / required) / 100
  };
}
export function decimal(value, decimals = 18, places = 6) {
  const base = 10n ** BigInt(decimals);
  const fraction = (value % base).toString().padStart(decimals, '0').slice(0, places).replace(/0+$/, '');
  if (value > 0n && value < base / 10n ** BigInt(places)) return '<0.' + '0'.repeat(places - 1) + '1';
  return (value / base).toString() + (fraction ? '.' + fraction : '');
}
