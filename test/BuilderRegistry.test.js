const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BuilderRegistry", function () {
  let governance, user, builder1, builder2, builder3;
  let registry;

  beforeEach(async () => {
    [governance, user, builder1, builder2, builder3] = await ethers.getSigners();

    const BuilderRegistry = await ethers.getContractFactory("BuilderRegistry");
    registry = await BuilderRegistry.deploy(governance.address);
    await registry.deployed();
  });

  // ── T01: Deploy ─────────────────────────────────────
  describe("Deployment", () => {
    it("T01 — deploys with Governance as owner", async () => {
      expect(await registry.owner()).to.equal(governance.address);
    });
  });

  // ── T02–T10: registerBuilder ────────────────────────
  describe("registerBuilder", () => {
    it("T02 — registers a builder successfully", async () => {
      await registry.registerBuilder(builder1.address, "TestProject", "https://test.com", "creator");
      expect(await registry.isBuilder(builder1.address)).to.equal(true);
    });

    it("T03 — isBuilder returns true after registration", async () => {
      await registry.registerBuilder(builder1.address, "Alpha", "https://alpha.io", "tooling");
      expect(await registry.isBuilder(builder1.address)).to.equal(true);
    });

    it("T04 — BuilderInfo stored correctly", async () => {
      await registry.registerBuilder(builder1.address, "MyDApp", "https://mydapp.io", "integration");
      const info = await registry.getBuilderInfo(builder1.address);
      expect(info.name).to.equal("MyDApp");
      expect(info.url).to.equal("https://mydapp.io");
      expect(info.category).to.equal("integration");
      expect(info.active).to.equal(true);
      expect(info.registeredAt).to.be.gt(0);
    });

    it("T05 — emits BuilderRegistered event", async () => {
      await expect(registry.registerBuilder(builder1.address, "Proj", "https://p.io", "creator"))
        .to.emit(registry, "BuilderRegistered");
    });

    it("T06 — reverts AlreadyRegistered on duplicate", async () => {
      await registry.registerBuilder(builder1.address, "First", "", "creator");
      await expect(
        registry.registerBuilder(builder1.address, "Second", "", "creator")
      ).to.be.reverted;
    });

    it("T07 — reverts InvalidAddress for address(0)", async () => {
      await expect(
        registry.registerBuilder(ethers.constants.AddressZero, "X", "", "creator")
      ).to.be.reverted;
    });

    it("T08 — reverts EmptyName for empty string", async () => {
      await expect(
        registry.registerBuilder(builder1.address, "", "", "creator")
      ).to.be.reverted;
    });

    it("T09 — reverts InvalidCategory for unknown category", async () => {
      await expect(
        registry.registerBuilder(builder1.address, "X", "", "hacker")
      ).to.be.reverted;
    });

    it("T10 — accepts all 4 valid categories", async () => {
      const signers = await ethers.getSigners();
      const categories = ["creator", "integration", "tooling", "dao"];
      for (let i = 0; i < categories.length; i++) {
        await registry.registerBuilder(signers[i + 5].address, `P${i}`, "", categories[i]);
        expect(await registry.isBuilder(signers[i + 5].address)).to.equal(true);
      }
    });
  });

  // ── T11–T14: removeBuilder ──────────────────────────
  describe("removeBuilder", () => {
    beforeEach(async () => {
      await registry.registerBuilder(builder1.address, "ToRemove", "", "creator");
    });

    it("T11 — isBuilder becomes false after removal", async () => {
      await registry.removeBuilder(builder1.address);
      expect(await registry.isBuilder(builder1.address)).to.equal(false);
    });

    it("T12 — active becomes false in BuilderInfo", async () => {
      await registry.removeBuilder(builder1.address);
      const info = await registry.getBuilderInfo(builder1.address);
      expect(info.active).to.equal(false);
    });

    it("T13 — emits BuilderRemoved event", async () => {
      await expect(registry.removeBuilder(builder1.address))
        .to.emit(registry, "BuilderRemoved");
    });

    it("T14 — reverts NotRegistered for unknown address", async () => {
      await expect(
        registry.removeBuilder(builder2.address)
      ).to.be.reverted;
    });
  });

  // ── T15–T19: updateBuilder ──────────────────────────
  describe("updateBuilder", () => {
    beforeEach(async () => {
      await registry.registerBuilder(builder1.address, "Original", "https://old.com", "creator");
    });

    it("T15 — updates name, url, category", async () => {
      await registry.updateBuilder(builder1.address, "Updated", "https://new.com", "tooling");
      const info = await registry.getBuilderInfo(builder1.address);
      expect(info.name).to.equal("Updated");
      expect(info.url).to.equal("https://new.com");
      expect(info.category).to.equal("tooling");
    });

    it("T16 — emits BuilderUpdated event", async () => {
      await expect(registry.updateBuilder(builder1.address, "New", "https://n.io", "dao"))
        .to.emit(registry, "BuilderUpdated")
        .withArgs(builder1.address, "New", "https://n.io", "dao");
    });

    it("T17 — reverts NotRegistered for unknown address", async () => {
      await expect(
        registry.updateBuilder(builder2.address, "X", "", "creator")
      ).to.be.reverted;
    });

    it("T18 — reverts EmptyName", async () => {
      await expect(
        registry.updateBuilder(builder1.address, "", "", "creator")
      ).to.be.reverted;
    });

    it("T19 — reverts InvalidCategory", async () => {
      await expect(
        registry.updateBuilder(builder1.address, "X", "", "exploit")
      ).to.be.reverted;
    });
  });

  // ── T20–T23: View Functions ─────────────────────────
  describe("View Functions", () => {
    beforeEach(async () => {
      await registry.registerBuilder(builder1.address, "A", "", "creator");
      await registry.registerBuilder(builder2.address, "B", "", "tooling");
      await registry.registerBuilder(builder3.address, "C", "", "dao");
    });

    it("T20 — getBuilderCount returns correct count", async () => {
      expect(await registry.getBuilderCount()).to.equal(3);
    });

    it("T21 — getBuilderAt returns correct address", async () => {
      expect(await registry.getBuilderAt(0)).to.equal(builder1.address);
      expect(await registry.getBuilderAt(1)).to.equal(builder2.address);
      expect(await registry.getBuilderAt(2)).to.equal(builder3.address);
    });

    it("T22 — getActiveBuilders returns all active", async () => {
      const active = await registry.getActiveBuilders();
      expect(active.length).to.equal(3);
      expect(active).to.include(builder1.address);
      expect(active).to.include(builder2.address);
      expect(active).to.include(builder3.address);
    });

    it("T23 — getActiveBuilders excludes removed builders", async () => {
      await registry.removeBuilder(builder2.address);
      const active = await registry.getActiveBuilders();
      expect(active.length).to.equal(2);
      expect(active).to.not.include(builder2.address);
    });
  });

  // ── T24–T25: Access Control ─────────────────────────
  describe("Access Control (onlyOwner)", () => {
    it("T24 — registerBuilder reverts for non-owner", async () => {
      await expect(
        registry.connect(user).registerBuilder(builder1.address, "X", "", "creator")
      ).to.be.reverted;
    });

    it("T25 — removeBuilder reverts for non-owner", async () => {
      await registry.registerBuilder(builder1.address, "X", "", "creator");
      await expect(
        registry.connect(user).removeBuilder(builder1.address)
      ).to.be.reverted;
    });
  });

  // ── T26–T27: Edge Cases ─────────────────────────────
  describe("Edge Cases", () => {
    it("T26 — re-register after remove succeeds (wallet reactivated)", async () => {
      await registry.registerBuilder(builder1.address, "X", "", "creator");
      await registry.removeBuilder(builder1.address);
      // isBuilder[wallet] = false after remove, so re-register is allowed
      await registry.registerBuilder(builder1.address, "Renewed", "", "tooling");
      expect(await registry.isBuilder(builder1.address)).to.equal(true);
      const info = await registry.getBuilderInfo(builder1.address);
      expect(info.name).to.equal("Renewed");
      expect(info.category).to.equal("tooling");
    });

    it("T27 — getBuilderInfo for unregistered returns empty struct", async () => {
      const info = await registry.getBuilderInfo(builder1.address);
      expect(info.name).to.equal("");
      expect(info.url).to.equal("");
      expect(info.category).to.equal("");
      expect(info.active).to.equal(false);
      expect(info.registeredAt).to.equal(0);
    });
  });
});
