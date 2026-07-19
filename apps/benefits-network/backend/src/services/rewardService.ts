import { ethers } from 'ethers';
import { config } from '../config';
import { normalizeAddress } from './sellerAuth';

const PARTNER_VAULT_ABI = [
  'function admin() view returns (address)',
  'function partners(bytes32 partnerId) view returns (address beneficiary, uint256 maxAllocation, uint256 unlockedTotal, uint256 rewardAccrued, uint256 claimedTotal, uint32 vestingStart, uint32 vestingDuration, uint32 cliff, bool active, bool milestonesFinal, uint8 tier)',
  'function claimable(bytes32 partnerId) view returns (uint256)',
  'function vestedAmount(bytes32 partnerId) view returns (uint256)',
  'function walletRewardClaimed(address wallet, bytes32 partnerId) view returns (bool)',
  'function authorizedCaller(address caller) view returns (bool)',
];

const BUILDER_REGISTRY_ABI = [
  'function owner() view returns (address)',
  'function isBuilder(address wallet) view returns (bool)',
  'function builders(address wallet) view returns (string name, string url, string category, uint256 registeredAt, bool active)',
];

export interface RewardOnChainStatus {
  checkedAt: string;
  blockNumber: number;
  chainId: number;
  contractCodeVerified: boolean;
  governanceAligned: boolean;
  partnerId: string;
  builderRegistered: boolean;
  builderActive: boolean;
  builderName: string;
  partnerExists: boolean;
  partnerActive: boolean;
  beneficiary: string | null;
  beneficiaryMatchesOwner: boolean;
  maxAllocationRaw: string;
  rewardAccruedRaw: string;
  claimedTotalRaw: string;
  vestedRaw: string;
  claimableRaw: string;
  rewardCallerConfigured: boolean;
  rewardCallerAuthorized: boolean;
  verified: boolean;
  submissionReady: boolean;
  reason: string | null;
}

function requireRewardConfig() {
  if (!config.PARTNER_VAULT_ADDRESS || !config.BUILDER_REGISTRY_ADDRESS) {
    throw new Error('Reward contracts are not configured');
  }
  return {
    partnerVaultAddress: config.PARTNER_VAULT_ADDRESS,
    builderRegistryAddress: config.BUILDER_REGISTRY_ADDRESS,
  };
}

function validatePartnerId(partnerId: string): string {
  if (!/^0x[a-fA-F0-9]{64}$/.test(partnerId)) throw new Error('Invalid PartnerVault partner ID');
  return partnerId.toLowerCase();
}

export function toIFRBaseUnits(value: string): string {
  const parsed = ethers.parseUnits(value, 9);
  if (parsed <= 0n) throw new Error('Reward lock amount must be positive');
  return parsed.toString();
}

export async function getRewardOnChainStatus(
  ownerAddress: string,
  rawPartnerId: string
): Promise<RewardOnChainStatus> {
  const addresses = requireRewardConfig();
  const owner = normalizeAddress(ownerAddress);
  const partnerId = validatePartnerId(rawPartnerId);
  const provider = new ethers.JsonRpcProvider(config.RPC_URL);
  const partnerVault = new ethers.Contract(addresses.partnerVaultAddress, PARTNER_VAULT_ABI, provider);
  const builderRegistry = new ethers.Contract(addresses.builderRegistryAddress, BUILDER_REGISTRY_ABI, provider);

  const [network, blockNumber, partnerCode, registryCode, partnerAdmin, registryOwner, builderRegistered, builderInfo, partner, vested, claimable, callerAuthorized] = await Promise.all([
    provider.getNetwork(),
    provider.getBlockNumber(),
    provider.getCode(addresses.partnerVaultAddress),
    provider.getCode(addresses.builderRegistryAddress),
    partnerVault.admin() as Promise<string>,
    builderRegistry.owner() as Promise<string>,
    builderRegistry.isBuilder(owner) as Promise<boolean>,
    builderRegistry.builders(owner) as Promise<{ name: string; active: boolean }>,
    partnerVault.partners(partnerId) as Promise<{
      beneficiary: string;
      maxAllocation: bigint;
      rewardAccrued: bigint;
      claimedTotal: bigint;
      active: boolean;
    }>,
    partnerVault.vestedAmount(partnerId) as Promise<bigint>,
    partnerVault.claimable(partnerId) as Promise<bigint>,
    config.REWARD_CALLER_ADDRESS
      ? partnerVault.authorizedCaller(config.REWARD_CALLER_ADDRESS) as Promise<boolean>
      : Promise.resolve(false),
  ]).finally(() => provider.destroy());

  const networkChainId = Number(network.chainId);
  const zero = ethers.ZeroAddress;
  const contractCodeVerified = partnerCode !== '0x' && registryCode !== '0x';
  const governanceAligned = normalizeAddress(partnerAdmin) === normalizeAddress(registryOwner);
  const partnerExists = normalizeAddress(partner.beneficiary) !== zero;
  const beneficiary = partnerExists ? normalizeAddress(partner.beneficiary) : null;
  const beneficiaryMatchesOwner = beneficiary === owner;
  const builderActive = Boolean(builderRegistered && builderInfo.active);
  const verified = networkChainId === config.CHAIN_ID && contractCodeVerified && governanceAligned &&
    builderActive && partnerExists && partner.active && beneficiaryMatchesOwner;
  const rewardCallerConfigured = Boolean(config.REWARD_CALLER_ADDRESS);
  const submissionReady = verified && rewardCallerConfigured && callerAuthorized;
  let reason: string | null = null;
  if (networkChainId !== config.CHAIN_ID) reason = 'Reward RPC is connected to the wrong chain';
  else if (!contractCodeVerified) reason = 'Configured reward contract bytecode is missing';
  else if (!governanceAligned) reason = 'BuilderRegistry owner and PartnerVault admin do not match';
  else if (!builderActive) reason = 'Seller owner is not active in BuilderRegistry';
  else if (!partnerExists) reason = 'PartnerVault partner does not exist';
  else if (!partner.active) reason = 'PartnerVault partner is not active';
  else if (!beneficiaryMatchesOwner) reason = 'PartnerVault beneficiary does not match seller owner';
  else if (!rewardCallerConfigured) reason = 'Reward caller is not configured';
  else if (!callerAuthorized) reason = 'Configured reward caller is not authorized by PartnerVault';

  return {
    checkedAt: new Date().toISOString(),
    blockNumber,
    chainId: networkChainId,
    contractCodeVerified,
    governanceAligned,
    partnerId,
    builderRegistered: Boolean(builderRegistered),
    builderActive,
    builderName: builderInfo.name || '',
    partnerExists,
    partnerActive: Boolean(partner.active),
    beneficiary,
    beneficiaryMatchesOwner,
    maxAllocationRaw: partner.maxAllocation.toString(),
    rewardAccruedRaw: partner.rewardAccrued.toString(),
    claimedTotalRaw: partner.claimedTotal.toString(),
    vestedRaw: vested.toString(),
    claimableRaw: claimable.toString(),
    rewardCallerConfigured,
    rewardCallerAuthorized: Boolean(callerAuthorized),
    verified,
    submissionReady,
    reason,
  };
}

export async function isWalletAlreadyRewarded(wallet: string, rawPartnerId: string): Promise<boolean> {
  const addresses = requireRewardConfig();
  const partnerId = validatePartnerId(rawPartnerId);
  const provider = new ethers.JsonRpcProvider(config.RPC_URL);
  const partnerVault = new ethers.Contract(addresses.partnerVaultAddress, PARTNER_VAULT_ABI, provider);
  return (partnerVault.walletRewardClaimed(normalizeAddress(wallet), partnerId) as Promise<boolean>)
    .finally(() => provider.destroy());
}
