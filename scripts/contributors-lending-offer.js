/**
 * Generalized contributor LendingVault offer script.
 *
 * Default behavior follows the contributor runbook:
 * - reads CONTRIBUTOR_ADDR from env
 * - reads real IFR balance on-chain
 * - amount = 50% of current IFR balance
 * - approve(LendingVault, amount)
 * - createOffer(amount) or increaseOffer(amount) when an offer already exists
 *
 * Usage:
 *   CONTRIBUTOR_ADDR=0x... DRY_RUN=true node scripts/contributors-lending-offer.js
 *   CONTRIBUTOR_ADDR=0x... PRIVATE_KEY=0x... DRY_RUN=false MAINNET=true node scripts/contributors-lending-offer.js
 *
 * Optional:
 *   LENDING_BPS=2500  offer 25% of current balance instead of 50%
 *   GAS_LIMIT=500000
 */

'use strict';

require('dotenv').config();
const { ethers } = require('ethers');

const IFR_TOKEN = '0x77e99917Eca8539c62F509ED1193ac36580A6e7B';
const LENDING_VAULT = '0x974305Ab0EC905172e697271C3d7d385194EB9DF';

const IFR_DECIMALS = 9;
const DEFAULT_LENDING_BPS = 5000;

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

const LV_ABI = [
  'function owner() view returns (address)',
  'function hasOffer(address lender) view returns (bool)',
  'function lenderOfferIndex(address lender) view returns (uint256)',
  'function offers(uint256) view returns (address lender, uint256 availableIFR, uint256 lentIFR, bool active)',
  'function totalAvailable() view returns (uint256)',
  'function totalLent() view returns (uint256)',
  'function getInterestRate() view returns (uint256)',
  'function createOffer(uint256 amount)',
  'function increaseOffer(uint256 amount)',
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
  const lendingBps = Number(process.env.LENDING_BPS || String(DEFAULT_LENDING_BPS));
  if (!Number.isInteger(lendingBps) || lendingBps <= 0 || lendingBps > 10000) {
    throw new Error('LENDING_BPS must be an integer from 1 to 10000');
  }

  const provider = new ethers.providers.JsonRpcProvider(
    process.env.MAINNET_RPC_URL || 'https://ethereum-rpc.publicnode.com'
  );
  const token = new ethers.Contract(IFR_TOKEN, ERC20_ABI, provider);
  const vault = new ethers.Contract(LENDING_VAULT, LV_ABI, provider);

  const [
    balance,
    allowance,
    hasOffer,
    totalAvailable,
    totalLent,
    interestRate,
    owner,
  ] = await Promise.all([
    token.balanceOf(contributor),
    token.allowance(contributor, LENDING_VAULT),
    vault.hasOffer(contributor),
    vault.totalAvailable(),
    vault.totalLent(),
    vault.getInterestRate(),
    vault.owner(),
  ]);

  if (balance.isZero()) {
    throw new Error('Contributor IFR balance is 0. Buy/claim IFR before creating a lending offer.');
  }

  const offerAmount = balance.mul(lendingBps).div(10000);
  if (offerAmount.isZero()) {
    throw new Error('Calculated lending amount is 0');
  }

  let offerIndex = null;
  let offer = null;
  if (hasOffer) {
    offerIndex = await vault.lenderOfferIndex(contributor);
    offer = await vault.offers(offerIndex);
  }

  const offerFnName = hasOffer ? 'increaseOffer' : 'createOffer';
  const lvIface = new ethers.utils.Interface(LV_ABI);
  const erc20Iface = new ethers.utils.Interface(ERC20_ABI);

  console.log('=== CONTRIBUTORS LENDING OFFER PLAN ===');
  console.log('Mode:', dryRun || !mainnet ? 'DRY_RUN' : 'MAINNET LIVE');
  console.log('Contributor:', contributor);
  console.log('IFR balance:', formatIFR(balance));
  console.log('Current allowance -> LendingVault:', formatIFR(allowance));
  console.log('LENDING_BPS:', lendingBps);
  console.log('Offer amount:', formatIFR(offerAmount));
  console.log('LendingVault owner:', owner);
  console.log('LendingVault totalAvailable:', formatIFR(totalAvailable));
  console.log('LendingVault totalLent:', formatIFR(totalLent));
  console.log('Interest rate:', interestRate.toString(), 'bps/month');
  console.log('Has existing offer:', hasOffer);
  if (offer) {
    console.log('Existing offer ID:', offerIndex.toString());
    console.log('Existing offer available:', formatIFR(offer.availableIFR));
    console.log('Existing offer lent:', formatIFR(offer.lentIFR));
    console.log('Existing offer active:', offer.active);
  }
  console.log('');
  console.log('NOTE: LendingVault ABI is createOffer(uint256 amount); there is no terms argument.');
  console.log('');

  console.log('[TX 0] approve LendingVault');
  console.log('to:', IFR_TOKEN);
  console.log('data:', erc20Iface.encodeFunctionData('approve', [LENDING_VAULT, offerAmount]));
  console.log('');
  console.log(`[TX 1] ${offerFnName}`);
  console.log('to:', LENDING_VAULT);
  console.log('amount:', formatIFR(offerAmount), 'IFR');
  console.log('data:', lvIface.encodeFunctionData(offerFnName, [offerAmount]));
  console.log('');

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

  if (allowance.lt(offerAmount)) {
    const approveTx = await tokenWithSigner.approve(LENDING_VAULT, offerAmount, overrides);
    console.log('approve tx:', approveTx.hash);
    await approveTx.wait();
  }

  const offerTx = await vaultWithSigner[offerFnName](offerAmount, overrides);
  console.log(`${offerFnName} tx:`, offerTx.hash);
  await offerTx.wait();

  const finalOfferIndex = await vault.lenderOfferIndex(contributor);
  const finalOffer = await vault.offers(finalOfferIndex);
  console.log('=== LENDING OFFER COMPLETE ===');
  console.log('Offer ID:', finalOfferIndex.toString());
  console.log('Available:', formatIFR(finalOffer.availableIFR), 'IFR');
  console.log('Lent:', formatIFR(finalOffer.lentIFR), 'IFR');
  console.log('Active:', finalOffer.active);
}

main().catch((err) => {
  console.error('Fatal:', err.message || err);
  process.exit(1);
});
