// scripts/propose-buyback-wiring.js
// Governance Proposals for BuybackController wiring:
//   Proposal A: setFeeExempt(BuybackController, true) on InfernoToken
//   Proposal B: setFeeCollector(BuybackController)    on FeeRouterV1
//
// IMPORTANT: Submit A first. Execute A before submitting B.
//            FeeExempt MUST be active before fees flow to Controller.
//
// Usage: DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/propose-buyback-wiring.js --network mainnet
//        CONTROLLER=0x... DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/propose-buyback-wiring.js --network mainnet

'use strict';
require('dotenv').config();
const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

// ── Mainnet Addresses ────────────────────────────────────────
const GOV_ADDRESS       = '0xc43d48E7FDA576C5022d0670B652A622E8caD041';
const TOKEN_ADDRESS     = '0x77e99917Eca8539c62F509ED1193ac36580A6e7B';
const FEE_ROUTER        = '0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a';

const GOV_ABI = [
  'function propose(address target, bytes calldata data) returns (uint256)',
  'function owner() view returns (address)',
  'event ProposalCreated(uint256 indexed proposalId, address target, bytes data, uint256 eta)',
];

async function main() {
  const [signer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  // Resolve BuybackController address
  let controllerAddress = process.env.CONTROLLER;
  if (!controllerAddress) {
    const deployFile = path.join(__dirname, '..', 'deployments', 'mainnet.json');
    if (fs.existsSync(deployFile)) {
      const data = JSON.parse(fs.readFileSync(deployFile, 'utf8'));
      if (data.BuybackController) {
        controllerAddress = data.BuybackController.address;
      }
    }
  }

  if (!controllerAddress) {
    console.error('ERROR: BuybackController address not found.');
    console.error('Either set CONTROLLER=0x... env var or deploy first.');
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════');
  console.log('  BuybackController Governance Wiring');
  console.log('═══════════════════════════════════════════════');
  console.log('Network:           ', network.chainId === 1 ? 'Ethereum Mainnet' : 'Chain ' + network.chainId);
  console.log('Signer:            ', signer.address);
  console.log('BuybackController: ', controllerAddress);
  console.log('');

  const gov = new ethers.Contract(GOV_ADDRESS, GOV_ABI, signer);

  // Verify signer is Governance owner
  const owner = await gov.owner();
  console.log('Governance Owner:  ', owner);
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    console.log('WARNING: Signer is NOT Governance owner.');
    console.log('If ownership transferred to TreasurySafe, submit via Safe TX builder.');
    console.log('');
    console.log('Safe TX Builder calldata for copy-paste:');
    console.log('');

    const ifaceToken = new ethers.utils.Interface(['function setFeeExempt(address,bool)']);
    const ifaceRouter = new ethers.utils.Interface(['function setFeeCollector(address)']);

    const calldataA = ifaceToken.encodeFunctionData('setFeeExempt', [controllerAddress, true]);
    const calldataB = ifaceRouter.encodeFunctionData('setFeeCollector', [controllerAddress]);

    console.log('── Proposal A: setFeeExempt ────────────────');
    console.log('  Governance.propose(target, data)');
    console.log('  To:     ', GOV_ADDRESS);
    console.log('  target: ', TOKEN_ADDRESS);
    console.log('  data:   ', calldataA);
    console.log('');
    console.log('── Proposal B: setFeeCollector (AFTER A is executed) ──');
    console.log('  Governance.propose(target, data)');
    console.log('  To:     ', GOV_ADDRESS);
    console.log('  target: ', FEE_ROUTER);
    console.log('  data:   ', calldataB);
    console.log('');
    return;
  }

  // ── Proposal A: setFeeExempt ────────────────────────────────
  console.log('Submitting Proposal A: setFeeExempt(BuybackController, true)...');
  const ifaceToken = new ethers.utils.Interface(['function setFeeExempt(address,bool)']);
  const calldataA = ifaceToken.encodeFunctionData('setFeeExempt', [controllerAddress, true]);
  console.log('  Target:  ', TOKEN_ADDRESS, '(InfernoToken)');
  console.log('  Calldata:', calldataA);

  const txA = await gov.propose(TOKEN_ADDRESS, calldataA);
  console.log('  TX:', txA.hash);
  const receiptA = await txA.wait();

  const eventA = receiptA.events.find(function (e) { return e.event === 'ProposalCreated'; });
  let proposalIdA;
  let etaA;
  if (eventA) {
    proposalIdA = eventA.args.proposalId.toString();
    etaA = new Date(eventA.args.eta.toNumber() * 1000);
    console.log('  Proposal ID:', proposalIdA);
    console.log('  Execute after:', etaA.toISOString());
  } else {
    console.log('  WARNING: ProposalCreated event not found');
  }
  console.log('');

  // ── Do NOT submit Proposal B yet ─────────────────────────────
  console.log('═══════════════════════════════════════════════');
  console.log('  PROPOSAL A SUBMITTED');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('  STOP HERE. Do NOT submit Proposal B yet.');
  console.log('');
  console.log('  1. Wait 48h until ETA:', etaA ? etaA.toISOString() : '(check TX)');
  console.log('  2. Execute Proposal A:');
  if (proposalIdA) {
    console.log('     PROPOSAL_ID=' + proposalIdA + ' npx hardhat run scripts/execute-proposal.js --network mainnet');
  }
  console.log('  3. Verify: InfernoToken.feeExempt(' + controllerAddress + ') == true');
  console.log('  4. THEN submit Proposal B:');
  console.log('');

  // Print Proposal B info for later
  const ifaceRouter = new ethers.utils.Interface(['function setFeeCollector(address)']);
  const calldataB = ifaceRouter.encodeFunctionData('setFeeCollector', [controllerAddress]);

  console.log('── Proposal B (submit AFTER A is executed) ──');
  console.log('  Target:  ', FEE_ROUTER, '(FeeRouterV1)');
  console.log('  Calldata:', calldataB);
  console.log('');
  console.log('  Submit manually:');
  console.log('  Governance.propose("' + FEE_ROUTER + '", "' + calldataB + '")');
  console.log('');
  console.log('═══════════════════════════════════════════════');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
