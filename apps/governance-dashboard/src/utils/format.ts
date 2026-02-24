import { ethers, BigNumber } from "ethers";

export const IFR_DECIMALS = 9;
export const INITIAL_SUPPLY = "1000000000";

export function formatIFR(bn: BigNumber): string {
  const val = parseFloat(ethers.utils.formatUnits(bn, IFR_DECIMALS));
  if (val >= 1_000_000) return (val / 1_000_000).toFixed(2) + "M";
  if (val >= 1_000) return (val / 1_000).toFixed(1) + "K";
  return val.toFixed(2);
}

export function formatIFRFull(bn: BigNumber): string {
  const val = parseFloat(ethers.utils.formatUnits(bn, IFR_DECIMALS));
  return val.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function parseIFR(amount: string): BigNumber {
  return ethers.utils.parseUnits(amount, IFR_DECIMALS);
}

export function bpsToPercent(bps: number | BigNumber): string {
  const val = typeof bps === "number" ? bps : bps.toNumber();
  return (val / 100).toFixed(1) + "%";
}

export function shortenAddress(addr: string): string {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

export function shortenBytes32(b: string): string {
  return b.slice(0, 10) + "..." + b.slice(-6);
}

export function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function formatCountdown(etaSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = etaSeconds - now;
  if (diff <= 0) return "Ready";
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
