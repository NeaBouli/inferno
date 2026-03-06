const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const https = require("https");

// Load .env.mainnet first, then .env as fallback
require("dotenv").config({ path: path.resolve(__dirname, "../.env.mainnet") });
if (!process.env.MAINNET_RPC_URL) {
  require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
}

// ── Config ──────────────────────────────────────────────
const IFR_TOKEN = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const DECIMALS = 9;
const DELAY_MS = 300;

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

// Known function selectors for decoding
const SELECTORS = {
  "0x8ebfc796": "setFeeExempt(address,bool)",
  "0xf2fde38b": "transferOwnership(address)",
  "0x9d481848": "propose(address,bytes)",
  "0xfe0d94c1": "execute(uint256)",
  "0x40e58ee5": "cancel(uint256)",
  "0x095ea7b3": "approve(address,uint256)",
  "0xa9059cbb": "transfer(address,uint256)",
  "0x23b872dd": "transferFrom(address,address,uint256)",
  "0x8456cb59": "pause()",
  "0x3f4ba83a": "unpause()",
  "0xe19a9dd9": "setGuardian(address)",
  "0x13af4035": "setOwner(address)",
  "0x6a42b8f8": "delay()",
};

// Address labels for display
const ALL_LABELS = {};
EOA_WALLETS.forEach((w) => (ALL_LABELS[w.address.toLowerCase()] = w.label));
SAFE_WALLETS.forEach((w) => (ALL_LABELS[w.address.toLowerCase()] = w.label));
CONTRACTS.forEach((w) => (ALL_LABELS[w.address.toLowerCase()] = w.label));

function labelFor(addr) {
  if (!addr) return "—";
  return ALL_LABELS[addr.toLowerCase()] || shortAddr(addr);
}

// ── Helpers ─────────────────────────────────────────────
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}`));
          }
        });
      })
      .on("error", reject);
  });
}

function fmtIFR(raw) {
  return ethers.utils.formatUnits(raw, DECIMALS);
}
function fmtETH(raw) {
  return ethers.utils.formatEther(raw);
}
function fmtNum(str) {
  const num = parseFloat(str);
  if (num === 0) return "0";
  if (num < 0.0001) return "<0.0001";
  return num.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
function shortAddr(addr) {
  if (!addr || addr.length < 10) return addr || "—";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
function tsToDate(ts) {
  return new Date(parseInt(ts) * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}
function tsToCET(ts) {
  const d = new Date(parseInt(ts) * 1000);
  return d.toLocaleString("de-DE", { timeZone: "Europe/Berlin" });
}
function decodeSel(input) {
  if (!input || input.length < 10) return "—";
  const sel = input.slice(0, 10);
  return SELECTORS[sel] || sel;
}

// ── Etherscan V2 API ────────────────────────────────────
async function etherscanGet(params, apiKey) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const url = `https://api.etherscan.io/v2/api?chainid=1&${qs}&apikey=${apiKey}`;
  await wait(DELAY_MS);
  const data = await fetchJSON(url);
  return Array.isArray(data.result) ? data.result : [];
}

// ── Main ────────────────────────────────────────────────
async function main() {
  const rpcUrl = process.env.MAINNET_RPC_URL;
  const etherscanKey = process.env.ETHERSCAN_API_KEY;

  if (!rpcUrl) {
    console.error("ERROR: MAINNET_RPC_URL not set in .env.mainnet or .env");
    process.exit(1);
  }
  if (!etherscanKey) {
    console.error("ERROR: ETHERSCAN_API_KEY not set");
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const blockNum = await provider.getBlockNumber();
  const token = new ethers.Contract(
    IFR_TOKEN,
    [
      "function balanceOf(address) view returns (uint256)",
      "function totalSupply() view returns (uint256)",
    ],
    provider
  );

  const totalSupply = await token.totalSupply();
  const initialSupply = ethers.BigNumber.from("1000000000000000000"); // 1B * 1e9
  const burned = initialSupply.sub(totalSupply);

  console.log(`Block: ${blockNum}`);
  console.log(`Total Supply: ${fmtNum(fmtIFR(totalSupply))} IFR`);
  console.log(`Burned: ${fmtNum(fmtIFR(burned))} IFR\n`);

  // ── 1. Fetch balances ─────────────────────────────────
  async function getBalances(entries, fetchTxCount) {
    const results = [];
    for (const entry of entries) {
      try {
        const calls = [
          provider.getBalance(entry.address),
          token.balanceOf(entry.address),
        ];
        if (fetchTxCount) calls.push(provider.getTransactionCount(entry.address));
        const res = await Promise.all(calls);
        results.push({
          ...entry,
          ethBalance: fmtETH(res[0]),
          ifrBalance: fmtIFR(res[1]),
          ifrRaw: res[1],
          txCount: fetchTxCount ? res[2] : null,
        });
        console.log(
          `  ${entry.label}: ${fmtNum(fmtETH(res[0]))} ETH | ${fmtNum(fmtIFR(res[1]))} IFR${fetchTxCount ? ` | ${res[2]} TXs` : ""}`
        );
      } catch (err) {
        console.error(`  ${entry.label}: ERROR — ${err.message}`);
        results.push({
          ...entry,
          ethBalance: "ERROR",
          ifrBalance: "ERROR",
          ifrRaw: ethers.BigNumber.from(0),
          txCount: null,
        });
      }
    }
    return results;
  }

  console.log("── EOA Wallets ──");
  const eoaResults = await getBalances(EOA_WALLETS, true);
  console.log("\n── Safe Multisigs ──");
  const safeResults = await getBalances(SAFE_WALLETS, false);
  console.log("\n── Smart Contracts ──");
  const contractResults = await getBalances(CONTRACTS, false);

  // ── 2. Contract ownership checks ──────────────────────
  console.log("\n── Ownership Checks ──");
  const ownerAbi = ["function owner() view returns (address)"];
  const guardianAbi = ["function guardian() view returns (address)"];
  const adminAbi = ["function admin() view returns (address)"];
  const govAbi = ["function governance() view returns (address)"];

  const ownershipChecks = [
    { label: "InfernoToken", address: CONTRACTS[0].address, method: "owner", abi: ownerAbi },
    { label: "Governance", address: CONTRACTS[1].address, method: "owner", abi: ownerAbi },
    { label: "IFRLock", address: CONTRACTS[2].address, method: "guardian", abi: guardianAbi },
    { label: "BurnReserve", address: CONTRACTS[3].address, method: "owner", abi: ownerAbi },
    { label: "BuybackVault", address: CONTRACTS[4].address, method: "owner", abi: ownerAbi },
    { label: "PartnerVault", address: CONTRACTS[5].address, method: "admin", abi: adminAbi },
    { label: "FeeRouterV1", address: CONTRACTS[6].address, method: "governance", abi: govAbi },
    { label: "Vesting", address: CONTRACTS[7].address, method: "guardian", abi: guardianAbi },
    { label: "LiquidityReserve", address: CONTRACTS[8].address, method: "owner", abi: ownerAbi },
  ];

  const ownership = [];
  for (const check of ownershipChecks) {
    try {
      const c = new ethers.Contract(check.address, check.abi, provider);
      const result = await c[check.method]();
      ownership.push({ label: check.label, method: check.method, controller: result });
      console.log(`  ${check.label}.${check.method}() = ${labelFor(result)} (${shortAddr(result)})`);
    } catch (err) {
      ownership.push({ label: check.label, method: check.method, controller: "ERROR" });
      console.error(`  ${check.label}: ${err.message}`);
    }
  }

  // ── 3. Governance deep dive ───────────────────────────
  console.log("\n── Governance Deep Dive ──");
  const govContract = new ethers.Contract(
    CONTRACTS[1].address,
    [
      "function proposalCount() view returns (uint256)",
      "function getProposal(uint256) view returns (address target, bytes data, uint256 eta, bool executed, bool cancelled)",
      "function owner() view returns (address)",
      "function guardian() view returns (address)",
      "function delay() view returns (uint256)",
    ],
    provider
  );

  const [proposalCount, govOwner, govGuardian, govDelay] = await Promise.all([
    govContract.proposalCount(),
    govContract.owner(),
    govContract.guardian(),
    govContract.delay(),
  ]);

  console.log(`  Proposal Count: ${proposalCount.toNumber()}`);
  console.log(`  Owner: ${labelFor(govOwner)} (${govOwner})`);
  console.log(`  Guardian: ${labelFor(govGuardian)} (${govGuardian})`);
  console.log(`  Delay: ${govDelay.toNumber()}s (${(govDelay.toNumber() / 3600).toFixed(1)}h)`);

  const proposals = [];
  const count = proposalCount.toNumber();
  for (let i = 0; i < count; i++) {
    try {
      const p = await govContract.getProposal(i);
      const nowTs = Math.floor(Date.now() / 1000);
      let status = "PENDING";
      if (p.cancelled) status = "CANCELLED";
      else if (p.executed) status = "EXECUTED";
      else if (p.eta.toNumber() <= nowTs) status = "READY TO EXECUTE";

      const decoded = decodeSel(p.data);

      proposals.push({
        id: i,
        target: p.target,
        data: p.data,
        decoded,
        eta: p.eta.toNumber(),
        etaDate: tsToDate(p.eta.toNumber()),
        etaCET: tsToCET(p.eta.toNumber()),
        executed: p.executed,
        cancelled: p.cancelled,
        status,
      });

      console.log(
        `  Proposal #${i}: ${status} | Target: ${labelFor(p.target)} | Fn: ${decoded} | ETA: ${tsToCET(p.eta.toNumber())}`
      );
    } catch (err) {
      console.error(`  Proposal #${i}: ERROR — ${err.message}`);
    }
  }

  // ── 4. Etherscan TX histories ─────────────────────────
  console.log("\n── Fetching TX Histories (Etherscan V2) ──");

  // EOA TX histories
  const eoaTxs = {};
  for (const eoa of EOA_WALLETS) {
    try {
      eoaTxs[eoa.address] = await etherscanGet(
        { module: "account", action: "txlist", address: eoa.address, startblock: 0, endblock: 99999999, page: 1, offset: 50, sort: "desc" },
        etherscanKey
      );
      console.log(`  ${eoa.label}: ${eoaTxs[eoa.address].length} TXs`);
    } catch (err) {
      eoaTxs[eoa.address] = [];
      console.error(`  ${eoa.label}: ERROR — ${err.message}`);
    }
  }

  // Safe TX histories
  const safeTxs = {};
  for (const safe of SAFE_WALLETS) {
    try {
      const [normal, internal] = await Promise.all([
        etherscanGet(
          { module: "account", action: "txlist", address: safe.address, startblock: 0, endblock: 99999999, page: 1, offset: 50, sort: "desc" },
          etherscanKey
        ),
        etherscanGet(
          { module: "account", action: "txlistinternal", address: safe.address, startblock: 0, endblock: 99999999, page: 1, offset: 50, sort: "desc" },
          etherscanKey
        ),
      ]);
      safeTxs[safe.address] = { normal, internal };
      console.log(`  ${safe.label}: ${normal.length} normal + ${internal.length} internal`);
    } catch (err) {
      safeTxs[safe.address] = { normal: [], internal: [] };
      console.error(`  ${safe.label}: ERROR — ${err.message}`);
    }
  }

  // EOA IFR token transfers
  const eoaTokenTxs = {};
  for (const eoa of EOA_WALLETS) {
    try {
      eoaTokenTxs[eoa.address] = await etherscanGet(
        { module: "account", action: "tokentx", contractaddress: IFR_TOKEN, address: eoa.address, page: 1, offset: 50, sort: "desc" },
        etherscanKey
      );
      console.log(`  ${eoa.label}: ${eoaTokenTxs[eoa.address].length} IFR transfers`);
    } catch (err) {
      eoaTokenTxs[eoa.address] = [];
    }
  }

  // Contract TX histories + IFR transfers
  console.log("\n── Fetching Contract TX Histories ──");
  const contractTxs = {};
  const contractTokenTxs = {};
  for (const c of CONTRACTS) {
    try {
      contractTxs[c.address] = await etherscanGet(
        { module: "account", action: "txlist", address: c.address, startblock: 0, endblock: 99999999, page: 1, offset: 30, sort: "desc" },
        etherscanKey
      );
      contractTokenTxs[c.address] = await etherscanGet(
        { module: "account", action: "tokentx", contractaddress: IFR_TOKEN, address: c.address, page: 1, offset: 30, sort: "desc" },
        etherscanKey
      );
      console.log(`  ${c.label}: ${contractTxs[c.address].length} TXs + ${contractTokenTxs[c.address].length} token transfers`);
    } catch (err) {
      contractTxs[c.address] = [];
      contractTokenTxs[c.address] = [];
      console.error(`  ${c.label}: ERROR — ${err.message}`);
    }
  }

  // ── 5. IFR Supply Check ───────────────────────────────
  const allResults = [...eoaResults, ...safeResults, ...contractResults];
  let totalTracked = ethers.BigNumber.from(0);
  for (const r of allResults) totalTracked = totalTracked.add(r.ifrRaw);

  let eoaTotal = ethers.BigNumber.from(0);
  for (const r of eoaResults) eoaTotal = eoaTotal.add(r.ifrRaw);
  let safeTotal = ethers.BigNumber.from(0);
  for (const r of safeResults) safeTotal = safeTotal.add(r.ifrRaw);
  let contractTotal = ethers.BigNumber.from(0);
  for (const r of contractResults) contractTotal = contractTotal.add(r.ifrRaw);

  const untracked = totalSupply.sub(totalTracked);

  console.log(`\n── Supply Check ──`);
  console.log(`  Tracked:   ${fmtNum(fmtIFR(totalTracked))} IFR`);
  console.log(`  Supply:    ${fmtNum(fmtIFR(totalSupply))} IFR`);
  console.log(`  Untracked: ${fmtNum(fmtIFR(untracked))} IFR`);
  if (!untracked.isZero()) {
    console.log(`  ⚠ WARNING: ${fmtNum(fmtIFR(untracked))} IFR not accounted for!`);
  }

  // ════════════════════════════════════════════════════════
  //  GENERATE MARKDOWN
  // ════════════════════════════════════════════════════════
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  let md = "";

  md += `# IFR Wallet & Contract Intelligence Report\n\n`;
  md += `**Generated:** ${now} UTC\n`;
  md += `**Block:** ${blockNum}\n`;
  md += `**Network:** Ethereum Mainnet\n`;
  md += `**IFR Token:** [\`${IFR_TOKEN}\`](https://etherscan.io/address/${IFR_TOKEN})\n`;
  md += `**Total Supply:** ${fmtNum(fmtIFR(totalSupply))} IFR\n`;
  md += `**Burned (from 1B):** ${fmtNum(fmtIFR(burned))} IFR\n\n`;

  // ── Action Items ──
  md += `---\n\n## ACTION ITEMS\n\n`;
  const actions = [];
  for (const p of proposals) {
    if (p.status === "READY TO EXECUTE") {
      actions.push(`- **Proposal #${p.id} READY** — \`${p.decoded}\` on ${labelFor(p.target)} — execute now!`);
    } else if (p.status === "PENDING") {
      actions.push(`- **Proposal #${p.id} PENDING** — ETA: ${p.etaCET} CET — \`${p.decoded}\` on ${labelFor(p.target)}`);
    }
  }
  if (govOwner.toLowerCase() !== SAFE_WALLETS[0].address.toLowerCase()) {
    actions.push(`- **Governance Owner** is ${labelFor(govOwner)} (\`${shortAddr(govOwner)}\`) — transfer to Gnosis Safe pending`);
  }
  if (!untracked.isZero()) {
    actions.push(`- **${fmtNum(fmtIFR(untracked))} IFR untracked** — not in any monitored wallet/contract`);
  }
  if (actions.length === 0) {
    md += `No action items.\n\n`;
  } else {
    md += actions.join("\n") + "\n\n";
  }

  // ── 1. EOA Wallets ──
  md += `---\n\n## 1. EOA Wallets\n\n`;
  md += `| Role | Address | ETH | IFR | TX Count |\n`;
  md += `|------|---------|-----|-----|----------|\n`;
  for (const r of eoaResults) {
    md += `| ${r.label} | [\`${shortAddr(r.address)}\`](https://etherscan.io/address/${r.address}) | ${fmtNum(r.ethBalance)} | ${fmtNum(r.ifrBalance)} | ${r.txCount ?? "—"} |\n`;
  }
  md += `\n`;

  // ── 2. Safe Multisigs ──
  md += `## 2. Safe Multisigs\n\n`;
  md += `| Role | Address | ETH | IFR |\n`;
  md += `|------|---------|-----|-----|\n`;
  for (const r of safeResults) {
    md += `| ${r.label} | [\`${shortAddr(r.address)}\`](https://etherscan.io/address/${r.address}) | ${fmtNum(r.ethBalance)} | ${fmtNum(r.ifrBalance)} |\n`;
  }
  md += `\n`;

  // ── 3. Smart Contracts ──
  md += `## 3. Smart Contracts — Balances & Ownership\n\n`;
  md += `| Contract | Address | ETH | IFR | Controller |\n`;
  md += `|----------|---------|-----|-----|------------|\n`;
  for (const r of contractResults) {
    const ow = ownership.find((o) => o.label === r.label);
    const ctrl = ow ? `${ow.method}(): ${labelFor(ow.controller)}` : "—";
    md += `| ${r.label} | [\`${shortAddr(r.address)}\`](https://etherscan.io/address/${r.address}) | ${fmtNum(r.ethBalance)} | ${fmtNum(r.ifrBalance)} | ${ctrl} |\n`;
  }
  md += `\n`;

  // ── 4. Governance Proposals ──
  md += `## 4. Governance — Proposal Overview\n\n`;
  md += `**Owner:** ${labelFor(govOwner)} (\`${govOwner}\`)\n`;
  md += `**Guardian:** ${labelFor(govGuardian)} (\`${govGuardian}\`)\n`;
  md += `**Delay:** ${govDelay.toNumber()}s (${(govDelay.toNumber() / 3600).toFixed(1)}h)\n`;
  md += `**Proposals:** ${count}\n\n`;

  if (count > 0) {
    md += `| ID | Target | Function | ETA (CET) | Status |\n`;
    md += `|----|--------|----------|-----------|--------|\n`;
    for (const p of proposals) {
      md += `| ${p.id} | ${labelFor(p.target)} | \`${p.decoded}\` | ${p.etaCET} | **${p.status}** |\n`;
    }
    md += `\n`;

    // Proposal detail boxes
    for (const p of proposals) {
      md += `### Proposal #${p.id} Detail\n\n`;
      md += `\`\`\`\n`;
      md += `Proposal ID:      ${p.id}\n`;
      md += `Target Contract:  ${labelFor(p.target)} (${p.target})\n`;
      md += `Function:         ${p.decoded}\n`;
      md += `Raw Data:         ${p.data.length > 74 ? p.data.slice(0, 74) + "..." : p.data}\n`;
      md += `ETA:              ${p.etaCET} CET (Unix: ${p.eta})\n`;
      md += `Status:           ${p.status}\n`;
      md += `Executed:         ${p.executed}\n`;
      md += `Cancelled:        ${p.cancelled}\n`;
      if (p.status === "READY TO EXECUTE") {
        md += `ACTION REQUIRED:  Execute now — npx hardhat run scripts/execute-proposal.js --network mainnet\n`;
      } else if (p.status === "PENDING") {
        const remaining = p.eta - Math.floor(Date.now() / 1000);
        const hours = (remaining / 3600).toFixed(1);
        md += `TIME REMAINING:   ~${hours}h\n`;
      }
      md += `\`\`\`\n\n`;
    }
  }

  // ── 5. Deployer TX History ──
  md += `## 5. Deployer Wallet TX History\n\n`;
  const deployerAddr = EOA_WALLETS[0].address.toLowerCase();
  const dTxs = eoaTxs[EOA_WALLETS[0].address] || [];
  if (dTxs.length > 0) {
    md += `| Date | Dir | Counterparty | ETH | Function | TX |\n`;
    md += `|------|-----|--------------|-----|----------|----|\n`;
    for (const tx of dTxs) {
      const isOut = tx.from.toLowerCase() === deployerAddr;
      const dir = isOut ? "OUT" : "IN";
      const cp = isOut ? tx.to : tx.from;
      const ethVal = fmtNum(ethers.utils.formatEther(tx.value || "0"));
      const fn = tx.functionName ? tx.functionName.split("(")[0] : decodeSel(tx.input);
      md += `| ${tsToDate(tx.timeStamp)} | ${dir} | ${labelFor(cp)} [\`${shortAddr(cp)}\`](https://etherscan.io/address/${cp}) | ${ethVal} | ${fn} | [\`${tx.hash.slice(0, 10)}...\`](https://etherscan.io/tx/${tx.hash}) |\n`;
    }
  } else {
    md += `No transactions found.\n`;
  }
  md += `\n`;

  // ── 6. IFR Token Transfers ──
  md += `## 6. IFR Token Transfers\n\n`;
  for (const eoa of EOA_WALLETS) {
    const transfers = eoaTokenTxs[eoa.address] || [];
    if (transfers.length === 0) continue;
    md += `### ${eoa.label} (\`${shortAddr(eoa.address)}\`)\n\n`;
    md += `| Date | Dir | Counterparty | IFR Amount | TX |\n`;
    md += `|------|-----|--------------|------------|----|\n`;
    for (const tx of transfers) {
      const isOut = tx.from.toLowerCase() === eoa.address.toLowerCase();
      const dir = isOut ? "OUT" : "IN";
      const cp = isOut ? tx.to : tx.from;
      const ifrVal = fmtNum(ethers.utils.formatUnits(tx.value || "0", DECIMALS));
      const cpLabel = labelFor(cp);
      md += `| ${tsToDate(tx.timeStamp)} | ${dir} | ${cpLabel} [\`${shortAddr(cp)}\`](https://etherscan.io/address/${cp}) | ${ifrVal} | [\`${tx.hash.slice(0, 10)}...\`](https://etherscan.io/tx/${tx.hash}) |\n`;
    }
    md += `\n`;
  }

  // ── 7. Smart Contract TX Histories ──
  md += `## 7. Smart Contract TX Histories\n\n`;
  for (const c of CONTRACTS) {
    const txs = contractTxs[c.address] || [];
    const tokenTx = contractTokenTxs[c.address] || [];
    if (txs.length === 0 && tokenTx.length === 0) continue;

    md += `### ${c.label} (\`${shortAddr(c.address)}\`)\n\n`;

    if (txs.length > 0) {
      md += `**Function Calls:**\n\n`;
      md += `| Date | Caller | Function | Status | TX |\n`;
      md += `|------|--------|----------|--------|----|\n`;
      for (const tx of txs.slice(0, 20)) {
        const fn = tx.functionName ? tx.functionName.split("(")[0] : decodeSel(tx.input);
        const status = tx.isError === "0" ? "OK" : "FAIL";
        md += `| ${tsToDate(tx.timeStamp)} | ${labelFor(tx.from)} | ${fn} | ${status} | [\`${tx.hash.slice(0, 10)}...\`](https://etherscan.io/tx/${tx.hash}) |\n`;
      }
      md += `\n`;
    }

    if (tokenTx.length > 0) {
      md += `**IFR Token Transfers:**\n\n`;
      md += `| Date | Dir | Counterparty | IFR Amount | TX |\n`;
      md += `|------|-----|--------------|------------|----|\n`;
      for (const tx of tokenTx.slice(0, 20)) {
        const isOut = tx.from.toLowerCase() === c.address.toLowerCase();
        const dir = isOut ? "OUT" : "IN";
        const cp = isOut ? tx.to : tx.from;
        const ifrVal = fmtNum(ethers.utils.formatUnits(tx.value || "0", DECIMALS));
        md += `| ${tsToDate(tx.timeStamp)} | ${dir} | ${labelFor(cp)} | ${ifrVal} | [\`${tx.hash.slice(0, 10)}...\`](https://etherscan.io/tx/${tx.hash}) |\n`;
      }
      md += `\n`;
    }
  }

  // ── 8. IFR Supply Check ──
  md += `## 8. IFR Supply Check\n\n`;
  md += `| Category | IFR Balance |\n`;
  md += `|----------|-------------|\n`;
  for (const r of [...eoaResults, ...safeResults, ...contractResults]) {
    if (r.ifrRaw.isZero()) continue;
    md += `| ${r.label} | ${fmtNum(r.ifrBalance)} |\n`;
  }
  md += `| | |\n`;
  md += `| **EOA Subtotal** | **${fmtNum(fmtIFR(eoaTotal))}** |\n`;
  md += `| **Safe Subtotal** | **${fmtNum(fmtIFR(safeTotal))}** |\n`;
  md += `| **Contract Subtotal** | **${fmtNum(fmtIFR(contractTotal))}** |\n`;
  md += `| **Tracked Total** | **${fmtNum(fmtIFR(totalTracked))}** |\n`;
  md += `| On-Chain Supply | ${fmtNum(fmtIFR(totalSupply))} |\n`;
  md += `| Burned (from 1B) | ${fmtNum(fmtIFR(burned))} |\n`;
  if (!untracked.isZero()) {
    md += `| **Untracked** | **${fmtNum(fmtIFR(untracked))}** |\n`;
  }
  md += `\n`;
  if (untracked.isZero()) {
    md += `**Supply verified: ${fmtNum(fmtIFR(totalTracked))} IFR tracked = ${fmtNum(fmtIFR(totalSupply))} on-chain supply.**\n\n`;
  } else {
    md += `**WARNING: ${fmtNum(fmtIFR(untracked))} IFR unaccounted for.**\n\n`;
  }

  // ── 9. ETH Flow ──
  md += `## 9. ETH Flow Overview\n\n`;
  md += `| From | To | ETH | Purpose |\n`;
  md += `|------|----|-----|---------|\n`;
  for (const tx of dTxs) {
    const ethVal = parseFloat(ethers.utils.formatEther(tx.value || "0"));
    if (ethVal <= 0) continue;
    const isOut = tx.from.toLowerCase() === deployerAddr;
    if (!isOut) continue;
    const fn = tx.functionName ? tx.functionName.split("(")[0] : "ETH transfer";
    md += `| Deployer | ${labelFor(tx.to)} | ${fmtNum(ethers.utils.formatEther(tx.value))} | ${fn} |\n`;
  }
  md += `\n`;

  md += `---\n\n`;
  md += `*Generated by \`scripts/fetch-wallet-report.js\` — re-run anytime for live data.*\n`;
  md += `*Addresses loaded from DEPLOYMENTS.md: ${[...EOA_WALLETS, ...SAFE_WALLETS, ...CONTRACTS].map((e) => e.label).join(", ")}*\n`;

  // ── Write ──
  const outPath = path.resolve(__dirname, "../docs/WALLET_TRANSPARENCY_REPORT.md");
  fs.writeFileSync(outPath, md, "utf-8");
  console.log(`\nReport written to: ${outPath}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
