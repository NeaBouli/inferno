const { createHash } = require("node:crypto");
const { existsSync, readFileSync, readdirSync, statSync } = require("node:fs");
const { join, relative } = require("node:path");

const ROOT = process.cwd();
const DOCS = join(ROOT, "docs");
const V6_ASSET = join(DOCS, "assets/vendor/ethers-6.17.0.umd.min.js");
const V5_ASSET = join(DOCS, "assets/vendor/ethers-5.7.2.umd.min.js");
const EXPECTED_SHA256 = "532950515fd29ae9f7a21ceb2b68100815024d7944c3d5a92246d5b900bd703b";
const V6_SRC = "/assets/vendor/ethers-6.17.0.umd.min.js";
const FORWARD_GUIDES = [
  "docs/PARTNER_INTEGRATION_SPEC.md",
  "docs/PRESS_KIT.md",
  "docs/SDK_QUICKSTART.md",
  "docs/STEALTHX_IFR_INTEGRATION.md",
  "docs/TESTNET_GUIDE.md",
];

function filesBelow(directory) {
  return readdirSync(directory).flatMap((name) => {
    const file = join(directory, name);
    return statSync(file).isDirectory() ? filesBelow(file) : [file];
  });
}

const errors = [];
if (!existsSync(V6_ASSET)) errors.push("Missing self-hosted Ethers 6 asset.");
if (existsSync(V5_ASSET)) errors.push("Legacy Ethers 5 asset is still published.");

if (existsSync(V6_ASSET)) {
  const sha = createHash("sha256").update(readFileSync(V6_ASSET)).digest("hex");
  if (sha !== EXPECTED_SHA256) errors.push(`Unexpected Ethers 6 asset SHA-256: ${sha}`);
}

const forbidden = [
  /ethers-5(?:\.|-)/,
  /ethers@5(?:\.|\/)/,
  /cdnjs[^\n"']*ethers/i,
  /unpkg[^\n"']*ethers@5/i,
  /ethers\.providers\./,
  /ethers\.utils\./,
  /ethers\.BigNumber/,
  /ethers\.constants\./,
];

for (const file of filesBelow(DOCS)) {
  if (!/\.(?:html|js)$/.test(file) || file === V6_ASSET) continue;
  const source = readFileSync(file, "utf8");
  const executableText = source.replace(/<[^>]+>/g, "");
  const name = relative(ROOT, file);
  for (const pattern of forbidden) {
    if (pattern.test(source)) errors.push(`${name} contains legacy browser API/reference ${pattern}.`);
  }
  if (/\.(?:toNumber|isZero|gte|gt|lte|lt|eq)\s*\(/.test(executableText)) {
    errors.push(`${name} contains a legacy BigNumber method.`);
  }
  if (file.endsWith(".html") && /<script[^>]+(?:wallet-core|web3-wallet-core)\.js/.test(source) && !source.includes(V6_SRC)) {
    errors.push(`${name} loads wallet-core without the pinned Ethers 6 asset.`);
  }
}

for (const name of FORWARD_GUIDES) {
  const source = readFileSync(join(ROOT, name), "utf8");
  if (/ethers\.providers\.|ethers\.utils\.|ethers\.BigNumber|\.(?:toNumber|isZero|gte|gt|lte|lt|eq)\s*\(/.test(source)) {
    errors.push(`${name} contains a legacy Ethers 5 guide example.`);
  }
}

const serviceWorker = readFileSync(join(DOCS, "web3-sw.js"), "utf8");
if (!serviceWorker.includes('const CACHE_NAME = "ifr-web3-v14"')) {
  errors.push("Web3 service-worker cache was not bumped to v14.");
}
if (!serviceWorker.includes(V6_SRC) || /ethers-5/.test(serviceWorker)) {
  errors.push("Web3 service-worker precache does not exclusively use Ethers 6.");
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log("Browser Ethers 6 gate passed (asset, SHA-256, loaders, APIs, service worker).");
