import { expect } from "chai";
import { ethers } from "./helpers/hardhat.js";

// CWA-16 evidence on a local simulated chain, using repository artifacts only.
// FINDING tests preserve legacy behavior; passing them does not remediate V1.
const U = 10n ** 9n;
const DAY = 86400n;
const DELAY = 2n * DAY;
const limits = { perLock: 100n * U, perWallet: 1000n * U, total: 10000n * U, daily: 1000n * U };
const encode = (contract, method, args = []) => contract.interface.encodeFunctionData(method, args);
const nextAt = (timestamp) => ethers.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);

async function deploy(name, ...args) {
  const contract = await ethers.deployContract(name, args);
  await contract.waitForDeployment();
  return contract;
}

async function accounts() {
  const [owner, guardian, nominee, replacement, stranger] = await ethers.getSigners();
  return { owner, guardian, nominee, replacement, stranger };
}

async function queueSelfCall(contract, signer, method, args = []) {
  const id = await contract.proposalCount();
  await contract.connect(signer).propose(contract.target, encode(contract, method, args));
  const proposal = await contract.getProposal(id);
  await nextAt(proposal.eta);
  return id;
}

async function twoStepFixture(name) {
  const a = await accounts();
  let constructorArgs;
  if (name === "GovernanceV2") {
    constructorArgs = [a.owner.address, a.guardian.address, DELAY];
  } else {
    const token = await deploy("InfernoToken", a.owner.address);
    constructorArgs = [token.target, a.owner.address];
    if (name === "LendingVaultV2") {
      const weth = await deploy("LendingVaultV2WETHMock");
      const factory = await deploy("MockPairFactory");
      constructorArgs = [token.target, weth.target, factory.target, a.owner.address];
    }
  }
  const contract = await deploy(name, ...constructorArgs);
  // GovernanceV2 nominations and cancellations require real queued self-calls.
  async function ownerCall(method, args = [], signer = a.owner) {
    if (name !== "GovernanceV2") return contract.connect(signer)[method](...args);
    const id = await queueSelfCall(contract, signer, method, args);
    return contract.connect(a.stranger).execute(id);
  }
  function privileged(signer) {
    if (name === "GovernanceV2") {
      return contract.connect(signer).propose(contract.target, encode(contract, "setDelay", [DELAY]));
    }
    if (name === "LendingVaultV2") {
      return contract.connect(signer).queueAction(encode(contract, "resume", [0n, true, true]));
    }
    return contract.connect(signer).queueEntryConfiguration(limits);
  }
  return { ...a, contract, constructorArgs, ownerCall, privileged };
}

const twoStepCases = [
  { name: "GovernanceV2", zeroError: "OwnableInvalidOwner", emptyError: "NoPendingOwnershipTransfer", renounceError: "RenunciationDisabled" },
  { name: "LendingVaultV2", zeroError: "InvalidAddress", emptyError: "InvalidAddress", renounceError: "RenunciationDisabled" },
  { name: "CommitmentVaultV2", zeroError: "InvalidOwnerNominee", emptyError: "NoPendingOwnershipTransfer", renounceError: "OwnershipRenunciationDisabled" },
];

describe("CWA-16 ownership and governance transfer evidence", function () {
  for (const { name, zeroError, emptyError, renounceError } of twoStepCases) {
    describe(`${name}: two-step ownership`, function () {
      let f;
      beforeEach(async function () { f = await twoStepFixture(name); });

      it("requires nomination and pending-owner acceptance, then revokes the incumbent's privileges", async function () {
        const { contract: c, owner, nominee, guardian, stranger, ownerCall, privileged } = f;
        expect(await c.owner()).to.equal(owner.address);
        expect(await c.pendingOwner()).to.equal(ethers.ZeroAddress);
        await expect(c.connect(nominee).acceptOwnership())
          .to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount").withArgs(nominee.address);
        await expect(ownerCall("transferOwnership", [nominee.address]))
          .to.emit(c, "OwnershipTransferStarted").withArgs(owner.address, nominee.address)
          .and.not.to.emit(c, "OwnershipTransferred");
        expect(await c.owner()).to.equal(owner.address);
        expect(await c.pendingOwner()).to.equal(nominee.address);
        await privileged(owner);
        await expect(privileged(nominee))
          .to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount").withArgs(nominee.address);
        for (const caller of [owner, guardian, stranger]) {
          await expect(c.connect(caller).acceptOwnership())
            .to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount").withArgs(caller.address);
          expect(await c.owner()).to.equal(owner.address);
          expect(await c.pendingOwner()).to.equal(nominee.address);
        }
        await expect(c.connect(nominee).acceptOwnership())
          .to.emit(c, "OwnershipTransferred").withArgs(owner.address, nominee.address);
        expect(await c.owner()).to.equal(nominee.address);
        expect(await c.pendingOwner()).to.equal(ethers.ZeroAddress);
        await expect(privileged(owner))
          .to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount").withArgs(owner.address);
        await privileged(nominee);
        await expect(c.connect(nominee).acceptOwnership())
          .to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount").withArgs(nominee.address);
      });

      it("cancels a pending nomination with events and rejects stale acceptance", async function () {
        const { contract: c, owner, nominee, guardian, stranger, ownerCall, privileged } = f;
        await expect(ownerCall("cancelOwnershipTransfer")).to.be.revertedWithCustomError(c, emptyError);
        await ownerCall("transferOwnership", [nominee.address]);
        for (const caller of [nominee, guardian, stranger]) {
          await expect(c.connect(caller).cancelOwnershipTransfer())
            .to.be.revertedWithCustomError(c, name === "GovernanceV2" ? "OnlySelf" : "OwnableUnauthorizedAccount")
            .withArgs(caller.address);
        }
        const cancellation = ownerCall("cancelOwnershipTransfer");
        if (name === "LendingVaultV2") {
          await expect(cancellation).to.emit(c, "OwnershipNominationCancelled").withArgs(nominee.address);
        } else {
          await expect(cancellation).to.emit(c, "OwnershipTransferCancelled").withArgs(owner.address, nominee.address);
        }
        if (name !== "GovernanceV2") {
          await expect(cancellation).to.emit(c, "OwnershipTransferStarted").withArgs(owner.address, ethers.ZeroAddress);
        }
        await expect(cancellation).not.to.emit(c, "OwnershipTransferred");
        expect(await c.owner()).to.equal(owner.address);
        expect(await c.pendingOwner()).to.equal(ethers.ZeroAddress);
        await expect(c.connect(nominee).acceptOwnership())
          .to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount").withArgs(nominee.address);
        await privileged(owner);
        await expect(ownerCall("cancelOwnershipTransfer")).to.be.revertedWithCustomError(c, emptyError);
      });

      it("overwrites a nomination so only the last nominee can accept", async function () {
        const { contract: c, owner, nominee, replacement, ownerCall, privileged } = f;
        await ownerCall("transferOwnership", [nominee.address]);
        const overwrite = ownerCall("transferOwnership", [replacement.address]);
        await expect(overwrite).to.emit(c, "OwnershipTransferStarted").withArgs(owner.address, replacement.address);
        if (name === "GovernanceV2") {
          await expect(overwrite).to.emit(c, "OwnershipTransferCancelled").withArgs(owner.address, nominee.address);
        }
        expect(await c.owner()).to.equal(owner.address);
        expect(await c.pendingOwner()).to.equal(replacement.address);
        await expect(c.connect(nominee).acceptOwnership())
          .to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount").withArgs(nominee.address);
        await expect(c.connect(replacement).acceptOwnership())
          .to.emit(c, "OwnershipTransferred").withArgs(owner.address, replacement.address);
        expect(await c.owner()).to.equal(replacement.address);
        expect(await c.pendingOwner()).to.equal(ethers.ZeroAddress);
        await expect(privileged(owner))
          .to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount").withArgs(owner.address);
        await privileged(replacement);
      });

      it("rejects a zero nomination without cancelling an existing nominee", async function () {
        const { contract: c, owner, nominee, ownerCall } = f;
        await ownerCall("transferOwnership", [nominee.address]);
        const rejection = expect(ownerCall("transferOwnership", [ethers.ZeroAddress]))
          .to.be.revertedWithCustomError(c, zeroError);
        if (name === "GovernanceV2") await rejection.withArgs(ethers.ZeroAddress);
        else await rejection;
        expect(await c.owner()).to.equal(owner.address);
        expect(await c.pendingOwner()).to.equal(nominee.address);
        await c.connect(nominee).acceptOwnership();
        expect(await c.owner()).to.equal(nominee.address);
      });

      it("rejects a zero initial owner", async function () {
        const args = [...f.constructorArgs];
        args[name === "GovernanceV2" ? 0 : args.length - 1] = ethers.ZeroAddress;
        await expect(ethers.deployContract(name, args))
          .to.be.revertedWithCustomError(f.contract, "OwnableInvalidOwner").withArgs(ethers.ZeroAddress);
      });

      it("rejects outsider, guardian and pending-owner attempts to propose a handover", async function () {
        const { contract: c, owner, guardian, nominee, replacement, stranger, ownerCall } = f;
        await ownerCall("transferOwnership", [nominee.address]);
        for (const caller of [guardian, nominee, stranger]) {
          await expect(c.connect(caller).transferOwnership(replacement.address))
            .to.be.revertedWithCustomError(c, name === "GovernanceV2" ? "OnlySelf" : "OwnableUnauthorizedAccount")
            .withArgs(caller.address);
          if (name === "GovernanceV2") {
            await expect(c.connect(caller).propose(c.target, encode(c, "transferOwnership", [replacement.address])))
              .to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount").withArgs(caller.address);
          }
        }
        if (name === "GovernanceV2") {
          await expect(c.connect(owner).transferOwnership(replacement.address))
            .to.be.revertedWithCustomError(c, "OnlySelf").withArgs(owner.address);
          await expect(c.connect(owner).cancelOwnershipTransfer())
            .to.be.revertedWithCustomError(c, "OnlySelf").withArgs(owner.address);
        }
        expect(await c.owner()).to.equal(owner.address);
        expect(await c.pendingOwner()).to.equal(nominee.address);
      });

      it("disables renunciation while preserving the owner and nomination", async function () {
        const { contract: c, owner, nominee, ownerCall } = f;
        await expect(c.connect(owner).renounceOwnership()).to.be.revertedWithCustomError(c, renounceError);
        await ownerCall("transferOwnership", [nominee.address]);
        await expect(c.connect(owner).renounceOwnership()).to.be.revertedWithCustomError(c, renounceError);
        expect(await c.owner()).to.equal(owner.address);
        expect(await c.pendingOwner()).to.equal(nominee.address);
      });
    });
  }

  it("GovernanceV2 cannot nominate before the timelock or make a zero guardian", async function () {
    const { contract: c, owner, guardian, nominee, stranger } = await twoStepFixture("GovernanceV2");
    const data = encode(c, "transferOwnership", [nominee.address]);
    await c.connect(owner).propose(c.target, data);
    const { eta } = await c.getProposal(0n);
    await nextAt(eta - 1n);
    await expect(c.connect(stranger).execute(0n))
      .to.be.revertedWithCustomError(c, "InvalidProposalState").withArgs(0n, 1n);
    expect(await c.pendingOwner()).to.equal(ethers.ZeroAddress);
    await nextAt(eta);
    await c.connect(stranger).execute(0n);
    expect(await c.owner()).to.equal(owner.address);
    expect(await c.pendingOwner()).to.equal(nominee.address);
    const id = await queueSelfCall(c, owner, "setGuardian", [ethers.ZeroAddress]);
    await expect(c.execute(id)).to.be.revertedWithCustomError(c, "InvalidGuardian").withArgs(ethers.ZeroAddress);
    expect(await c.guardian()).to.equal(guardian.address);
  });

  it("CommitmentVaultV2 acceptance invalidates the old owner's queued entry configuration", async function () {
    const { contract: c, owner, nominee, ownerCall, privileged } = await twoStepFixture("CommitmentVaultV2");
    await privileged(owner);
    const nonce = await c.configurationNonce();
    expect(await c.configurationEta()).to.be.gt(0n);
    await ownerCall("transferOwnership", [nominee.address]);
    await expect(c.connect(nominee).acceptOwnership()).to.emit(c, "EntryConfigurationCancelled").withArgs(nonce);
    expect(await c.configurationEta()).to.equal(0n);
    expect(await c.pendingEntryLimits()).to.deep.equal([0n, 0n, 0n, 0n]);
    await expect(c.connect(owner).executeEntryConfiguration(nonce))
      .to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount").withArgs(owner.address);
    await expect(c.connect(nominee).executeEntryConfiguration(nonce))
      .to.be.revertedWithCustomError(c, "NoPendingConfiguration");
  });

  describe("LendingVaultV2: two-step guardian", function () {
    let f, first, second;
    beforeEach(async function () {
      f = await twoStepFixture("LendingVaultV2");
      first = await deploy("LendingVaultV2Actor", f.nominee.address);
      second = await deploy("LendingVaultV2Actor", f.replacement.address);
    });
    async function queue(candidate) {
      const data = encode(f.contract, "nominateGuardian", [candidate]);
      await f.contract.connect(f.owner).queueAction(data);
      await nextAt(await f.contract.actionETA(ethers.keccak256(data)));
    }
    async function nominate(candidate) {
      await queue(candidate);
      return f.contract.connect(f.owner).nominateGuardian(candidate);
    }
    const through = (actor, signer, method, args = []) => actor.connect(signer).execute(f.contract.target, encode(f.contract, method, args));

    it("requires the queued nomination and contract acceptance and revokes the replaced guardian", async function () {
      const { contract: c, owner, nominee, replacement, stranger } = f;
      await expect(c.nominateGuardian(first.target)).to.be.revertedWithCustomError(c, "ActionNotReady");
      const data = encode(c, "nominateGuardian", [first.target]);
      await c.queueAction(data);
      const eta = await c.actionETA(ethers.keccak256(data));
      await nextAt(eta - 1n);
      await expect(c.nominateGuardian(first.target)).to.be.revertedWithCustomError(c, "ActionNotReady");
      await nextAt(eta);
      await expect(c.nominateGuardian(first.target)).to.emit(c, "GuardianNominated").withArgs(ethers.ZeroAddress, first.target);
      expect(await c.guardian()).to.equal(ethers.ZeroAddress);
      expect(await c.pendingGuardian()).to.equal(first.target);
      await expect(through(first, nominee, "pause", [true, false])).to.be.revertedWithCustomError(c, "Unauthorized");
      for (const caller of [owner, nominee, stranger]) {
        await expect(c.connect(caller).acceptGuardian()).to.be.revertedWithCustomError(c, "Unauthorized");
      }
      await expect(through(first, nominee, "acceptGuardian")).to.emit(c, "GuardianAccepted").withArgs(ethers.ZeroAddress, first.target);
      expect(await c.pendingGuardian()).to.equal(ethers.ZeroAddress);
      await through(first, nominee, "pause", [true, false]);
      await nominate(second.target);
      expect(await c.guardian()).to.equal(first.target);
      await through(first, nominee, "pause", [false, true]);
      await expect(through(second, replacement, "acceptGuardian")).to.emit(c, "GuardianAccepted").withArgs(first.target, second.target);
      expect(await c.guardian()).to.equal(second.target);
      expect(await c.pendingGuardian()).to.equal(ethers.ZeroAddress);
      await expect(through(first, nominee, "pause", [true, true])).to.be.revertedWithCustomError(c, "Unauthorized");
      await through(second, replacement, "pause", [true, true]);
      await expect(through(second, replacement, "acceptGuardian")).to.be.revertedWithCustomError(c, "Unauthorized");
    });

    it("cancels a nomination, retains the incumbent and rejects stale acceptance", async function () {
      const { contract: c, nominee, replacement, stranger } = f;
      await expect(c.cancelGuardianNomination()).to.be.revertedWithCustomError(c, "InvalidAddress");
      await nominate(first.target);
      await through(first, nominee, "acceptGuardian");
      await nominate(second.target);
      await expect(c.connect(stranger).cancelGuardianNomination())
        .to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount").withArgs(stranger.address);
      await expect(through(second, replacement, "cancelGuardianNomination"))
        .to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount").withArgs(second.target);
      await expect(c.cancelGuardianNomination()).to.emit(c, "GuardianNominated").withArgs(second.target, ethers.ZeroAddress);
      expect(await c.guardian()).to.equal(first.target);
      expect(await c.pendingGuardian()).to.equal(ethers.ZeroAddress);
      await expect(through(second, replacement, "acceptGuardian")).to.be.revertedWithCustomError(c, "Unauthorized");
      await through(first, nominee, "pause", [true, true]);
    });

    it("overwrites a pending guardian so only the newest contract can accept", async function () {
      const { contract: c, nominee, replacement } = f;
      await nominate(first.target);
      await expect(nominate(second.target)).to.emit(c, "GuardianNominated").withArgs(first.target, second.target);
      expect(await c.pendingGuardian()).to.equal(second.target);
      await expect(through(first, nominee, "acceptGuardian")).to.be.revertedWithCustomError(c, "Unauthorized");
      await through(second, replacement, "acceptGuardian");
      expect(await c.guardian()).to.equal(second.target);
    });

    it("rejects zero and EOA guardians without deleting an existing nomination", async function () {
      const { contract: c, nominee } = f;
      await nominate(first.target);
      for (const invalid of [ethers.ZeroAddress, nominee.address]) {
        await queue(invalid);
        await expect(c.nominateGuardian(invalid)).to.be.revertedWithCustomError(c, "InvalidAddress");
        expect(await c.pendingGuardian()).to.equal(first.target);
        expect(await c.guardian()).to.equal(ethers.ZeroAddress);
      }
    });

    it("rejects non-owner queuing and nomination even with ready calldata", async function () {
      const { contract: c, guardian, nominee, stranger } = f;
      const data = encode(c, "nominateGuardian", [first.target]);
      await queue(first.target);
      for (const caller of [guardian, nominee, stranger]) {
        await expect(c.connect(caller).queueAction(data))
          .to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount").withArgs(caller.address);
        await expect(c.connect(caller).nominateGuardian(first.target))
          .to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount").withArgs(caller.address);
      }
      expect(await c.guardian()).to.equal(ethers.ZeroAddress);
      expect(await c.pendingGuardian()).to.equal(ethers.ZeroAddress);
    });
  });

  describe("FINDING [Low]: legacy single-step authority transfers", function () {
    let a, token;
    beforeEach(async function () {
      a = await accounts();
      token = await deploy("InfernoToken", a.owner.address);
    });
    const constructors = {
      LiquidityReserve: () => [token.target, DAY, 100n * U, DAY, a.guardian.address],
      BurnReserve: () => [token.target, a.guardian.address],
      BuybackVault: () => [token.target, a.stranger.address, a.owner.address, a.stranger.address, a.guardian.address, DAY],
      BuybackController: () => [token.target, a.stranger.address, a.stranger.address, a.owner.address, a.guardian.address, a.owner.address],
      InfernoToken: () => [a.owner.address],
      CommitmentVault: () => [token.target, a.owner.address],
      LendingVault: () => [token.target, a.owner.address],
      BuilderRegistry: () => [a.owner.address],
      IFRBuilderVault: () => [token.target, 100n * U, DAY, "CWA-16", "https://example.invalid", a.owner.address],
    };
    const ownable = new Set(["InfernoToken", "CommitmentVault", "LendingVault", "BuilderRegistry", "IFRBuilderVault", "PriceLockVault"]);

    async function singleStepContract(name) {
      if (name !== "PriceLockVault") return deploy(name, ...constructors[name]());
      const weth = await deploy("LendingVaultV2WETHMock");
      const factory = await deploy("MockPairFactory");
      const pair = await deploy("MockTwapPair", token.target, weth.target);
      await factory.setPair(token.target, weth.target, pair.target);
      return deploy(name, token.target, weth.target, factory.target, a.owner.address, DAY, ethers.parseEther("50"), 0n);
    }

    for (const name of [...Object.keys(constructors), "PriceLockVault"]) {
      it(`${name} transfers to an arbitrary account immediately; zero transfer is rejected${ownable.has(name) ? " but renunciation is immediate" : ""}`, async function () {
        const c = await singleStepContract(name);
        const { owner, nominee, stranger } = a;
        if (ownable.has(name)) {
          await expect(c.transferOwnership(ethers.ZeroAddress))
            .to.be.revertedWithCustomError(c, "OwnableInvalidOwner").withArgs(ethers.ZeroAddress);
          await expect(c.connect(stranger).transferOwnership(nominee.address))
            .to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount").withArgs(stranger.address);
        } else {
          await expect(c.transferOwnership(ethers.ZeroAddress)).to.be.revertedWith("newOwner=0");
          await expect(c.connect(stranger).transferOwnership(nominee.address)).to.be.revertedWith("not owner");
        }
        expect(await c.owner()).to.equal(owner.address);
        await expect(c.transferOwnership(nominee.address))
          .to.emit(c, "OwnershipTransferred").withArgs(owner.address, nominee.address);
        // No transaction from nominee (and no acceptance call) precedes this change.
        expect(await c.owner()).to.equal(nominee.address);
        if (ownable.has(name)) {
          await expect(c.connect(owner).transferOwnership(owner.address))
            .to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount").withArgs(owner.address);
          await expect(c.connect(nominee).renounceOwnership())
            .to.emit(c, "OwnershipTransferred").withArgs(nominee.address, ethers.ZeroAddress);
          expect(await c.owner()).to.equal(ethers.ZeroAddress);
          await expect(c.connect(nominee).transferOwnership(owner.address))
            .to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount").withArgs(nominee.address);
        } else {
          await expect(c.connect(owner).transferOwnership(owner.address)).to.be.revertedWith("not owner");
          await c.connect(nominee).transferOwnership(owner.address);
          expect(await c.owner()).to.equal(owner.address);
        }
      });
    }

    it("Governance.setOwner takes effect on timelock execution without recipient acceptance", async function () {
      const { owner, guardian, nominee, stranger } = a;
      const c = await deploy("Governance", DELAY, guardian.address);
      await expect(c.setOwner(nominee.address)).to.be.revertedWith("not self");
      await expect(c.connect(stranger).propose(c.target, encode(c, "setOwner", [nominee.address]))).to.be.revertedWith("not owner");
      const invalid = await queueSelfCall(c, owner, "setOwner", [ethers.ZeroAddress]);
      // V1 wraps target revert bytes; do not mistake that wrapper for zero-address acceptance.
      let failure;
      try { await c.execute(invalid); } catch (error) { failure = error; }
      const inner = new ethers.Interface(["error Error(string)"]).encodeErrorResult("Error", ["owner=0"]);
      const wrapped = ethers.concat(["0x08c379a0", ethers.AbiCoder.defaultAbiCoder().encode(["bytes"], [inner])]);
      expect(failure?.data).to.equal(wrapped);
      expect((await c.getProposal(invalid)).executed).to.equal(false);
      expect(await c.owner()).to.equal(owner.address);
      const id = await c.proposalCount();
      await c.propose(c.target, encode(c, "setOwner", [nominee.address]));
      const { eta } = await c.getProposal(id);
      await nextAt(eta - 1n);
      await expect(c.execute(id)).to.be.revertedWith("too early");
      await nextAt(eta);
      await expect(c.execute(id)).to.emit(c, "OwnerUpdated").withArgs(owner.address, nominee.address);
      expect(await c.owner()).to.equal(nominee.address);
      const data = encode(c, "setOwner", [owner.address]);
      await expect(c.connect(owner).propose(c.target, data)).to.be.revertedWith("not owner");
      await c.connect(nominee).propose(c.target, data);
    });

    it("PartnerVault.setAdmin immediately replaces admin and rejects zero", async function () {
      const { owner, guardian, nominee, stranger } = a;
      const c = await deploy("PartnerVault", token.target, owner.address, guardian.address, 1500n, 4_000_000n * U);
      await expect(c.setAdmin(ethers.ZeroAddress)).to.be.revertedWith("admin=0");
      await expect(c.connect(stranger).setAdmin(nominee.address)).to.be.revertedWith("not admin");
      await expect(c.setAdmin(nominee.address)).to.emit(c, "AdminUpdated").withArgs(owner.address, nominee.address);
      expect(await c.admin()).to.equal(nominee.address);
      await expect(c.setRewardBps(1500n)).to.be.revertedWith("not admin");
      await c.connect(nominee).setRewardBps(1500n);
    });

    for (const name of ["LiquidityReserve", "BurnReserve", "Governance", "IFRLock", "Vesting", "PartnerVault"]) {
      it(`${name} immediately replaces its guardian without acceptance and rejects zero`, async function () {
        const { owner, guardian, nominee, stranger } = a;
        let c;
        if (name === "Governance") c = await deploy(name, DELAY, guardian.address);
        else if (name === "IFRLock") c = await deploy(name, token.target, guardian.address);
        else if (name === "Vesting") c = await deploy(name, token.target, owner.address, DAY, 4n * DAY, 1000n * U, guardian.address);
        else if (name === "PartnerVault") c = await deploy(name, token.target, owner.address, guardian.address, 1500n, 4_000_000n * U);
        else c = await singleStepContract(name);
        const selfManaged = ["IFRLock", "Vesting", "PartnerVault"].includes(name);
        const authority = selfManaged ? guardian : owner;
        const method = name === "Vesting" ? "transferGuardian" : "setGuardian";
        await expect(c.connect(authority)[method](ethers.ZeroAddress)).to.be.revertedWith(name === "Vesting" ? "newGuardian=0" : "guardian=0");
        const unauthorized = c.connect(stranger)[method](nominee.address);
        if (name === "Vesting") await expect(unauthorized).to.be.revertedWithCustomError(c, "OnlyGuardian");
        else await expect(unauthorized).to.be.revertedWith(selfManaged ? "not guardian" : "not owner");
        const event = name === "Vesting" ? "GuardianTransferred" : "GuardianUpdated";
        const eventArgs = ["LiquidityReserve", "BurnReserve"].includes(name) ? [nominee.address] : [guardian.address, nominee.address];
        await expect(c.connect(authority)[method](nominee.address)).to.emit(c, event).withArgs(...eventArgs);
        expect(await c.guardian()).to.equal(nominee.address);
        if (name === "Governance") {
          await c.propose(c.target, encode(c, "setDelay", [DELAY]));
          await expect(c.connect(guardian).cancel(0n)).to.be.revertedWith("not authorized");
          await c.connect(nominee).cancel(0n);
        } else if (name === "BurnReserve") {
          await token.transfer(c.target, 100n * U);
          await expect(c.connect(guardian).burn(U)).to.be.revertedWith("not authorized");
          await c.connect(nominee).burn(U);
          expect(await c.totalBurned()).to.equal(U);
        } else {
          if (name === "Vesting") await expect(c.connect(guardian).pause()).to.be.revertedWithCustomError(c, "OnlyGuardian");
          else await expect(c.connect(guardian).pause()).to.be.revertedWith("not guardian");
          await c.connect(nominee).pause();
          expect(await c.paused()).to.equal(true);
        }
      });
    }
  });
});
