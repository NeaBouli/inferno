/**
 * contributor1-lending-allowance.js
 * Set up Contributor 1 as a lender in LendingVault with 50M IFR.
 *
 * LendingVault has no setLendingAllowance() — lenders participate by:
 *   1. approve(LendingVault, 50M IFR)  — ERC-20 approval
 *   2. createOffer(50M IFR)            — deposit IFR, create lending offer
 *
 * Anyone can call createOffer(). No owner restriction.
 *
 * Usage:
 *   DRY_RUN=true node scripts/contributor1-lending-allowance.js
 *   MAINNET=true PRIVATE_KEY=0x... node scripts/contributor1-lending-allowance.js
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
const IFR_TOKEN      = '0x77e99917Eca8539c62F509ED1193ac36580A6e7B';
const LENDING_VAULT  = '0x974305Ab0EC905172e697271C3d7d385194EB9DF';
// Contributor 1 — BootstrapVault contributors[0], block 24663703
const DEFAULT_CONTRIBUTOR1 = '0x4f632748460E5277bF8435259cADce440AbAC254';

// ── Parameters ─────────────────────────────────────────────────────────────────
const IFR_DECIMALS    = 9;
const ONE_IFR         = ethers.BigNumber.from(10).pow(IFR_DECIMALS);
const LENDING_AMOUNT  = ONE_IFR.mul(50_000_000); // 50M IFR

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
  const DRY_RUN = process.env.DRY_RUN === 'true';
  const IS_MAINNET = process.env.MAINNET === 'true';
  const contributor1 = (process.env.CONTRIBUTOR1_ADDRESS || DEFAULT_CONTRIBUTOR1).toLowerCase();

  const rpcUrl = process.env.MAINNET_RPC_URL || 'https://ethereum-rpc.publicnode.com';
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

  console.log('=== contributor1-lending-allowance.js ===');
  console.log('Mode:', DRY_RUN ? 'DRY_RUN' : IS_MAINNET ? 'MAINNET (LIVE)' : 'DRY_RUN (default)');
  console.log('Contributor 1:', contributor1);
  console.log('LendingVault:', LENDING_VAULT);
  console.log('IFR Token:', IFR_TOKEN);
  console.log('Lending amount: 50M IFR');
  console.log('');
  console.log('NOTE: LendingVault has no setLendingAllowance().');
  console.log('      Lending is done via createOffer(amount) — permissionless, callable by anyone.');
  console.log('      Steps: (1) approve(LendingVault, 50M IFR) + (2) createOffer(50M IFR)');
  console.log('');

  // ── On-chain reads ───────────────────────────────────────────────────────────
  const ifr = new ethers.Contract(IFR_TOKEN, ERC20_ABI, provider);
  const lv  = new ethers.Contract(LENDING_VAULT, LV_ABI, provider);

  const [lvOwner, ifrBal, lvAllowance, hasOffer, totalAvailable, totalLent, interestRate] = await Promise.all([
    lv.owner(),
    ifr.balanceOf(contributor1),
    ifr.allowance(contributor1, LENDING_VAULT),
    lv.hasOffer(contributor1),
    lv.totalAvailable(),
    lv.totalLent(),
    lv.getInterestRate(),
  ]);

  console.log('--- LendingVault state ---');
  console.log('owner:', lvOwner);
  console.log('totalAvailable:', ethers.utils.formatUnits(totalAvailable, IFR_DECIMALS), 'IFR');
  console.log('totalLent:', ethers.utils.formatUnits(totalLent, IFR_DECIMALS), 'IFR');
  console.log('interestRate:', interestRate.toString(), 'bps/month (', interestRate.toNumber() / 100, '% /month)');
  console.log('');
  console.log('--- Contributor 1 state ---');
  console.log('IFR balance:', ethers.utils.formatUnits(ifrBal, IFR_DECIMALS), 'IFR');
  console.log('LV allowance:', ethers.utils.formatUnits(lvAllowance, IFR_DECIMALS), 'IFR');
  console.log('Has existing offer:', hasOffer);

  if (hasOffer) {
    const offerIdx = await lv.lenderOfferIndex(contributor1);
    const offer = await lv.offers(offerIdx);
    console.log('  Offer ID:', offerIdx.toString());
    console.log('  Available:', ethers.utils.formatUnits(offer.availableIFR, IFR_DECIMALS), 'IFR');
    console.log('  Lent:', ethers.utils.formatUnits(offer.lentIFR, IFR_DECIMALS), 'IFR');
    console.log('  Active:', offer.active);
  }
  console.log('');

  // ── Build calldata ───────────────────────────────────────────────────────────
  const lvIface   = new ethers.utils.Interface(LV_ABI);
  const erc20Iface = new ethers.utils.Interface(ERC20_ABI);

  const approveCalldata = erc20Iface.encodeFunctionData('approve', [
    LENDING_VAULT,
    LENDING_AMOUNT,
  ]);

  const offerCalldata = hasOffer
    ? lvIface.encodeFunctionData('increaseOffer', [LENDING_AMOUNT])
    : lvIface.encodeFunctionData('createOffer', [LENDING_AMOUNT]);

  const offerFnName = hasOffer ? 'increaseOffer' : 'createOffer';

  console.log('--- Transactions to execute ---');
  console.log('');
  console.log('[TX 0] ERC-20 approve(LendingVault, 50M IFR)');
  console.log('  to:', IFR_TOKEN);
  console.log('  calldata:', approveCalldata);
  console.log('  decoded: approve(spender=LendingVault, amount=50,000,000 IFR)');
  console.log('');
  console.log('[TX 1] LendingVault.' + offerFnName + '(50M IFR)');
  console.log('  to:', LENDING_VAULT);
  console.log('  calldata:', offerCalldata);
  console.log('  decoded:', offerFnName + '(amount=50,000,000 IFR)');
  console.log('  access: permissionless — any address can call createOffer()');
  console.log('');

  // ── Balance check ─────────────────────────────────────────────────────────────
  if (ifrBal.lt(LENDING_AMOUNT)) {
    console.warn('WARNING: Contributor 1 IFR balance (' +
      ethers.utils.formatUnits(ifrBal, IFR_DECIMALS) +
      ' IFR) < 50M IFR required. Ensure tokens are claimed/transferred first.');
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
  const lvSigned  = lv.connect(signer);

  // Step 1: Approve if needed
  if (lvAllowance.lt(LENDING_AMOUNT)) {
    console.log('Approving LendingVault to spend 50M IFR...');
    const approveTx = await ifrSigned.approve(LENDING_VAULT, LENDING_AMOUNT);
    console.log('approve tx:', approveTx.hash);
    await approveTx.wait();
    console.log('approve confirmed');
  } else {
    console.log('Allowance already sufficient, skipping approve');
  }

  // Step 2: Create or increase offer
  if (hasOffer) {
    console.log('Increasing existing offer by 50M IFR...');
    const tx = await lvSigned.increaseOffer(LENDING_AMOUNT);
    console.log('increaseOffer tx:', tx.hash);
    await tx.wait();
    console.log('increaseOffer confirmed');
  } else {
    console.log('Creating new lending offer with 50M IFR...');
    const tx = await lvSigned.createOffer(LENDING_AMOUNT);
    console.log('createOffer tx:', tx.hash);
    await tx.wait();
    console.log('createOffer confirmed');
  }

  const newOfferIdx = await lv.lenderOfferIndex(contributor1);
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
