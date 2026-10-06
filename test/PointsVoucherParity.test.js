import { expect } from "chai";
import { ethers } from "./helpers/hardhat.js";
import { POINTS_CONFIG } from "../apps/points-backend/src/config/points.ts";
import {
  capVoucherDiscountBps,
  signVoucherTypedData,
  voucherDomain,
} from "../apps/points-backend/src/services/voucher-eip712.ts";

// T-289: proves that vouchers produced with the points backend's real EIP-712 format
// are accepted by the real FeeRouterV1, and that discounts above the fee are rejected.
describe("Points backend voucher parity with FeeRouterV1", function () {
  let router, adapter, governance, feeCollector, voucherSigner, user;
  let nonce = 1n;

  beforeEach(async function () {
    [governance, feeCollector, voucherSigner, user] = await ethers.getSigners();
    const Router = await ethers.getContractFactory("FeeRouterV1");
    router = await Router.deploy(governance.address, feeCollector.address, voucherSigner.address);
    await router.waitForDeployment();
    const Adapter = await ethers.getContractFactory("MockAdapter");
    adapter = await Adapter.deploy();
    await adapter.waitForDeployment();
    await router.connect(governance).setAdapter(adapter.target, true);
  });

  async function issue(discountBps) {
    const { chainId } = await ethers.provider.getNetwork();
    const latest = await ethers.provider.getBlock("latest");
    const voucher = {
      user: ethers.getAddress(user.address),
      discountBps,
      maxUses: 1,
      expiry: latest.timestamp + POINTS_CONFIG.voucher.expiryDays * 86400,
      nonce: (nonce++).toString(),
    };
    const signature = await signVoucherTypedData(
      voucherSigner,
      voucherDomain(chainId, router.target),
      voucher,
    );
    return { voucher, signature };
  }

  function swap({ voucher, signature }, value = ethers.parseEther("1")) {
    return router.connect(user).swapWithFee(adapter.target, "0x", voucher, signature, true, { value });
  }

  it("deploys with the 5 bps protocol fee read from mainnet on 2026-10-06", async function () {
    expect(await router.protocolFeeBps()).to.equal(5n);
  });

  it("exposes the EIP-712 domain the backend signs and verifies at startup", async function () {
    const { chainId } = await ethers.provider.getNetwork();
    const expected = voucherDomain(chainId, router.target);
    const [, name, version, domainChainId, verifyingContract] = await router.eip712Domain();
    expect({ name, version, chainId: domainChainId, verifyingContract }).to.deep.equal({
      name: expected.name,
      version: expected.version,
      chainId: expected.chainId,
      verifyingContract: expected.verifyingContract,
    });
  });

  it("rejects a 15 bps voucher with 'Discount exceeds fee'", async function () {
    await expect(swap(await issue(15))).to.be.revertedWith("Discount exceeds fee");
  });

  it("accepts a backend-format voucher at the configured discount and waives the fee", async function () {
    const issued = await issue(POINTS_CONFIG.voucher.discountBps);
    const [valid, reason] = await router.connect(user).isVoucherValid(issued.voucher, issued.signature);
    expect(reason).to.equal("Valid");
    expect(valid).to.equal(true);
    await expect(swap(issued)).to.emit(router, "VoucherUsed").and.not.to.emit(router, "FeeCharged");
  });

  it("issues at the backend cap of the on-chain fee and is accepted after a fee change", async function () {
    await router.connect(governance).setFeeBps(3);
    const discountBps = capVoucherDiscountBps(POINTS_CONFIG.voucher, Number(await router.protocolFeeBps()));
    expect(discountBps).to.equal(3);
    await expect(swap(await issue(discountBps))).to.emit(router, "VoucherUsed").and.not.to.emit(router, "FeeCharged");
    // Without the cap the configured 5 bps would now revert.
    await expect(swap(await issue(POINTS_CONFIG.voucher.discountBps))).to.be.revertedWith("Discount exceeds fee");
  });

  it("yields no discount when the on-chain fee is 0", async function () {
    await router.connect(governance).setFeeBps(0);
    expect(capVoucherDiscountBps(POINTS_CONFIG.voucher, Number(await router.protocolFeeBps()))).to.equal(0);
  });

  it("accepts a voucher below the fee and charges the remainder", async function () {
    const value = ethers.parseEther("1");
    await expect(swap(await issue(2), value))
      .to.emit(router, "FeeCharged")
      .withArgs(user.address, (value * 3n) / 10000n);
  });
});
