/**
 * Generalized contributor CommitmentVault lock script.
 *
 * Default behavior follows the contributor runbook:
 * - reads CONTRIBUTOR_ADDR from env
 * - reads real IFR balance on-chain
 * - creates 10 TIME_ONLY tranches
 * - each tranche is totalLock / 10; the last tranche absorbs rounding dust
 * - unlockTime = now + 30 days
 *
 * Usage:
 *   CONTRIBUTOR_ADDR=0x... DRY_RUN=true node scripts/contributors-lock.js
 *   CONTRIBUTOR_ADDR=0x... PRIVATE_KEY=0x... DRY_RUN=false MAINNET=true node scripts/contributors-lock.js
 *
 * Optional:
 *   LOCK_BPS=5000  lock 50% of current balance instead of 100%
 *   GAS_LIMIT=500000
 */

'use strict';

require('dotenv').config();
const { ethers } = require('ethers');

const IFR_TOKEN = '0x77e99917Eca8539c62F509ED1193ac36580A6e7B';
const COMMITMENT_VAULT = '0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3';

const IFR_DECIMALS = 9;
const NUM_TRANCHES = 10;
const CTYPE_TIME_ONLY = 0;
const UNLOCK_SECONDS = 30 * 24 * 3600;
const P0_MULTIPLIER = 0;

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

const CV_ABI = [
  'function getTrancheCount(address wallet) view returns (uint256)',
  'function lockedBalance(address wallet) view returns (uint256)',
  'function lock(uint256 amount, uint8 cType, uint256 unlockTime, uint256 p0Multiplier)',
];

function envFlag(name, defaultValue) {
  if (process.env[name] == null) return defaultValue;
  return String(process.env[name]).toLowerCase() === 'true';
}

function requireAddress(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return ethers.utils.getAddress(value);
}

function formatIFR(value) {
  return ethers.utils.formatUnits(value, IFR_DECIMALS);
}

async function main() {
  const contributor = requireAddress(process.env.CONTRIBUTOR_ADDR, 'CONTRIBUTOR_ADDR');
  const dryRun = envFlag('DRY_RUN', true);
  const mainnet = envFlag('MAINNET', false);
  const lockBps = Number(process.env.LOCK_BPS || '10000');
  if (!Number.isInteger(lockBps) || lockBps <= 0 || lockBps > 10000) {
    throw new Error('LOCK_BPS must be an integer from 1 to 10000');
  }

  const provider = new ethers.providers.JsonRpcProvider(
    process.env.MAINNET_RPC_URL || 'https://ethereum-rpc.publicnode.com'
  );
  const token = new ethers.Contract(IFR_TOKEN, ERC20_ABI, provider);
  const vault = new ethers.Contract(COMMITMENT_VAULT, CV_ABI, provider);

  const [balance, allowance, existingTranches, lockedBalance] = await Promise.all([
    token.balanceOf(contributor),
    token.allowance(contributor, COMMITMENT_VAULT),
    vault.getTrancheCount(contributor),
    vault.lockedBalance(contributor),
  ]);

  if (balance.isZero()) {
    throw new Error('Contributor IFR balance is 0. Buy/claim IFR before locking.');
  }

  const totalLock = balance.mul(lockBps).div(10000);
  if (totalLock.isZero()) {
    throw new Error('Calculated lock amount is 0');
  }

  const trancheAmount = totalLock.div(NUM_TRANCHES);
  const lastTranche = totalLock.sub(trancheAmount.mul(NUM_TRANCHES - 1));
  const unlockTime = Math.floor(Date.now() / 1000) + UNLOCK_SECONDS;
  const unlockDate = new Date(unlockTime * 1000).toISOString();

  console.log('=== CONTRIBUTORS LOCK PLAN ===');
  console.log('Mode:', dryRun || !mainnet ? 'DRY_RUN' : 'MAINNET LIVE');
  console.log('Contributor:', contributor);
  console.log('IFR balance:', formatIFR(balance));
  console.log('Existing locked balance:', formatIFR(lockedBalance));
  console.log('Existing tranches:', existingTranches.toString());
  console.log('Current allowance -> CommitmentVault:', formatIFR(allowance));
  console.log('LOCK_BPS:', lockBps);
  console.log('Total lock amount:', formatIFR(totalLock));
  console.log('Tranches:', NUM_TRANCHES);
  console.log('Tranche 1-9:', formatIFR(trancheAmount));
  console.log('Tranche 10:', formatIFR(lastTranche));
  console.log('cType: TIME_ONLY (0)');
  console.log('unlockTime:', unlockTime, `(${unlockDate})`);
  console.log('p0Multiplier:', P0_MULTIPLIER);
  console.log('');

  if (lockBps === 10000) {
    console.log('WARNING: LOCK_BPS=10000 locks the full current IFR balance.');
    console.log('         A later LendingVault offer from this same balance will have 0 IFR available.');
    console.log('');
  }

  const cvIface = new ethers.utils.Interface(CV_ABI);
  const erc20Iface = new ethers.utils.Interface(ERC20_ABI);
  console.log('[TX 0] approve CommitmentVault');
  console.log('to:', IFR_TOKEN);
  console.log('data:', erc20Iface.encodeFunctionData('approve', [COMMITMENT_VAULT, totalLock]));
  console.log('');

  const trancheAmounts = [];
  for (let i = 0; i < NUM_TRANCHES; i++) {
    const amount = i === NUM_TRANCHES - 1 ? lastTranche : trancheAmount;
    trancheAmounts.push(amount);
    console.log(`[TX ${i + 1}] lock tranche ${i + 1}/${NUM_TRANCHES}`);
    console.log('to:', COMMITMENT_VAULT);
    console.log('amount:', formatIFR(amount), 'IFR');
    console.log('data:', cvIface.encodeFunctionData('lock', [
      amount,
      CTYPE_TIME_ONLY,
      unlockTime,
      P0_MULTIPLIER,
    ]));
    console.log('');
  }

  if (dryRun || !mainnet) {
    console.log('=== DRY_RUN complete: no transactions sent ===');
    return;
  }

  const signer = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);
  if (ethers.utils.getAddress(signer.address) !== contributor) {
    throw new Error(`PRIVATE_KEY signer ${signer.address} does not match CONTRIBUTOR_ADDR ${contributor}`);
  }

  const overrides = {};
  if (process.env.GAS_LIMIT) overrides.gasLimit = ethers.BigNumber.from(process.env.GAS_LIMIT);

  const tokenWithSigner = token.connect(signer);
  const vaultWithSigner = vault.connect(signer);

  if (allowance.lt(totalLock)) {
    const approveTx = await tokenWithSigner.approve(COMMITMENT_VAULT, totalLock, overrides);
    console.log('approve tx:', approveTx.hash);
    await approveTx.wait();
  }

  for (let i = 0; i < trancheAmounts.length; i++) {
    const tx = await vaultWithSigner.lock(
      trancheAmounts[i],
      CTYPE_TIME_ONLY,
      unlockTime,
      P0_MULTIPLIER,
      overrides
    );
    console.log(`lock tranche ${i + 1} tx:`, tx.hash);
    await tx.wait();
  }

  const [finalTranches, finalLocked] = await Promise.all([
    vault.getTrancheCount(contributor),
    vault.lockedBalance(contributor),
  ]);
  console.log('=== LOCK COMPLETE ===');
  console.log('Final tranches:', finalTranches.toString());
  console.log('Final locked balance:', formatIFR(finalLocked), 'IFR');
}

main().catch((err) => {
  console.error('Fatal:', err.message || err);
  process.exit(1);
});
