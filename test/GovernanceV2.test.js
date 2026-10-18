import { expect } from "chai";
import { ethers } from "./helpers/hardhat.js";

const MIN = 48n * 3600n;
const MAX = 30n * 86400n;
const GRACE = 7n * 86400n;
const S = { Unset: 0n, Pending: 1n, Ready: 2n, Executed: 3n, Cancelled: 4n, Expired: 5n };
const abi = ethers.AbiCoder.defaultAbiCoder();

describe("GovernanceV2 release candidate", function () {
  let deployer, owner, guardian, user, candidate, other, replacementGuardian, pool;
  let gov, target, factory;

  beforeEach(async function () {
    [deployer, owner, guardian, user, candidate, other, replacementGuardian, pool] = await ethers.getSigners();
    factory = await ethers.getContractFactory("GovernanceV2", deployer);
    gov = await factory.deploy(owner.address, guardian.address, MIN);
    target = await ethers.deployContract("MockGovernanceV2Target");
    await Promise.all([gov.waitForDeployment(), target.waitForDeployment()]);
  });

  const encode = (contract, name, args = []) => contract.interface.encodeFunctionData(name, args);
  const nextTime = (timestamp) => ethers.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
  async function mineAt(timestamp) {
    await nextTime(timestamp);
    await ethers.provider.send("evm_mine", []);
  }
  async function queue(contract = target, name = "callMe", args = [123n], controller = gov) {
    const id = await controller.proposalCount();
    const data = encode(contract, name, args);
    const tx = await controller.connect(owner).propose(contract.target, data);
    const receipt = await tx.wait();
    return { id, data, receipt, p: await controller.getProposal(id) };
  }
  async function ready(q, executor = user, controller = gov) {
    await nextTime(q.p.eta);
    return controller.connect(executor).execute(q.id);
  }
  async function selfCall(name, args = []) {
    const q = await queue(gov, name, args);
    await ready(q);
    return q;
  }
  async function nominate(who = candidate) {
    return selfCall("transferOwnership", [who.address ?? who.target]);
  }
  async function predictedDeployment() {
    return ethers.getCreateAddress({ from: deployer.address, nonce: await ethers.provider.getTransactionCount(deployer.address) });
  }
  function operationHash(chainId, controller, id, p) {
    return ethers.keccak256(abi.encode(
      ["uint256", "address", "uint256", "address", "bytes32", "uint256", "uint256"],
      [chainId, controller, id, p.target, ethers.keccak256(p.data), p.eta, p.expiresAt],
    ));
  }

  describe("initialization and immutable bounds", function () {
    it("initializes explicit roles, immutable bounds and a zero-based empty ID space without deployer privilege", async function () {
      expect(await gov.owner()).to.equal(owner.address);
      expect(await gov.pendingOwner()).to.equal(ethers.ZeroAddress);
      expect(await gov.guardian()).to.equal(guardian.address);
      expect(await gov.delay()).to.equal(MIN);
      expect(await gov.MIN_DELAY()).to.equal(MIN);
      expect(await gov.MAX_DELAY()).to.equal(MAX);
      expect(await gov.GRACE_PERIOD()).to.equal(GRACE);
      expect(await gov.proposalCount()).to.equal(0n);
      await expect(gov.connect(deployer).propose(target.target, encode(target, "callMe", [1n])))
        .to.be.revertedWithCustomError(gov, "OwnableUnauthorizedAccount").withArgs(deployer.address);
    });

    it("emits constructor ownership, guardian and delay evidence", async function () {
      await expect(gov.deploymentTransaction()).to.emit(gov, "OwnershipTransferred").withArgs(ethers.ZeroAddress, owner.address);
      await expect(gov.deploymentTransaction()).to.emit(gov, "GuardianUpdated").withArgs(ethers.ZeroAddress, guardian.address);
      await expect(gov.deploymentTransaction()).to.emit(gov, "DelayUpdated").withArgs(0n, MIN);
    });

    for (const delay of [0n, MIN - 1n, MAX + 1n]) {
      it(`rejects constructor delay ${delay}`, async function () {
        await expect(factory.deploy(owner.address, guardian.address, delay))
          .to.be.revertedWithCustomError(gov, "DelayOutOfBounds").withArgs(delay);
      });
    }
    for (const delay of [MIN, MAX]) {
      it(`accepts constructor inclusive delay boundary ${delay}`, async function () {
        const instance = await factory.deploy(owner.address, guardian.address, delay);
        expect(await instance.delay()).to.equal(delay);
      });
    }
    it("rejects zero and self initial owners", async function () {
      await expect(factory.deploy(ethers.ZeroAddress, guardian.address, MIN))
        .to.be.revertedWithCustomError(gov, "OwnableInvalidOwner").withArgs(ethers.ZeroAddress);
      const predicted = await predictedDeployment();
      await expect(factory.deploy(predicted, guardian.address, MIN))
        .to.be.revertedWithCustomError(gov, "OwnableInvalidOwner").withArgs(predicted);
    });
    it("rejects zero, owner-overlapping and self initial guardians", async function () {
      for (const invalid of [ethers.ZeroAddress, owner.address]) {
        await expect(factory.deploy(owner.address, invalid, MIN))
          .to.be.revertedWithCustomError(gov, "InvalidGuardian").withArgs(invalid);
      }
      const predicted = await predictedDeployment();
      await expect(factory.deploy(owner.address, predicted, MIN))
        .to.be.revertedWithCustomError(gov, "InvalidGuardian").withArgs(predicted);
    });
  });

  describe("proposal authorization and permanent evidence", function () {
    it("stores exact bytes, timestamps and domain hash and emits every creation field", async function () {
      const q = await queue();
      const block = await ethers.provider.getBlock(q.receipt.blockNumber);
      const { chainId } = await ethers.provider.getNetwork();
      const hash = operationHash(chainId, gov.target, q.id, q.p);
      expect(q.id).to.equal(0n);
      expect(q.p.target).to.equal(target.target);
      expect(q.p.data).to.equal(q.data);
      expect(q.p.eta).to.equal(BigInt(block.timestamp) + MIN);
      expect(q.p.expiresAt).to.equal(q.p.eta + GRACE);
      expect(q.p.operationHash).to.equal(hash);
      expect(q.p.executed).to.equal(false);
      expect(q.p.cancelled).to.equal(false);
      expect(await gov.state(q.id)).to.equal(S.Pending);
      await expect(Promise.resolve(q.receipt)).to.emit(gov, "ProposalCreated")
        .withArgs(q.id, owner.address, target.target, q.data, q.p.eta, q.p.expiresAt, hash);
    });
    it("assigns distinct increasing IDs and hashes to identical calls", async function () {
      const a = await queue();
      const b = await queue();
      expect(a.data).to.equal(b.data);
      expect(b.id).to.equal(a.id + 1n);
      expect(await gov.proposalCount()).to.equal(2n);
      expect(b.p.operationHash).not.to.equal(a.p.operationHash);
    });
    it("separates operation hashes by chain, controller address and local ID", async function () {
      const q = await queue();
      const { chainId } = await ethers.provider.getNetwork();
      for (const [chain, controller, id] of [
        [chainId + 1n, gov.target, q.id], [chainId, target.target, q.id], [chainId, gov.target, q.id + 1n],
      ]) expect(operationHash(chain, controller, id, q.p)).not.to.equal(q.p.operationHash);
      const second = await factory.deploy(owner.address, guardian.address, MIN);
      const b = await queue(target, "callMe", [123n], second);
      expect(b.id).to.equal(q.id);
      expect(b.p.operationHash).to.equal(operationHash(chainId, second.target, b.id, b.p));
      expect(b.p.operationHash).not.to.equal(q.p.operationHash);
    });
    for (const role of ["deployer", "guardian", "user", "pending owner"]) {
      it(`rejects proposal creation by ${role}`, async function () {
        if (role === "pending owner") await nominate();
        const signer = { deployer, guardian, user, "pending owner": candidate }[role];
        await expect(gov.connect(signer).propose(target.target, encode(target, "callMe", [1n])))
          .to.be.revertedWithCustomError(gov, "OwnableUnauthorizedAccount").withArgs(signer.address);
      });
    }
    it("rejects zero and code-less targets", async function () {
      for (const invalid of [ethers.ZeroAddress, user.address]) {
        await expect(gov.connect(owner).propose(invalid, "0x12345678"))
          .to.be.revertedWithCustomError(gov, "InvalidTarget").withArgs(invalid);
      }
      expect(await gov.proposalCount()).to.equal(0n);
    });
    for (const data of ["0x", "0x01", "0x0102", "0x010203"]) {
      it(`rejects calldata shorter than a selector: ${data}`, async function () {
        await expect(gov.connect(owner).propose(target.target, data))
          .to.be.revertedWithCustomError(gov, "InvalidCalldata").withArgs(BigInt(ethers.dataLength(data)));
        expect(await gov.proposalCount()).to.equal(0n);
      });
    }
    it("accepts four-byte selectors without inventing a selector allowlist", async function () {
      await gov.connect(owner).propose(target.target, encode(target, "failWithoutData"));
      expect(await gov.proposalCount()).to.equal(1n);
    });
    it("reports Unset but rejects nonexistent reads, execution and cancellation", async function () {
      for (const id of [0n, 99n, ethers.MaxUint256]) {
        expect(await gov.state(id)).to.equal(S.Unset);
        await expect(gov.getProposal(id)).to.be.revertedWithCustomError(gov, "ProposalNotFound").withArgs(id);
        await expect(gov.connect(user).execute(id)).to.be.revertedWithCustomError(gov, "ProposalNotFound").withArgs(id);
        await expect(gov.connect(owner).cancel(id)).to.be.revertedWithCustomError(gov, "ProposalNotFound").withArgs(id);
      }
    });
  });

  describe("execution lifecycle and call boundaries", function () {
    for (const role of ["owner", "guardian", "user", "pending owner", "deployer"]) {
      it(`allows ${role} to execute exactly at ETA with exact result/event and zero-value CALL`, async function () {
        if (role === "pending owner") await nominate();
        const executor = { owner, guardian, user, "pending owner": candidate, deployer }[role];
        const q = await queue();
        await mineAt(q.p.eta - 1n);
        expect(await gov.state(q.id)).to.equal(S.Pending);
        await nextTime(q.p.eta);
        const tx = await gov.connect(executor).execute(q.id);
        const result = abi.encode(["uint256"], [123n]);
        await expect(tx).to.emit(gov, "ProposalExecuted")
          .withArgs(q.id, executor.address, q.p.operationHash, ethers.keccak256(result));
        await expect(tx).to.emit(target, "Called").withArgs(gov.target, 123n, 0n);
        expect(await target.value()).to.equal(123n);
        expect(await target.lastCaller()).to.equal(gov.target);
        expect(await target.lastValue()).to.equal(0n);
        expect(await gov.owner()).to.equal(owner.address); // target storage wasn't delegated into G2
        expect(await gov.state(q.id)).to.equal(S.Executed);
        const p = await gov.getProposal(q.id);
        expect(p.executed).to.equal(true);
        expect(p.data).to.equal(q.p.data);
        expect(p.eta).to.equal(q.p.eta);
        expect(p.expiresAt).to.equal(q.p.expiresAt);
        expect(p.operationHash).to.equal(q.p.operationHash);
      });
    }
    it("returns raw target bytes from execute", async function () {
      const q = await queue();
      await mineAt(q.p.eta);
      expect(await gov.connect(user).execute.staticCall(q.id)).to.equal(abi.encode(["uint256"], [123n]));
      expect(await gov.state(q.id)).to.equal(S.Ready);
    });
    it("rejects execution at ETA minus one and leaves the proposal pending", async function () {
      const q = await queue();
      await nextTime(q.p.eta - 1n);
      await expect(gov.connect(user).execute(q.id)).to.be.revertedWithCustomError(gov, "InvalidProposalState").withArgs(q.id, S.Pending);
      expect((await gov.getProposal(q.id)).executed).to.equal(false);
    });
    it("allows execution at expiry minus one and retains Executed after expiry", async function () {
      const q = await queue();
      await mineAt(q.p.eta);
      expect(await gov.state(q.id)).to.equal(S.Ready);
      await nextTime(q.p.expiresAt - 1n);
      await gov.connect(user).execute(q.id);
      await mineAt(q.p.expiresAt);
      expect(await gov.state(q.id)).to.equal(S.Executed);
    });
    it("derives expiry exactly without a transaction and rejects execute and cancel", async function () {
      const q = await queue();
      await mineAt(q.p.expiresAt - 1n);
      expect(await gov.state(q.id)).to.equal(S.Ready);
      await mineAt(q.p.expiresAt);
      expect(await gov.state(q.id)).to.equal(S.Expired);
      await expect(gov.connect(user).execute(q.id)).to.be.revertedWithCustomError(gov, "InvalidProposalState").withArgs(q.id, S.Expired);
      await expect(gov.connect(guardian).cancel(q.id)).to.be.revertedWithCustomError(gov, "InvalidProposalState").withArgs(q.id, S.Expired);
      expect(await gov.getProposal(q.id)).to.deep.equal(q.p);
    });
    it("rejects repeated execution and cancellation of an executed action", async function () {
      const q = await queue();
      await ready(q);
      await expect(gov.connect(user).execute(q.id)).to.be.revertedWithCustomError(gov, "InvalidProposalState").withArgs(q.id, S.Executed);
      await expect(gov.connect(owner).cancel(q.id)).to.be.revertedWithCustomError(gov, "InvalidProposalState").withArgs(q.id, S.Executed);
    });
    it("rechecks target code at execution and permits retry after code is restored", async function () {
      const q = await queue();
      const code = await ethers.provider.getCode(target.target);
      await ethers.provider.send("hardhat_setCode", [target.target, "0x"]);
      await nextTime(q.p.eta);
      await expect(gov.connect(user).execute(q.id)).to.be.revertedWithCustomError(gov, "InvalidTarget").withArgs(target.target);
      expect((await gov.getProposal(q.id)).executed).to.equal(false);
      await ethers.provider.send("hardhat_setCode", [target.target, code]);
      await gov.connect(user).execute(q.id);
      expect(await gov.state(q.id)).to.equal(S.Executed);
    });
    it("bubbles raw custom errors, rolls back target writes, and permits a corrected retry", async function () {
      await target.setFailing(true);
      const q = await queue();
      await mineAt(q.p.eta);
      await expect(gov.connect(user).execute(q.id, { gasLimit: 5000000n })).to.be.revertedWithCustomError(target, "TargetFailure").withArgs(123n, gov.target);
      expect(await target.value()).to.equal(0n);
      expect(await target.lastCaller()).to.equal(ethers.ZeroAddress);
      expect(await gov.getProposal(q.id)).to.deep.equal(q.p);
      expect(await gov.state(q.id)).to.equal(S.Ready);
      await target.setFailing(false);
      await gov.connect(other).execute(q.id);
      expect(await target.value()).to.equal(123n);
    });
    it("does not revive a failing call after its immutable expiry", async function () {
      await target.setFailing(true);
      const q = await queue();
      await nextTime(q.p.eta);
      await expect(gov.connect(user).execute(q.id)).to.be.revertedWithCustomError(target, "TargetFailure");
      await target.setFailing(false);
      await mineAt(q.p.expiresAt);
      await expect(gov.connect(user).execute(q.id)).to.be.revertedWithCustomError(gov, "InvalidProposalState").withArgs(q.id, S.Expired);
    });
    it("bubbles string reasons without wrapping the raw revert", async function () {
      const q = await queue(target, "failWithReason", []);
      await nextTime(q.p.eta);
      await expect(gov.connect(user).execute(q.id)).to.be.revertedWith("target reason");
      expect((await gov.getProposal(q.id)).executed).to.equal(false);
    });
    it("bubbles empty revert data and leaves the action retryable", async function () {
      const q = await queue(target, "failWithoutData", []);
      await nextTime(q.p.eta);
      await expect(gov.connect(user).execute(q.id)).to.be.revertedWithoutReason();
      expect((await gov.getProposal(q.id)).executed).to.equal(false);
    });
    it("supports large returndata and hashes the complete ABI result", async function () {
      const size = 65536;
      const q = await queue(target, "largeResult", [size]);
      const result = abi.encode(["bytes"], [ethers.hexlify(new Uint8Array(size))]);
      await mineAt(q.p.eta);
      expect(await gov.connect(user).execute.staticCall(q.id)).to.equal(result);
      await expect(gov.connect(user).execute(q.id)).to.emit(gov, "ProposalExecuted")
        .withArgs(q.id, user.address, q.p.operationHash, ethers.keccak256(result));
    });
    it("exposes no ETH-value, executor-selected calldata, delegatecall or immediate admin entry point", async function () {
      const mutating = gov.interface.fragments.filter((f) => f.type === "function" && !["view", "pure"].includes(f.stateMutability));
      expect(mutating.map((f) => f.name).sort()).to.deep.equal([
        "acceptOwnership", "cancel", "cancelOwnershipTransfer", "execute", "propose", "setDelay", "setGuardian", "transferOwnership",
      ].sort());
      expect(gov.interface.fragments.some((f) => ["receive", "fallback"].includes(f.type))).to.equal(false);
      expect(gov.interface.getFunction("execute").inputs.map((i) => i.type)).to.deep.equal(["uint256"]);
      expect(mutating.every((f) => f.stateMutability === "nonpayable")).to.equal(true);
      const q = await queue();
      await mineAt(q.p.eta);
      await expect(gov.connect(user).execute(q.id, { value: 1n })).to.be.revertedWithoutReason();
      await expect(user.sendTransaction({ to: gov.target, value: 1n })).to.be.revertedWithoutReason();
      await ethers.provider.send("hardhat_setBalance", [gov.target, "0x64"]); // forced ETH cannot fund CALL
      await gov.connect(user).execute(q.id);
      expect(await target.lastValue()).to.equal(0n);
      expect(await ethers.provider.getBalance(gov.target)).to.equal(100n);
    });
  });

  describe("immediate cancellation and fresh authorization", function () {
    for (const role of ["owner", "guardian"]) {
      for (const phase of ["Pending", "Ready"]) {
        it(`allows ${role} cancellation in ${phase} and emits complete terminal evidence`, async function () {
          const signer = { owner, guardian }[role];
          const q = await queue();
          if (phase === "Ready") await nextTime(q.p.eta);
          await expect(gov.connect(signer).cancel(q.id)).to.emit(gov, "ProposalCancelled")
            .withArgs(q.id, signer.address, q.p.operationHash);
          expect(await gov.state(q.id)).to.equal(S.Cancelled);
          expect((await gov.getProposal(q.id)).cancelled).to.equal(true);
          await expect(gov.connect(user).execute(q.id)).to.be.revertedWithCustomError(gov, "InvalidProposalState").withArgs(q.id, S.Cancelled);
          await expect(gov.connect(signer).cancel(q.id)).to.be.revertedWithCustomError(gov, "InvalidProposalState").withArgs(q.id, S.Cancelled);
          await mineAt(q.p.expiresAt);
          expect(await gov.state(q.id)).to.equal(S.Cancelled);
        });
      }
    }
    it("permits cancellation at expiry minus one and resolves cancel-first ordering terminally", async function () {
      const q = await queue();
      await nextTime(q.p.expiresAt - 1n);
      await gov.connect(guardian).cancel(q.id);
      await expect(gov.connect(user).execute(q.id)).to.be.revertedWithCustomError(gov, "InvalidProposalState").withArgs(q.id, S.Cancelled);
    });
    for (const role of ["user", "deployer", "pending owner"]) {
      it(`rejects cancellation by ${role}`, async function () {
        if (role === "pending owner") await nominate();
        const signer = { user, deployer, "pending owner": candidate }[role];
        const q = await queue();
        await expect(gov.connect(signer).cancel(q.id)).to.be.revertedWithCustomError(gov, "UnauthorizedCancellation").withArgs(signer.address);
      });
    }
    for (const terminal of ["cancelled", "expired"]) {
      it(`requires a new ID and full fresh delay to re-propose a ${terminal} action`, async function () {
        const first = await queue();
        if (terminal === "cancelled") await gov.connect(guardian).cancel(first.id);
        else await mineAt(first.p.expiresAt);
        const second = await queue();
        expect(second.id).to.equal(first.id + 1n);
        expect(second.data).to.equal(first.data);
        const block = await ethers.provider.getBlock(second.receipt.blockNumber);
        expect(second.p.eta).to.equal(BigInt(block.timestamp) + MIN);
        expect(second.p.expiresAt).to.equal(second.p.eta + GRACE);
        expect(second.p.operationHash).not.to.equal(first.p.operationHash);
        await expect(gov.connect(user).execute(second.id)).to.be.revertedWithCustomError(gov, "InvalidProposalState").withArgs(second.id, S.Pending);
        const original = await gov.getProposal(first.id);
        expect(original.target).to.equal(first.p.target);
        expect(original.data).to.equal(first.p.data);
        expect(original.eta).to.equal(first.p.eta);
        expect(original.expiresAt).to.equal(first.p.expiresAt);
        expect(original.operationHash).to.equal(first.p.operationHash);
        expect(original.executed).to.equal(false);
        expect(original.cancelled).to.equal(terminal === "cancelled");
      });
    }
  });

  describe("timelocked configuration and independent guardian", function () {
    for (const role of ["owner", "guardian", "user", "pending owner", "deployer"]) {
      it(`rejects every direct configuration/nomination path by ${role}`, async function () {
        if (role === "pending owner") await nominate();
        const signer = { owner, guardian, user, "pending owner": candidate, deployer }[role];
        for (const [method, args] of [
          ["setDelay", [MIN]], ["setGuardian", [replacementGuardian.address]],
          ["transferOwnership", [other.address]], ["cancelOwnershipTransfer", []],
        ]) {
          await expect(gov.connect(signer)[method](...args)).to.be.revertedWithCustomError(gov, "OnlySelf").withArgs(signer.address);
        }
      });
    }
    for (const delay of [0n, MIN - 1n, MAX + 1n]) {
      it(`rejects queued delay outside bounds: ${delay}`, async function () {
        const q = await queue(gov, "setDelay", [delay]);
        await nextTime(q.p.eta);
        await expect(gov.connect(user).execute(q.id)).to.be.revertedWithCustomError(gov, "DelayOutOfBounds").withArgs(delay);
        expect(await gov.delay()).to.equal(MIN);
        expect((await gov.getProposal(q.id)).executed).to.equal(false);
      });
    }
    it("accepts delay ceiling and floor without rewriting prior timestamps or hashes", async function () {
      const old = await queue();
      const increase = await queue(gov, "setDelay", [MAX]);
      await nextTime(increase.p.eta);
      await expect(gov.connect(user).execute(increase.id)).to.emit(gov, "DelayUpdated").withArgs(MIN, MAX);
      expect(await gov.getProposal(old.id)).to.deep.equal(old.p);
      const long = await queue();
      const lower = await queue(gov, "setDelay", [MIN]);
      const lowerBlock = await ethers.provider.getBlock(lower.receipt.blockNumber);
      expect(lower.p.eta).to.equal(BigInt(lowerBlock.timestamp) + MAX);
      await nextTime(lower.p.eta - 1n);
      await expect(gov.connect(user).execute(lower.id)).to.be.revertedWithCustomError(gov, "InvalidProposalState").withArgs(lower.id, S.Pending);
      await nextTime(lower.p.eta);
      await expect(gov.connect(user).execute(lower.id)).to.emit(gov, "DelayUpdated").withArgs(MAX, MIN);
      expect(await gov.getProposal(long.id)).to.deep.equal(long.p);
      expect(await gov.getProposal(old.id)).to.deep.equal(old.p);
      expect(await gov.state(old.id)).to.equal(S.Expired);
      const short = await queue();
      const shortBlock = await ethers.provider.getBlock(short.receipt.blockNumber);
      expect(short.p.eta).to.equal(BigInt(shortBlock.timestamp) + MIN);
    });
    it("rotates guardian only after the full delay and transfers only cancellation privilege", async function () {
      const rotation = await queue(gov, "setGuardian", [replacementGuardian.address]);
      const business = await queue();
      await expect(gov.connect(user).execute(rotation.id)).to.be.revertedWithCustomError(gov, "InvalidProposalState").withArgs(rotation.id, S.Pending);
      await nextTime(rotation.p.eta);
      await expect(gov.connect(user).execute(rotation.id)).to.emit(gov, "GuardianUpdated").withArgs(guardian.address, replacementGuardian.address);
      expect(await gov.guardian()).to.equal(replacementGuardian.address);
      await expect(gov.connect(guardian).cancel(business.id)).to.be.revertedWithCustomError(gov, "UnauthorizedCancellation").withArgs(guardian.address);
      await gov.connect(replacementGuardian).cancel(business.id);
      await expect(gov.connect(replacementGuardian).propose(target.target, encode(target, "callMe", [7n])))
        .to.be.revertedWithCustomError(gov, "OwnableUnauthorizedAccount");
    });
    it("lets guardian veto its own replacement without a bypass", async function () {
      const rotation = await queue(gov, "setGuardian", [replacementGuardian.address]);
      await gov.connect(guardian).cancel(rotation.id);
      await nextTime(rotation.p.eta);
      await expect(gov.connect(owner).execute(rotation.id)).to.be.revertedWithCustomError(gov, "InvalidProposalState").withArgs(rotation.id, S.Cancelled);
      expect(await gov.guardian()).to.equal(guardian.address);
    });
    it("rejects zero, self, active-owner and pending-owner guardians", async function () {
      await nominate();
      for (const invalid of [ethers.ZeroAddress, gov.target, owner.address, candidate.address]) {
        const q = await queue(gov, "setGuardian", [invalid]);
        await nextTime(q.p.eta);
        await expect(gov.connect(user).execute(q.id)).to.be.revertedWithCustomError(gov, "InvalidGuardian").withArgs(invalid);
        expect(await gov.guardian()).to.equal(guardian.address);
      }
    });
    it("revalidates role separation at execution when a nomination changes queued rotation validity", async function () {
      const nomination = await queue(gov, "transferOwnership", [candidate.address]);
      const rotation = await queue(gov, "setGuardian", [candidate.address]);
      await ready(nomination);
      await nextTime(rotation.p.eta);
      await expect(gov.connect(user).execute(rotation.id)).to.be.revertedWithCustomError(gov, "InvalidGuardian").withArgs(candidate.address);
    });
    it("revalidates queued nomination against a later guardian rotation", async function () {
      const rotation = await queue(gov, "setGuardian", [candidate.address]);
      const nomination = await queue(gov, "transferOwnership", [candidate.address]);
      await ready(rotation);
      await nextTime(nomination.p.eta);
      await expect(gov.connect(user).execute(nomination.id)).to.be.revertedWithCustomError(gov, "OwnableInvalidOwner").withArgs(candidate.address);
      expect(await gov.pendingOwner()).to.equal(ethers.ZeroAddress);
    });
  });

  describe("Ownable2Step handover without inherited bypasses", function () {
    it("nominates after delay, retains the old owner, and clears pending on acceptance", async function () {
      const q = await queue(gov, "transferOwnership", [candidate.address]);
      expect(await gov.pendingOwner()).to.equal(ethers.ZeroAddress);
      await nextTime(q.p.eta);
      await expect(gov.connect(user).execute(q.id)).to.emit(gov, "OwnershipTransferStarted").withArgs(owner.address, candidate.address);
      expect(await gov.owner()).to.equal(owner.address);
      expect(await gov.pendingOwner()).to.equal(candidate.address);
      await queue(); // old owner still proposes
      await expect(gov.connect(candidate).acceptOwnership()).to.emit(gov, "OwnershipTransferred").withArgs(owner.address, candidate.address);
      expect(await gov.owner()).to.equal(candidate.address);
      expect(await gov.pendingOwner()).to.equal(ethers.ZeroAddress);
      await expect(gov.connect(owner).propose(target.target, encode(target, "callMe", [1n])))
        .to.be.revertedWithCustomError(gov, "OwnableUnauthorizedAccount").withArgs(owner.address);
      await gov.connect(candidate).propose(target.target, encode(target, "callMe", [1n]));
      await expect(gov.connect(candidate).acceptOwnership()).to.be.revertedWithCustomError(gov, "OwnableUnauthorizedAccount").withArgs(candidate.address);
    });
    it("rejects acceptance without a nomination for all roles", async function () {
      for (const signer of [deployer, owner, guardian, user, candidate]) {
        await expect(gov.connect(signer).acceptOwnership()).to.be.revertedWithCustomError(gov, "OwnableUnauthorizedAccount").withArgs(signer.address);
      }
    });
    it("rejects acceptance by every account other than the nominated candidate", async function () {
      await nominate();
      for (const signer of [deployer, owner, guardian, user, other]) {
        await expect(gov.connect(signer).acceptOwnership()).to.be.revertedWithCustomError(gov, "OwnableUnauthorizedAccount").withArgs(signer.address);
      }
      expect(await gov.owner()).to.equal(owner.address);
      expect(await gov.pendingOwner()).to.equal(candidate.address);
    });
    it("rejects zero, self and guardian nominees through queued calls", async function () {
      for (const invalid of [ethers.ZeroAddress, gov.target, guardian.address]) {
        const q = await queue(gov, "transferOwnership", [invalid]);
        await nextTime(q.p.eta);
        await expect(gov.connect(user).execute(q.id)).to.be.revertedWithCustomError(gov, "OwnableInvalidOwner").withArgs(invalid);
        expect(await gov.owner()).to.equal(owner.address);
        expect(await gov.pendingOwner()).to.equal(ethers.ZeroAddress);
      }
    });
    it("clears a replaced candidate with cancellation evidence and prevents stale acceptance", async function () {
      await nominate();
      const q = await queue(gov, "transferOwnership", [other.address]);
      await nextTime(q.p.eta);
      const tx = await gov.connect(user).execute(q.id);
      await expect(tx).to.emit(gov, "OwnershipTransferCancelled").withArgs(owner.address, candidate.address);
      await expect(tx).to.emit(gov, "OwnershipTransferStarted").withArgs(owner.address, other.address);
      expect(await gov.pendingOwner()).to.equal(other.address);
      await expect(gov.connect(candidate).acceptOwnership()).to.be.revertedWithCustomError(gov, "OwnableUnauthorizedAccount").withArgs(candidate.address);
      await gov.connect(other).acceptOwnership();
      expect(await gov.owner()).to.equal(other.address);
      expect(await gov.pendingOwner()).to.equal(ethers.ZeroAddress);
    });
    it("cancels a nomination only through delay and rejects stale acceptance", async function () {
      await nominate();
      const q = await queue(gov, "cancelOwnershipTransfer", []);
      await nextTime(q.p.eta);
      await expect(gov.connect(user).execute(q.id)).to.emit(gov, "OwnershipTransferCancelled").withArgs(owner.address, candidate.address);
      expect(await gov.pendingOwner()).to.equal(ethers.ZeroAddress);
      expect(await gov.owner()).to.equal(owner.address);
      await expect(gov.connect(candidate).acceptOwnership()).to.be.revertedWithCustomError(gov, "OwnableUnauthorizedAccount").withArgs(candidate.address);
    });
    it("rejects cancellation when no nomination exists", async function () {
      const q = await queue(gov, "cancelOwnershipTransfer", []);
      await nextTime(q.p.eta);
      await expect(gov.connect(user).execute(q.id)).to.be.revertedWithCustomError(gov, "NoPendingOwnershipTransfer");
    });
    it("does not undo acceptance if acceptance wins the race against queued cancellation", async function () {
      await nominate();
      const q = await queue(gov, "cancelOwnershipTransfer", []);
      await gov.connect(candidate).acceptOwnership();
      await nextTime(q.p.eta);
      await expect(gov.connect(user).execute(q.id)).to.be.revertedWithCustomError(gov, "NoPendingOwnershipTransfer");
      expect(await gov.owner()).to.equal(candidate.address);
      expect(await gov.pendingOwner()).to.equal(ethers.ZeroAddress);
    });
    it("leaves prior business proposals intact through ownership transfer and changes cancellation authority", async function () {
      const nomination = await queue(gov, "transferOwnership", [candidate.address]);
      const business = await queue();
      const cancelMe = await queue(target, "callMe", [456n]);
      await ready(nomination);
      await gov.connect(candidate).acceptOwnership();
      expect(await gov.getProposal(business.id)).to.deep.equal(business.p);
      await gov.connect(user).execute(business.id);
      await expect(gov.connect(owner).cancel(cancelMe.id)).to.be.revertedWithCustomError(gov, "UnauthorizedCancellation").withArgs(owner.address);
      await gov.connect(candidate).cancel(cancelMe.id);
    });
    it("allows a contract candidate to accept through an actual external call", async function () {
      await selfCall("transferOwnership", [target.target]);
      await expect(target.acceptControllerOwnership(gov.target)).to.emit(gov, "OwnershipTransferred").withArgs(owner.address, target.target);
      expect(await gov.owner()).to.equal(target.target);
      expect(await gov.pendingOwner()).to.equal(ethers.ZeroAddress);
    });
    it("accepts a new two-step child owner through the controller's exact queued CALL", async function () {
      const child = await factory.deploy(owner.address, replacementGuardian.address, MIN);
      const nomination = await queue(child, "transferOwnership", [gov.target], child);
      await ready(nomination, user, child);
      expect(await child.owner()).to.equal(owner.address);
      expect(await child.pendingOwner()).to.equal(gov.target);
      const acceptance = await queue(child, "acceptOwnership", []);
      await expect(gov.connect(user).execute(acceptance.id)).to.be.revertedWithCustomError(gov, "InvalidProposalState")
        .withArgs(acceptance.id, S.Pending);
      await nextTime(acceptance.p.eta);
      await expect(gov.connect(user).execute(acceptance.id)).to.emit(child, "OwnershipTransferred").withArgs(owner.address, gov.target);
      expect(await child.owner()).to.equal(gov.target);
      expect(await child.pendingOwner()).to.equal(ethers.ZeroAddress);
    });
    it("lets guardian cancel ownership proposals without acquiring ownership", async function () {
      const q = await queue(gov, "transferOwnership", [candidate.address]);
      await gov.connect(guardian).cancel(q.id);
      expect(await gov.pendingOwner()).to.equal(ethers.ZeroAddress);
      expect(await gov.owner()).to.equal(owner.address);
    });
    it("disables renunciation for every role and for a queued self-call", async function () {
      await nominate();
      for (const signer of [owner, guardian, user, candidate, deployer]) {
        await expect(gov.connect(signer).renounceOwnership()).to.be.revertedWithCustomError(gov, "RenunciationDisabled");
      }
      const q = await queue(gov, "renounceOwnership", []);
      await nextTime(q.p.eta);
      await expect(gov.connect(user).execute(q.id)).to.be.revertedWithCustomError(gov, "RenunciationDisabled");
      expect(await gov.owner()).to.equal(owner.address);
      expect(await gov.pendingOwner()).to.equal(candidate.address);
    });
    it("cannot use a queued self-call to create proposals as though the controller were owner", async function () {
      const q = await queue(gov, "propose", [target.target, encode(target, "callMe", [999n])]);
      await nextTime(q.p.eta);
      await expect(gov.connect(user).execute(q.id)).to.be.revertedWithCustomError(gov, "OwnableUnauthorizedAccount").withArgs(gov.target);
      expect(await gov.proposalCount()).to.equal(1n);
    });
  });

  describe("fee-on-transfer and malicious-target integrations", function () {
    for (const exempt of [false, true]) {
      it(`reconciles actual IFR balance deltas at nine decimals with fee exemption ${exempt}`, async function () {
        const token = await ethers.deployContract("InfernoToken", [pool.address]);
        const unit = 10n ** 9n;
        const gross = 100n * unit + 101n;
        if (exempt) await token.setFeeExempt(gov.target, true);
        const net = (amount) => exempt ? amount : amount - amount * 200n / 10000n - amount * 50n / 10000n - amount * 100n / 10000n;
        const beforeIn = await token.balanceOf(gov.target);
        await token.transfer(gov.target, gross);
        const received = (await token.balanceOf(gov.target)) - beforeIn;
        expect(received).to.equal(net(gross));
        expect(await token.decimals()).to.equal(9n);
        await token.transferOwnership(gov.target); // local legacy T1, no new acceptance invented
        const q = await queue(token, "transfer", [other.address, received]);
        const beforeOut = await token.balanceOf(other.address);
        const beforePool = await token.balanceOf(pool.address);
        const beforeSupply = await token.totalSupply();
        await ready(q);
        expect((await token.balanceOf(other.address)) - beforeOut).to.equal(net(received));
        expect(await token.balanceOf(gov.target)).to.equal(0n);
        expect((await token.balanceOf(pool.address)) - beforePool).to.equal(exempt ? 0n : received * 100n / 10000n);
        expect(beforeSupply - (await token.totalSupply())).to.equal(exempt ? 0n : received * 200n / 10000n + received * 50n / 10000n);
        expect(await token.owner()).to.equal(gov.target);
        expect(await token.senderBurnBps()).to.equal(200n);
        expect(await token.recipientBurnBps()).to.equal(50n);
        expect(await token.poolFeeBps()).to.equal(100n);
      });
    }
    it("reuses the fee-on-transfer mock and never treats a transfer's boolean return as a receipt amount", async function () {
      const token = await ethers.deployContract("MockFeeOnTransferToken");
      const gross = 9007199254740993123n; // exceeds Number safe precision
      await token.setFeeBps(350n);
      await token.mint(owner.address, gross);
      const before = await token.balanceOf(gov.target);
      await token.connect(owner).transfer(gov.target, gross);
      const received = (await token.balanceOf(gov.target)) - before;
      expect(received).to.equal(gross - gross * 350n / 10000n);
      const q = await queue(token, "transfer", [other.address, received]);
      await mineAt(q.p.eta);
      expect(await gov.connect(user).execute.staticCall(q.id)).to.equal(abi.encode(["bool"], [true]));
      const recipientBefore = await token.balanceOf(other.address);
      await gov.connect(user).execute(q.id);
      expect((await token.balanceOf(other.address)) - recipientBefore).to.equal(received - received * 350n / 10000n);
    });
    it("retains generic CALL semantics when a token-shaped target returns false", async function () {
      const token = await ethers.deployContract("MockFalseReturnToken");
      const q = await queue(token, "transfer", [other.address, 1n]);
      await mineAt(q.p.eta);
      const result = abi.encode(["bool"], [false]);
      expect(await gov.connect(user).execute.staticCall(q.id)).to.equal(result);
      await expect(gov.connect(user).execute(q.id)).to.emit(gov, "ProposalExecuted")
        .withArgs(q.id, user.address, q.p.operationHash, ethers.keccak256(result));
      expect(await gov.state(q.id)).to.equal(S.Executed);
    });
    for (const nested of ["same", "other"]) {
      it(`blocks ${nested}-proposal reentrancy from the existing malicious token and rolls back all effects`, async function () {
        const malicious = await ethers.deployContract("MockReentrantToken");
        const amount = 123456789n;
        await malicious.transfer(gov.target, amount);
        const outer = await queue(malicious, "transfer", [other.address, amount]);
        const inner = await queue();
        const nestedId = nested === "same" ? outer.id : inner.id;
        await malicious.arm(gov.target, encode(gov, "execute", [nestedId]));
        await nextTime(inner.p.eta);
        await expect(gov.connect(user).execute(outer.id, { gasLimit: 5000000n })).to.be.revertedWithCustomError(gov, "ReentrancyGuardReentrantCall");
        expect(await gov.getProposal(outer.id)).to.deep.equal(outer.p);
        expect(await gov.getProposal(inner.id)).to.deep.equal(inner.p);
        expect(await malicious.balanceOf(gov.target)).to.equal(amount);
        expect(await malicious.balanceOf(other.address)).to.equal(0n);
        expect(await target.value()).to.equal(0n);
        expect(await malicious.getFunction("target")()).to.equal(gov.target); // callback disarm also rolled back
        await malicious.arm(ethers.ZeroAddress, "0x");
        await gov.connect(other).execute(outer.id);
        await gov.connect(user).execute(inner.id);
        expect(await malicious.balanceOf(other.address)).to.equal(amount);
        expect(await target.value()).to.equal(123n);
      });
    }
    it("does not grant a malicious target privileged configuration authority", async function () {
      const malicious = await ethers.deployContract("MockReentrantToken");
      await malicious.transfer(gov.target, 10n);
      const q = await queue(malicious, "transfer", [other.address, 10n]);
      await malicious.arm(gov.target, encode(gov, "setDelay", [MAX]));
      await nextTime(q.p.eta);
      await expect(gov.connect(user).execute(q.id)).to.be.revertedWithCustomError(gov, "OnlySelf").withArgs(malicious.target);
      expect(await gov.delay()).to.equal(MIN);
      expect(await malicious.balanceOf(gov.target)).to.equal(10n);
    });
  });
});
