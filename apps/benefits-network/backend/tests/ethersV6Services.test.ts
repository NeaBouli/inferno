import http from 'node:http';
import { AddressInfo } from 'node:net';
import { ethers } from 'ethers';

const IFR_LOCK = '0x0000000000000000000000000000000000000011';
const IFR_TOKEN = '0x0000000000000000000000000000000000000066';
const COMMITMENT_VAULT = '0x0000000000000000000000000000000000000077';
const PARTNER_VAULT = '0x0000000000000000000000000000000000000022';
const BUILDER_REGISTRY = '0x0000000000000000000000000000000000000033';
const REWARD_CALLER = '0x0000000000000000000000000000000000000044';
const OWNER = '0x0000000000000000000000000000000000000055';
const PARTNER_ID = `0x${'ab'.repeat(32)}`;

const mockConfig = {
  CHAIN_ID: 1,
  RPC_URL: 'http://127.0.0.1:1',
  IFR_TOKEN_ADDRESS: IFR_TOKEN,
  IFRLOCK_ADDRESS: IFR_LOCK,
  COMMITMENT_VAULT_ADDRESS: COMMITMENT_VAULT,
  PARTNER_VAULT_ADDRESS: PARTNER_VAULT,
  BUILDER_REGISTRY_ADDRESS: BUILDER_REGISTRY,
  REWARD_CALLER_ADDRESS: REWARD_CALLER,
  ADMIN_SECRET: 'test-secret-12345',
  DATABASE_URL: 'file:./test.db',
  MAX_ACTIVE_SELLER_BUSINESSES_PER_WALLET: 5,
  PORT: 0,
};

jest.mock('../src/config', () => ({ config: mockConfig }));

import { checkBenefitEligibility, checkLock, initProvider } from '../src/services/ifrLockService';
import {
  getRewardOnChainStatus,
  isWalletAlreadyRewarded,
  toIFRBaseUnits,
} from '../src/services/rewardService';

const coder = ethers.AbiCoder.defaultAbiCoder();
const ifrLockInterface = new ethers.Interface([
  'function isLocked(address user, uint256 minAmount) view returns (bool)',
  'function lockedBalance(address user) view returns (uint256)',
  'function token() view returns (address)',
]);
const tokenInterface = new ethers.Interface([
  'function balanceOf(address account) view returns (uint256)',
]);
const commitmentInterface = new ethers.Interface([
  'function ifrToken() view returns (address)',
  'function getTranches(address wallet) view returns (tuple(uint256 amount,uint8 cType,uint256 unlockTime,uint256 p0Multiplier,bool unlocked,uint256 conditionMetAt)[])',
]);
const partnerInterface = new ethers.Interface([
  'function admin() view returns (address)',
  'function partners(bytes32 partnerId) view returns (address beneficiary, uint256 maxAllocation, uint256 unlockedTotal, uint256 rewardAccrued, uint256 claimedTotal, uint32 vestingStart, uint32 vestingDuration, uint32 cliff, bool active, bool milestonesFinal, uint8 tier)',
  'function claimable(bytes32 partnerId) view returns (uint256)',
  'function vestedAmount(bytes32 partnerId) view returns (uint256)',
  'function walletRewardClaimed(address wallet, bytes32 partnerId) view returns (bool)',
  'function authorizedCaller(address caller) view returns (bool)',
]);
const registryInterface = new ethers.Interface([
  'function owner() view returns (address)',
  'function isBuilder(address wallet) view returns (bool)',
  'function builders(address wallet) view returns (string name, string url, string category, uint256 registeredAt, bool active)',
]);

type RpcState = {
  chainId: number;
  failNextWalletRewardRead: boolean;
  failNextTokenBalanceRead: boolean;
  failNextCommitmentRead: boolean;
  partnerExists: boolean;
  methods: string[];
  callBlockTags: string[];
  walletBalanceRaw: bigint;
  ifrLockBalanceRaw: bigint;
  commitmentToken: string;
  commitmentTranches: Array<[bigint, number, bigint, bigint, boolean, bigint]>;
  missingCodeAddress?: string;
  observedLockThreshold?: bigint;
};

const state: RpcState = {
  chainId: 1,
  failNextWalletRewardRead: false,
  failNextTokenBalanceRead: false,
  failNextCommitmentRead: false,
  partnerExists: true,
  methods: [],
  callBlockTags: [],
  walletBalanceRaw: ethers.parseUnits('1250.000000001', 9),
  ifrLockBalanceRaw: ethers.parseUnits('2500.125', 9),
  commitmentToken: IFR_TOKEN,
  commitmentTranches: [],
};

function encode(types: readonly string[], values: readonly unknown[]) {
  return coder.encode(types, values);
}

function contractCall(to: string, data: string): string {
  const target = to.toLowerCase();
  const selector = data.slice(0, 10);

  if (target === IFR_LOCK.toLowerCase()) {
    if (selector === ifrLockInterface.getFunction('isLocked')!.selector) {
      const [, threshold] = ifrLockInterface.decodeFunctionData('isLocked', data);
      state.observedLockThreshold = threshold;
      return encode(['bool'], [true]);
    }
    if (selector === ifrLockInterface.getFunction('lockedBalance')!.selector) {
      return encode(['uint256'], [state.ifrLockBalanceRaw]);
    }
    if (selector === ifrLockInterface.getFunction('token')!.selector) {
      return encode(['address'], [IFR_TOKEN]);
    }
  }

  if (target === COMMITMENT_VAULT.toLowerCase()) {
    if (state.failNextCommitmentRead) {
      state.failNextCommitmentRead = false;
      throw new Error('Simulated CommitmentVault RPC read failure');
    }
    if (selector === commitmentInterface.getFunction('ifrToken')!.selector) {
      return encode(['address'], [state.commitmentToken]);
    }
    if (selector === commitmentInterface.getFunction('getTranches')!.selector) {
      return commitmentInterface.encodeFunctionResult('getTranches', [state.commitmentTranches]);
    }
  }

  if (target === IFR_TOKEN.toLowerCase()) {
    if (selector === tokenInterface.getFunction('balanceOf')!.selector) {
      if (state.failNextTokenBalanceRead) {
        state.failNextTokenBalanceRead = false;
        throw new Error('Simulated token balance RPC read failure');
      }
      return encode(['uint256'], [state.walletBalanceRaw]);
    }
  }

  if (target === PARTNER_VAULT.toLowerCase()) {
    if (selector === partnerInterface.getFunction('admin')!.selector) {
      return encode(['address'], [OWNER]);
    }
    if (selector === partnerInterface.getFunction('partners')!.selector) {
      return encode(
        ['address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint32', 'uint32', 'uint32', 'bool', 'bool', 'uint8'],
        [
          state.partnerExists ? OWNER : ethers.ZeroAddress,
          ethers.parseUnits('1000000', 9),
          0n,
          ethers.parseUnits('1250', 9),
          ethers.parseUnits('250', 9),
          1n,
          2n,
          0n,
          state.partnerExists,
          false,
          1n,
        ]
      );
    }
    if (selector === partnerInterface.getFunction('vestedAmount')!.selector) {
      return encode(['uint256'], [ethers.parseUnits('1000', 9)]);
    }
    if (selector === partnerInterface.getFunction('claimable')!.selector) {
      return encode(['uint256'], [ethers.parseUnits('750', 9)]);
    }
    if (selector === partnerInterface.getFunction('authorizedCaller')!.selector) {
      return encode(['bool'], [true]);
    }
    if (selector === partnerInterface.getFunction('walletRewardClaimed')!.selector) {
      if (state.failNextWalletRewardRead) {
        state.failNextWalletRewardRead = false;
        throw new Error('Simulated reward RPC read failure');
      }
      return encode(['bool'], [true]);
    }
  }

  if (target === BUILDER_REGISTRY.toLowerCase()) {
    if (selector === registryInterface.getFunction('owner')!.selector) {
      return encode(['address'], [OWNER]);
    }
    if (selector === registryInterface.getFunction('isBuilder')!.selector) {
      return encode(['bool'], [true]);
    }
    if (selector === registryInterface.getFunction('builders')!.selector) {
      return encode(['string', 'string', 'string', 'uint256', 'bool'], ['Verified shop', '', 'retail', 1n, true]);
    }
  }

  throw new Error(`Unexpected contract call ${to} ${selector}`);
}

function rpcResult(request: { method: string; params?: unknown[] }) {
  state.methods.push(request.method);
  if (request.method === 'eth_chainId') return `0x${state.chainId.toString(16)}`;
  if (request.method === 'eth_blockNumber') return '0x10';
  if (request.method === 'eth_getCode') {
    const address = String(request.params?.[0] ?? '');
    return address.toLowerCase() === state.missingCodeAddress?.toLowerCase() ? '0x' : '0x6000';
  }
  if (request.method === 'eth_call') {
    const call = (request.params?.[0] || {}) as { to?: string; data?: string; input?: string };
    state.callBlockTags.push(String(request.params?.[1] ?? ''));
    return contractCall(call.to || '', call.data || call.input || '0x');
  }
  throw new Error(`Unexpected JSON-RPC method ${request.method}`);
}

describe('Ethers v6 service boundaries', () => {
  let rpcServer: http.Server;

  beforeAll(async () => {
    rpcServer = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const answer = (item: { id: number; method: string; params?: unknown[] }) => {
          try {
            return { jsonrpc: '2.0', id: item.id, result: rpcResult(item) };
          } catch (error) {
            return {
              jsonrpc: '2.0',
              id: item.id,
              error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
            };
          }
        };
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(Array.isArray(payload) ? payload.map(answer) : answer(payload)));
      });
    });
    await new Promise<void>((resolve) => rpcServer.listen(0, '127.0.0.1', resolve));
    const address = rpcServer.address() as AddressInfo;
    mockConfig.RPC_URL = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    // Ethers caches completed low-level reads briefly; let those timers settle before handle detection.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await new Promise<void>((resolve, reject) => {
      rpcServer.close((error) => error ? reject(error) : resolve());
    });
  });

  beforeEach(() => {
    state.chainId = 1;
    state.failNextWalletRewardRead = false;
    state.failNextTokenBalanceRead = false;
    state.failNextCommitmentRead = false;
    state.partnerExists = true;
    state.methods = [];
    state.callBlockTags = [];
    state.walletBalanceRaw = ethers.parseUnits('1250.000000001', 9);
    state.ifrLockBalanceRaw = ethers.parseUnits('2500.125', 9);
    state.commitmentToken = IFR_TOKEN;
    state.commitmentTranches = [];
    state.missingCodeAddress = undefined;
    state.observedLockThreshold = undefined;
  });

  it('preserves the IFRLock 9-decimal threshold and bigint balance format', async () => {
    initProvider();
    const result = await checkLock(OWNER, 1000);

    expect(state.observedLockThreshold).toBe(1000n * 10n ** 9n);
    expect(result).toEqual({ eligible: true, lockedAmount: '2500.125' });
    expect(state.callBlockTags).toHaveLength(3);
    expect(new Set(state.callBlockTags)).toEqual(new Set(['0x10']));
    expect(state.methods).not.toContain('eth_sendTransaction');
  });

  it('checks locked and freely held IFR exactly at one block', async () => {
    initProvider();
    const result = await checkBenefitEligibility(OWNER, 1000, 1250);

    expect(state.observedLockThreshold).toBe(1000n * 10n ** 9n);
    expect(result).toEqual({
      eligible: true,
      lockEligible: true,
      heldEligible: true,
      lockedAmount: '2500.125',
      walletAmount: '1250.000000001',
      walletBalanceRaw: ethers.parseUnits('1250.000000001', 9).toString(),
      ifrLockAmount: '2500.125',
      commitmentAmount: null,
      verifiedLockSource: 'ifrlock',
      verificationBlock: 16,
    });
    expect(state.methods).toContain('eth_blockNumber');
    expect(state.callBlockTags).toHaveLength(4);
    expect(new Set(state.callBlockTags)).toEqual(new Set(['0x10']));
    expect(state.methods).not.toContain('eth_sendTransaction');
  });

  it('rejects one base unit below the held threshold without rounding', async () => {
    state.walletBalanceRaw = ethers.parseUnits('1250', 9) - 1n;
    initProvider();

    await expect(checkBenefitEligibility(OWNER, 1000, 1250)).resolves.toMatchObject({
      eligible: false,
      lockEligible: true,
      heldEligible: false,
      walletAmount: '1249.999999999',
      walletBalanceRaw: state.walletBalanceRaw.toString(),
    });
  });

  it('sums only active TIME_ONLY CommitmentVault tranches', async () => {
    state.commitmentTranches = [
      [ethers.parseUnits('600', 9), 0, 100n, 0n, false, 0n],
      [ethers.parseUnits('400', 9), 0, 200n, 0n, false, 0n],
      [ethers.parseUnits('9000', 9), 1, 0n, 200n, false, 0n],
      [ethers.parseUnits('9000', 9), 2, 300n, 200n, false, 0n],
      [ethers.parseUnits('9000', 9), 3, 300n, 200n, false, 0n],
      [ethers.parseUnits('500', 9), 0, 50n, 0n, true, 0n],
    ];
    initProvider();

    await expect(checkBenefitEligibility(OWNER, 1000, 0, 'commitment_time_only'))
      .resolves.toMatchObject({
        eligible: true,
        lockEligible: true,
        heldEligible: true,
        lockedAmount: '1000.0',
        ifrLockAmount: null,
        commitmentAmount: '1000.0',
        verifiedLockSource: 'commitment_time_only',
        verificationBlock: 16,
      });
    expect(state.observedLockThreshold).toBeUndefined();
    expect(state.callBlockTags).toHaveLength(2);
    expect(new Set(state.callBlockTags)).toEqual(new Set(['0x10']));
  });

  it('does not combine partial balances for either-source rules', async () => {
    state.ifrLockBalanceRaw = ethers.parseUnits('600', 9);
    state.commitmentTranches = [
      [ethers.parseUnits('600', 9), 0, 100n, 0n, false, 0n],
    ];
    initProvider();

    await expect(checkBenefitEligibility(OWNER, 1000, 0, 'either'))
      .resolves.toMatchObject({
        eligible: false,
        lockEligible: false,
        ifrLockAmount: '600.0',
        commitmentAmount: '600.0',
        verifiedLockSource: null,
      });
  });

  it('fails closed on CommitmentVault token mismatch, RPC failure, and oversized tranche data', async () => {
    state.commitmentToken = OWNER;
    initProvider();
    await expect(checkBenefitEligibility(OWNER, 1000, 0, 'commitment_time_only'))
      .rejects.toThrow('CommitmentVault token does not match');

    state.commitmentToken = IFR_TOKEN;
    state.failNextCommitmentRead = true;
    initProvider();
    await expect(checkBenefitEligibility(OWNER, 1000, 0, 'commitment_time_only'))
      .rejects.toThrow('missing revert data');

    state.commitmentTranches = Array.from(
      { length: 51 },
      () => [1n, 0, 100n, 0n, false, 0n] as [bigint, number, bigint, bigint, boolean, bigint]
    );
    initProvider();
    await expect(checkBenefitEligibility(OWNER, 1000, 0, 'commitment_time_only'))
      .rejects.toThrow('too many tranches');
  });

  it('fails closed when selected lock or token contract bytecode is missing', async () => {
    state.missingCodeAddress = IFR_TOKEN;
    initProvider();
    await expect(checkBenefitEligibility(OWNER, 1000, 0, 'ifrlock'))
      .rejects.toThrow('IFR token bytecode is missing');

    state.missingCodeAddress = IFR_LOCK;
    initProvider();
    await expect(checkBenefitEligibility(OWNER, 1000, 0, 'ifrlock'))
      .rejects.toThrow('IFRLock bytecode is missing');

    state.missingCodeAddress = COMMITMENT_VAULT;
    initProvider();
    await expect(checkBenefitEligibility(OWNER, 1000, 0, 'commitment_time_only'))
      .rejects.toThrow('CommitmentVault bytecode is missing');
  });

  it('fails closed when the eligibility RPC is on the wrong chain', async () => {
    state.chainId = 2;
    initProvider();
    await expect(checkBenefitEligibility(OWNER, 1000, 0, 'ifrlock'))
      .rejects.toThrow('Eligibility RPC is on chain 2, expected 1');
  });

  it('fails closed when the token balance RPC read fails', async () => {
    state.failNextTokenBalanceRead = true;
    initProvider();

    await expect(checkBenefitEligibility(OWNER, 1000, 1250))
      .rejects.toThrow('missing revert data');
  });

  it('rejects unsafe or non-positive eligibility thresholds before RPC reads', async () => {
    initProvider();

    await expect(checkBenefitEligibility(OWNER, 0, 1250))
      .rejects.toThrow('Required lock threshold must be a positive safe integer');
    await expect(checkBenefitEligibility(OWNER, 1000, Number.MAX_SAFE_INTEGER + 1))
      .rejects.toThrow('Held IFR threshold must be a nonnegative safe integer');
    expect(state.methods).toEqual([]);
  });

  it('maps v6 bigint reward results without changing string API fields', async () => {
    const result = await getRewardOnChainStatus(OWNER, PARTNER_ID);

    expect(result).toMatchObject({
      chainId: 1,
      blockNumber: 16,
      builderRegistered: true,
      builderActive: true,
      builderName: 'Verified shop',
      partnerExists: true,
      partnerActive: true,
      beneficiaryMatchesOwner: true,
      maxAllocationRaw: ethers.parseUnits('1000000', 9).toString(),
      rewardAccruedRaw: ethers.parseUnits('1250', 9).toString(),
      claimedTotalRaw: ethers.parseUnits('250', 9).toString(),
      vestedRaw: ethers.parseUnits('1000', 9).toString(),
      claimableRaw: ethers.parseUnits('750', 9).toString(),
      rewardCallerAuthorized: true,
      verified: true,
      submissionReady: true,
      reason: null,
    });
    expect(state.methods).not.toContain('eth_sendTransaction');
  });

  it('fails reward readiness on the actual RPC chain and on a zero beneficiary', async () => {
    state.chainId = 2;
    const wrongChain = await getRewardOnChainStatus(OWNER, PARTNER_ID);
    expect(wrongChain).toMatchObject({
      chainId: 2,
      verified: false,
      submissionReady: false,
      reason: 'Reward RPC is connected to the wrong chain',
    });

    state.chainId = 1;
    state.partnerExists = false;
    const missingPartner = await getRewardOnChainStatus(OWNER, PARTNER_ID);
    expect(missingPartner).toMatchObject({
      partnerExists: false,
      beneficiary: null,
      verified: false,
      submissionReady: false,
      reason: 'PartnerVault partner does not exist',
    });
  });

  it('keeps reward amount validation and rewarded-wallet reads exact', async () => {
    expect(toIFRBaseUnits('2500.125')).toBe(ethers.parseUnits('2500.125', 9).toString());
    expect(() => toIFRBaseUnits('0')).toThrow('Reward lock amount must be positive');
    expect(() => toIFRBaseUnits('-1')).toThrow('Reward lock amount must be positive');
    await expect(isWalletAlreadyRewarded(OWNER, PARTNER_ID)).resolves.toBe(true);
    expect(state.methods).not.toContain('eth_sendTransaction');
  });

  it('cleans up a failed reward provider before the next read', async () => {
    state.failNextWalletRewardRead = true;

    await expect(isWalletAlreadyRewarded(OWNER, PARTNER_ID))
      .rejects.toMatchObject({ code: 'CALL_EXCEPTION' });
    await expect(isWalletAlreadyRewarded(OWNER, PARTNER_ID)).resolves.toBe(true);
    expect(state.methods).not.toContain('eth_sendTransaction');
  });
});
