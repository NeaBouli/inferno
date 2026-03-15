// scripts/propose_7.js
// Governance Proposal #7 — setFeeExempt(Deployer + TreasurySafe + CommunitySafe)
// Usage: PRIVATE_KEY=0x... node scripts/propose_7.js
// NEVER commit .env or private keys!

require('dotenv').config();
const { ethers } = require('ethers');

const GOV_ADDRESS   = '0xc43d48E7FDA576C5022d0670B652A622E8caD041';
const TOKEN_ADDRESS = '0x77e99917Eca8539c62F509ED1193ac36580A6e7B';
const DEPLOYER      = '0x6b36687b0cd4386fb14cf565B67D7862110Fed67';

const GOV_ABI = [
  'function propose(address target, bytes calldata data) returns (uint256)',
  'function execute(uint256 proposalId)',
  'event ProposalCreated(uint256 indexed proposalId, address target, bytes data, uint256 eta)'
];

const TARGETS = [
  { name: 'Deployer EOA',   address: '0x6b36687b0cd4386fb14cf565B67D7862110Fed67' },
  { name: 'Treasury Safe',  address: '0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b' },
  { name: 'Community Safe', address: '0xaC5687547B2B21d80F8fd345B51e608d476667C7' }
];

async function main() {
  if (!process.env.PRIVATE_KEY) {
    console.error('ERROR: PRIVATE_KEY env var required');
    console.error('Usage: PRIVATE_KEY=0x... node scripts/propose_7.js');
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider(
    process.env.RPC_URL || 'https://ethereum-rpc.publicnode.com'
  );
  const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  // Verify signer is Deployer (Governance Owner)
  if (signer.address.toLowerCase() !== DEPLOYER.toLowerCase()) {
    console.error('ERROR: Signer must be Deployer (Governance Owner)');
    console.error('Expected:', DEPLOYER);
    console.error('Got:     ', signer.address);
    process.exit(1);
  }

  const network = await provider.getNetwork();
  console.log('Signer: ', signer.address);
  console.log('Network:', network.chainId === 1 ? 'Ethereum Mainnet' : `Chain ${network.chainId}`);
  console.log('');

  const gov = new ethers.Contract(GOV_ADDRESS, GOV_ABI, signer);
  const iface = new ethers.utils.Interface(['function setFeeExempt(address,bool)']);
  const results = [];

  for (const t of TARGETS) {
    console.log(`Proposing setFeeExempt(${t.name})...`);
    const calldata = iface.encodeFunctionData('setFeeExempt', [t.address, true]);
    console.log('  Calldata:', calldata);

    const tx = await gov.propose(TOKEN_ADDRESS, calldata);
    console.log('  TX:', tx.hash);
    const receipt = await tx.wait();

    const event = receipt.events.find(function(e) { return e.event === 'ProposalCreated'; });
    if (event) {
      const id = event.args.proposalId.toString();
      const eta = new Date(event.args.eta.toNumber() * 1000);
      console.log('  Proposal ID:', id);
      console.log('  Execute after:', eta.toISOString());
      results.push({ name: t.name, id, eta: eta.toISOString() });
    } else {
      console.log('  WARNING: ProposalCreated event not found in receipt');
    }
    console.log('');
  }

  console.log('════════════════════════════════════════');
  console.log('SAVE THESE PROPOSAL IDs FOR EXECUTE:');
  console.log('════════════════════════════════════════');
  results.forEach(function(r) {
    console.log(r.name + ': ID=' + r.id + ', execute after ' + r.eta);
  });
  console.log('');
  console.log('To execute after 48h:');
  console.log('  node -e "require(\'dotenv\').config();const{ethers}=require(\'ethers\');' +
    'const p=new ethers.providers.JsonRpcProvider(process.env.RPC_URL||\'https://ethereum-rpc.publicnode.com\');' +
    'const s=new ethers.Wallet(process.env.PRIVATE_KEY,p);' +
    'const g=new ethers.Contract(\'' + GOV_ADDRESS + '\',[\'function execute(uint256)\'],s);' +
    'g.execute(PROPOSAL_ID).then(tx=>tx.wait()).then(()=>console.log(\'Done\'))"');
}

main().catch(console.error);
