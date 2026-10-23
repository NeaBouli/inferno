import { expect } from "chai";
import { ethers } from "./helpers/hardhat.js";

// Local source behavior only: no fork, recorded deployment, or production signer.
describe("BuilderRegistry rights", function () {
  let deployer, owner, outsider, builder, successor;
  let registry;

  const operations = [
    {
      method: "registerBuilder",
      args: () => [successor.address, "New builder", "https://example.invalid/new", "dao"],
      event: "BuilderRegistered",
      eventArgs: (_previousOwner, timestamp) => [successor.address, "New builder", "dao", timestamp],
    },
    {
      method: "removeBuilder",
      args: () => [builder.address],
      event: "BuilderRemoved",
      eventArgs: (_previousOwner, timestamp) => [builder.address, timestamp],
    },
    {
      method: "updateBuilder",
      args: () => [builder.address, "Updated", "https://example.invalid/updated", "tooling"],
      event: "BuilderUpdated",
      eventArgs: () => [builder.address, "Updated", "https://example.invalid/updated", "tooling"],
    },
    {
      method: "transferOwnership",
      args: () => [deployer.address],
      event: "OwnershipTransferred",
      eventArgs: (previousOwner) => [previousOwner, deployer.address],
    },
    {
      method: "renounceOwnership",
      args: () => [],
      event: "OwnershipTransferred",
      eventArgs: (previousOwner) => [previousOwner, ethers.ZeroAddress],
    },
  ];

  async function snapshot() {
    return {
      owner: await registry.owner(),
      count: await registry.getBuilderCount(),
      active: Array.from(await registry.getActiveBuilders()),
      members: await Promise.all([builder, successor].map(async ({ address }) => ({
        registered: await registry.isBuilder(address),
        info: Array.from(await registry.getBuilderInfo(address)),
      }))),
    };
  }

  async function assertAccepted(operation, send) {
    const before = await snapshot();
    const tx = await send();
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt.blockNumber);
    const timestamp = BigInt(block.timestamp);
    await expect(tx).to.emit(registry, operation.event)
      .withArgs(...operation.eventArgs(before.owner, timestamp));

    switch (operation.method) {
      case "registerBuilder": {
        expect(await registry.isBuilder(successor.address)).to.equal(true);
        expect(Array.from(await registry.getBuilderInfo(successor.address))).to.deep.equal([
          "New builder", "https://example.invalid/new", "dao", timestamp, true,
        ]);
        expect(await registry.getBuilderCount()).to.equal(before.count + 1n);
        expect(await registry.getBuilderAt(before.count)).to.equal(successor.address);
        break;
      }
      case "removeBuilder": {
        const expected = [...before.members[0].info];
        expected[4] = false;
        expect(await registry.isBuilder(builder.address)).to.equal(false);
        expect(Array.from(await registry.getBuilderInfo(builder.address))).to.deep.equal(expected);
        expect(await registry.getActiveBuilders()).not.to.include(builder.address);
        expect(await registry.getBuilderCount()).to.equal(before.count);
        break;
      }
      case "updateBuilder":
        expect(Array.from(await registry.getBuilderInfo(builder.address))).to.deep.equal([
          "Updated", "https://example.invalid/updated", "tooling", before.members[0].info[3], true,
        ]);
        expect(await registry.isBuilder(builder.address)).to.equal(true);
        expect(await registry.getBuilderCount()).to.equal(before.count);
        break;
      default:
        expect(await snapshot()).to.deep.equal({ ...before, owner: operation.args()[0] ?? ethers.ZeroAddress });
    }
  }

  beforeEach(async function () {
    [deployer, owner, outsider, builder, successor] = await ethers.getSigners();
    registry = await ethers.deployContract("BuilderRegistry", [owner.address], deployer);
    await registry.waitForDeployment();
    await registry.connect(owner).registerBuilder(builder.address, "Original", "", "creator");
  });

  for (const operation of operations) {
    describe(operation.method, function () {
      it("rejects the deployer, outsider and registered builder without changing state", async function () {
        const before = await snapshot();
        for (const caller of [deployer, outsider, builder]) {
          await expect(registry.connect(caller)[operation.method](...operation.args()))
            .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount")
            .withArgs(caller.address);
          expect(await snapshot()).to.deep.equal(before);
        }
      });

      it("accepts the explicit constructor owner and emits exact event arguments", async function () {
        expect(await registry.owner()).to.equal(owner.address);
        await assertAccepted(operation, () => registry.connect(owner)[operation.method](...operation.args()));
      });

      it("moves this right immediately to the successor and rejects the former owner", async function () {
        await expect(registry.connect(owner).transferOwnership(successor.address))
          .to.emit(registry, "OwnershipTransferred").withArgs(owner.address, successor.address);
        const before = await snapshot();
        await expect(registry.connect(owner)[operation.method](...operation.args()))
          .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount")
          .withArgs(owner.address);
        expect(await snapshot()).to.deep.equal(before);
        await assertAccepted(operation, () => registry.connect(successor)[operation.method](...operation.args()));
      });
    });
  }

  it("rejects a zero constructor owner", async function () {
    await expect(ethers.deployContract("BuilderRegistry", [ethers.ZeroAddress], deployer))
      .to.be.revertedWithCustomError(registry, "OwnableInvalidOwner").withArgs(ethers.ZeroAddress);
  });

  it("rejects a zero successor without changing state", async function () {
    const before = await snapshot();
    await expect(registry.connect(owner).transferOwnership(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(registry, "OwnableInvalidOwner").withArgs(ethers.ZeroAddress);
    expect(await snapshot()).to.deep.equal(before);
  });

  it("renunciation freezes all five rights while preserving public registry data", async function () {
    const renounce = operations.find(({ method }) => method === "renounceOwnership");
    await assertAccepted(renounce, () => registry.connect(owner).renounceOwnership());
    const before = await snapshot();
    for (const caller of [owner, deployer, outsider, builder, successor]) {
      for (const operation of operations) {
        await expect(registry.connect(caller)[operation.method](...operation.args()))
          .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount")
          .withArgs(caller.address);
        expect(await snapshot()).to.deep.equal(before);
      }
    }
  });

  it("records the existing duplicate enumeration after owner removal and re-registration", async function () {
    await registry.connect(owner).removeBuilder(builder.address);
    await registry.connect(owner).registerBuilder(builder.address, "Renewed", "", "dao");
    expect(await registry.getBuilderCount()).to.equal(2n);
    expect(await registry.getBuilderAt(0n)).to.equal(builder.address);
    expect(await registry.getBuilderAt(1n)).to.equal(builder.address);
    expect(Array.from(await registry.getActiveBuilders())).to.deep.equal([builder.address, builder.address]);
  });

  describe("local Governance execution path (repository source, not deployed-bytecode proof)", function () {
    const delay = 172800n;
    let governance;

    async function queue(method, args) {
      const id = await governance.proposalCount();
      await governance.connect(owner).propose(registry.target, registry.interface.encodeFunctionData(method, args));
      return id;
    }

    async function advanceToEta(id) {
      const proposal = await governance.getProposal(id);
      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(proposal.eta)]);
    }

    beforeEach(async function () {
      governance = await ethers.deployContract("Governance", [delay, outsider.address], owner);
      await governance.waitForDeployment();
      registry = await ethers.deployContract("BuilderRegistry", [governance.target], deployer);
      await registry.waitForDeployment();
      const id = await queue("registerBuilder", [builder.address, "Original", "", "creator"]);
      await advanceToEta(id);
      await governance.connect(owner).execute(id);
    });

    for (const operation of operations) {
      it(`requires Governance execution after the delay for ${operation.method}`, async function () {
        const before = await snapshot();
        for (const caller of [owner, outsider, builder, deployer]) {
          await expect(registry.connect(caller)[operation.method](...operation.args()))
            .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount")
            .withArgs(caller.address);
        }
        const data = registry.interface.encodeFunctionData(operation.method, operation.args());
        await expect(governance.connect(outsider).propose(registry.target, data)).to.be.revertedWith("not owner");
        const id = await queue(operation.method, operation.args());
        await expect(governance.connect(owner).execute(id)).to.be.revertedWith("too early");
        expect(await snapshot()).to.deep.equal(before);
        await advanceToEta(id);
        await expect(governance.connect(outsider).execute(id)).to.be.revertedWith("not owner");
        expect(await snapshot()).to.deep.equal(before);
        let execution;
        await assertAccepted(operation, async () => {
          execution = await governance.connect(owner).execute(id);
          return execution;
        });
        await expect(execution).to.emit(governance, "ProposalExecuted").withArgs(id);
      });
    }
  });
});
