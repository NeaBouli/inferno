import { expect } from "chai";
import { ethers } from "./helpers/hardhat.js";

// Local simulated-chain tests ONLY. OracleMock fabricates evidence; no TWAP/economic claim.
const U = 10n ** 9n;
const DAY = 86400n;
const TERM = 30n * DAY;
const PRICE = 10n ** 12n;
const ceil = (a, b) => (a + b - 1n) / b;
const interest = (a, r, t) => ceil(a * r * t, 10000n * TERM);
const value = (a, p) => ceil(a * p, U);
const now = async () => BigInt((await ethers.provider.getBlock("latest")).timestamp);
const advance = async (seconds) => {
  await ethers.provider.send("evm_increaseTime", [Number(seconds)]);
  await ethers.provider.send("evm_mine", []);
};
const nextAt = async (timestamp) => ethers.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);

async function deployFixture(tokenName = "LendingVaultV2TokenMock", reverse = false) {
  const [owner, lender, borrower, payer, receiver, stranger, nextOwner, otherLender] = await ethers.getSigners();
  const deploy = async (name, ...args) => {
    const contract = await (await ethers.getContractFactory(name)).deploy(...args);
    await contract.waitForDeployment();
    return contract;
  };
  const token = await deploy(tokenName, ...(tokenName === "InfernoToken" ? [owner.address] : []));
  const weth = await deploy("LendingVaultV2WETHMock");
  const factory = await deploy("MockPairFactory");
  const pair = await deploy("MockTwapPair", ...(reverse ? [weth.target, token.target] : [token.target, weth.target]));
  await factory.setPair(token.target, weth.target, pair.target);
  const oracle = await deploy("LendingVaultV2OracleMock", token.target, weth.target, factory.target, pair.target);
  const vault = await deploy("LendingVaultV2", token.target, weth.target, factory.target, owner.address);
  if (tokenName === "LendingVaultV2TokenMock") await token.mint(owner.address, 2_000_000n * U);
  if (tokenName === "InfernoToken") await token.setFeeExempt(owner.address, true);
  if (tokenName !== "LendingVaultV2ReentrantTokenMock") await token.setFeeExempt(vault.target, true);
  for (const account of [lender, borrower, payer, otherLender]) {
    if (tokenName === "LendingVaultV2TokenMock") await token.mint(account.address, 2_000_000n * U);
    else await token.transfer(account.address, 2_000_000n * U);
    await token.connect(account).approve(vault.target, ethers.MaxUint256);
  }
  const configuration = {
    adapter: oracle.target, oracleVersion: 1n, feeReceiver: receiver.address,
    minPrice: 1n, maxPrice: 10n ** 18n, minIfrDepth: 1_000_000n * U,
    totalCap: 100_000n * U, loanCap: 10_000n * U, borrowerCap: 20_000n * U,
    offerCap: 25_000n * U, dailyCap: 25_000n * U, ethCap: ethers.parseEther("0.5"), economicCap: ethers.parseEther("0.5"),
  };
  async function evidence(changes = {}, adapter = oracle, version = 1n) {
    const t = await now();
    const data = {
      version, slowPrice: PRICE, fastPrice: PRICE,
      slowStart: t - 7n * DAY, slowEnd: t,
      fastStart: t - 1800n, fastEnd: t, latestObservation: t,
      maxGap: 1800n, fastMaxGap: 1800n, minWethDepth: ethers.parseEther("50"), minIfrDepth: 10_000_000n * U, reason: 0n,
      ...changes,
    };
    await adapter.setEvidence(version, data);
    return data;
  }
  const calldata = (method, args) => vault.interface.encodeFunctionData(method, args);
  async function queued(method, args) {
    await vault.queueAction(calldata(method, args));
    await advance(48n * 3600n);
  }
  async function configure(changes = {}) {
    Object.assign(configuration, changes);
    await queued("setConfiguration", [configuration]);
    await vault.setConfiguration(configuration);
  }
  async function resume() {
    const nonce = await vault.pauseNonce();
    await queued("resume", [nonce, true, true]);
    await evidence();
    await vault.resume(nonce, true, true);
  }
  async function ready() {
    await vault.connect(receiver).confirmFeeReceiver();
    await configure();
    await resume();
  }
  async function fund(amount = 1_000_000n * U, rate = 200n, who = lender) {
    const id = await vault.getOfferCount();
    await vault.connect(who).createOffer(amount, rate, TERM, 90n * DAY);
    return id;
  }
  async function borrow(changes = {}, who = borrower, extraETH = 0n) {
    const id = await vault.getLoanCount();
    const request = { offerId: 0n, principal: 1000n * U, term: TERM, maxRateBps: 200n, minReceived: 1n, maxCollateral: ethers.parseEther("10"), deadline: (await now()) + 3600n, ...changes };
    const [required] = await vault.quote(request.offerId, request.principal, request.term);
    await vault.connect(who).borrow(request, { value: required + extraETH });
    return { id, request, loan: await vault.getLoan(id), required };
  }
  async function request(changes = {}) {
    return { offerId: 0n, principal: 1000n * U, term: TERM, maxRateBps: 200n, minReceived: 1n, maxCollateral: ethers.parseEther("10"), deadline: (await now()) + 3600n, ...changes };
  }
  async function invariant() {
    let available = 0n, lent = 0n, collateral = 0n, exposure = 0n, losses = 0n;
    const counts = new Map();
    const principals = new Map();
    const beneficiaries = new Set([owner, lender, borrower, payer, receiver, stranger, nextOwner, otherLender].map((a) => a.address));
    for (let i = 0n; i < await vault.getOfferCount(); i++) {
      const offer = await vault.getOffer(i);
      beneficiaries.add(offer.lender);
      available += offer.available; losses += offer.losses;
      let offerLent = 0n;
      for (let j = 0n; j < await vault.getLoanCount(); j++) {
        const loan = await vault.getLoan(j);
        if (loan.offerId === i && loan.status === 0n) offerLent += loan.principal;
      }
      expect(offer.lent).to.equal(offerLent);
    }
    for (let i = 0n; i < await vault.getLoanCount(); i++) {
      const loan = await vault.getLoan(i);
      beneficiaries.add(loan.borrower);
      if (loan.status !== 0n) { expect(loan.collateral).to.equal(0n); continue; }
      lent += loan.principal; collateral += loan.collateral; exposure += loan.defaultETH;
      counts.set(loan.borrower, (counts.get(loan.borrower) || 0n) + 1n);
      principals.set(loan.borrower, (principals.get(loan.borrower) || 0n) + loan.principal);
    }
    for (const account of [borrower, payer, stranger]) {
      expect(await vault.activeLoanCount(account.address)).to.equal(counts.get(account.address) || 0n);
      expect(await vault.borrowerPrincipal(account.address)).to.equal(principals.get(account.address) || 0n);
    }
    expect(await vault.totalAvailable()).to.equal(available);
    expect(await vault.totalLent()).to.equal(lent);
    expect(await vault.totalLosses()).to.equal(losses);
    expect(await vault.totalCollateral()).to.equal(collateral);
    expect(await vault.totalDefaultExposure()).to.equal(exposure);
    for (let i = 1n; i <= await vault.policyId(); i++) beneficiaries.add((await vault.getConfiguration(i)).feeReceiver);
    let ifrCreditSum = 0n, ethCreditSum = 0n;
    for (const address of beneficiaries) {
      ifrCreditSum += await vault.ifrCredits(address);
      ethCreditSum += await vault.ethCredits(address);
    }
    expect(await vault.totalIFRCredits()).to.equal(ifrCreditSum);
    expect(await vault.totalETHCredits()).to.equal(ethCreditSum);
    expect(await token.balanceOf(vault.target)).to.be.gte(available + await vault.totalIFRCredits());
    expect(await ethers.provider.getBalance(vault.target)).to.be.gte(collateral + await vault.totalETHCredits());
  }
  return { owner, lender, borrower, payer, receiver, stranger, nextOwner, otherLender, token, weth, factory, pair, oracle, vault, configuration, deploy, evidence, calldata, queued, configure, resume, ready, fund, borrow, request, invariant };
}

describe("LendingVaultV2 release candidate", function () {
  let f;
  beforeEach(async () => { f = await deployFixture(); });

  it("D01 starts paused, all budgets and balances zero, with explicit immutable assets", async () => {
    const { vault, owner, token, weth, factory } = f;
    expect(await vault.owner()).to.equal(owner.address);
    expect(await vault.pendingOwner()).to.equal(ethers.ZeroAddress);
    expect(await vault.borrowingPaused()).to.equal(true);
    expect(await vault.liquidationPaused()).to.equal(true);
    expect(await vault.policyId()).to.equal(0n);
    expect((await vault.getConfiguration(0)).totalCap).to.equal(0n);
    expect(await vault.ifrToken()).to.equal(token.target);
    expect(await vault.weth()).to.equal(weth.target);
    expect(await vault.factory()).to.equal(factory.target);
    expect(await vault.getOfferCount()).to.equal(0n);
    expect(await vault.getLoanCount()).to.equal(0n);
    await f.invariant();
  });

  it("D02 rejects zero/noncontract/identical assets, wrong decimals and zero owner", async () => {
    const { token, weth, factory, owner, stranger } = f;
    const V = await ethers.getContractFactory("LendingVaultV2");
    for (const args of [
      [ethers.ZeroAddress, weth.target, factory.target, owner.address],
      [token.target, stranger.address, factory.target, owner.address],
      [token.target, weth.target, ethers.ZeroAddress, owner.address],
      [token.target, token.target, factory.target, owner.address],
    ]) await expect(V.deploy(...args)).to.be.revertedWithCustomError(V, "InvalidAddress");
    await expect(V.deploy(weth.target, token.target, factory.target, owner.address)).to.be.revertedWithCustomError(V, "InvalidConfiguration");
    await expect(V.deploy(token.target, weth.target, factory.target, ethers.ZeroAddress)).to.be.revertedWithCustomError(V, "OwnableInvalidOwner");
  });

  it("A01 ownership requires nomination and correct acceptance; replacement/cancellation reject stale candidates", async () => {
    const { vault, nextOwner, stranger, owner } = f;
    await expect(vault.connect(stranger).transferOwnership(nextOwner.address)).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    await expect(vault.transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(vault, "InvalidAddress");
    await expect(vault.transferOwnership(vault.target)).to.be.revertedWithCustomError(vault, "InvalidAddress");
    await expect(vault.cancelOwnershipTransfer()).to.be.revertedWithCustomError(vault, "InvalidAddress");
    await vault.transferOwnership(nextOwner.address);
    expect(await vault.owner()).to.equal(owner.address);
    await expect(vault.connect(nextOwner).pause(true, true)).to.be.revertedWithCustomError(vault, "Unauthorized");
    await expect(vault.connect(stranger).acceptOwnership()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    await vault.transferOwnership(stranger.address);
    await expect(vault.connect(nextOwner).acceptOwnership()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    await expect(vault.cancelOwnershipTransfer()).to.emit(vault, "OwnershipNominationCancelled").withArgs(stranger.address);
    await expect(vault.connect(stranger).acceptOwnership()).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    await vault.transferOwnership(nextOwner.address);
    await expect(vault.connect(nextOwner).acceptOwnership()).to.emit(vault, "OwnershipTransferred").withArgs(owner.address, nextOwner.address);
    expect(await vault.pendingOwner()).to.equal(ethers.ZeroAddress);
    await expect(vault.pause(true, true)).to.be.revertedWithCustomError(vault, "Unauthorized");
    await expect(vault.connect(nextOwner).renounceOwnership()).to.be.revertedWithCustomError(vault, "RenunciationDisabled");
  });

  it("A02 a contract owner can accept and operate through its controller", async () => {
    const actor = await f.deploy("LendingVaultV2Actor", f.owner.address);
    await f.vault.transferOwnership(actor.target);
    await actor.execute(f.vault.target, f.calldata("acceptOwnership", []));
    expect(await f.vault.owner()).to.equal(actor.target);
    await actor.execute(f.vault.target, f.calldata("pause", [true, true]));
    await actor.transferOwnership(f.nextOwner.address);
    await expect(actor.connect(f.nextOwner).execute(f.vault.target, f.calldata("pause", [true, true]))).to.be.revertedWithCustomError(actor, "OwnableUnauthorizedAccount");
    await actor.connect(f.nextOwner).acceptOwnership();
    await actor.connect(f.nextOwner).execute(f.vault.target, f.calldata("pause", [true, true]));
  });

  it("A03 exact calldata timelock rejects missing/early/changed/replayed actions and supports cancellation", async () => {
    const { vault, configuration: c, stranger } = f;
    await expect(vault.setConfiguration(c)).to.be.revertedWithCustomError(vault, "ActionNotReady");
    await expect(vault.queueAction("0x12")).to.be.revertedWithCustomError(vault, "InvalidAction");
    await expect(vault.queueAction(f.calldata("expire", [0]))).to.be.revertedWithCustomError(vault, "InvalidAction");
    await expect(vault.connect(stranger).queueAction(f.calldata("setConfiguration", [c]))).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    const data = f.calldata("setConfiguration", [c]);
    await expect(vault.queueAction(data)).to.emit(vault, "ActionQueued");
    const eta = await vault.actionETA(ethers.keccak256(data));
    await nextAt(eta - 1n);
    await expect(vault.setConfiguration(c)).to.be.revertedWithCustomError(vault, "ActionNotReady");
    await nextAt(eta);
    await expect(vault.setConfiguration({ ...c, loanCap: 1n })).to.be.revertedWithCustomError(vault, "ActionNotReady");
    await expect(vault.setConfiguration(c)).to.emit(vault, "ConfigurationChanged");
    await expect(vault.setConfiguration(c)).to.be.revertedWithCustomError(vault, "ActionNotReady");
    await vault.queueAction(data);
    await expect(vault.connect(stranger).cancelAction(ethers.keccak256(data))).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    await expect(vault.cancelAction(ethers.keccak256(data))).to.emit(vault, "ActionRemoved").withArgs(ethers.keccak256(data), false);
    await expect(vault.cancelAction(ethers.keccak256(data))).to.be.revertedWithCustomError(vault, "InvalidAction");
  });

  it("A04 guardian contract nomination/acceptance/replacement/cancellation confers only immediate pause", async () => {
    const { vault, owner, stranger } = f;
    const a = await f.deploy("LendingVaultV2Actor", owner.address);
    const b = await f.deploy("LendingVaultV2Actor", owner.address);
    await expect(vault.nominateGuardian(a.target)).to.be.revertedWithCustomError(vault, "ActionNotReady");
    await f.queued("nominateGuardian", [a.target]);
    await vault.nominateGuardian(a.target);
    await expect(a.execute(vault.target, f.calldata("pause", [true, true]))).to.be.revertedWithCustomError(vault, "Unauthorized");
    await expect(vault.connect(stranger).acceptGuardian()).to.be.revertedWithCustomError(vault, "Unauthorized");
    await a.execute(vault.target, f.calldata("acceptGuardian", []));
    expect(await vault.guardian()).to.equal(a.target);
    await a.execute(vault.target, f.calldata("pause", [true, false]));
    await expect(a.execute(vault.target, f.calldata("resume", [await vault.pauseNonce(), true, true]))).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    await expect(a.execute(vault.target, f.calldata("setConfiguration", [f.configuration]))).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    await f.queued("nominateGuardian", [b.target]);
    await vault.nominateGuardian(b.target);
    await vault.cancelGuardianNomination();
    await expect(b.execute(vault.target, f.calldata("acceptGuardian", []))).to.be.revertedWithCustomError(vault, "Unauthorized");
    expect(await vault.guardian()).to.equal(a.target);
    await expect(vault.cancelGuardianNomination()).to.be.revertedWithCustomError(vault, "InvalidAddress");
    await f.queued("nominateGuardian", [b.target]);
    await vault.nominateGuardian(b.target);
    await b.execute(vault.target, f.calldata("acceptGuardian", []));
    await expect(a.execute(vault.target, f.calldata("pause", [true, true]))).to.be.revertedWithCustomError(vault, "Unauthorized");
    await f.queued("nominateGuardian", [stranger.address]);
    await expect(vault.nominateGuardian(stranger.address)).to.be.revertedWithCustomError(vault, "InvalidAddress");
    await expect(vault.pause(false, false)).to.be.revertedWithCustomError(vault, "InvalidAction");
  });

  const configInvalid = [
    ["adapter", ethers.ZeroAddress, "InvalidAddress"], ["feeReceiver", ethers.ZeroAddress, "InvalidAddress"],
    ["oracleVersion", 0n], ["minPrice", 0n], ["maxPrice", 0n], ["maxPrice", 1n << 128n],
    ["minIfrDepth", 0n], ["minIfrDepth", 1n << 112n], ["totalCap", 100_000n * U + 1n],
    ["loanCap", 10_000n * U + 1n], ["borrowerCap", 20_000n * U + 1n], ["offerCap", 25_000n * U + 1n],
    ["dailyCap", 25_000n * U + 1n], ["ethCap", ethers.parseEther("0.5") + 1n], ["economicCap", ethers.parseEther("0.5") + 1n],
  ];
  for (const [field, value_, error = "InvalidConfiguration"] of configInvalid) {
    it(`A05 rejects out-of-bounds configuration ${field}=${value_}`, async () => {
      const c = { ...f.configuration, [field]: value_ };
      await f.queued("setConfiguration", [c]);
      await expect(f.vault.setConfiguration(c)).to.be.revertedWithCustomError(f.vault, error);
    });
  }

  it("A06 receiver must be distinct and confirm ability to claim; zero caps cannot resume", async () => {
    for (const address of [f.token.target, f.vault.target]) {
      const c = { ...f.configuration, feeReceiver: address };
      await f.queued("setConfiguration", [c]);
      await expect(f.vault.setConfiguration(c)).to.be.revertedWithCustomError(f.vault, "InvalidAddress");
    }
    await f.configure();
    await f.queued("resume", [await f.vault.pauseNonce(), true, true]);
    await f.evidence();
    await expect(f.vault.resume(await f.vault.pauseNonce(), true, true)).to.be.revertedWithCustomError(f.vault, "ReceiverNotConfirmed");
    await f.vault.connect(f.receiver).confirmFeeReceiver();
    await f.vault.resume(await f.vault.pauseNonce(), true, true);
    await f.configure({ economicCap: 0n });
    await f.queued("resume", [await f.vault.pauseNonce(), true, true]);
    await f.evidence();
    await expect(f.vault.resume(await f.vault.pauseNonce(), true, true)).to.be.revertedWithCustomError(f.vault, "CapExceeded");
  });

  it("A07 an incident invalidates already queued resume and resumption rechecks oracle and exemption", async () => {
    await f.ready();
    const nonce = await f.vault.pauseNonce();
    await f.queued("resume", [nonce, true, true]);
    await f.vault.pause(true, true);
    await expect(f.vault.resume(nonce, true, true)).to.be.revertedWithCustomError(f.vault, "InvalidAction");
    const current = await f.vault.pauseNonce();
    await f.queued("resume", [current, true, true]);
    await expect(f.vault.resume(current, true, true)).to.be.revertedWithCustomError(f.vault, "InvalidOracle");
    await f.evidence();
    await f.token.setFeeExempt(f.vault.target, false);
    await expect(f.vault.resume(current, true, true)).to.be.revertedWithCustomError(f.vault, "FeeExemptionRequired");
    await f.token.setFeeExempt(f.vault.target, true);
    await f.vault.resume(current, true, true);
    await f.queued("resume", [current, false, false]);
    await expect(f.vault.resume(current, false, false)).to.be.revertedWithCustomError(f.vault, "InvalidAction");
  });

  it("F01 exact funding/increase/withdraw/reopen and independent fixed offers preserve principal", async () => {
    await expect(f.vault.connect(f.lender).createOffer(10n * U, 200, TERM, TERM)).to.emit(f.vault, "OfferCreated");
    await expect(f.vault.connect(f.lender).fundOffer(0, U)).to.emit(f.vault, "OfferFunded").withArgs(0n, U);
    await f.vault.connect(f.lender).withdrawOffer(0, 11n * U, f.lender.address);
    await f.vault.connect(f.lender).fundOffer(0, 2n * U);
    await f.fund(3n * U, 0n);
    expect(await f.vault.getOfferCount()).to.equal(2n);
    expect((await f.vault.getOffer(0)).available).to.equal(2n * U);
    expect((await f.vault.getOffer(1)).rateBps).to.equal(0n);
    await f.invariant();
  });

  it("F02 offer errors: IDs, unauthorized, zero, terms, insufficient availability and destination", async () => {
    await expect(f.vault.getOffer(0)).to.be.revertedWithCustomError(f.vault, "InvalidOffer");
    await expect(f.vault.getLoan(0)).to.be.revertedWithCustomError(f.vault, "InvalidLoan");
    await expect(f.vault.debtOf(0)).to.be.revertedWithCustomError(f.vault, "InvalidLoan");
    await expect(f.vault.connect(f.lender).createOffer(0, 200, TERM, TERM)).to.be.revertedWithCustomError(f.vault, "ZeroAmount");
    for (const [r, min, max] of [[201n, TERM, TERM], [0n, TERM - 1n, TERM], [0n, TERM, 90n * DAY + 1n], [0n, TERM + 1n, TERM]]) {
      await expect(f.vault.connect(f.lender).createOffer(U, r, min, max)).to.be.revertedWithCustomError(f.vault, "InvalidTerms");
    }
    await f.fund(U);
    await expect(f.vault.fundOffer(0, U)).to.be.revertedWithCustomError(f.vault, "Unauthorized");
    await expect(f.vault.connect(f.lender).fundOffer(0, 0)).to.be.revertedWithCustomError(f.vault, "ZeroAmount");
    await expect(f.vault.withdrawOffer(0, U, f.owner.address)).to.be.revertedWithCustomError(f.vault, "Unauthorized");
    await expect(f.vault.connect(f.lender).withdrawOffer(0, U + 1n, f.lender.address)).to.be.revertedWithCustomError(f.vault, "InsufficientAvailable");
    await expect(f.vault.connect(f.lender).withdrawOffer(0, 0, f.lender.address)).to.be.revertedWithCustomError(f.vault, "ZeroAmount");
    for (const destination of [ethers.ZeroAddress, f.vault.target]) await expect(f.vault.connect(f.lender).withdrawOffer(0, U, destination)).to.be.revertedWithCustomError(f.vault, "InvalidAddress");
  });

  it("F03 revoked or lying exemption cannot overcredit taxed deposits", async () => {
    await f.token.setFeeExempt(f.vault.target, false);
    await expect(f.fund()).to.be.revertedWithCustomError(f.vault, "FeeExemptionRequired");
    await f.token.setFeeExempt(f.vault.target, true);
    await f.token.setFeeBps(350);
    await expect(f.fund()).to.be.revertedWithCustomError(f.vault, "ReceiptMismatch").withArgs(1_000_000n * U, 965_000n * U);
    expect(await f.vault.getOfferCount()).to.equal(0n);
    await f.token.setFeeBps(0);
    await f.fund();
    await f.token.setFeeExempt(f.vault.target, false);
    await expect(f.vault.connect(f.lender).fundOffer(0, U)).to.be.revertedWithCustomError(f.vault, "FeeExemptionRequired");
    await f.invariant();
  });

  it("F04 outgoing withdrawals disclose actual tax and debit only the gross entitlement", async () => {
    await f.fund(100n * U);
    await f.token.setFeeExempt(f.vault.target, false);
    await f.token.setFeeBps(350);
    await expect(f.vault.connect(f.lender).withdrawOffer(0, 100n * U, f.lender.address)).to.emit(f.vault, "OfferWithdrawn").withArgs(0n, f.lender.address, 100n * U, 965n * U / 10n);
    await f.invariant();
  });

  describe("live loan lifecycle", function () {
    beforeEach(async () => { await f.fund(); await f.ready(); });

    it("L01 snapshots rate/term/policy/default and exact receipt at initial-LTV equality", async () => {
      const { loan, required } = await f.borrow({ principal: 10_000n * U, term: 90n * DAY });
      const maxDebt = 10_000n * U + interest(10_000n * U, 200n, 90n * DAY);
      expect(required).to.equal(ceil(value(maxDebt, PRICE) * 10000n, 3000n));
      expect(loan.defaultETH).to.equal(ceil(value(maxDebt, PRICE) * 12500n, 10000n));
      expect(loan.rateBps).to.equal(200n);
      expect(loan.term).to.equal(90n * DAY);
      expect(loan.policyId).to.equal(1n);
      expect(await f.vault.rollingOriginations()).to.equal(10_000n * U);
      await f.invariant();
    });

    it("L02 borrow validates amount/term/offer/self-borrow/availability and all borrower quote guards", async () => {
      const { vault, borrower } = f;
      await expect(vault.connect(borrower).borrow(await f.request({ principal: 0n }))).to.be.revertedWithCustomError(vault, "ZeroAmount");
      await expect(vault.connect(borrower).borrow(await f.request({ term: TERM - 1n }))).to.be.revertedWithCustomError(vault, "InvalidTerms");
      await expect(vault.connect(borrower).borrow(await f.request({ offerId: 44n }))).to.be.revertedWithCustomError(vault, "InvalidOffer");
      await expect(vault.connect(f.lender).borrow(await f.request())).to.be.revertedWithCustomError(vault, "Unauthorized");
      for (const changes of [{ deadline: (await now()) - 1n }, { deadline: (await now()) + 7200n }, { maxRateBps: 199n }, { minReceived: 0n }, { minReceived: 1001n * U }, { maxCollateral: 1n }]) {
        await expect(vault.connect(borrower).borrow(await f.request(changes), { value: 1n })).to.be.revertedWithCustomError(vault, "QuoteRejected");
      }
      const req = await f.request();
      const [required] = await vault.quote(0, req.principal, req.term);
      await expect(vault.connect(borrower).borrow(req, { value: required - 1n })).to.be.revertedWithCustomError(vault, "QuoteRejected");
      await expect(vault.connect(borrower).borrow({ ...req, maxCollateral: required }, { value: required + 1n })).to.be.revertedWithCustomError(vault, "QuoteRejected");
      await f.fund(1n, 0n, f.otherLender);
      await expect(vault.connect(borrower).borrow(await f.request({ offerId: 1n }))).to.be.revertedWithCustomError(vault, "InsufficientAvailable");
      await f.vault.pause(true, false);
      await expect(vault.connect(borrower).borrow(req)).to.be.revertedWithCustomError(vault, "Paused");
    });

    it("L03 early repayment uses ceil per second, no minimum month, net excess credit and pull interest", async () => {
      const { loan } = await f.borrow();
      await nextAt(loan.start + 17n);
      const due = loan.principal + interest(loan.principal, loan.rateBps, 17n);
      const overpay = 7n;
      await expect(f.vault.connect(f.borrower).repay(0, due + overpay)).to.emit(f.vault, "LoanPaid").withArgs(0n, 1n, f.borrower.address, due, due + overpay, (due - loan.principal) / 2n, (due - loan.principal + 1n) / 2n);
      expect(await f.vault.ethCredits(f.borrower.address)).to.equal(loan.collateral);
      expect(await f.vault.ifrCredits(f.borrower.address)).to.equal(overpay);
      expect(await f.vault.totalIFRCredits()).to.equal(due - loan.principal + overpay);
      await f.vault.connect(f.receiver).claimIFR(f.stranger.address);
      await f.vault.connect(f.lender).claimIFR(f.lender.address);
      await f.vault.connect(f.borrower).claimIFR(f.borrower.address);
      await f.vault.connect(f.borrower).claimETH(f.borrower.address, false);
      await f.invariant();
    });

    it("L04 one-base-unit interest floors lender half and assigns the remainder to protocol", async () => {
      const { loan } = await f.borrow({ principal: 1n, minReceived: 1n });
      expect(await f.vault.debtOf(0)).to.equal(1n); // same timestamp as origination
      await nextAt(loan.start + 1n);
      await f.vault.connect(f.borrower).repay(0, 2n);
      expect(await f.vault.ifrCredits(f.lender.address)).to.equal(0n);
      expect(await f.vault.ifrCredits(f.receiver.address)).to.equal(1n);
      await f.invariant();
    });

    for (const offset of [-1n, 0n, 1n, 7n * DAY - 1n]) {
      it(`L05 repayment at maturity offset ${offset} seconds has capped interest`, async () => {
        const { loan } = await f.borrow();
        const elapsed = TERM + offset;
        await nextAt(loan.start + elapsed);
        const debt = loan.principal + interest(loan.principal, loan.rateBps, elapsed < TERM ? elapsed : TERM);
        await f.vault.connect(f.borrower).repay(0, debt);
        expect((await f.vault.getLoan(0)).status).to.equal(1n);
        await f.invariant();
      });
    }

    it("L06 exact expiry blocks repayment and price liquidation, enables permissionless default", async () => {
      const { loan } = await f.borrow();
      const expiry = loan.start + loan.term + 7n * DAY;
      await nextAt(expiry - 1n);
      await expect(f.vault.expire(0)).to.be.revertedWithCustomError(f.vault, "NotExpired");
      await nextAt(expiry);
      await expect(f.vault.connect(f.borrower).repay(0, ethers.MaxUint256)).to.be.revertedWithCustomError(f.vault, "ExpiryBoundary");
      await expect(f.vault.connect(f.payer).liquidate(0, ethers.MaxUint256)).to.be.revertedWithCustomError(f.vault, "ExpiryBoundary");
      await f.vault.connect(f.stranger).expire(0);
      expect(await f.vault.ethCredits(f.lender.address)).to.equal(loan.defaultETH);
      expect(await f.vault.ethCredits(f.borrower.address)).to.equal(loan.collateral - loan.defaultETH);
      expect(await f.vault.totalIFRCredits()).to.equal(0n);
      expect(await f.vault.totalLosses()).to.equal(loan.principal);
      expect((await f.vault.getOffer(0)).available).to.equal(1_000_000n * U - loan.principal);
      await f.invariant();
    });

    it("L07 top-up changes only collateral; all terminal paths reject repeated settlement", async () => {
      const { loan } = await f.borrow();
      await expect(f.vault.topUpCollateral(0, { value: 1n })).to.be.revertedWithCustomError(f.vault, "Unauthorized");
      await expect(f.vault.connect(f.borrower).topUpCollateral(0)).to.be.revertedWithCustomError(f.vault, "ZeroAmount");
      await expect(f.vault.connect(f.borrower).topUpCollateral(0, { value: 100n })).to.emit(f.vault, "CollateralAdded");
      const after = await f.vault.getLoan(0);
      expect(after.defaultETH).to.equal(loan.defaultETH);
      expect(after.collateral).to.equal(loan.collateral + 100n);
      expect(after.rateBps).to.equal(loan.rateBps);
      await expect(f.vault.repay(0, 0)).to.be.revertedWithCustomError(f.vault, "Unauthorized");
      await expect(f.vault.connect(f.borrower).repay(0, 0)).to.be.revertedWithCustomError(f.vault, "InsufficientReceipt");
      await f.vault.connect(f.borrower).repay(0, loan.principal * 2n);
      for (const method of [() => f.vault.connect(f.borrower).repay(0, 0), () => f.vault.liquidate(0, 0), () => f.vault.expire(0), () => f.vault.connect(f.borrower).topUpCollateral(0)]) {
        await expect(method()).to.be.revertedWithCustomError(f.vault, "LoanSettled");
      }
      await f.invariant();
    });

    it("L08 full liquidation collects IFR, returns principal and credits bonus plus all borrower surplus", async () => {
      const { loan } = await f.borrow();
      await expect(f.vault.connect(f.payer).liquidate(0, loan.principal * 2n)).to.be.revertedWithCustomError(f.vault, "NotLiquidatable");
      await f.evidence({ slowPrice: PRICE * 2n, fastPrice: PRICE * 2n });
      const tx = await f.vault.connect(f.payer).liquidate(0, loan.principal * 2n);
      const t = BigInt((await ethers.provider.getBlock((await tx.wait()).blockNumber)).timestamp);
      const debt = loan.principal + interest(loan.principal, loan.rateBps, t - loan.start);
      const reward = ceil(value(debt, PRICE * 2n) * 10500n, 10000n);
      expect(await f.vault.ethCredits(f.payer.address)).to.equal(reward);
      expect(await f.vault.ethCredits(f.borrower.address)).to.equal(loan.collateral - reward);
      expect(await f.vault.ifrCredits(f.payer.address)).to.equal(loan.principal * 2n - debt);
      expect(await f.vault.totalLosses()).to.equal(0n);
      await f.invariant();
    });

    it("L09 liquidation equality and warning equality include accrued debt; underwater payout is capped at C", async () => {
      // Zero-rate offer removes timestamp drift, and collateral has an exact debt-value multiple.
      await f.fund(100_000n * U, 0n, f.otherLender);
      const { loan } = await f.borrow({ offerId: 1n, principal: 400n * U });
      await f.evidence({ slowPrice: 4n * PRICE / 3n, fastPrice: 4n * PRICE / 3n });
      // Set collateral to an exactly divisible value via a borrower top-up.
      const C = 2_000_000_000_000_000n;
      await f.vault.connect(f.borrower).topUpCollateral(0, { value: C - loan.collateral });
      const exactWarning = 800_000_000_000_000n * U / loan.principal;
      await f.evidence({ slowPrice: exactWarning, fastPrice: exactWarning });
      expect((await f.vault.health(0)).warning).to.equal(true);
      const exactLiquidation = 1_000_000_000_000_000n * U / loan.principal;
      await f.evidence({ slowPrice: exactLiquidation, fastPrice: exactLiquidation });
      expect((await f.vault.health(0)).liquidatable).to.equal(true);
      await f.vault.connect(f.payer).liquidate(0, loan.principal);
      await f.evidence({ slowPrice: PRICE, fastPrice: PRICE });
      const second = await f.borrow({ offerId: 1n, principal: 300n * U });
      await f.evidence({ slowPrice: PRICE * 100n, fastPrice: PRICE * 100n });
      await f.vault.connect(f.payer).liquidate(1, second.loan.principal);
      expect(await f.vault.ethCredits(f.payer.address)).to.be.gte(second.loan.collateral);
      expect((await f.vault.getLoan(1)).status).to.equal(2n);
      await f.invariant();
    });

    it("L10 pause and reverting oracle do not block withdrawals, repayment, top-up, claims or default", async () => {
      const first = await f.borrow();
      const second = await f.borrow({}, f.payer);
      await f.vault.pause(true, true);
      await f.oracle.setBroken(true);
      await f.pair.setBroken(true);
      await expect(f.vault.connect(f.borrower).borrow(await f.request())).to.be.revertedWithCustomError(f.vault, "Paused");
      await expect(f.vault.liquidate(0, 0)).to.be.revertedWithCustomError(f.vault, "Paused");
      await f.vault.connect(f.lender).withdrawOffer(0, U, f.lender.address);
      await f.vault.connect(f.borrower).topUpCollateral(0, { value: 1n });
      await f.vault.connect(f.borrower).repay(0, first.loan.principal * 2n);
      await f.vault.connect(f.borrower).claimETH(f.borrower.address, false);
      await f.vault.connect(f.receiver).claimIFR(f.receiver.address);
      await nextAt(second.loan.start + TERM + 7n * DAY);
      await f.token.setFailure(false, true);
      await f.vault.expire(1);
      await f.vault.connect(f.lender).claimETH(f.lender.address, true);
      await f.invariant();
    });

    it("L11 revoked exemption requires bounded net debt payment; tax never consumes another offer's cash", async () => {
      const { loan } = await f.borrow();
      await f.token.setFeeExempt(f.vault.target, false);
      await f.token.setFeeBps(350);
      await expect(f.vault.connect(f.borrower).borrow(await f.request())).to.be.revertedWithCustomError(f.vault, "FeeExemptionRequired");
      await nextAt(loan.start + 100n);
      const debt = loan.principal + interest(loan.principal, loan.rateBps, 100n);
      await expect(f.vault.connect(f.borrower).repay(0, debt)).to.be.revertedWithCustomError(f.vault, "InsufficientReceipt");
      expect((await f.vault.getLoan(0)).status).to.equal(0n);
      await f.vault.connect(f.borrower).repay(0, loan.principal * 2n);
      const credit = await f.vault.ifrCredits(f.receiver.address);
      await expect(f.vault.connect(f.receiver).claimIFR(f.receiver.address)).to.emit(f.vault, "Claimed").withArgs(f.receiver.address, f.receiver.address, f.token.target, credit, credit - credit * 350n / 10000n);
      await f.invariant();
    });

    it("L12 false-return/reverting IFR rolls back settlement/claims and never blocks expiry", async () => {
      const { loan } = await f.borrow();
      await f.token.setFailure(true, false);
      await expect(f.vault.connect(f.borrower).repay(0, loan.principal * 2n)).to.be.revertedWithCustomError(f.vault, "SafeERC20FailedOperation");
      await f.token.setFailure(false, true);
      await expect(f.vault.connect(f.borrower).repay(0, loan.principal * 2n)).to.be.revertedWith("token broken");
      expect(await f.vault.totalLent()).to.equal(loan.principal);
      await f.token.setFailure(false, false);
      await f.vault.connect(f.borrower).repay(0, loan.principal * 2n);
      const credit = await f.vault.ifrCredits(f.receiver.address);
      await f.token.setFailure(true, false);
      await expect(f.vault.connect(f.receiver).claimIFR(f.receiver.address)).to.be.revertedWithCustomError(f.vault, "SafeERC20FailedOperation");
      expect(await f.vault.ifrCredits(f.receiver.address)).to.equal(credit);
      await f.invariant();
    });

    it("L13 donations/forced ETH do not become principal, credits or exposure headroom", async () => {
      await f.token.transfer(f.vault.target, 2_000_000n * U);
      await (await ethers.getContractFactory("LendingVaultV2ForceETH")).deploy(f.vault.target, { value: ethers.parseEther("1") });
      expect(await f.vault.totalAvailable()).to.equal(1_000_000n * U);
      expect(await f.vault.totalETHCredits()).to.equal(0n);
      expect(await f.vault.totalDefaultExposure()).to.equal(0n);
      await f.invariant();
    });

    it("L14 fixed historical adapter/version/receiver survive prospective replacement; old failure leaves repayment", async () => {
      const first = await f.borrow();
      const secondOracle = await f.deploy("LendingVaultV2OracleMock", f.token.target, f.weth.target, f.factory.target, f.pair.target);
      await f.vault.connect(f.stranger).confirmFeeReceiver();
      await f.configure({ adapter: secondOracle.target, oracleVersion: 2n, feeReceiver: f.stranger.address, totalCap: 1n });
      expect((await f.vault.getLoan(0)).policyId).to.equal(1n);
      expect((await f.vault.getConfiguration(1)).feeReceiver).to.equal(f.receiver.address);
      expect((await f.vault.getConfiguration(2)).feeReceiver).to.equal(f.stranger.address);
      await f.oracle.setBroken(true);
      await f.vault.connect(f.borrower).repay(0, first.loan.principal * 2n);
      expect(await f.vault.ifrCredits(f.receiver.address)).to.be.gt(0n);
      expect(await f.vault.ifrCredits(f.stranger.address)).to.equal(0n);
      await f.invariant();
    });
  });

  it("L15 exact expiry directly defaults once; later top-ups preserve immutable payoff and all surplus", async () => {
    await f.fund(); await f.ready();
    const { loan } = await f.borrow({}, f.borrower, 123n);
    const boundary = loan.start + loan.term + 7n * DAY;
    await nextAt(boundary - 1n);
    await f.vault.connect(f.borrower).topUpCollateral(0, { value: 456n });
    await nextAt(boundary);
    await expect(f.vault.connect(f.stranger).expire(0)).to.emit(f.vault, "LoanDefaulted").withArgs(0n, loan.principal, loan.defaultETH, loan.collateral + 456n - loan.defaultETH);
    expect(await f.vault.totalETHCredits()).to.equal(loan.collateral + 456n);
    await expect(f.vault.expire(0)).to.be.revertedWithCustomError(f.vault, "LoanSettled");
    await f.invariant();
  });

  it("L16 valid price liquidation remains possible during maturity grace with debt frozen at Dmax", async () => {
    await f.fund(); await f.ready();
    const { loan } = await f.borrow();
    await nextAt(loan.start + TERM + 7n * DAY - 3n);
    await ethers.provider.send("evm_mine", []);
    await f.evidence({ slowPrice: 2n * PRICE, fastPrice: 2n * PRICE });
    const debt = loan.principal + interest(loan.principal, loan.rateBps, TERM);
    await nextAt(loan.start + TERM + 7n * DAY - 1n);
    await f.vault.connect(f.payer).liquidate(0, debt);
    expect((await f.vault.getLoan(0)).status).to.equal(2n);
    expect(await f.vault.totalIFRCredits()).to.equal(debt - loan.principal);
    await f.invariant();
  });

  it("C07 absolute total-cap equality holds across five offers and five wallets over rolling days", async () => {
    await f.fund();
    for (let i = 0; i < 4; i++) await f.fund(100_000n * U);
    await f.ready();
    const borrowers = [f.borrower, f.payer, f.stranger, f.nextOwner, f.otherLender];
    for (let i = 0; i < 5; i++) {
      if (i > 0) await advance(DAY + 1n);
      await f.evidence();
      await f.borrow({ offerId: BigInt(i), principal: 10_000n * U }, borrowers[i]);
      await f.borrow({ offerId: BigInt(i), principal: 10_000n * U }, borrowers[i]);
      await f.invariant();
    }
    expect(await f.vault.totalLent()).to.equal(100_000n * U);
    await expect(f.borrow({ principal: 1n }, f.receiver)).to.be.revertedWithCustomError(f.vault, "CapExceeded");
    await f.invariant();
  });

  describe("oracle consumer boundary (fabricated evidence, not adapter verification)", function () {
    beforeEach(async () => { await f.fund(); await f.ready(); });
    const invalid = [
      ["reason", 1n], ["version", 2n], ["slowPrice", 0n], ["fastPrice", 0n],
      ["slowPrice", 10n ** 18n + 1n], ["fastPrice", 10n ** 18n + 1n],
      ["slowStart", 0n], ["fastStart", 0n], ["maxGap", 0n], ["maxGap", 3601n],
      ["fastMaxGap", 0n], ["fastMaxGap", 1801n],
      ["minWethDepth", ethers.parseEther("50") - 1n], ["minIfrDepth", 1_000_000n * U - 1n],
      ["fastPrice", PRICE * 120n / 100n + 1n], ["fastPrice", PRICE * 80n / 100n - 1n],
    ];
    for (const [field, v] of invalid) {
      it(`O01 rejects invalid evidence ${field}=${v} for borrow/health/liquidation`, async () => {
        await f.borrow();
        await f.evidence({ [field]: v });
        await expect(f.vault.quote(0, U, TERM)).to.be.revertedWithCustomError(f.vault, "InvalidOracle");
        await expect(f.vault.connect(f.borrower).borrow(await f.request(), { value: ethers.parseEther("1") })).to.be.revertedWithCustomError(f.vault, "InvalidOracle");
        await expect(f.vault.health(0)).to.be.revertedWithCustomError(f.vault, "InvalidOracle");
        await expect(f.vault.liquidate(0, 10_000n * U)).to.be.revertedWithCustomError(f.vault, "InvalidOracle");
      });
    }
    it("O02 missing/stale/future/short/long/zero windows and missing coverage fail closed; reads do not refresh age", async () => {
      const t = await now();
      const bad = [
        { slowEnd: t + 100n }, { fastEnd: t + 100n }, { latestObservation: t + 100n },
        { slowStart: t - 7n * DAY + 1n }, { slowStart: t - 7n * DAY - 3601n },
        { fastStart: t - 1799n }, { fastStart: t - 3601n },
        { slowStart: t, slowEnd: t }, { fastStart: t, fastEnd: t },
        { latestObservation: t - 100n },
      ];
      for (const changes of bad) {
        await f.evidence({ slowStart: t - 7n * DAY, slowEnd: t, fastStart: t - 1800n, fastEnd: t, latestObservation: t, ...changes });
        await expect(f.vault.quote(0, U, TERM)).to.be.revertedWithCustomError(f.vault, "InvalidOracle");
      }
      await f.evidence();
      await advance(3601n);
      await expect(f.vault.quote(0, U, TERM)).to.be.revertedWithCustomError(f.vault, "InvalidOracle");
      await expect(f.vault.quote(0, U, TERM)).to.be.revertedWithCustomError(f.vault, "InvalidOracle");
      await f.oracle.setBroken(true);
      await expect(f.vault.quote(0, U, TERM)).to.be.revertedWithCustomError(f.vault, "InvalidOracle");
    });
    it("O03 origination uses max, health uses min, 20% equality passes and thin scenario fails", async () => {
      await f.evidence({ fastPrice: PRICE * 120n / 100n });
      const { loan, required } = await f.borrow();
      const Dmax = loan.principal + interest(loan.principal, 200n, TERM);
      expect(required).to.equal(ceil(value(Dmax, PRICE * 120n / 100n) * 10000n, 3000n));
      const h = await f.vault.health(0);
      expect(h.debtValueWei).to.equal(value(await f.vault.debtOf(0), PRICE));
      await f.evidence({ minWethDepth: ethers.parseEther("0.39"), minIfrDepth: 17_600_000n * U });
      await expect(f.vault.quote(0, U, TERM)).to.be.revertedWithCustomError(f.vault, "InvalidOracle");
    });
  });

  it("O04 both canonical token orders are accepted; substitute factory/pair/asset metadata is rejected", async () => {
    const reverse = await deployFixture("LendingVaultV2TokenMock", true);
    await reverse.ready();
    await reverse.fund();
    await reverse.borrow();
    const badOracle = await f.deploy("LendingVaultV2OracleMock", f.weth.target, f.token.target, f.factory.target, f.pair.target);
    const c = { ...f.configuration, adapter: badOracle.target };
    await f.queued("setConfiguration", [c]);
    await expect(f.vault.setConfiguration(c)).to.be.revertedWithCustomError(f.vault, "InvalidConfiguration");
    const fakePair = await f.deploy("MockTwapPair", f.token.target, f.stranger.address);
    await f.factory.setPair(f.token.target, f.weth.target, fakePair.target);
    const mismatched = await f.deploy("LendingVaultV2OracleMock", f.token.target, f.weth.target, f.factory.target, fakePair.target);
    c.adapter = mismatched.target;
    await f.queued("setConfiguration", [c]);
    await expect(f.vault.setConfiguration(c)).to.be.revertedWithCustomError(f.vault, "InvalidConfiguration");
    await f.factory.setPair(f.token.target, f.weth.target, f.pair.target);
    await expect(f.vault.setConfiguration(c)).to.be.revertedWithCustomError(f.vault, "InvalidConfiguration");
  });

  describe("caps across wallets and offers", function () {
    beforeEach(async () => { await f.fund(); await f.ready(); });
    for (const [field, limit, amount] of [
      ["loanCap", 999n * U, 1000n * U], ["totalCap", 999n * U, 1000n * U],
      ["borrowerCap", 999n * U, 1000n * U], ["offerCap", 999n * U, 1000n * U],
      ["dailyCap", 999n * U, 1000n * U], ["ethCap", 1n, 1000n * U], ["economicCap", 1n, 1000n * U],
    ]) {
      it(`C01 enforces ${field} independently`, async () => {
        await f.configure({ [field]: limit });
        await f.resume();
        await expect(f.borrow({ principal: amount })).to.be.revertedWithCustomError(f.vault, "CapExceeded");
        await f.invariant();
      });
    }
    it("C02 loan/borrower/two-active equality passes and third active loan fails", async () => {
      await f.borrow({ principal: 10_000n * U });
      await f.borrow({ principal: 10_000n * U });
      await expect(f.borrow({ principal: 1n })).to.be.revertedWithCustomError(f.vault, "CapExceeded");
      expect(await f.vault.borrowerPrincipal(f.borrower.address)).to.equal(20_000n * U);
      await f.invariant();
    });
    it("C03 aggregate cap and offer cap apply across wallets, repayment restores principal only", async () => {
      await f.configure({ totalCap: 2000n * U, offerCap: 2000n * U }); await f.resume();
      await f.borrow(); await f.borrow({}, f.payer);
      await expect(f.borrow({ principal: 1n }, f.stranger)).to.be.revertedWithCustomError(f.vault, "CapExceeded");
      await f.vault.connect(f.borrower).repay(0, 2000n * U);
      await f.borrow();
      expect(await f.vault.rollingOriginations()).to.equal(3000n * U);
      await f.invariant();
    });
    it("C04 gross rolling 24h is not reset by repayment/reborrow or offer creation; exact aging frees it", async () => {
      await f.configure({ dailyCap: 1000n * U }); await f.resume();
      const { loan } = await f.borrow();
      await f.vault.connect(f.borrower).repay(0, loan.principal * 2n);
      await f.fund(100_000n * U, 0n, f.otherLender);
      await expect(f.borrow({ offerId: 1n })).to.be.revertedWithCustomError(f.vault, "CapExceeded");
      await nextAt(loan.start + DAY - 3n);
      await ethers.provider.send("evm_mine", []);
      await f.evidence(); // transaction at DAY-2
      await nextAt(loan.start + DAY - 1n);
      await expect(f.vault.connect(f.borrower).borrow(await f.request(), { value: loan.collateral })).to.be.revertedWithCustomError(f.vault, "CapExceeded");
      await nextAt(loan.start + DAY);
      await f.vault.connect(f.borrower).borrow(await f.request(), { value: loan.collateral });
      expect(await f.vault.rollingOriginations()).to.equal(loan.principal);
      await f.invariant();
    });
    it("C05 ten-percent principal cap excludes donations/interest and decreases never force closure", async () => {
      const { loan } = await f.borrow({ principal: 10_000n * U });
      await f.vault.connect(f.lender).withdrawOffer(0, 900_000n * U, f.lender.address);
      await f.token.transfer(f.vault.target, 2_000_000n * U);
      await expect(f.borrow({ principal: 1n }, f.payer)).to.be.revertedWithCustomError(f.vault, "CapExceeded");
      await f.configure({ totalCap: 1n, economicCap: 0n });
      expect((await f.vault.getLoan(0)).status).to.equal(0n);
      await f.vault.connect(f.borrower).repay(0, loan.principal * 2n);
      await f.invariant();
    });
    it("C06 default exposure never increases on top-up and is released only by terminal settlement", async () => {
      const first = await f.borrow();
      const E = first.loan.defaultETH;
      await f.configure({ ethCap: E }); await f.resume();
      await f.vault.connect(f.borrower).topUpCollateral(0, { value: 1n });
      expect(await f.vault.totalDefaultExposure()).to.equal(E);
      await expect(f.borrow({ principal: 1n }, f.payer)).to.be.revertedWithCustomError(f.vault, "CapExceeded");
      await f.vault.connect(f.borrower).repay(0, first.loan.principal * 2n);
      expect(await f.vault.totalDefaultExposure()).to.equal(0n);
      await f.borrow();
      await f.invariant();
    });
  });

  describe("hostile recipients and token callbacks", function () {
    beforeEach(async () => { await f.fund(); await f.ready(); });
    it("H01 rejecting ETH borrower cannot block settlement or other claims; failed claim restores credit; WETH works", async () => {
      const actor = await f.deploy("LendingVaultV2Actor", f.owner.address);
      await f.token.mint(actor.target, 10_000n * U);
      await actor.execute(f.token.target, f.token.interface.encodeFunctionData("approve", [f.vault.target, ethers.MaxUint256]));
      const req = await f.request();
      const [C] = await f.vault.quote(0, req.principal, req.term);
      await actor.execute(f.vault.target, f.calldata("borrow", [req]), { value: C });
      await actor.configure(true, ethers.ZeroAddress, "0x");
      await actor.execute(f.vault.target, f.calldata("repay", [0, req.principal * 2n]));
      expect((await f.vault.getLoan(0)).status).to.equal(1n);
      await expect(actor.execute(f.vault.target, f.calldata("claimETH", [actor.target, false]))).to.be.revertedWithCustomError(f.vault, "ETHTransferFailed");
      expect(await f.vault.ethCredits(actor.target)).to.equal(C);
      await f.vault.connect(f.receiver).claimIFR(f.receiver.address);
      await actor.execute(f.vault.target, f.calldata("claimETH", [actor.target, true]));
      expect(await f.weth.balanceOf(actor.target)).to.equal(C);
      expect(await f.vault.ethCredits(actor.target)).to.equal(0n);
      await f.invariant();
    });
    it("H02 malicious ETH receiver cannot reenter claims; guard failure is explicit and credit is consumed once", async () => {
      const { loan } = await f.borrow();
      await f.vault.connect(f.borrower).repay(0, loan.principal * 2n);
      const actor = await f.deploy("LendingVaultV2Actor", f.owner.address);
      await actor.configure(false, f.vault.target, f.calldata("claimETH", [actor.target, false]));
      await f.vault.connect(f.borrower).claimETH(actor.target, false);
      expect(await actor.reentryFailure()).to.equal(f.vault.interface.getError("ReentrancyGuardReentrantCall").selector);
      expect(await actor.received()).to.equal(loan.collateral);
      expect(await f.vault.ethCredits(f.borrower.address)).to.equal(0n);
      await f.invariant();
    });
    it("H03 claim errors and incompatible WETH restore entitlement", async () => {
      await expect(f.vault.claimETH(f.owner.address, false)).to.be.revertedWithCustomError(f.vault, "NothingToClaim");
      await expect(f.vault.claimIFR(f.owner.address)).to.be.revertedWithCustomError(f.vault, "NothingToClaim");
      for (const d of [ethers.ZeroAddress, f.vault.target]) {
        await expect(f.vault.claimETH(d, false)).to.be.revertedWithCustomError(f.vault, "InvalidAddress");
        await expect(f.vault.claimIFR(d)).to.be.revertedWithCustomError(f.vault, "InvalidAddress");
      }
      const { loan } = await f.borrow();
      await f.vault.connect(f.borrower).repay(0, loan.principal * 2n);
      await f.weth.setShortMint(true);
      await expect(f.vault.connect(f.borrower).claimETH(f.borrower.address, true)).to.be.revertedWithCustomError(f.vault, "ReceiptMismatch");
      expect(await f.vault.ethCredits(f.borrower.address)).to.equal(loan.collateral);
      await f.invariant();
    });
    it("H04 taxed origination receipt reverts all loan/exposure/rolling accounting", async () => {
      await f.token.setFeeBps(350); // deliberately dishonest exemption report
      await expect(f.borrow()).to.be.revertedWithCustomError(f.vault, "ReceiptMismatch");
      expect(await f.vault.getLoanCount()).to.equal(0n);
      expect(await f.vault.rollingOriginations()).to.equal(0n);
      await f.invariant();
    });
  });

  it("H05 existing malicious token mock cannot reenter funding, borrowing, repayment or IFR claims", async () => {
    f = await deployFixture("LendingVaultV2ReentrantTokenMock");
    const attack = f.calldata("claimIFR", [f.stranger.address]);
    await f.token.arm(f.vault.target, attack);
    await expect(f.fund()).to.be.revertedWithCustomError(f.vault, "ReentrancyGuardReentrantCall");
    await f.token.arm(ethers.ZeroAddress, "0x"); await f.fund(); await f.ready();
    await f.token.arm(f.vault.target, attack);
    await expect(f.borrow()).to.be.revertedWithCustomError(f.vault, "ReentrancyGuardReentrantCall");
    await f.token.arm(ethers.ZeroAddress, "0x"); const { loan } = await f.borrow();
    await f.token.arm(f.vault.target, attack);
    await expect(f.vault.connect(f.borrower).repay(0, loan.principal * 2n)).to.be.revertedWithCustomError(f.vault, "ReentrancyGuardReentrantCall");
    await f.token.arm(ethers.ZeroAddress, "0x"); await f.vault.connect(f.borrower).repay(0, loan.principal * 2n);
    await f.token.arm(f.vault.target, attack);
    await expect(f.vault.connect(f.receiver).claimIFR(f.receiver.address)).to.be.revertedWithCustomError(f.vault, "ReentrancyGuardReentrantCall");
    await f.invariant();
  });

  it("H06 actual repository IFR token supports exemption revocation, taxed net repayment and default without transfers", async () => {
    f = await deployFixture("InfernoToken");
    await f.fund(); await f.ready();
    const { loan } = await f.borrow();
    const second = await f.borrow({}, f.payer);
    await f.token.setFeeExempt(f.vault.target, false);
    await expect(f.fund()).to.be.revertedWithCustomError(f.vault, "FeeExemptionRequired");
    await expect(f.vault.connect(f.borrower).repay(0, loan.principal)).to.be.revertedWithCustomError(f.vault, "InsufficientReceipt");
    await f.vault.connect(f.borrower).repay(0, loan.principal * 2n);
    await f.oracle.setBroken(true);
    await nextAt(second.loan.start + TERM + 7n * DAY);
    await f.vault.connect(f.stranger).expire(1);
    expect(await f.vault.totalLosses()).to.equal(second.loan.principal);
    await f.invariant();
  });

  it("I01 deterministic pseudo-random conservation sequence across offers, wallets, repayments, defaults and claims", async () => {
    await f.fund(); await f.fund(1_000_000n * U, 37n, f.otherLender); await f.ready();
    let seed = 0x12345678n;
    const random = () => { seed = (1664525n * seed + 1013904223n) % (1n << 32n); return seed; };
    for (let round = 0; round < 10; round++) {
      await f.evidence();
      const principal = (random() % 500n + 1n) * U + random() % U;
      const who = random() % 2n ? f.borrower : f.payer;
      const { id, loan } = await f.borrow({ offerId: random() % 2n, principal }, who);
      if (random() % 2n) await f.vault.connect(who).topUpCollateral(id, { value: random() + 1n });
      await advance(random() % 1000n + 1n);
      await f.vault.connect(who).repay(id, principal * 2n);
      await f.invariant();
      if (round % 3 === 0) {
        await f.vault.connect(who).claimETH(who.address, round % 2 === 0);
        await f.vault.connect(who).claimIFR(who.address);
      }
    }
    await f.evidence();
    const { loan } = await f.borrow();
    await nextAt(loan.start + TERM + 7n * DAY);
    await f.vault.connect(f.stranger).expire(10);
    await f.invariant();
    await f.vault.connect(f.lender).claimETH(f.lender.address, false);
    await f.vault.connect(f.receiver).claimIFR(f.receiver.address);
    await f.invariant();
  });
});
