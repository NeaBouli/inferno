// scripts/propose_8.js
// Governance Proposal #8 — setOwner(TreasurySafe)
// Transfers Governance ownership from Deployer EOA to 3-of-5 Multisig
// Usage: PRIVATE_KEY=0x... node scripts/propose_8.js
// NEVER commit .env or private keys!
//
// WARNING: After execution, ONLY the 3-of-5 Multisig can create proposals.
// Ensure all 5 signers are reachable before executing!

'use strict';
require('dotenv').config();
const { ethers } = require('ethers');

const GOV_ADDRESS    = '0xc43d48E7FDA576C5022d0670B652A622E8caD041';
const TOKEN_ADDRESS  = '0x77e99917Eca8539c62F509ED1193ac36580A6e7B';
const TREASURY_SAFE  = '0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b';
const DEPLOYER       = '0x6b36687b0cd4386fb14cf565B67D7862110Fed67';

const GOV_ABI = [
  'function propose(address target, bytes calldata data) returns (uint256)',
  'function execute(uint256 proposalId)',
  'function owner() view returns (address)',
  'event ProposalCreated(uint256 indexed proposalId, address target, bytes data, uint256 eta)'
];

async function main() {
  if (!process.env.PRIVATE_KEY) {
    console.error('ERROR: PRIVATE_KEY env var required');
    console.error('Usage: PRIVATE_KEY=0x... node scripts/propose_8.js');
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider(
    process.env.RPC_URL || 'https://ethereum-rpc.publicnode.com'
  );
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log('=== Proposal #8 — setOwner(TreasurySafe) ===');
  console.log('');

  // Safety check 1: Signer must be Deployer
  if (signer.address.toLowerCase() !== DEPLOYER.toLowerCase()) {
    console.error('ERROR: Signer must be Deployer (Governance Owner)');
    console.error('Expected:', DEPLOYER);
    console.error('Got:     ', signer.address);
    process.exit(1);
  }
  console.log('Signer:', signer.address, '(Deployer)');

  const network = await provider.getNetwork();
  console.log('Network:', network.chainId === 1 ? 'Ethereum Mainnet' : 'Chain ' + network.chainId);
  console.log('');

  const gov = new ethers.Contract(GOV_ADDRESS, GOV_ABI, signer);

  // Safety check 2: Current owner
  const currentOwner = await gov.owner();
  console.log('Current Governance Owner:', currentOwner);
  if (currentOwner.toLowerCase() === TREASURY_SAFE.toLowerCase()) {
    console.log('Already transferred to Treasury Safe — nothing to do');
    process.exit(0);
  }
  if (currentOwner.toLowerCase() !== DEPLOYER.toLowerCase()) {
    console.error('ERROR: Governance owner is not Deployer — unexpected state!');
    process.exit(1);
  }
  console.log('Confirmed: Deployer is current owner');
  console.log('');

  // Safety check 3: Proposal #7 executed (Deployer must be feeExempt)
  const token = new ethers.Contract(
    TOKEN_ADDRESS,
    ['function isFeeExempt(address) view returns (bool)'],
    provider
  );
  const deployerExempt = await token.isFeeExempt(DEPLOYER);
  if (!deployerExempt) {
    console.error('ERROR: Proposal #7 not yet executed!');
    console.error('Deployer is NOT feeExempt — execute Proposals #7/#8/#9 first.');
    console.error('See docs/PROPOSAL_7_EXECUTION.md');
    process.exit(1);
  }
  console.log('Proposal #7 verified: Deployer is feeExempt');
  console.log('');

  // Critical warning + abort window
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  CRITICAL WARNING                                ║');
  console.log('║                                                   ║');
  console.log('║  After execution, ONLY Treasury Safe (3-of-5)    ║');
  console.log('║  can create new governance proposals.             ║');
  console.log('║  Deployer loses ALL governance control.           ║');
  console.log('║                                                   ║');
  console.log('║  Ensure ALL 5 signers are reachable:             ║');
  console.log('║  A.K. / M.G. / A.M. / Y.K. / A.P.              ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
  console.log('Proceeding in 15 seconds... Press Ctrl+C to abort.');
  await new Promise(function(r) { setTimeout(r, 15000); });

  // Encode setOwner(TreasurySafe)
  const iface = new ethers.utils.Interface(['function setOwner(address)']);
  const calldata = iface.encodeFunctionData('setOwner', [TREASURY_SAFE]);

  console.log('');
  console.log('Proposing setOwner(TreasurySafe)...');
  console.log('  Target:', GOV_ADDRESS, '(Governance calls itself)');
  console.log('  New Owner:', TREASURY_SAFE, '(Treasury Safe 3-of-5)');
  console.log('  Calldata:', calldata);
  console.log('');

  const tx = await gov.propose(GOV_ADDRESS, calldata);
  console.log('  TX:', tx.hash);
  const receipt = await tx.wait();

  var event = receipt.events.find(function(e) { return e.event === 'ProposalCreated'; });
  if (event) {
    var id = event.args.proposalId.toString();
    var eta = new Date(event.args.eta.toNumber() * 1000);
    console.log('');
    console.log('════════════════════════════════════════');
    console.log('  PROPOSAL SUBMITTED');
    console.log('════════════════════════════════════════');
    console.log('  Proposal ID:', id);
    console.log('  Execute after:', eta.toISOString());
    console.log('');
    console.log('IMPORTANT: Execute ONLY after confirming all 5 signers are reachable.');
    console.log('');
    console.log('Execute command (after ETA):');
    console.log('  PROPOSAL_ID=' + id + ' PRIVATE_KEY=0x... node scripts/execute-proposal.js --network mainnet');
    console.log('');
    console.log('Or via Etherscan Write Contract:');
    console.log('  https://etherscan.io/address/' + GOV_ADDRESS + '#writeContract');
    console.log('  Function: execute(' + id + ')');
    console.log('');
    console.log('Verification after execute:');
    console.log('  https://etherscan.io/address/' + GOV_ADDRESS + '#readContract');
    console.log('  Function: owner() → should return ' + TREASURY_SAFE);
  } else {
    console.log('WARNING: ProposalCreated event not found in receipt');
    console.log('Check TX hash on Etherscan for details.');
  }
}

main().catch(console.error);
