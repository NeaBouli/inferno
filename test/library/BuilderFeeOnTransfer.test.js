// Fee-on-transfer accounting for the Builder contract library and the contracts the Builder
// generators emit. IFR charges a transfer fee for non-exempt addresses, so a lock must credit
// the balance delta the contract actually received, never the requested `amount`.
import { expect } from "chai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import hre from "hardhat";
import { connection, ethers } from "../helpers/hardhat.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const IFR_MAINNET = "0x77e99917Eca8539c62F509ED1193ac36580A6e7B";
const FEE_BPS = 500n; // 5 %
const SEVEN_DAYS = 7 * 86400;
const units = (n) => ethers.parseUnits(String(n), 9);
const afterFee = (amount) => amount - (amount * FEE_BPS) / 10_000n;

describe("Builder library — fee-on-transfer accounting", function () {
  let user, governance, token, vault;
  const MIN = units(500);

  beforeEach(async () => {
    [, user, governance] = await ethers.getSigners();
    token = await (await ethers.getContractFactory("MockFeeOnTransferToken")).deploy();
    await token.mint(user.address, units(20000));
    await token.setFeeBps(FEE_BPS);
    vault = await (await ethers.getContractFactory("IFRBuilderVault")).deploy(
      token.target, MIN, SEVEN_DAYS, "FeeProduct", "https://fee.example", governance.address
    );
    await token.connect(user).approve(vault.target, ethers.MaxUint256);
  });

  it("credits, emits and tier-rates exactly the received amount", async () => {
    const amount = units(2200);
    const received = afterFee(amount);
    await expect(vault.connect(user).lock(amount, SEVEN_DAYS))
      .to.emit(vault, "Locked").withArgs(user.address, received, SEVEN_DAYS);
    expect(await vault.lockedAmount(user.address)).to.equal(received);
    expect(await token.balanceOf(vault.target)).to.equal(received);
    expect(await vault.hasAccess(user.address)).to.equal(true);
    // 2200 requested would be tier 2 (>= 2000); 2090 received is still tier 2, 2000 requested would not be.
    expect(await vault.getTier(user.address)).to.equal(2);
  });

  it("does not grant a tier from the requested amount when the fee pushes it below the threshold", async () => {
    await vault.connect(user).lock(units(2000), SEVEN_DAYS);
    expect(await vault.lockedAmount(user.address)).to.equal(units(1900));
    expect(await vault.getTier(user.address)).to.equal(1);
  });

  it("unlock returns only what was credited, so the vault stays solvent", async () => {
    const amount = units(1000);
    await vault.connect(user).lock(amount, SEVEN_DAYS);
    await connection.provider.request({ method: "evm_increaseTime", params: [SEVEN_DAYS] });
    await connection.provider.request({ method: "evm_mine", params: [] });
    await expect(vault.connect(user).unlock())
      .to.emit(vault, "Unlocked").withArgs(user.address, afterFee(amount));
    expect(await token.balanceOf(vault.target)).to.equal(0n);
  });

  it("rejects a lock whose received amount falls below minRequired", async () => {
    await expect(vault.connect(user).lock(MIN, SEVEN_DAYS)).to.be.revertedWith("Below minimum after fee");
  });

  it("rejects a lock when nothing arrives", async () => {
    await token.setFeeBps(10_000n);
    await expect(vault.connect(user).lock(units(1000), SEVEN_DAYS)).to.be.revertedWith("Nothing received");
  });

  it("credits the full amount for a fee-exempt (zero-fee) transfer", async () => {
    await token.setFeeBps(0n);
    await vault.connect(user).lock(units(1000), SEVEN_DAYS);
    expect(await vault.lockedAmount(user.address)).to.equal(units(1000));
  });
});

describe("Builder library — real InfernoToken fee path", function () {
  it("credits the net amount after IFR's 3.5 % fee, and the full amount once the vault is fee-exempt", async () => {
    const [deployer, user, user2, governance, poolFeeReceiver] = await ethers.getSigners();
    const ifr = await (await ethers.getContractFactory("InfernoToken")).deploy(poolFeeReceiver.address);
    await ifr.transfer(user.address, units(20000)); // deployer is not exempt either: user receives net
    await ifr.transfer(user2.address, units(20000));
    const vault = await (await ethers.getContractFactory("IFRBuilderVault")).deploy(
      ifr.target, units(500), SEVEN_DAYS, "RealIFR", "https://ifr.example", governance.address
    );
    const amount = units(10000);
    const net = amount - (amount * 350n) / 10_000n; // 2.0 % + 0.5 % burn + 1.0 % pool fee
    await ifr.connect(user).approve(vault.target, amount);
    await expect(vault.connect(user).lock(amount, SEVEN_DAYS))
      .to.emit(vault, "Locked").withArgs(user.address, net, SEVEN_DAYS);
    expect(await vault.lockedAmount(user.address)).to.equal(net);
    expect(await ifr.balanceOf(vault.target)).to.equal(net);
    expect(await vault.getTier(user.address)).to.equal(2); // 9650 IFR is below the 10000 tier-3 threshold

    await ifr.connect(deployer).setFeeExempt(vault.target, true);
    await ifr.connect(user2).approve(vault.target, amount);
    await vault.connect(user2).lock(amount, SEVEN_DAYS);
    expect(await vault.lockedAmount(user2.address)).to.equal(amount);
    expect(await ifr.balanceOf(vault.target)).to.equal(net + amount);
  });
});

// ── Generated contracts (docs/builder.html generator) ────────────────────────

function loadPageGenerator() {
  const html = fs.readFileSync(path.join(root, "docs/builder.html"), "utf8");
  const script = html.match(/<script>\n([\s\S]*?)<\/script>/);
  if (!script) throw new Error("builder.html generator script not found");
  const elements = {};
  const el = (id) => (elements[id] ||= {
    value: "", textContent: "", innerHTML: "", style: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {} }, scrollIntoView() {},
  });
  const page = new Function("document", "navigator", "window", "event", `${script[1]}\n;return { gen, C };`)(
    { getElementById: el, querySelectorAll: () => [el("q0"), el("q1"), el("q2")], querySelector: () => el("qS") },
    { clipboard: { writeText: async () => {} } }, {}, {}
  );
  return (cfg) => {
    Object.assign(page.C, cfg);
    el("pName").value = cfg.productName;
    el("pUrl").value = cfg.productUrl;
    page.gen();
    const code = el("t-contract").textContent;
    return { contractName: code.match(/^contract (\S+) is /m)[1], contractCode: code };
  };
}

/** Optional: the compiled TypeScript engine (apps/builder/engine) when BUILDER_ENGINE_DIR points at it. */
async function loadEngineGenerator() {
  const dir = process.env.BUILDER_ENGINE_DIR;
  if (!dir) return null;
  const { createRequire } = await import("node:module");
  const { generateCode } = createRequire(import.meta.url)(path.join(path.resolve(dir), "CodeGenerator.js"));
  return (cfg) => generateCode(cfg);
}

/** Compiles one generated contract in the documented layout (X.sol next to ./library/*.sol) with Hardhat. */
async function compileGenerated(workDir, contractName, code) {
  const file = path.join(workDir, `${contractName}.sol`);
  fs.writeFileSync(file, code);
  const jobs = await hre.solidity.getCompilationJobs([file], { quiet: true });
  if (!jobs.success) throw new Error(`compilation job for ${contractName} failed: ${jobs.reason}`);
  const { output } = await hre.solidity.runCompilationJob(jobs.compilationJobsPerFile.get(file), { quiet: true });
  const errors = (output.errors || []).filter((e) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  const entry = Object.entries(output.contracts).find(([source]) => source.endsWith(`/${contractName}.sol`));
  return entry[1][contractName];
}

describe("Builder generated contracts — fee-on-transfer accounting", function () {
  this.timeout(180_000);
  const workDir = path.join(root, "cache", "builder-generated-fot");
  const generators = [];
  let user, governance, token;

  before(async () => {
    generators.push(["builder.html", loadPageGenerator()]);
    const engine = await loadEngineGenerator();
    if (engine) generators.push(["engine", engine]);
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(workDir, "library"), { recursive: true });
    for (const file of fs.readdirSync(path.join(root, "contracts/library"))) {
      fs.copyFileSync(path.join(root, "contracts/library", file), path.join(workDir, "library", file));
    }
    [, user, governance] = await ethers.getSigners();
    // Generated contracts embed the Mainnet IFR address; place the fee mock's runtime code there.
    const mock = await (await ethers.getContractFactory("MockFeeOnTransferToken")).deploy();
    const runtime = await connection.provider.request({ method: "eth_getCode", params: [mock.target, "latest"] });
    await connection.provider.request({ method: "hardhat_setCode", params: [IFR_MAINNET, runtime] });
    token = await ethers.getContractAt("MockFeeOnTransferToken", IFR_MAINNET);
    await token.mint(user.address, units(1_000_000));
    await token.setFeeBps(FEE_BPS);
  });

  after(() => fs.rmSync(workDir, { recursive: true, force: true }));

  const base = { productName: "Fee Demo", productUrl: "https://fee.example", minAmount: 1000, lockDuration: 30, apiCheck: false };
  const combos = [];
  for (const hardLock of [true, false]) for (const tierSystem of [false, true]) for (const cooldown of [false, true]) {
    combos.push({ ...base, hardLock, tierSystem, cooldown });
  }

  it("every hard-lock combination credits exactly the received amount; balance-only combinations take no deposits", async () => {
    let checked = 0;
    for (const [generatorName, generate] of generators) {
      for (const cfg of combos) {
        const where = `${generatorName} hl${+cfg.hardLock}-tier${+cfg.tierSystem}-cd${+cfg.cooldown}`;
        const { contractName, contractCode } = generate(cfg);
        expect(contractCode, `${where}: no own transferFrom path`).to.not.match(/transferFrom/);
        const { abi, evm } = await compileGenerated(workDir, contractName, contractCode);
        const hasLock = abi.some((item) => item.type === "function" && item.name === "lock");
        expect(hasLock, `${where}: lock() exists only with HardLock`).to.equal(cfg.hardLock);
        if (!cfg.hardLock) continue;

        const factory = new ethers.ContractFactory(abi, evm.bytecode.object, governance);
        const contract = await factory.deploy(governance.address);
        await token.connect(user).approve(contract.target, ethers.MaxUint256);
        const amount = units(2500);
        const received = afterFee(amount);
        const lockSeconds = cfg.lockDuration * 86400;
        await expect(contract.connect(user).lock(amount, lockSeconds), where)
          .to.emit(contract, "Locked").withArgs(user.address, received, lockSeconds);
        expect(await contract.lockedAmount(user.address), `${where}: locked`).to.equal(received);
        expect(await token.balanceOf(contract.target), `${where}: held`).to.equal(received);
        expect(await contract.hasAccess(user.address), `${where}: access`).to.equal(true);
        if (cfg.tierSystem) {
          // Default tier thresholds 500/2000/10000 IFR: 2375 received -> tier 2.
          expect(await contract.getUserTier(user.address), `${where}: tier from received`).to.equal(2);
        }
        await expect(contract.connect(user).lock(units(1000), lockSeconds)).to.be.revertedWith("Already locked");
        checked += 1;
      }
    }
    expect(checked).to.equal(4 * generators.length);
  });
});
