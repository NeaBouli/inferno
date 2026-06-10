/**
 * contributor1-lending-allowance.js
 * Set up contributor as a lender in LendingVault with 50% of IFR balance.
 * Lending amount is calculated dynamically from the actual on-chain IFR balance.
 *
 * LendingVault has no setLendingAllowance() — lenders participate by:
 *   1. approve(LendingVault, amount)  — ERC-20 approval
 *   2. createOffer(amount)            — deposit IFR, create lending offer
 *      OR increaseOffer(amount)       — if offer already exists
 *
 * Usage:
 *   DRY_RUN=true node scripts/contributor1-lending-allowance.js
 *   CONTRIBUTOR_ADDR=0x... DRY_RUN=true node scripts/contributor1-lending-allowance.js
 *   CONTRIBUTOR_ADDR=0x... MAINNET=true PRIVATE_KEY=0x... node scripts/contributor1-lending-allowance.js
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
const IFR_TOKEN     = '0x77e99917Eca8539c62F509ED1193ac36580A6e7B';
const LENDING_VAULT = '0x974305Ab0EC905172e697271C3d7d385194EB9DF';
const DEFAULT_CONTRIBUTOR = '0x4f632748460E5277bF8435259cADce440AbAC254'; // C1

// ── Parameters ─────────────────────────────────────────────────────────────────
const IFR_DECIMALS    = 9;
const LENDING_SHARE   = 2; // offer 1/2 (50%) of IFR balance

// ── ABIs ───────────────────────────────────────────────────────────────────────
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

const LV_ABI = [
  'function owner() view returns (address)',
  'function hasOffer(address) view returns (bool)',
  'function lenderOfferIndex(address) view returns (uint256)',
  'function offers(uint256) view returns (address lender, uint256 availableIFR, uint256 lentIFR, bool active)',
  'function totalAvailable() view returns (uint256)',
  'function totalLent() view returns (uint256)',
  'function getInterestRate() view returns (uint256)',
  'function createOffer(uint256 amount)',
  'function increaseOffer(uint256 amount)',
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

  console.log('=== contributor1-lending-allowance.js ===');
  console.log('Mode:', DRY_RUN ? 'DRY_RUN' : IS_MAINNET ? 'MAINNET (LIVE)' : 'DRY_RUN (default)');
  console.log('Contributor:', contributor);
  console.log('LendingVault:', LENDING_VAULT);
  console.log('IFR Token:', IFR_TOKEN);
  console.log('');
  console.log('NOTE: LendingVault has no setLendingAllowance().');
  console.log('      Steps: (1) approve(LendingVault, 50% IFR balance) + (2) createOffer(amount)');
  console.log('');

  // ── On-chain reads ───────────────────────────────────────────────────────────
  const ifr = new ethers.Contract(IFR_TOKEN, ERC20_ABI, provider);
  const lv  = new ethers.Contract(LENDING_VAULT, LV_ABI, provider);

  const [lvOwner, ifrBal, lvAllowance, hasOffer, totalAvailable, totalLent, interestRate] = await Promise.all([
    lv.owner(),
    ifr.balanceOf(contributor),
    ifr.allowance(contributor, LENDING_VAULT),
    lv.hasOffer(contributor),
    lv.totalAvailable(),
    lv.totalLent(),
    lv.getInterestRate(),
  ]);

  console.log('--- LendingVault state ---');
  console.log('owner:', lvOwner);
  console.log('totalAvailable:', ethers.utils.formatUnits(totalAvailable, IFR_DECIMALS), 'IFR');
  console.log('totalLent:', ethers.utils.formatUnits(totalLent, IFR_DECIMALS), 'IFR');
  console.log('interestRate:', interestRate.toString(), 'bps/month (' + (interestRate.toNumber() / 100) + '% /month)');
  console.log('');
  console.log('--- Contributor state ---');
  console.log('IFR balance:', ethers.utils.formatUnits(ifrBal, IFR_DECIMALS), 'IFR');
  console.log('LV allowance:', ethers.utils.formatUnits(lvAllowance, IFR_DECIMALS), 'IFR');
  console.log('Has existing offer:', hasOffer);

  if (hasOffer) {
    const offerIdx = await lv.lenderOfferIndex(contributor);
    const offer    = await lv.offers(offerIdx);
    console.log('  Offer ID:', offerIdx.toString());
    console.log('  Available:', ethers.utils.formatUnits(offer.availableIFR, IFR_DECIMALS), 'IFR');
    console.log('  Lent:', ethers.utils.formatUnits(offer.lentIFR, IFR_DECIMALS), 'IFR');
    console.log('  Active:', offer.active);
  }
  console.log('');

  if (ifrBal.isZero()) {
    console.error('ERROR: IFR balance is 0. Ensure claim() has been called on BootstrapVault first.');
    process.exit(1);
  }

  // ── Dynamic lending amount: 50% of IFR balance ───────────────────────────────
  const lendingAmount = ifrBal.div(LENDING_SHARE);

  console.log('--- Lending plan ---');
  console.log('Offer amount (50% of balance):', ethers.utils.formatUnits(lendingAmount, IFR_DECIMALS), 'IFR');
  console.log('');

  // ── Build calldata ───────────────────────────────────────────────────────────
  const lvIface    = new ethers.utils.Interface(LV_ABI);
  const erc20Iface = new ethers.utils.Interface(ERC20_ABI);

  const approveCalldata = erc20Iface.encodeFunctionData('approve', [LENDING_VAULT, lendingAmount]);
  const offerFnName    = hasOffer ? 'increaseOffer' : 'createOffer';
  const offerCalldata  = lvIface.encodeFunctionData(offerFnName, [lendingAmount]);

  console.log('--- Transactions to execute ---');
  console.log('');
  console.log('[TX 0] ERC-20 approve(LendingVault,', ethers.utils.formatUnits(lendingAmount, IFR_DECIMALS), 'IFR)');
  console.log('  to:', IFR_TOKEN);
  console.log('  calldata:', approveCalldata);
  console.log('');
  console.log('[TX 1] LendingVault.' + offerFnName + '(' + ethers.utils.formatUnits(lendingAmount, IFR_DECIMALS) + ' IFR)');
  console.log('  to:', LENDING_VAULT);
  console.log('  calldata:', offerCalldata);
  console.log('  access: permissionless — any address can call createOffer()');
  console.log('');

  if (ifrBal.lt(lendingAmount)) {
    console.warn('WARNING: IFR balance insufficient for lending amount.');
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
  const lvSigned  = lv.connect(signer);

  if (lvAllowance.lt(lendingAmount)) {
    console.log('Approving LendingVault to spend', ethers.utils.formatUnits(lendingAmount, IFR_DECIMALS), 'IFR...');
    const approveTx = await ifrSigned.approve(LENDING_VAULT, lendingAmount);
    console.log('approve tx:', approveTx.hash);
    await approveTx.wait();
    console.log('approve confirmed');
  } else {
    console.log('Allowance already sufficient, skipping approve');
  }

  if (hasOffer) {
    console.log('Increasing existing offer by', ethers.utils.formatUnits(lendingAmount, IFR_DECIMALS), 'IFR...');
    const tx = await lvSigned.increaseOffer(lendingAmount);
    console.log('increaseOffer tx:', tx.hash);
    await tx.wait();
    console.log('increaseOffer confirmed');
  } else {
    console.log('Creating new lending offer with', ethers.utils.formatUnits(lendingAmount, IFR_DECIMALS), 'IFR...');
    const tx = await lvSigned.createOffer(lendingAmount);
    console.log('createOffer tx:', tx.hash);
    await tx.wait();
    console.log('createOffer confirmed');
  }

  const newOfferIdx = await lv.lenderOfferIndex(contributor);
  const newOffer    = await lv.offers(newOfferIdx);
  console.log('');
  console.log('=== Done ===');
  console.log('Offer ID:', newOfferIdx.toString());
  console.log('Available:', ethers.utils.formatUnits(newOffer.availableIFR, IFR_DECIMALS), 'IFR');
}

main().catch((err) => {
  console.error('Fatal:', err.message || err);
  process.exit(1);
});
