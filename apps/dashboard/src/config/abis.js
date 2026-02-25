export const InfernoTokenABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function senderBurnBps() view returns (uint256)",
  "function recipientBurnBps() view returns (uint256)",
  "function poolFeeBps() view returns (uint256)",
  "function poolFeeReceiver() view returns (address)",
  "function feeExempt(address) view returns (bool)",
  "function owner() view returns (address)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

export const GovernanceABI = [
  "function proposalCount() view returns (uint256)",
  "function getProposal(uint256) view returns (address target, bytes data, uint256 eta, bool executed, bool cancelled)",
  "function delay() view returns (uint256)",
  "function owner() view returns (address)",
  "function guardian() view returns (address)",
  "function propose(address target, bytes data) returns (uint256)",
  "function execute(uint256 proposalId)",
  "function cancel(uint256 proposalId)",
];

export const BurnReserveABI = [
  "function totalBurned() view returns (uint256)",
  "function pendingBurn() view returns (uint256)",
];

export const BuybackVaultABI = [
  "function activationTime() view returns (uint256)",
  "function paused() view returns (bool)",
  "function router() view returns (address)",
  "function treasury() view returns (address)",
  "function burnShareBps() view returns (uint256)",
  "function cooldown() view returns (uint256)",
  "function slippageBps() view returns (uint256)",
];

export const LiquidityReserveABI = [
  "function lockEnd() view returns (uint256)",
  "function availableToWithdraw() view returns (uint256)",
  "function pendingBalance() view returns (uint256)",
  "function currentPeriod() view returns (uint256)",
  "function paused() view returns (bool)",
];

export const VestingABI = [
  "function beneficiary() view returns (address)",
  "function releasableAmount() view returns (uint256)",
  "function vestedAmount() view returns (uint256)",
  "function released() view returns (uint256)",
  "function start() view returns (uint256)",
  "function cliffDuration() view returns (uint256)",
  "function duration() view returns (uint256)",
  "function totalAllocation() view returns (uint256)",
  "function paused() view returns (bool)",
];

export const IFRLockABI = [
  "function isLocked(address wallet, uint256 minAmount) view returns (bool)",
  "function lockedAmount(address wallet) view returns (uint256)",
  "function totalLocked() view returns (uint256)",
  "function lockType(address wallet) view returns (bytes32)",
];

export const PartnerVaultABI = [
  "function rewardBps() view returns (uint256)",
  "function totalRewarded() view returns (uint256)",
  "function annualEmissionCap() view returns (uint256)",
  "function partnerCount() view returns (uint256)",
];

export const FeeRouterABI = [
  "function protocolFeeBps() view returns (uint256)",
  "function paused() view returns (bool)",
  "function voucherSigner() view returns (address)",
];
