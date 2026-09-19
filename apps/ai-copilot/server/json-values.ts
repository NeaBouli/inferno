export function toJsonSafeUint32(value: bigint | number): number {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0 || normalized > 0xffffffff) {
    throw new RangeError("Value is outside the uint32 range");
  }
  return normalized;
}
