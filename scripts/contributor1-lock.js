/**
 * contributor1-lock.js
 * Lock 100M IFR for Contributor 1 in CommitmentVault.
 * 10 tranches × 10M IFR each — condition: TIME_OR_PRICE (30 days OR price >= P0*2).
 *
 * Usage:
 *   DRY_RUN=true node scripts/contributor1-lock.js
 *   MAINNET=true PRIVATE_KEY=0x... node scripts/contributor1-lock.js
 *
 * Env vars:
 *   CONTRIBUTOR1_ADDRESS   override default on-chain address
 *   PRIVATE_KEY            signer private key (required for MAINNET=true)
 *   MAINNET_RPC_URL        Ethereum RPC endpoint
 *   DRY_RUN                show calldata only, do not send tx
 *   MAINNET                send real transactions
 */

'use strict';

require('dotenv').config();
const { ethers } = require('ethers');

// ── Addresses ──────────────────────────────────────────────────────────────────
const IFR_TOKEN          = '0x77e99917Eca8539c62F509ED1193ac36580A6e7B';
const COMMITMENT_VAULT   = '0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3';
// Contributor 1 — found on-chain from BootstrapVault contributors[0], block 24663703
const DEFAULT_CONTRIBUTOR1 = '0x4f632748460E5277bF8435259cADce440AbAC254';

// ── Parameters ─────────────────────────────────────────────────────────────────
const IFR_DECIMALS   = 9;
const ONE_IFR        = ethers.BigNumber.from(10).pow(IFR_DECIMALS);
const TRANCHE_AMOUNT = ONE_IFR.mul(10_000_000);  // 10M IFR per tranche
const NUM_TRANCHES   = 10;                        // 10 × 10M = 100M IFR
const TOTAL_LOCK     = TRANCHE_AMOUNT.mul(NUM_TRANCHES);

// ConditionType enum (CommitmentVault.sol)
//   0 = TIME_ONLY
//   1 = PRICE_ONLY
//   2 = TIME_OR_PRICE  ← used here
//   3 = TIME_AND_PRICE
const CTYPE_TIME_OR_PRICE = 2;

// Unlock time: 30 days from now
const UNLOCK_SECONDS = 30 * 24 * 3600;

// p0Multiplier: 200 bps → P0 * (200/100) = P0*2
const P0_MULTIPLIER = 200;

// ── ABIs ───────────────────────────────────────────────────────────────────────
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

const CV_ABI = [
  'function p0() view returns (uint256)',
  'function p0Set() view returns (bool)',
  'function owner() view returns (address)',
  'function totalLocked() view returns (uint256)',
  'function getTrancheCount(address wallet) view returns (uint256)',
  'function lockedBalance(address wallet) view returns (uint256)',
  'function lock(uint256 amount, uint8 cType, uint256 unlockTime, uint256 p0Multiplier)',
];

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const DRY_RUN = process.env.DRY_RUN === 'true';
  const IS_MAINNET = process.env.MAINNET === 'true';
  const contributor1 = (process.env.CONTRIBUTOR1_ADDRESS || DEFAULT_CONTRIBUTOR1).toLowerCase();

  const rpcUrl = process.env.MAINNET_RPC_URL || 'https://ethereum-rpc.publicnode.com';
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

  console.log('=== contributor1-lock.js ===');
  console.log('Mode:', DRY_RUN ? 'DRY_RUN' : IS_MAINNET ? 'MAINNET (LIVE)' : 'DRY_RUN (default)');
  console.log('Contributor 1:', contributor1);
  console.log('CommitmentVault:', COMMITMENT_VAULT);
  console.log('IFR Token:', IFR_TOKEN);
  console.log('Tranches:', NUM_TRANCHES, '× 10M IFR = 100M IFR');
  console.log('Condition: TIME_OR_PRICE (2) — 30d unlock OR price >= P0*2');
  console.log('');

  // ── On-chain reads ───────────────────────────────────────────────────────────
  const ifr = new ethers.Contract(IFR_TOKEN, ERC20_ABI, provider);
  const cv  = new ethers.Contract(COMMITMENT_VAULT, CV_ABI, provider);

  const [p0, p0Set, cvOwner, totalLocked, ifrBal, cvAllowance, trancheCount] = await Promise.all([
    cv.p0(),
    cv.p0Set(),
    cv.owner(),
    cv.totalLocked(),
    ifr.balanceOf(contributor1),
    ifr.allowance(contributor1, COMMITMENT_VAULT),
    cv.getTrancheCount(contributor1),
  ]);

  console.log('--- CommitmentVault state ---');
  console.log('p0:', p0.toString(), 'wei', p0Set ? '(SET)' : '(NOT SET)');
  console.log('owner:', cvOwner);
  console.log('totalLocked:', ethers.utils.formatUnits(totalLocked, IFR_DECIMALS), 'IFR');
  console.log('');
  console.log('--- Contributor 1 state ---');
  console.log('IFR balance:', ethers.utils.formatUnits(ifrBal, IFR_DECIMALS), 'IFR');
  console.log('CV allowance:', ethers.utils.formatUnits(cvAllowance, IFR_DECIMALS), 'IFR');
  console.log('Existing tranches:', trancheCount.toString());
  console.log('');

  if (!p0Set) {
    console.warn('WARNING: p0 not set on CommitmentVault — price conditions will not resolve');
  }

  // ── Build calldata ───────────────────────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  const unlockTime = now + UNLOCK_SECONDS;

  const cvIface = new ethers.utils.Interface(CV_ABI);
  const erc20Iface = new ethers.utils.Interface(ERC20_ABI);

  const approveCalldata = erc20Iface.encodeFunctionData('approve', [
    COMMITMENT_VAULT,
    TOTAL_LOCK,
  ]);

  const lockCalldatas = [];
  for (let i = 0; i < NUM_TRANCHES; i++) {
    lockCalldatas.push(cvIface.encodeFunctionData('lock', [
      TRANCHE_AMOUNT,
      CTYPE_TIME_OR_PRICE,
      unlockTime,
      P0_MULTIPLIER,
    ]));
  }

  console.log('--- Transactions to execute ---');
  console.log('');
  console.log('[TX 0] ERC-20 approve(CommitmentVault, 100M IFR)');
  console.log('  to:', IFR_TOKEN);
  console.log('  calldata:', approveCalldata);
  console.log('  decoded: approve(spender=CommitmentVault, amount=100,000,000 IFR)');
  console.log('');

  for (let i = 0; i < NUM_TRANCHES; i++) {
    console.log('[TX ' + (i + 1) + '] CommitmentVault.lock() — tranche', i);
    console.log('  to:', COMMITMENT_VAULT);
    console.log('  calldata:', lockCalldatas[i]);
    console.log('  decoded: lock(amount=10,000,000 IFR, cType=TIME_OR_PRICE(2), unlockTime=' + unlockTime + ', p0Multiplier=200)');
    console.log('');
  }

  // ── Balance checks ───────────────────────────────────────────────────────────
  if (ifrBal.lt(TOTAL_LOCK)) {
    console.warn('WARNING: Contributor 1 IFR balance (' +
      ethers.utils.formatUnits(ifrBal, IFR_DECIMALS) +
      ' IFR) < 100M IFR required. Ensure tokens are claimed/transferred first.');
  }

  if (DRY_RUN || !IS_MAINNET) {
    console.log('=== DRY_RUN complete — no transactions sent ===');
    return;
  }

  // ── MAINNET execution ────────────────────────────────────────────────────────
  if (!process.env.PRIVATE_KEY) {
    throw new Error('PRIVATE_KEY env var required for MAINNET=true');
  }

  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log('Signer:', signer.address);
  console.log('');

  const ifrSigned = ifr.connect(signer);
  const cvSigned  = cv.connect(signer);

  // Step 1: Approve if needed
  if (cvAllowance.lt(TOTAL_LOCK)) {
    console.log('Approving CommitmentVault to spend 100M IFR...');
    const approveTx = await ifrSigned.approve(COMMITMENT_VAULT, TOTAL_LOCK);
    console.log('approve tx:', approveTx.hash);
    await approveTx.wait();
    console.log('approve confirmed');
  } else {
    console.log('Allowance already sufficient, skipping approve');
  }

  // Step 2: Lock 10 tranches
  for (let i = 0; i < NUM_TRANCHES; i++) {
    console.log('Locking tranche', i, '(10M IFR)...');
    const lockTx = await cvSigned.lock(
      TRANCHE_AMOUNT,
      CTYPE_TIME_OR_PRICE,
      unlockTime,
      P0_MULTIPLIER,
    );
    console.log('lock tx:', lockTx.hash);
    await lockTx.wait();
    console.log('tranche', i, 'confirmed');
  }

  const newTrancheCount = await cv.getTrancheCount(contributor1);
  const newLocked = await cv.lockedBalance(contributor1);
  console.log('');
  console.log('=== Done ===');
  console.log('Tranches:', newTrancheCount.toString());
  console.log('Locked balance:', ethers.utils.formatUnits(newLocked, IFR_DECIMALS), 'IFR');
}

main().catch((err) => {
  console.error('Fatal:', err.message || err);
  process.exit(1);
});
