const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const https = require("https");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.mainnet") });

// ── Config ──────────────────────────────────────────────
const IFR_TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const DECIMALS = 9;

const EOA_WALLETS = [
  { label: "Deployer", address: "0x6b36687b0cd4386fb14cf565B67D7862110Fed67" },
  { label: "Voucher Signer", address: "0x17F8DD6dECCb3ff5d95691982B85A87d7d9872d4" },
  { label: "Team Beneficiary", address: "0x04FABC52c51d1F8ced6974E7C25a34249b1E6239" },
  { label: "Community EOA", address: "0x61aF4E72C77b58F4b50964Ee93d420750Cd9857E" },
  { label: "Treasury EOA", address: "0xC8f4B45fA0C4727E9b27c13Af3d000C922a2ac9c" },
];

const SAFE_WALLETS = [
  { label: "Gnosis Safe (Treasury)", address: "0x5ad6193eD6E1e31ed10977E73e3B609AcBfEcE3b" },
  { label: "Community Safe", address: "0xaC5687547B2B21d80F8fd345B51e608d476667C7" },
];

const CONTRACTS = [
  { label: "InfernoToken", address: "0x77e99917Eca8539c62F509ED1193ac36580A6e7B" },
  { label: "Governance", address: "0xc43d48E7FDA576C5022d0670B652A622E8caD041" },
  { label: "IFRLock", address: "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb" },
  { label: "BurnReserve", address: "0xaA1496133B6c274190A2113410B501C5802b6fCF" },
  { label: "BuybackVault", address: "0x670D293e3D65f96171c10DdC8d88B96b0570F812" },
  { label: "PartnerVault", address: "0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D" },
  { label: "FeeRouterV1", address: "0x4807B77B2E25cD055DA42B09BA4d0aF9e580C60a" },
  { label: "Vesting", address: "0x2694Bc84e8D5251E9E4Ecd4B2Ae3f866d6106271" },
  { label: "LiquidityReserve", address: "0xdc0309804803b3A105154f6073061E3185018f64" },
  { label: "BootstrapVault", address: "0xA820540936d18e1377C39dd9445E5b36F3F1261a" },
];

// ── Helpers ─────────────────────────────────────────────
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    }).on("error", reject);
  });
}

function fmtIFR(raw) {
  return ethers.utils.formatUnits(raw, DECIMALS);
}

function fmtETH(raw) {
  return ethers.utils.formatEther(raw);
}

function fmtNumber(str) {
  const num = parseFloat(str);
  if (num === 0) return "0";
  if (num < 0.0001) return "<0.0001";
  return num.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function shortAddr(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function unixToDate(ts) {
  return new Date(parseInt(ts) * 1000).toISOString().slice(0, 19).replace("T", " ");
}

// ── Main ────────────────────────────────────────────────
async function main() {
  const rpcUrl = process.env.MAINNET_RPC_URL;
  const etherscanKey = process.env.ETHERSCAN_API_KEY;

  if (!rpcUrl) {
    console.error("ERROR: MAINNET_RPC_URL not set in .env.mainnet");
    process.exit(1);
  }
  if (!etherscanKey) {
    console.error("ERROR: ETHERSCAN_API_KEY not set in .env.mainnet");
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const token = new ethers.Contract(IFR_TOKEN, [
    "function balanceOf(address) view returns (uint256)",
    "function totalSupply() view returns (uint256)",
  ], provider);

  const totalSupply = await token.totalSupply();
  console.log(`Total IFR Supply: ${fmtIFR(totalSupply)}\n`);

  // ── Fetch balances for all addresses ──
  async function getBalances(entries) {
    const results = [];
    for (const entry of entries) {
      const [ethBal, ifrBal] = await Promise.all([
        provider.getBalance(entry.address),
        token.balanceOf(entry.address),
      ]);
      results.push({
        ...entry,
        ethBalance: fmtETH(ethBal),
        ifrBalance: fmtIFR(ifrBal),
        ifrRaw: ifrBal,
      });
      console.log(`  ${entry.label}: ${fmtNumber(fmtETH(ethBal))} ETH | ${fmtNumber(fmtIFR(ifrBal))} IFR`);
    }
    return results;
  }

  console.log("── EOA Wallets ──");
  const eoaResults = await getBalances(EOA_WALLETS);

  console.log("\n── Safe Multisigs ──");
  const safeResults = await getBalances(SAFE_WALLETS);

  console.log("\n── Smart Contracts ──");
  const contractResults = await getBalances(CONTRACTS);

  // ── Fetch TX history for EOAs ──
  console.log("\n── Fetching TX histories (Etherscan API) ──");
  const BASE = "https://api.etherscan.io/v2/api?chainid=1";

  const eoaTxHistory = {};
  for (const eoa of EOA_WALLETS) {
    await delay(200);
    const url = `${BASE}&module=account&action=txlist&address=${eoa.address}&startblock=0&endblock=99999999&page=1&offset=20&sort=desc&apikey=${etherscanKey}`;
    const data = await fetchJSON(url);
    const txList = Array.isArray(data.result) ? data.result : [];
    eoaTxHistory[eoa.address] = txList.filter(
      (tx) => tx.value !== "0" || tx.input !== "0x"
    );
    console.log(`  ${eoa.label}: ${txList.length} TXs`);
  }

  // ── Fetch IFR token transfers for EOAs ──
  console.log("\n── Fetching IFR Token Transfers ──");
  const eoaTokenTx = {};
  for (const eoa of EOA_WALLETS) {
    await delay(200);
    const url = `${BASE}&module=account&action=tokentx&contractaddress=${IFR_TOKEN}&address=${eoa.address}&page=1&offset=20&sort=desc&apikey=${etherscanKey}`;
    const data = await fetchJSON(url);
    const tokenList = Array.isArray(data.result) ? data.result : [];
    eoaTokenTx[eoa.address] = tokenList;
    console.log(`  ${eoa.label}: ${tokenList.length} IFR transfers`);
  }

  // ── Calculate totals ──
  const allResults = [...eoaResults, ...safeResults, ...contractResults];
  let totalIFR = ethers.BigNumber.from(0);
  for (const r of allResults) {
    totalIFR = totalIFR.add(r.ifrRaw);
  }
  const burned = totalSupply.sub(totalIFR).lt(0)
    ? ethers.BigNumber.from(0)
    : ethers.BigNumber.from("1000000000000000000").sub(totalSupply);

  console.log(`\n── Summary ──`);
  console.log(`  Total IFR in tracked wallets: ${fmtNumber(fmtIFR(totalIFR))}`);
  console.log(`  Total Supply (on-chain):      ${fmtNumber(fmtIFR(totalSupply))}`);
  console.log(`  Burned from initial 1B:       ${fmtNumber(fmtIFR(ethers.BigNumber.from("1000000000000000000").sub(totalSupply)))}`);

  // ── Generate Markdown ─────────────────────────────────
  const now = new Date().toISOString().slice(0, 10);
  let md = `# Inferno ($IFR) — Wallet Transparency Report\n\n`;
  md += `**Generated:** ${now}\n`;
  md += `**Network:** Ethereum Mainnet\n`;
  md += `**IFR Token:** [\`${IFR_TOKEN}\`](https://etherscan.io/address/${IFR_TOKEN})\n`;
  md += `**Total Supply:** ${fmtNumber(fmtIFR(totalSupply))} IFR (of 1,000,000,000 initial)\n`;
  md += `**Burned:** ${fmtNumber(fmtIFR(ethers.BigNumber.from("1000000000000000000").sub(totalSupply)))} IFR\n\n`;
  md += `---\n\n`;

  // Table 1: EOA Wallets
  md += `## 1. EOA Wallets\n\n`;
  md += `| Role | Address | ETH Balance | IFR Balance |\n`;
  md += `|------|---------|-------------|-------------|\n`;
  for (const r of eoaResults) {
    md += `| ${r.label} | [\`${shortAddr(r.address)}\`](https://etherscan.io/address/${r.address}) | ${fmtNumber(r.ethBalance)} | ${fmtNumber(r.ifrBalance)} |\n`;
  }
  md += `\n`;

  // Table 2: Safe Multisigs
  md += `## 2. Safe Multisigs\n\n`;
  md += `| Role | Address | ETH Balance | IFR Balance |\n`;
  md += `|------|---------|-------------|-------------|\n`;
  for (const r of safeResults) {
    md += `| ${r.label} | [\`${shortAddr(r.address)}\`](https://etherscan.io/address/${r.address}) | ${fmtNumber(r.ethBalance)} | ${fmtNumber(r.ifrBalance)} |\n`;
  }
  md += `\n`;

  // Table 3: Smart Contracts
  md += `## 3. Smart Contracts\n\n`;
  md += `| Contract | Address | ETH Balance | IFR Balance |\n`;
  md += `|----------|---------|-------------|-------------|\n`;
  for (const r of contractResults) {
    md += `| ${r.label} | [\`${shortAddr(r.address)}\`](https://etherscan.io/address/${r.address}) | ${fmtNumber(r.ethBalance)} | ${fmtNumber(r.ifrBalance)} |\n`;
  }
  md += `\n`;

  // Table 4: ETH Transactions from Deployer
  md += `## 4. Deployer ETH Transactions (Recent)\n\n`;
  const deployerTxs = eoaTxHistory[EOA_WALLETS[0].address] || [];
  if (deployerTxs.length > 0) {
    md += `| Date | Direction | Counterparty | ETH Value | TX |\n`;
    md += `|------|-----------|--------------|-----------|----|\n`;
    for (const tx of deployerTxs.slice(0, 20)) {
      const isOut = tx.from.toLowerCase() === EOA_WALLETS[0].address.toLowerCase();
      const dir = isOut ? "OUT" : "IN";
      const counterparty = isOut ? tx.to : tx.from;
      const ethVal = ethers.utils.formatEther(tx.value || "0");
      md += `| ${unixToDate(tx.timeStamp)} | ${dir} | [\`${shortAddr(counterparty)}\`](https://etherscan.io/address/${counterparty}) | ${fmtNumber(ethVal)} | [\`${tx.hash.slice(0, 10)}...\`](https://etherscan.io/tx/${tx.hash}) |\n`;
    }
  } else {
    md += `No transactions found.\n`;
  }
  md += `\n`;

  // Table 5: IFR Token Transfers from/to EOA Wallets
  md += `## 5. IFR Token Transfers (Recent per EOA)\n\n`;
  for (const eoa of EOA_WALLETS) {
    const transfers = eoaTokenTx[eoa.address] || [];
    if (transfers.length === 0) continue;
    md += `### ${eoa.label} (\`${shortAddr(eoa.address)}\`)\n\n`;
    md += `| Date | Direction | Counterparty | IFR Amount | TX |\n`;
    md += `|------|-----------|--------------|------------|----|\n`;
    for (const tx of transfers.slice(0, 20)) {
      const isOut = tx.from.toLowerCase() === eoa.address.toLowerCase();
      const dir = isOut ? "OUT" : "IN";
      const counterparty = isOut ? tx.to : tx.from;
      const ifrVal = ethers.utils.formatUnits(tx.value || "0", DECIMALS);
      md += `| ${unixToDate(tx.timeStamp)} | ${dir} | [\`${shortAddr(counterparty)}\`](https://etherscan.io/address/${counterparty}) | ${fmtNumber(ifrVal)} | [\`${tx.hash.slice(0, 10)}...\`](https://etherscan.io/tx/${tx.hash}) |\n`;
    }
    md += `\n`;
  }

  // Summary
  md += `## 6. Balance Summary\n\n`;
  md += `| Category | IFR Total |\n`;
  md += `|----------|-----------|\n`;
  let eoaTotal = ethers.BigNumber.from(0);
  for (const r of eoaResults) eoaTotal = eoaTotal.add(r.ifrRaw);
  let safeTotal = ethers.BigNumber.from(0);
  for (const r of safeResults) safeTotal = safeTotal.add(r.ifrRaw);
  let contractTotal = ethers.BigNumber.from(0);
  for (const r of contractResults) contractTotal = contractTotal.add(r.ifrRaw);
  md += `| EOA Wallets | ${fmtNumber(fmtIFR(eoaTotal))} |\n`;
  md += `| Safe Multisigs | ${fmtNumber(fmtIFR(safeTotal))} |\n`;
  md += `| Smart Contracts | ${fmtNumber(fmtIFR(contractTotal))} |\n`;
  md += `| **Tracked Total** | **${fmtNumber(fmtIFR(totalIFR))}** |\n`;
  md += `| On-Chain Supply | ${fmtNumber(fmtIFR(totalSupply))} |\n`;
  md += `| Burned (from 1B) | ${fmtNumber(fmtIFR(ethers.BigNumber.from("1000000000000000000").sub(totalSupply)))} |\n`;
  md += `\n---\n\n`;
  md += `*Generated by \`scripts/fetch-wallet-report.js\` — re-run anytime for live data.*\n`;

  // ── Write file ──
  const outPath = path.resolve(__dirname, "../docs/WALLET_TRANSPARENCY_REPORT.md");
  fs.writeFileSync(outPath, md, "utf-8");
  console.log(`\nReport written to: ${outPath}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
