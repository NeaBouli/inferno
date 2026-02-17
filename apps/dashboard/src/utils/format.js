import { ethers } from "ethers";

const IFR_DECIMALS = 9;
const INITIAL_SUPPLY = "1000000000"; // 1B

export function formatIFR(bigNumber) {
  const str = ethers.utils.formatUnits(bigNumber, IFR_DECIMALS);
  const num = parseFloat(str);
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(2) + "M";
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(2) + "K";
  }
  return num.toFixed(2);
}

export function formatIFRFull(bigNumber) {
  const str = ethers.utils.formatUnits(bigNumber, IFR_DECIMALS);
  return parseFloat(str).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

export function parseIFR(amount) {
  return ethers.utils.parseUnits(amount, IFR_DECIMALS);
}

export function shortenAddress(addr) {
  if (!addr) return "";
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

export function bpsToPercent(bps) {
  return (Number(bps) / 100).toFixed(1) + "%";
}

export function calcBurnedPercent(totalSupply) {
  const initial = ethers.utils.parseUnits(INITIAL_SUPPLY, IFR_DECIMALS);
  const burned = initial.sub(totalSupply);
  return (burned.mul(10000).div(initial).toNumber() / 100).toFixed(2);
}

export { IFR_DECIMALS, INITIAL_SUPPLY };
