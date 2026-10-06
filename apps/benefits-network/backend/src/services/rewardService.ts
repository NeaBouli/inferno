import { ethers } from 'ethers';
import { config } from '../config';
import { normalizeAddress } from './sellerAuth';

const PARTNER_VAULT_ABI = [
  'function admin() view returns (address)',
  'function partners(bytes32 partnerId) view returns (address beneficiary, uint256 maxAllocation, uint256 unlockedTotal, uint256 rewardAccrued, uint256 claimedTotal, uint32 vestingStart, uint32 vestingDuration, uint32 cliff, bool active, bool milestonesFinal, uint8 tier)',
  'function claimable(bytes32 partnerId) view returns (uint256)',
  'function vestedAmount(bytes32 partnerId) view returns (uint256)',
  'function authorizedCaller(address caller) view returns (bool)',
  'function paused() view returns (bool)',
  'function milestoneDone(bytes32 partnerId, bytes32 milestoneId) view returns (bool)',
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
  expectedBeneficiary: string;
  beneficiaryMatchesOwner: boolean;
  beneficiaryMatchesRewardWallet: boolean;
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
  rawPartnerId: string,
  rewardWallet?: string | null
): Promise<RewardOnChainStatus> {
  const addresses = requireRewardConfig();
  // BuilderRegistry remains bound to the seller owner wallet; the PartnerVault
  // beneficiary must match the confirmed reward wallet, falling back to the
  // owner wallet when no separate reward wallet is set.
  const owner = normalizeAddress(ownerAddress);
  const expectedBeneficiary = rewardWallet ? normalizeAddress(rewardWallet) : owner;
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
  const beneficiaryMatchesRewardWallet = beneficiary === expectedBeneficiary;
  const builderActive = Boolean(builderRegistered && builderInfo.active);
  const verified = networkChainId === config.CHAIN_ID && contractCodeVerified && governanceAligned &&
    builderActive && partnerExists && partner.active && beneficiaryMatchesRewardWallet;
  const rewardCallerConfigured = Boolean(config.REWARD_CALLER_ADDRESS);
  const submissionReady = verified && rewardCallerConfigured && callerAuthorized;
  let reason: string | null = null;
  if (networkChainId !== config.CHAIN_ID) reason = 'Reward RPC is connected to the wrong chain';
  else if (!contractCodeVerified) reason = 'Configured reward contract bytecode is missing';
  else if (!governanceAligned) reason = 'BuilderRegistry owner and PartnerVault admin do not match';
  else if (!builderActive) reason = 'Seller owner is not active in BuilderRegistry';
  else if (!partnerExists) reason = 'PartnerVault partner does not exist';
  else if (!partner.active) reason = 'PartnerVault partner is not active';
  else if (!beneficiaryMatchesRewardWallet) {
    reason = rewardWallet
      ? 'PartnerVault beneficiary does not match the confirmed seller reward wallet'
      : 'PartnerVault beneficiary does not match seller owner';
  }
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
    expectedBeneficiary,
    beneficiaryMatchesOwner,
    beneficiaryMatchesRewardWallet,
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

/**
 * T-231a: the backend stores no customer wallet address, only a keyed fingerprint. The legacy
 * lock-reward path would need the raw address (PartnerVault.walletRewardClaimed(address) and a
 * caller submission), so its events are held as BLOCKED_CALLER with this reason.
 */
export const LOCK_REWARD_PATH_BLOCKED_REASON =
  'Lock-reward path needs a customer wallet address, which this service does not store (T-231a); use Model B settlement';

/**
 * Read-only PartnerVault state for a Model B settlement export (T-275): pause state, pilot partner
 * allocation, usage of every pilot partner for the global budget and whether the milestone identity
 * is already recorded. No transaction is built, signed or sent here.
 */
export async function getModelBVaultState(
  pilotPartnerIds: string[],
  rawPartnerId: string,
  rawMilestoneId: string
): Promise<{
  chainId: number;
  blockNumber: number;
  blockHash: string;
  partnerVault: string;
  governance: string;
  paused: boolean;
  partner: { active: boolean; milestonesFinal: boolean; maxAllocation: bigint; unlockedTotal: bigint; rewardAccrued: bigint };
  pilotUsage: Record<string, bigint>;
  milestoneDone: boolean;
}> {
  const addresses = requireRewardConfig();
  const partnerId = validatePartnerId(rawPartnerId);
  const milestoneId = validatePartnerId(rawMilestoneId);
  const pilots = pilotPartnerIds.map(validatePartnerId);
  const provider = new ethers.JsonRpcProvider(config.RPC_URL);
  const partnerVault = new ethers.Contract(addresses.partnerVaultAddress, PARTNER_VAULT_ABI, provider);
  type PartnerRow = { active: boolean; milestonesFinal: boolean; maxAllocation: bigint; unlockedTotal: bigint; rewardAccrued: bigint };
  try {
    const block = await provider.getBlock('latest');
    if (!block?.hash) throw new Error('Latest block is unavailable');
    const blockTag = block.number;
    const [network, governance, paused, partner, done, usageRows] = await Promise.all([
      provider.getNetwork(),
      partnerVault.admin({ blockTag }) as Promise<string>,
      partnerVault.paused({ blockTag }) as Promise<boolean>,
      partnerVault.partners(partnerId, { blockTag }) as Promise<PartnerRow>,
      partnerVault.milestoneDone(partnerId, milestoneId, { blockTag }) as Promise<boolean>,
      Promise.all(pilots.map((id) => partnerVault.partners(id, { blockTag }) as Promise<PartnerRow>)),
    ]);
    const pilotUsage: Record<string, bigint> = {};
    pilots.forEach((id, index) => {
      pilotUsage[id] = BigInt(usageRows[index].unlockedTotal) + BigInt(usageRows[index].rewardAccrued);
    });
    return {
      chainId: Number(network.chainId),
      blockNumber: block.number,
      blockHash: block.hash,
      partnerVault: normalizeAddress(addresses.partnerVaultAddress),
      governance: normalizeAddress(governance),
      paused: Boolean(paused),
      partner: {
        active: Boolean(partner.active),
        milestonesFinal: Boolean(partner.milestonesFinal),
        maxAllocation: BigInt(partner.maxAllocation),
        unlockedTotal: BigInt(partner.unlockedTotal),
        rewardAccrued: BigInt(partner.rewardAccrued),
      },
      pilotUsage,
      milestoneDone: Boolean(done),
    };
  } finally {
    provider.destroy();
  }
}
