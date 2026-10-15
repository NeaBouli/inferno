const fs = require('node:fs');
const { parseArgs } = require('node:util');
const { Contract, JsonRpcProvider } = require('ethers');
const { loadBallot } = require('../src/forum/ballot');
const { tallyBallot } = require('../src/forum/tally');

const LOCK_ABI = [
  'function lockedBalance(address wallet) view returns (uint256)',
  'function totalLocked() view returns (uint256)',
];

async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      ballot: { type: 'string' },
      'ballots-dir': { type: 'string' },
      votes: { type: 'string' },
      rpc: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  for (const name of ['ballot', 'ballots-dir', 'votes', 'rpc']) {
    if (!values[name]) throw new Error(`Missing required argument --${name}`);
  }
  let url;
  try {
    url = new URL(values.rpc);
  } catch {
    throw new Error('--rpc must be an HTTPS URL');
  }
  if (url.protocol !== 'https:') throw new Error('--rpc must be an HTTPS URL');
  const ballot = loadBallot(values['ballots-dir'], values.ballot);
  const votes = JSON.parse(fs.readFileSync(values.votes, 'utf8'));
  if (!Array.isArray(votes)) throw new Error('Votes must be a JSON array');

  // Detect the static network from eth_chainId, never from the ballot's claim.
  const provider = new JsonRpcProvider(values.rpc, undefined, { staticNetwork: true });
  try {
    const reader = {
      async chainId() {
        return (await provider.getNetwork()).chainId;
      },
      async blockHash(height) {
        const block = await provider.getBlock(height);
        if (!block) throw new Error(`Snapshot block not found at height ${height}`);
        return block.hash;
      },
      async lockedBalance(contract, wallet, height) {
        return new Contract(contract, LOCK_ABI, provider).lockedBalance(wallet, { blockTag: height });
      },
      async totalLocked(contract, height) {
        return new Contract(contract, LOCK_ABI, provider).totalLocked({ blockTag: height });
      },
    };
    return await tallyBallot({ ballot, votes, reader });
  } finally {
    provider.destroy();
  }
}

if (require.main === module) {
  main().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
