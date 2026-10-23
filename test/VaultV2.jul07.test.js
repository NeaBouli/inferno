import { expect } from "chai";
import { ethers } from "./helpers/hardhat.js";

// JUL-07: local simulated chain only; oracle responses are fabricated test data.
// IFR amounts stay in nine-decimal bigint base units throughout.
const U = 10n ** 9n;
const DAY = 86400n;
const TERM = 30n * DAY;
const PRICE = 10n ** 12n;
const LIMITS = [100000n * U, 250000n * U, 1000000n * U, 100000n * U];
const ceil = (a, b) => (a + b - 1n) / b;
const netIFR = (amount, taxed) => taxed
  ? amount - amount * 200n / 10000n - amount * 50n / 10000n - amount * 100n / 10000n
  : amount;
const mockNet = (amount, fee) => amount - amount * fee / 10000n;
const now = async () => BigInt((await ethers.provider.getBlock("latest")).timestamp);
const nextAt = async (time) => ethers.provider.send("evm_setNextBlockTimestamp", [Number(time)]);
async function mineAt(time) {
  await nextAt(time);
  await ethers.provider.send("evm_mine", []);
}
async function deploy(name, ...args) {
  const contract = await (await ethers.getContractFactory(name)).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function baseFixture(mock = false) {
  const [owner, pool, receiver, ...users] = (await ethers.getSigners()).slice(0, 10);
  const token = mock ? await deploy("MockCommitmentV2Token") : await deploy("InfernoToken", pool.address);
  if (!mock) await token.setFeeExempt(owner.address, true);
  return { owner, pool, receiver, users, token, mock, accounts: [owner, pool, receiver, ...users] };
}
async function prepareUsers(f) {
  for (const user of f.users) {
    if (f.mock) await f.token.mint(user.address, 1000000n * U);
    else await f.token.transfer(user.address, 1000000n * U);
    await f.token.connect(user).approve(f.vault.target, ethers.MaxUint256);
  }
}
async function exempt(f, value, unreadable = false) {
  if (f.mock) await f.token.setExemption(value, unreadable);
  else await f.token.setFeeExempt(f.vault.target, value);
}
async function tokenState(f) {
  return {
    balances: await Promise.all([...f.accounts.map((a) => a.address), f.vault.target].map((a) => f.token.balanceOf(a))),
    allowances: await Promise.all(f.users.map((u) => f.token.allowance(u.address, f.vault.target))),
    supply: await f.token.totalSupply(),
  };
}

async function commitmentFixture(mock = false) {
  const f = await baseFixture(mock);
  f.vault = await deploy("CommitmentVaultV2", f.token.target, f.owner.address);
  await exempt(f, true);
  await prepareUsers(f);
  await f.vault.queueEntryConfiguration(LIMITS);
  await nextAt(await f.vault.configurationEta());
  await f.vault.executeEntryConfiguration(await f.vault.configurationNonce());
  return f;
}
async function commitmentState(f) {
  const wallets = [];
  for (const user of f.users) {
    const tranches = [];
    for (let id = 0n; id < await f.vault.getTrancheCount(user.address); id++) {
      tranches.push(Array.from(await f.vault.getTranche(user.address, id)));
    }
    wallets.push([tranches, await f.vault.lockedBalance(user.address), await f.vault.activeLockCount(user.address)]);
  }
  return {
    token: await tokenState(f), wallets, total: await f.vault.totalLocked(),
    entries: await f.vault.unprunedEntryAmount(), head: await f.vault.entryHead(),
  };
}
async function commitmentInvariant(f) {
  let claims = 0n;
  for (const user of f.users) {
    let wallet = 0n, active = 0n;
    for (let id = 0n; id < await f.vault.getTrancheCount(user.address); id++) {
      const tranche = await f.vault.getTranche(user.address, id);
      if (tranche.unlocked) expect(tranche.amount).to.equal(0n);
      else { wallet += tranche.amount; active++; }
    }
    expect(await f.vault.lockedBalance(user.address)).to.equal(wallet);
    expect(await f.vault.activeLockCount(user.address)).to.equal(active);
    claims += wallet;
  }
  expect(await f.vault.totalLocked()).to.equal(claims);
  expect(claims).to.be.lte(await f.token.balanceOf(f.vault.target));
}

async function lendingFixture(mock = false) {
  const f = await baseFixture(mock);
  f.weth = await deploy("LendingVaultV2WETHMock");
  const factory = await deploy("MockPairFactory");
  const pair = await deploy("MockTwapPair", f.token.target, f.weth.target);
  await factory.setPair(f.token.target, f.weth.target, pair.target);
  f.oracle = await deploy("LendingVaultV2OracleMock", f.token.target, f.weth.target, factory.target, pair.target);
  f.vault = await deploy("LendingVaultV2", f.token.target, f.weth.target, factory.target, f.owner.address);
  await exempt(f, true);
  await prepareUsers(f);
  f.evidence = async (price = PRICE) => {
    const t = await now();
    await f.oracle.setEvidence(1n, {
      version: 1n, slowPrice: price, fastPrice: price, slowStart: t - 7n * DAY, slowEnd: t,
      fastStart: t - 1800n, fastEnd: t, latestObservation: t, maxGap: 1800n, fastMaxGap: 1800n,
      minWethDepth: ethers.parseEther("50"), minIfrDepth: 10000000n * U, reason: 0n,
    });
  };
  f.queue = async (method, args) => {
    const data = f.vault.interface.encodeFunctionData(method, args);
    await f.vault.queueAction(data);
    await mineAt(await f.vault.actionETA(ethers.keccak256(data)));
  };
  const configuration = {
    adapter: f.oracle.target, oracleVersion: 1n, feeReceiver: f.receiver.address,
    minPrice: 1n, maxPrice: 10n ** 18n, minIfrDepth: 1000000n * U,
    totalCap: 100000n * U, loanCap: 10000n * U, borrowerCap: 20000n * U,
    offerCap: 25000n * U, dailyCap: 25000n * U, ethCap: ethers.parseEther("0.5"), economicCap: ethers.parseEther("0.5"),
  };
  await f.vault.connect(f.receiver).confirmFeeReceiver();
  await f.queue("setConfiguration", [configuration]);
  await f.vault.setConfiguration(configuration);
  const nonce = await f.vault.pauseNonce();
  await f.queue("resume", [nonce, true, true]);
  await f.evidence();
  await f.vault.resume(nonce, true, true);
  f.fund = async (user, amount = 100000n * U) => {
    const id = await f.vault.getOfferCount();
    await f.vault.connect(user).createOffer(amount, 200n, TERM, TERM);
    return id;
  };
  f.request = async (offerId = 0n, principal = 1000n * U + 123456789n) => ({
    offerId, principal, term: TERM, maxRateBps: 200n, minReceived: principal,
    maxCollateral: ethers.parseEther("1"), deadline: (await now()) + 3600n,
  });
  f.borrow = async (user, offerId = 0n, principal) => {
    await f.evidence();
    const request = await f.request(offerId, principal);
    const [collateral] = await f.vault.quote(offerId, request.principal, TERM);
    const id = await f.vault.getLoanCount();
    await f.vault.connect(user).borrow(request, { value: collateral });
    return { id, loan: await f.vault.getLoan(id) };
  };
  return f;
}
async function lendingState(f) {
  const offers = [], loans = [];
  for (let id = 0n; id < await f.vault.getOfferCount(); id++) offers.push(Array.from(await f.vault.getOffer(id)));
  for (let id = 0n; id < await f.vault.getLoanCount(); id++) loans.push(Array.from(await f.vault.getLoan(id)));
  return {
    token: await tokenState(f), offers, loans, eth: await ethers.provider.getBalance(f.vault.target),
    totals: await Promise.all(["totalAvailable", "totalLent", "totalCollateral", "totalDefaultExposure", "totalIFRCredits", "totalETHCredits", "totalLosses", "rollingOriginations"].map((m) => f.vault[m]())),
    credits: await Promise.all(f.accounts.map(async (a) => [await f.vault.ifrCredits(a.address), await f.vault.ethCredits(a.address)])),
    borrowers: await Promise.all(f.users.map(async (a) => [await f.vault.borrowerPrincipal(a.address), await f.vault.activeLoanCount(a.address)])),
  };
}
async function lendingInvariant(f) {
  let available = 0n, lent = 0n, losses = 0n, collateral = 0n, exposure = 0n, ifrCredits = 0n, ethCredits = 0n;
  const principalByUser = new Map(), countByUser = new Map(), lentByOffer = new Map();
  for (let id = 0n; id < await f.vault.getLoanCount(); id++) {
    const loan = await f.vault.getLoan(id);
    if (loan.status !== 0n) { expect(loan.collateral).to.equal(0n); continue; }
    lent += loan.principal; collateral += loan.collateral; exposure += loan.defaultETH;
    lentByOffer.set(loan.offerId, (lentByOffer.get(loan.offerId) ?? 0n) + loan.principal);
    principalByUser.set(loan.borrower, (principalByUser.get(loan.borrower) ?? 0n) + loan.principal);
    countByUser.set(loan.borrower, (countByUser.get(loan.borrower) ?? 0n) + 1n);
  }
  for (let id = 0n; id < await f.vault.getOfferCount(); id++) {
    const offer = await f.vault.getOffer(id);
    available += offer.available; losses += offer.losses;
    expect(offer.lent).to.equal(lentByOffer.get(id) ?? 0n);
  }
  for (const account of f.accounts) {
    ifrCredits += await f.vault.ifrCredits(account.address);
    ethCredits += await f.vault.ethCredits(account.address);
  }
  for (const user of f.users) {
    expect(await f.vault.borrowerPrincipal(user.address)).to.equal(principalByUser.get(user.address) ?? 0n);
    expect(await f.vault.activeLoanCount(user.address)).to.equal(countByUser.get(user.address) ?? 0n);
  }
  for (const [getter, expected] of Object.entries({ totalAvailable: available, totalLent: lent, totalLosses: losses,
    totalCollateral: collateral, totalDefaultExposure: exposure, totalIFRCredits: ifrCredits, totalETHCredits: ethCredits })) {
    expect(await f.vault[getter](), getter).to.equal(expected);
  }
  // Lent principal is a borrower receivable, not a simultaneous liquid claim.
  expect(available + ifrCredits).to.be.lte(await f.token.balanceOf(f.vault.target));
  expect(collateral + ethCredits).to.be.lte(await ethers.provider.getBalance(f.vault.target));
}
async function payout(f, user, gross, taxed, action) {
  const cash = await f.token.balanceOf(f.vault.target);
  const wallet = await f.token.balanceOf(user.address);
  expect(gross).to.be.lte(cash);
  await action();
  expect(cash - await f.token.balanceOf(f.vault.target)).to.equal(gross);
  expect(await f.token.balanceOf(user.address) - wallet).to.equal(netIFR(gross, taxed));
}
function debtAt(loan, timestamp) {
  const elapsed = timestamp - loan.start < loan.term ? timestamp - loan.start : loan.term;
  return loan.principal + ceil(loan.principal * loan.rateBps * elapsed, 10000n * TERM);
}
async function settle(f, id, payer, liquidate, taxed) {
  const loan = await f.vault.getLoan(id);
  if (liquidate) await f.evidence(2n * PRICE);
  const time = (await now()) + 100n;
  const debt = debtAt(loan, time);
  const gross = (taxed ? ceil(debt * 10000n, 9650n) : debt) + 7n * U + 1n;
  const received = netIFR(gross, taxed);
  const before = await lendingState(f);
  const offer = await f.vault.getOffer(loan.offerId);
  const method = liquidate ? "liquidate" : "repay";
  const short = taxed ? debt : debt - 1n;
  await nextAt(time);
  await expect(f.vault.connect(payer)[method](id, short)).to.be.revertedWithCustomError(f.vault, "InsufficientReceipt")
    .withArgs(debt, netIFR(short, taxed));
  expect(await lendingState(f)).to.deep.equal(before);
  await lendingInvariant(f);

  // Pin the successful block as well, so interest assertions do not depend on automine timing.
  const paidDebt = debtAt(loan, time + 1n);
  const lenderInterest = (paidDebt - loan.principal) / 2n;
  const protocolInterest = paidDebt - loan.principal - lenderInterest;
  const lenderBefore = await f.vault.ifrCredits(offer.lender);
  const receiverBefore = await f.vault.ifrCredits(f.receiver.address);
  const payerBefore = await f.vault.ifrCredits(payer.address);
  const liquidatorBefore = await f.vault.ethCredits(payer.address);
  const borrowerBefore = await f.vault.ethCredits(loan.borrower);
  const cashBefore = await f.token.balanceOf(f.vault.target);
  const walletBefore = await f.token.balanceOf(payer.address);
  const ethBefore = await ethers.provider.getBalance(f.vault.target);
  await nextAt(time + 1n);
  await expect(f.vault.connect(payer)[method](id, gross)).to.emit(f.vault, "LoanPaid")
    .withArgs(id, liquidate ? 2n : 1n, payer.address, paidDebt, received, lenderInterest, protocolInterest);
  expect(await f.token.balanceOf(f.vault.target) - cashBefore).to.equal(received);
  expect(walletBefore - await f.token.balanceOf(payer.address)).to.equal(gross);
  expect(await f.vault.ifrCredits(offer.lender) - lenderBefore).to.equal(lenderInterest);
  expect(await f.vault.ifrCredits(f.receiver.address) - receiverBefore).to.equal(protocolInterest);
  expect(await f.vault.ifrCredits(payer.address) - payerBefore).to.equal(received - paidDebt);
  expect((await f.vault.getOffer(loan.offerId)).available - offer.available).to.equal(loan.principal);
  // Settlement partitions existing collateral into credits without pushing ETH or minting IFR.
  expect(await ethers.provider.getBalance(f.vault.target)).to.equal(ethBefore);
  if (liquidate) {
    const value = ceil(paidDebt * 2n * PRICE, U);
    const bonusPayment = ceil(value * 10500n, 10000n);
    const payment = bonusPayment < loan.collateral ? bonusPayment : loan.collateral;
    expect(await f.vault.ethCredits(payer.address) - liquidatorBefore).to.equal(payment);
    expect(await f.vault.ethCredits(loan.borrower) - borrowerBefore).to.equal(loan.collateral - payment);
  } else expect(await f.vault.ethCredits(loan.borrower) - borrowerBefore).to.equal(loan.collateral);
  await lendingInvariant(f);
  const settled = await lendingState(f);
  await expect(f.vault.connect(payer)[method](id, gross)).to.be.revertedWithCustomError(f.vault, "LoanSettled");
  expect(await lendingState(f)).to.deep.equal(settled);
}

describe("JUL-07 V2 vault fee-exemption solvency evidence", function () {
  for (const fee of [350n, 500n, 10000n]) {
    it(`J07-C1.${fee} rejects a ${fee} bps short lock receipt atomically, then credits an exact balance difference`, async () => {
      const f = await commitmentFixture(true);
      const user = f.users[0], amount = 1234567890123n;
      await f.token.setFeeBps(fee); // Getter deliberately lies: receipt checks must be independent.
      const before = await commitmentState(f);
      await expect(f.vault.connect(user).lock(amount, 0, (await now()) + 2n * DAY, 0))
        .to.be.revertedWithCustomError(f.vault, "ReceiptMismatch").withArgs(amount, mockNet(amount, fee));
      expect(await commitmentState(f)).to.deep.equal(before);
      await f.token.setFeeBps(0n);
      const balance = await f.token.balanceOf(f.vault.target);
      await f.vault.connect(user).lock(amount, 0, (await now()) + 2n * DAY, 0);
      expect((await f.vault.getTranche(user.address, 0n)).amount).to.equal(await f.token.balanceOf(f.vault.target) - balance);
      expect(await f.vault.totalLocked()).to.equal(amount);
      await commitmentInvariant(f);
    });
  }

  for (const unreadable of [false, true]) {
    it(`J07-C2.${unreadable} fails closed on ${unreadable ? "unreadable" : "revoked"} exemption at lock/configuration execution`, async () => {
      const f = await commitmentFixture(true);
      await f.vault.queueEntryConfiguration(LIMITS);
      const nonce = await f.vault.configurationNonce(), eta = await f.vault.configurationEta();
      await exempt(f, false, unreadable);
      await mineAt(eta);
      const before = await commitmentState(f);
      await expect(f.vault.executeEntryConfiguration(nonce)).to.be.revertedWithCustomError(f.vault, "FeeExemptionRequired");
      await expect(f.vault.connect(f.users[0]).lock(U, 0, (await now()) + 2n * DAY, 0))
        .to.be.revertedWithCustomError(f.vault, "FeeExemptionRequired");
      expect(await commitmentState(f)).to.deep.equal(before);
      expect(await f.vault.configurationEta()).to.equal(eta);
      await commitmentInvariant(f);
    });
  }

  it("J07-C3 preserves every user's claim coverage through three mixed-tax rounds and nine permissionless exits", async () => {
    const f = await commitmentFixture();
    const users = f.users.slice(0, 3);
    await f.token.transfer(f.vault.target, 17n); // Donations must never become claims.
    for (let round = 0; round < 3; round++) {
      await exempt(f, true);
      const deadline = (await now()) + DAY + 1000n;
      for (const [index, user] of users.entries()) {
        const amount = BigInt(round + index + 1) * U + 123456789n;
        await f.vault.connect(user).lock(amount, 0, deadline, 0);
        await commitmentInvariant(f);
      }
      await exempt(f, false);
      const before = await commitmentState(f);
      await expect(f.vault.connect(users[0]).lock(U, 0, deadline, 0)).to.be.revertedWithCustomError(f.vault, "FeeExemptionRequired");
      expect(await commitmentState(f)).to.deep.equal(before);
      await mineAt(deadline);
      for (const [index, user] of users.entries()) {
        const taxed = (round + index) % 2 === 0;
        await exempt(f, !taxed);
        const id = BigInt(round), amount = (await f.vault.getTranche(user.address, id)).amount;
        await payout(f, user, amount, taxed, async () => {
          await expect(f.vault.connect(f.users[6]).unlock(user.address, id)).to.emit(f.vault, "Unlocked")
            .withArgs(user.address, id, f.users[6].address, 2n, amount, netIFR(amount, taxed));
        });
        await commitmentInvariant(f);
        await expect(f.vault.unlock(user.address, id)).to.be.revertedWithCustomError(f.vault, "AlreadyUnlocked");
      }
    }
    expect(await f.vault.totalLocked()).to.equal(0n);
    expect(await f.token.balanceOf(f.vault.target)).to.equal(17n);
  });

  it("J07-L1 rejects taxed create/fund/borrow receipts even when exemption metadata reports true", async () => {
    const f = await lendingFixture(true), lender = f.users[0], borrower = f.users[3];
    await f.fund(lender);
    for (const fee of [350n, 500n, 10000n]) {
      await f.token.setFeeBps(fee);
      const amount = 1234567890123n;
      const before = await lendingState(f);
      for (const action of [() => f.fund(f.users[1], amount), () => f.vault.connect(lender).fundOffer(0n, amount)]) {
        await expect(action()).to.be.revertedWithCustomError(f.vault, "ReceiptMismatch").withArgs(amount, mockNet(amount, fee));
        expect(await lendingState(f)).to.deep.equal(before);
        await lendingInvariant(f);
      }
      await f.evidence();
      const request = await f.request();
      const [collateral] = await f.vault.quote(0n, request.principal, TERM);
      await expect(f.vault.connect(borrower).borrow(request, { value: collateral }))
        .to.be.revertedWithCustomError(f.vault, "ReceiptMismatch").withArgs(request.principal, mockNet(request.principal, fee));
      expect(await lendingState(f)).to.deep.equal(before);
      await lendingInvariant(f);
    }
    await f.token.setFeeBps(0n);
    const cash = await f.token.balanceOf(f.vault.target), claims = await f.vault.totalAvailable();
    await f.vault.connect(lender).fundOffer(0n, 1234567890123n);
    expect(await f.vault.totalAvailable() - claims).to.equal(await f.token.balanceOf(f.vault.target) - cash);
  });

  for (const unreadable of [false, true]) {
    it(`J07-L2.${unreadable} fails closed on ${unreadable ? "unreadable" : "revoked"} exemption for create/fund/borrow/resume`, async () => {
      const f = await lendingFixture(true), lender = f.users[0];
      await f.fund(lender);
      await exempt(f, false, unreadable);
      const request = await f.request();
      const [collateral] = await f.vault.quote(0n, request.principal, TERM);
      const before = await lendingState(f);
      for (const action of [() => f.fund(f.users[1]), () => f.vault.connect(lender).fundOffer(0n, U),
        () => f.vault.connect(f.users[3]).borrow(request, { value: collateral })]) {
        await expect(action()).to.be.revertedWithCustomError(f.vault, "FeeExemptionRequired");
        expect(await lendingState(f)).to.deep.equal(before);
      }
      await f.vault.pause(true, false);
      const nonce = await f.vault.pauseNonce();
      await f.queue("resume", [nonce, true, false]);
      await f.evidence();
      await expect(f.vault.resume(nonce, true, false)).to.be.revertedWithCustomError(f.vault, "FeeExemptionRequired");
      expect(await f.vault.borrowingPaused()).to.equal(true);
      await lendingInvariant(f);
    });
  }

  for (const liquidate of [false, true]) for (const taxed of [false, true]) {
    it(`J07-L3.${liquidate}.${taxed} ${liquidate ? "liquidation" : "repayment"} credits measured ${taxed ? "taxed" : "exempt"} receipts and rejects underpayment`, async () => {
      const f = await lendingFixture();
      await f.fund(f.users[0]);
      await f.fund(f.users[1]);
      const { id } = await f.borrow(f.users[3]);
      await exempt(f, !taxed);
      await settle(f, id, liquidate ? f.users[6] : f.users[3], liquidate, taxed);
      expect((await f.vault.getOffer(1n)).available).to.equal(100000n * U);
      for (const user of [f.users[0], f.receiver, liquidate ? f.users[6] : f.users[3]]) {
        const gross = await f.vault.ifrCredits(user.address);
        expect(gross).to.be.gt(0n);
        await payout(f, user, gross, taxed, () => f.vault.connect(user).claimIFR(user.address));
        await lendingInvariant(f);
        await expect(f.vault.connect(user).claimIFR(user.address)).to.be.revertedWithCustomError(f.vault, "NothingToClaim");
      }
    });
  }

  it("J07-L4 conserves all liquid IFR/ETH claims across three lenders, three borrowers, six mixed-tax rounds and default", async () => {
    const f = await lendingFixture(), lenders = f.users.slice(0, 3), borrowers = f.users.slice(3, 6);
    for (const user of lenders) { await f.fund(user); await lendingInvariant(f); }
    await f.token.transfer(f.vault.target, 19n);
    for (let round = 0; round < 6; round++) {
      await exempt(f, true);
      const index = round % 3, lender = lenders[index], borrower = borrowers[index];
      const cash = await f.token.balanceOf(f.vault.target), available = await f.vault.totalAvailable();
      await f.vault.connect(lender).fundOffer(BigInt(index), 100n * U + BigInt(round));
      expect(await f.vault.totalAvailable() - available).to.equal(await f.token.balanceOf(f.vault.target) - cash);
      await lendingInvariant(f);
      const { id } = await f.borrow(borrower, BigInt(index), (100n + BigInt(round)) * U + 123456789n);
      await lendingInvariant(f);
      const taxed = round % 2 === 0;
      await exempt(f, !taxed);
      const snapshot = await lendingState(f), offer = await f.vault.getOffer(BigInt(index));
      await expect(f.vault.connect(lender).withdrawOffer(BigInt(index), offer.available + 1n, lender.address))
        .to.be.revertedWithCustomError(f.vault, "InsufficientAvailable");
      expect(await lendingState(f)).to.deep.equal(snapshot);
      await payout(f, lender, 13n * U + 7n, taxed, () => f.vault.connect(lender).withdrawOffer(BigInt(index), 13n * U + 7n, lender.address));
      await lendingInvariant(f);
      await settle(f, id, round % 3 === 1 ? f.users[6] : borrower, round % 3 === 1, taxed);
      for (const user of [borrower, lender, f.receiver, f.users[6]]) {
        const credit = await f.vault.ifrCredits(user.address);
        if (credit > 0n) {
          await payout(f, user, credit, taxed, () => f.vault.connect(user).claimIFR(user.address));
          await lendingInvariant(f);
        }
      }
    }
    await exempt(f, true);
    const { id, loan } = await f.borrow(borrowers[0]);
    await exempt(f, false);
    await mineAt(loan.start + TERM + 7n * DAY);
    await f.vault.expire(id);
    expect(await f.vault.totalLosses()).to.equal(loan.principal);
    await lendingInvariant(f);
    for (const [index, user] of lenders.entries()) {
      const amount = (await f.vault.getOffer(BigInt(index))).available;
      const taxed = index % 2 === 0;
      await exempt(f, !taxed);
      await payout(f, user, amount, taxed, () => f.vault.connect(user).withdrawOffer(BigInt(index), amount, user.address));
      await lendingInvariant(f);
    }
    for (const user of f.accounts) {
      const credit = await f.vault.ethCredits(user.address);
      if (credit === 0n) continue;
      const cash = await ethers.provider.getBalance(f.vault.target);
      expect(credit).to.be.lte(cash);
      await f.vault.connect(user).claimETH(user.address, false);
      expect(cash - await ethers.provider.getBalance(f.vault.target)).to.equal(credit);
      await lendingInvariant(f);
      await expect(f.vault.connect(user).claimETH(user.address, false)).to.be.revertedWithCustomError(f.vault, "NothingToClaim");
    }
    expect(await f.token.balanceOf(f.vault.target)).to.equal(19n);
    expect(await ethers.provider.getBalance(f.vault.target)).to.equal(0n);
  });

  async function bootstrapFixture() {
    const f = await baseFixture();
    const weth = await deploy("LendingVaultV2WETHMock");
    f.router = await deploy("MockBootstrapRouter", weth.target);
    f.allocation = 10001n * U + 101n;
    const start = (await now()) + 100n;
    f.vault = await deploy("BootstrapVaultV2", f.token.target, f.router.target, ethers.ZeroAddress,
      start, DAY, f.allocation, ethers.parseEther("0.01"), ethers.parseEther("1"), 365n * DAY);
    await prepareUsers(f);
    await mineAt(start);
    for (const [index, user] of f.users.slice(0, 3).entries()) {
      await f.vault.connect(user).contribute({ value: BigInt(index + 1) * ethers.parseEther("0.01") });
    }
    return f;
  }

  it("J07-B1 uses actual prefunding balance: taxed nominal 2x allocation cannot finalise", async () => {
    const f = await bootstrapFixture(), amount = 2n * f.allocation;
    await f.token.connect(f.users[0]).transfer(f.vault.target, amount);
    expect(await f.token.balanceOf(f.vault.target)).to.equal(netIFR(amount, true));
    await mineAt(await f.vault.endTime());
    const before = await tokenState(f), eth = await ethers.provider.getBalance(f.vault.target);
    await expect(f.vault.finalise()).to.be.revertedWith("BootstrapVault: insufficient IFR balance");
    expect(await tokenState(f)).to.deep.equal(before);
    expect(await ethers.provider.getBalance(f.vault.target)).to.equal(eth);
    expect(await f.vault.finalised()).to.equal(false);
  });

  it("J07-B2 FINDING: bootstrap claims stay covered but do not fail closed or disclose measured net payouts", async () => {
    const f = await bootstrapFixture(), users = f.users.slice(0, 3);
    await exempt(f, true);
    await f.token.transfer(f.vault.target, 2n * f.allocation);
    await mineAt(await f.vault.endTime());
    await f.vault.finalise(); // Router is a local mock, not production liquidity evidence.
    async function invariant() {
      let claims = 0n;
      for (const user of users) if (!await f.vault.claimed(user.address)) claims += await f.vault.getEstimatedIFR(user.address);
      expect(claims).to.be.lte(await f.token.balanceOf(f.vault.target));
    }
    await invariant();
    for (const [index, user] of users.entries()) {
      const taxed = index % 2 === 0;
      await exempt(f, !taxed);
      const gross = await f.vault.getEstimatedIFR(user.address);
      await payout(f, user, gross, taxed, async () => {
        await expect(f.vault.connect(user).claim()).to.emit(f.vault, "Claimed").withArgs(user.address, gross);
      });
      expect(await f.vault.claimed(user.address)).to.equal(true);
      await invariant();
      await expect(f.vault.connect(user).claim()).to.be.revertedWith("already claimed");
    }
    const allocations = await Promise.all(users.map((u) => f.vault.getEstimatedIFR(u.address)));
    const dust = f.allocation - allocations.reduce((sum, amount) => sum + amount, 0n);
    expect(await f.token.balanceOf(f.vault.target)).to.equal(dust);
  });

  for (const name of ["CommitmentVault", "LendingVault"]) {
    it(`J07-V1.${name} reproduces the nominal-credit deficit after exemption removal for comparison`, async () => {
      const f = await baseFixture();
      f.vault = await deploy(name, f.token.target, f.owner.address);
      await prepareUsers(f);
      await exempt(f, true);
      const amount = 1000n * U;
      if (name === "CommitmentVault") await f.vault.connect(f.users[0]).lock(amount, 0, (await now()) + DAY, 0);
      else await f.vault.connect(f.users[0]).createOffer(amount);
      await exempt(f, false);
      if (name === "CommitmentVault") await f.vault.connect(f.users[1]).lock(amount, 0, (await now()) + DAY, 0);
      else await f.vault.connect(f.users[1]).createOffer(amount);
      const claims = name === "CommitmentVault" ? await f.vault.totalLocked() : await f.vault.totalAvailable();
      expect(claims).to.equal(2n * amount);
      expect(await f.token.balanceOf(f.vault.target)).to.equal(amount + netIFR(amount, true));
      expect(claims - await f.token.balanceOf(f.vault.target)).to.equal(35n * U);
    });
  }
});
