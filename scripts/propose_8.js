// scripts/propose_8.js
// Governance Proposal #8 — setOwner(TreasurySafe)
// Transfers Governance ownership from Deployer EOA to 3-of-5 Multisig
// Usage: PRIVATE_KEY=0x... node scripts/propose_8.js
// NEVER commit .env or private keys!
//
// WARNING: After execution, ONLY the 3-of-5 Multisig can create proposals.
// Ensure all 5 signers are reachable before executing!

require('dotenv').config();
const { ethers } = require('ethers');

const GOV_ADDRESS    = '0xc43d48E7FDA576C5022d0670B652A622E8caD041';
const TREASURY_SAFE  = '0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b';
const DEPLOYER       = '0x6b36687b0cd4386fb14cf565B67D7862110Fed67';

const GOV_ABI = [
  'function propose(address target, bytes calldata data) returns (uint256)',
  'function execute(uint256 proposalId)',
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

  // Verify signer is Deployer
  if (signer.address.toLowerCase() !== DEPLOYER.toLowerCase()) {
    console.error('ERROR: Signer must be Deployer (Governance Owner)');
    process.exit(1);
  }

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  WARNING: This transfers Governance ownership   ║');
  console.log('║  from Deployer EOA to Treasury Safe (3-of-5).   ║');
  console.log('║  After execute: ONLY Multisig can propose.      ║');
  console.log('║  Ensure all 5 signers are reachable!            ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
  console.log('Press Ctrl+C within 10 seconds to abort...');
  await new Promise(function(r) { setTimeout(r, 10000); });

  const network = await provider.getNetwork();
  console.log('Signer: ', signer.address);
  console.log('Network:', network.chainId === 1 ? 'Ethereum Mainnet' : 'Chain ' + network.chainId);
  console.log('New Owner:', TREASURY_SAFE);
  console.log('');

  const gov = new ethers.Contract(GOV_ADDRESS, GOV_ABI, signer);
  const iface = new ethers.utils.Interface(['function setOwner(address)']);
  const calldata = iface.encodeFunctionData('setOwner', [TREASURY_SAFE]);

  console.log('Proposing setOwner(TreasurySafe)...');
  console.log('  Target:', GOV_ADDRESS, '(Governance itself)');
  console.log('  Calldata:', calldata);

  const tx = await gov.propose(GOV_ADDRESS, calldata);
  console.log('  TX:', tx.hash);
  const receipt = await tx.wait();

  const event = receipt.events.find(function(e) { return e.event === 'ProposalCreated'; });
  if (event) {
    const id = event.args.proposalId.toString();
    const eta = new Date(event.args.eta.toNumber() * 1000);
    console.log('  Proposal ID:', id);
    console.log('  Execute after:', eta.toISOString());
    console.log('');
    console.log('IMPORTANT: Execute ONLY after confirming all 5 signers are reachable.');
  }
}

main().catch(console.error);
