const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json') });
const settlement = require('../src/services/modelBSettlement');

function args(argv, allowed) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i].replace(/^--/, '');
    if (!argv[i].startsWith('--') || !allowed.includes(name) || result[name] !== undefined ||
        !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Invalid CLI arguments');
    result[name] = argv[i + 1];
  }
  return result;
}

function required(value, label) {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}

function uint(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)) throw new Error('Invalid integer string');
  const parsed = BigInt(value);
  if (parsed >= 2n ** 256n) throw new Error('Integer exceeds uint256');
  return parsed;
}

function checksum(document) {
  const { reconciliationChecksum, ...content } = document;
  return settlement.canonicalDigest(content);
}

module.exports = { ...settlement, args, required, uint, checksum };
