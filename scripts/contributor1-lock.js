/**
 * contributor1-lock.js
 * Lock contributor IFR in CommitmentVault.
 * 10 tranches × (balance / 10) IFR each — condition: TIME_OR_PRICE (30 days OR price >= P0*2).
 * Tranche size is calculated dynamically from the actual on-chain IFR balance.
 *
 * Usage:
 *   DRY_RUN=true node scripts/contributor1-lock.js
 *   CONTRIBUTOR_ADDR=0x... DRY_RUN=true node scripts/contributor1-lock.js
 *   CONTRIBUTOR_ADDR=0x... MAINNET=true PRIVATE_KEY=0x... node scripts/contributor1-lock.js
 *
 * Env vars:
 *   CONTRIBUTOR_ADDR       contributor address (default: C1)
 *   CONTRIBUTOR1_ADDRESS   alias for CONTRIBUTOR_ADDR
 *   PRIVATE_KEY            signer private key (required for MAINNET=true)
 *   MAINNET_RPC_URL        Ethereum RPC endpoint
 *   DRY_RUN                show calldata only, do not send tx
 *   MAINNET                send real transactions
 */

'use strict';

require('dotenv').config();
const { ethers } = require('ethers');

// ── Addresses ──────────────────────────────────────────────────────────────────
const IFR_TOKEN        = '0x77e99917Eca8539c62F509ED1193ac36580A6e7B';
const COMMITMENT_VAULT = '0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3';
const DEFAULT_CONTRIBUTOR = '0x4f632748460E5277bF8435259cADce440AbAC254'; // C1

// ── Parameters ─────────────────────────────────────────────────────────────────
const IFR_DECIMALS = 9;
const NUM_TRANCHES = 10;

// ConditionType enum (CommitmentVault.sol)
//   0 = TIME_ONLY
//   1 = PRICE_ONLY
//   2 = TIME_OR_PRICE  ← unlock after 30d OR when price >= P0*2
//   3 = TIME_AND_PRICE
const CTYPE_TIME_OR_PRICE = 2;

const UNLOCK_SECONDS = 30 * 24 * 3600; // 30 days
const P0_MULTIPLIER  = 200;            // targetPrice = p0 * 200 / 100 = p0 * 2

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
  const DRY_RUN    = process.env.DRY_RUN === 'true';
  const IS_MAINNET = process.env.MAINNET === 'true';
  const contributor = (
    process.env.CONTRIBUTOR_ADDR ||
    process.env.CONTRIBUTOR1_ADDRESS ||
    DEFAULT_CONTRIBUTOR
  ).toLowerCase();

  const rpcUrl   = process.env.MAINNET_RPC_URL || 'https://ethereum-rpc.publicnode.com';
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

  console.log('=== contributor1-lock.js ===');
  console.log('Mode:', DRY_RUN ? 'DRY_RUN' : IS_MAINNET ? 'MAINNET (LIVE)' : 'DRY_RUN (default)');
  console.log('Contributor:', contributor);
  console.log('CommitmentVault:', COMMITMENT_VAULT);
  console.log('IFR Token:', IFR_TOKEN);
  console.log('');

  // ── On-chain reads ───────────────────────────────────────────────────────────
  const ifr = new ethers.Contract(IFR_TOKEN, ERC20_ABI, provider);
  const cv  = new ethers.Contract(COMMITMENT_VAULT, CV_ABI, provider);

  const [p0, p0Set, cvOwner, totalLocked, ifrBal, cvAllowance, trancheCount] = await Promise.all([
    cv.p0(),
    cv.p0Set(),
    cv.owner(),
    cv.totalLocked(),
    ifr.balanceOf(contributor),
    ifr.allowance(contributor, COMMITMENT_VAULT),
    cv.getTrancheCount(contributor),
  ]);

  console.log('--- CommitmentVault state ---');
  console.log('p0:', p0.toString(), 'wei', '(=', ethers.utils.formatUnits(p0, 9), 'Gwei)');
  console.log('p0Set:', p0Set);
  console.log('owner:', cvOwner);
  console.log('totalLocked:', ethers.utils.formatUnits(totalLocked, IFR_DECIMALS), 'IFR');
  console.log('');
  console.log('--- Contributor state ---');
  console.log('IFR balance:', ethers.utils.formatUnits(ifrBal, IFR_DECIMALS), 'IFR');
  console.log('CV allowance:', ethers.utils.formatUnits(cvAllowance, IFR_DECIMALS), 'IFR');
  console.log('Existing tranches:', trancheCount.toString());
  console.log('');

  if (!p0Set) {
    console.warn('WARNING: p0 not set on CommitmentVault — price conditions will not resolve');
  }

  if (ifrBal.isZero()) {
    console.error('ERROR: IFR balance is 0. Ensure claim() has been called on BootstrapVault first.');
    process.exit(1);
  }

  // ── Dynamic tranche calculation ──────────────────────────────────────────────
  // Split balance evenly into NUM_TRANCHES; last tranche absorbs rounding dust
  const trancheAmount = ifrBal.div(NUM_TRANCHES);
  const lastTranche   = ifrBal.sub(trancheAmount.mul(NUM_TRANCHES - 1));
  const totalLock     = trancheAmount.mul(NUM_TRANCHES - 1).add(lastTranche); // = ifrBal

  console.log('--- Lock plan ---');
  console.log('Tranches:', NUM_TRANCHES);
  console.log('Tranche size (1-9):', ethers.utils.formatUnits(trancheAmount, IFR_DECIMALS), 'IFR');
  console.log('Last tranche (10):', ethers.utils.formatUnits(lastTranche, IFR_DECIMALS), 'IFR');
  console.log('Total to lock:', ethers.utils.formatUnits(totalLock, IFR_DECIMALS), 'IFR');
  console.log('Condition: TIME_OR_PRICE — 30 days OR price >= P0*2');
  console.log('P0 multiplier:', P0_MULTIPLIER, '(=', P0_MULTIPLIER / 100, 'x P0)');
  console.log('');

  // ── Build calldata ───────────────────────────────────────────────────────────
  const now        = Math.floor(Date.now() / 1000);
  const unlockTime = now + UNLOCK_SECONDS;

  const cvIface   = new ethers.utils.Interface(CV_ABI);
  const erc20Iface = new ethers.utils.Interface(ERC20_ABI);

  const approveCalldata = erc20Iface.encodeFunctionData('approve', [COMMITMENT_VAULT, totalLock]);

  const lockCalldatas = [];
  for (let i = 0; i < NUM_TRANCHES; i++) {
    const amount = i === NUM_TRANCHES - 1 ? lastTranche : trancheAmount;
    lockCalldatas.push(cvIface.encodeFunctionData('lock', [
      amount,
      CTYPE_TIME_OR_PRICE,
      unlockTime,
      P0_MULTIPLIER,
    ]));
  }

  console.log('--- Transactions to execute ---');
  console.log('');
  console.log('[TX 0] ERC-20 approve(CommitmentVault,', ethers.utils.formatUnits(totalLock, IFR_DECIMALS), 'IFR)');
  console.log('  to:', IFR_TOKEN);
  console.log('  calldata:', approveCalldata);
  console.log('');

  for (let i = 0; i < NUM_TRANCHES; i++) {
    const amount = i === NUM_TRANCHES - 1 ? lastTranche : trancheAmount;
    console.log('[TX ' + (i + 1) + '] CommitmentVault.lock() — tranche', i);
    console.log('  to:', COMMITMENT_VAULT);
    console.log('  calldata:', lockCalldatas[i]);
    console.log('  decoded: lock(amount=' + ethers.utils.formatUnits(amount, IFR_DECIMALS) +
      ' IFR, cType=TIME_OR_PRICE(2), unlockTime=' + unlockTime + ', p0Multiplier=' + P0_MULTIPLIER + ')');
    console.log('');
  }

  if (DRY_RUN || !IS_MAINNET) {
    console.log('=== DRY_RUN complete — no transactions sent ===');
    return;
  }

  // ── MAINNET execution ────────────────────────────────────────────────────────
  if (!process.env.PRIVATE_KEY) {
    throw new Error('PRIVATE_KEY env var required for MAINNET=true');
  }

  const signer    = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log('Signer:', signer.address);
  console.log('');

  const ifrSigned = ifr.connect(signer);
  const cvSigned  = cv.connect(signer);

  // Step 1: Approve if needed
  if (cvAllowance.lt(totalLock)) {
    console.log('Approving CommitmentVault to spend', ethers.utils.formatUnits(totalLock, IFR_DECIMALS), 'IFR...');
    const approveTx = await ifrSigned.approve(COMMITMENT_VAULT, totalLock);
    console.log('approve tx:', approveTx.hash);
    await approveTx.wait();
    console.log('approve confirmed');
  } else {
    console.log('Allowance already sufficient, skipping approve');
  }

  // Step 2: Lock NUM_TRANCHES tranches
  for (let i = 0; i < NUM_TRANCHES; i++) {
    const amount = i === NUM_TRANCHES - 1 ? lastTranche : trancheAmount;
    console.log('Locking tranche', i, '(' + ethers.utils.formatUnits(amount, IFR_DECIMALS) + ' IFR)...');
    const lockTx = await cvSigned.lock(amount, CTYPE_TIME_OR_PRICE, unlockTime, P0_MULTIPLIER);
    console.log('lock tx:', lockTx.hash);
    await lockTx.wait();
    console.log('tranche', i, 'confirmed');
  }

  const newTrancheCount = await cv.getTrancheCount(contributor);
  const newLocked       = await cv.lockedBalance(contributor);
  console.log('');
  console.log('=== Done ===');
  console.log('Tranches:', newTrancheCount.toString());
  console.log('Locked balance:', ethers.utils.formatUnits(newLocked, IFR_DECIMALS), 'IFR');
}

main().catch((err) => {
  console.error('Fatal:', err.message || err);
  process.exit(1);
});
