"use strict";

// Source-only dummy assertions. No automatic invocation, transport, keys or target import.
async function runDummyTests() {
  const assert = require("node:assert/strict");
  const ethers = require("ethers");
  const api = require("./forum-chain-evidence.cjs");
  assert.equal(ethers.version, "6.17.0");
  assert.deepEqual(Object.keys(api).sort(), ["collect1271Evidence", "collectLockEvidence"]);
  const DEFAULT = Symbol("dummy-default");
  const A = (digit) => "0x" + digit.repeat(40);
  const H = (byte) => "0x" + byte.repeat(32);
  const copy = (value) => structuredClone(value);
  const tokenAbi = new ethers.Interface(["function decimals() view returns (uint8)"]);
  const lockAbi = new ethers.Interface(["function token() view returns (address)", "function lockedBalance(address) view returns (uint256)"]);
  const walletAbi = new ethers.Interface(["function isValidSignature(bytes32,bytes) view returns (bytes4)"]);
  const tokenCode = "0x6001", lockCode = "0x6002", walletCode = "0x6003";
  const fixtures = (signatures = false) => {
    const input = {
      schema: "forum-chain-evidence-input-v1", providerId: "public-dummy-provider",
      snapshot: { chainId: "1", height: "12345678", blockHash: H("ab") },
      policy: {
        schema: "forum-eligibility-input-v1", approval: "not-established", chainId: "1",
        token: { address: A("a"), codeHash: ethers.keccak256(tokenCode), decimals: "9" },
        contracts: [{ address: A("b"), type: "IFRLOCK", codeHash: ethers.keccak256(lockCode), ownerSlot: "wallet-aggregate" }],
        condition: "recorded-balance-at-snapshot", ownerAttribution: "supplied-wallet",
        aggregation: "no-cross-slot-total", overlap: "reject-duplicate-slots",
        finality: { basis: "caller-selected-unverified", reference: "dummy-snapshot-no-finality-proof" },
        callContext: { from: A("e"), gasLimit: "100000" },
        limits: {
          maxCalls: "64", maxVoters: "8", maxContracts: "4", maxSignatures: "8",
          maxRequestBytes: "16384", maxTotalRequestBytes: "131072", maxResponseBytes: "65536",
          maxTotalResponseBytes: "262144", maxEvidenceBytes: "524288", maxSignatureBytes: "1024",
          requestTimeoutMs: "1000", totalTimeoutMs: "10000",
        },
      },
      voters: [
        { wallet: A("c"), kind: "EOA", codeHash: ethers.keccak256("0x") },
        { wallet: A("d"), kind: "EIP1271", codeHash: ethers.keccak256(walletCode) },
      ],
    };
    if (signatures) input.requests = [{ wallet: A("d"), digest: H("12"), signature: "0x1234ab", contextHash: H("34") }];
    return input;
  };

  function dummy(input, hook = () => DEFAULT) {
    const reference = copy(input);
    const trace = [];
    const provider = {
      async request(args) {
        assert.ok(Object.isFrozen(args));
        assert.ok(Object.isFrozen(args.params));
        trace.push(copy(args));
        const { method, params } = args;
        assert.ok(["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call"].includes(method));
        if (method === "eth_getCode" || method === "eth_call") {
          assert.deepEqual(params[1], { blockHash: reference.snapshot.blockHash, requireCanonical: true });
          assert.ok(Object.isFrozen(params[1]));
        }
        if (method === "eth_getBlockByNumber") {
          assert.deepEqual(params, ["0x" + BigInt(reference.snapshot.height).toString(16), false]);
        }
        const replacement = await hook(args, trace);
        if (replacement !== DEFAULT) return replacement;
        if (method === "eth_chainId") { assert.deepEqual(params, []); return "0x1"; }
        if (method === "eth_getBlockByNumber") {
          return { number: params[0], hash: reference.snapshot.blockHash, extraData: "0x" };
        }
        if (method === "eth_getCode") {
          const target = params[0];
          if (target === reference.policy.token.address) return tokenCode;
          if (reference.policy.contracts.some((contract) => contract.address === target)) return lockCode;
          const voter = reference.voters.find((item) => item.wallet === target);
          assert.ok(voter);
          return voter.kind === "EOA" ? "0x" : walletCode;
        }
        const tx = params[0];
        assert.ok(Object.isFrozen(tx));
        assert.deepEqual(Object.keys(tx).sort(), ["data", "from", "gas", "to", "value"]);
        assert.equal(tx.from, reference.policy.callContext.from);
        assert.equal(tx.gas, "0x" + BigInt(reference.policy.callContext.gasLimit).toString(16));
        assert.equal(tx.value, "0x0");
        if (tx.to === reference.policy.token.address) {
          assert.equal(tx.data, tokenAbi.encodeFunctionData("decimals", []));
          return tokenAbi.encodeFunctionResult("decimals", [9n]);
        }
        if (reference.policy.contracts.some((contract) => contract.address === tx.to)) {
          const parsed = lockAbi.parseTransaction({ data: tx.data });
          if (parsed.name === "token") return lockAbi.encodeFunctionResult("token", [reference.policy.token.address]);
          assert.equal(parsed.name, "lockedBalance");
          const owner = parsed.args[0].toLowerCase();
          assert.ok(reference.voters.some((voter) => voter.wallet === owner));
          return lockAbi.encodeFunctionResult("lockedBalance", [owner === A("c") ? 9007199254740993n : 0n]);
        }
        const parsed = walletAbi.parseTransaction({ data: tx.data });
        assert.equal(parsed.name, "isValidSignature");
        assert.ok(reference.requests.some((request) => request.wallet === tx.to
          && request.digest === parsed.args[0] && request.signature.toLowerCase() === parsed.args[1]));
        return walletAbi.encodeFunctionResult("isValidSignature", ["0x1626ba7e"]);
      },
    };
    return { provider, trace };
  }

  function disabled(result) {
    assert.equal(result.authority, "ADVISORY");
    assert.equal(result.productionReady, false);
    assert.equal(result.chainEvidenceVerified, false);
    assert.equal(result.trust, "rpc-observations");
    assert.equal(result.policyApproval, "not-established");
    assert.equal(result.snapshotFinality, "not-established");
    assert.equal(result.eligibleSupply, "unknown");
    assert.equal(result.intakeOrdering, "unknown");
    assert.ok(Object.isFrozen(result));
    for (const forbidden of ["profile", "winner", "quorum", "eligibleWeight", "receipts", "cutoff", "trustedEvidence"]) {
      assert.equal(Object.hasOwn(result, forbidden), false);
    }
  }

  function rejected(result, category) {
    disabled(result);
    assert.equal(result.status, "rejected");
    assert.equal(result.error, category);
    assert.deepEqual(Object.keys(result).sort(), [
      "schema", "kind", "status", "authority", "productionReady", "chainEvidenceVerified", "trust",
      "policyApproval", "snapshotFinality", "eligibleSupply", "intakeOrdering", "error",
    ].sort());
  }

  const lockInput = fixtures();
  const lockDummy = dummy(lockInput);
  const lockResult = await api.collectLockEvidence(lockInput, lockDummy.provider);
  disabled(lockResult);
  assert.equal(lockResult.status, "observed");
  assert.equal(lockResult.coverage.scope, "supplied-voters-only");
  assert.equal(lockResult.observations.length, 2);
  assert.equal(lockResult.observations.find((item) => item.owner === A("c")).weight, "9007199254740993");
  assert.equal(lockResult.observations.find((item) => item.owner === A("d")).state, "zero");
  assert.equal(lockResult.calls.length, 12);
  assert.ok(Object.isFrozen(lockResult.policy.limits));
  assert.ok(Object.isFrozen(lockResult.observations[0]));
  assert.deepEqual(lockInput, fixtures());
  const withoutHash = copy(lockResult);
  delete withoutHash.evidenceHash;
  const canonical = (value) => Array.isArray(value) ? "[" + value.map(canonical).join(",") + "]"
    : value !== null && typeof value === "object" ? "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}"
      : JSON.stringify(value);
  const hashJSON = (value) => ethers.keccak256(ethers.toUtf8Bytes(canonical(value)));
  assert.equal(lockResult.evidenceHash, hashJSON(withoutHash));
  assert.equal(lockResult.policyHash, hashJSON(lockResult.policy));
  for (const observation of lockResult.observations) {
    const { claimId, weight, state, ...slot } = observation;
    assert.equal(claimId, hashJSON(slot));
  }

  const signatureInput = fixtures(true);
  const signatureDummy = dummy(signatureInput);
  const signatureResult = await api.collect1271Evidence(signatureInput, signatureDummy.provider);
  disabled(signatureResult);
  assert.equal(signatureResult.status, "observed");
  assert.equal(signatureResult.observations[0].signatureHash, ethers.keccak256("0x1234ab"));
  assert.equal(signatureResult.observations[0].magicValue, "0x1626ba7e");
  assert.equal(signatureResult.observations[0].digest, signatureInput.requests[0].digest);
  assert.equal(signatureResult.observations[0].contextHash, signatureInput.requests[0].contextHash);
  assert.deepEqual(signatureResult.observations[0].snapshot, signatureInput.snapshot);
  assert.equal(signatureResult.calls.length, 11);
  assert.equal(signatureResult.coverage.signatureRequests, "1");

  for (const signatures of [false, true]) {
    const invoke = signatures ? api.collect1271Evidence : api.collectLockEvidence;
    const input = fixtures(signatures);
    input.policy.contracts.push({ ...input.policy.contracts[0], address: A("1") });
    if (signatures) input.requests.push({ ...input.requests[0], digest: H("56"), signature: "0xdeadbeef" });
    const baseline = await invoke(input, dummy(input).provider);
    assert.equal(baseline.status, "observed");
    const permuted = copy(input);
    permuted.voters.reverse();
    permuted.policy.contracts.reverse();
    if (signatures) permuted.requests.reverse();
    assert.deepEqual(await invoke(permuted, dummy(permuted).provider), baseline);
    const mutated = copy(input);
    const before = copy(input);
    let mutatedOnce = false;
    const capability = dummy(before, () => {
      if (!mutatedOnce) {
        mutatedOnce = true;
        mutated.snapshot.blockHash = H("ff");
        mutated.policy.token.address = A("2");
        mutated.policy.callContext.from = A("3");
        mutated.policy.limits.maxCalls = "0";
        mutated.policy.contracts.push({ type: "COMMITMENT_VAULT" });
        mutated.voters[0].kind = "EIP1271";
        mutated.providerId = "changed";
        if (signatures) mutated.requests[0].signature = "0xffff";
        capability.provider.request = () => { throw new Error("dummy-secret-must-not-escape"); };
      }
      return DEFAULT;
    });
    assert.deepEqual(await invoke(mutated, capability.provider), baseline);
  }

  const invalidInputs = [
    ["INPUT_INVALID", (input) => { delete input.policy; }],
    ["INPUT_INVALID", (input) => { delete input.policy.limits.maxTotalRequestBytes; }],
    ["INPUT_INVALID", (input) => { delete input.policy.callContext.from; }],
    ["INPUT_INVALID", (input) => { input.policy.token.decimals = 9; }],
    ["INPUT_INVALID", (input) => { input.snapshot.height = 123; }],
    ["INPUT_INVALID", (input) => { input.snapshot.height = "01"; }],
    ["INPUT_INVALID", (input) => { input.snapshot.chainId = "2"; }],
    ["INPUT_INVALID", (input) => { input.voters.push(copy(input.voters[0])); }],
    ["INPUT_INVALID", (input) => { input.voters.push({ ...input.voters[0], wallet: "0x" + input.voters[0].wallet.slice(2).toUpperCase() }); }],
    ["INPUT_INVALID", (input) => { input.policy.contracts.push(copy(input.policy.contracts[0])); }],
    ["INPUT_INVALID", (input) => { input.voters[0].wallet = A("0"); }],
    ["INPUT_INVALID", (input) => { input.snapshot.blockHash = "0x12"; }],
    ["INPUT_INVALID", (input) => { input.snapshot.extra = true; }],
    ["POLICY_UNSUPPORTED", (input) => { input.policy.contracts[0].type = "COMMITMENT_VAULT"; }],
    ["POLICY_UNSUPPORTED", (input) => { input.policy.ownerAttribution = "beneficiary"; }],
    ["POLICY_UNSUPPORTED", (input) => { input.policy.condition = "TIME_ONLY"; }],
    ["POLICY_UNSUPPORTED", (input) => { input.policy.approval = "approved"; }],
    ["POLICY_UNSUPPORTED", (input) => { input.policy.finality.basis = "finalized"; }],
    ["POLICY_UNSUPPORTED", (input) => { input.policy.aggregation = "total-eligible-supply"; }],
    ["LIMIT_EXCEEDED", (input) => { input.policy.limits.maxCalls = "1"; }],
    ["LIMIT_EXCEEDED", (input) => { input.policy.limits.maxVoters = "129"; }],
    ["LIMIT_EXCEEDED", (input) => { input.policy.limits.totalTimeoutMs = "0"; }],
  ];
  for (const [category, edit] of invalidInputs) {
    const input = fixtures();
    edit(input);
    let touched = false;
    rejected(await api.collectLockEvidence(input, { request() { touched = true; throw new Error("must not read"); } }), category);
    assert.equal(touched, false);
  }
  for (const edit of [
    (input) => { Object.defineProperty(input, "snapshot", { get() { throw new Error("getter must not run"); }, enumerable: true }); },
    (input) => { input.voters = new Array(2); },
    (input) => { input.policy.self = input.policy; },
    (input) => { input.voters[0][Symbol("hidden")] = true; },
  ]) {
    const input = fixtures(); edit(input);
    let touched = false;
    rejected(await api.collectLockEvidence(input, { request() { touched = true; } }), "INPUT_INVALID");
    assert.equal(touched, false);
  }

  const faultCases = [
    ["CHAIN_MISMATCH", (args) => args.method === "eth_chainId" ? "0x2" : DEFAULT],
    ["SNAPSHOT_MISMATCH", (args) => args.method === "eth_getBlockByNumber" ? { number: "0x1", hash: H("ab") } : DEFAULT],
    ["SNAPSHOT_MISMATCH", (args) => args.method === "eth_getBlockByNumber" ? { number: args.params[0], hash: H("ff") } : DEFAULT],
    ["SNAPSHOT_MISMATCH", (args, trace) => args.method === "eth_getBlockByNumber" && trace.filter((item) => item.method === "eth_getBlockByNumber").length === 2 ? { number: args.params[0], hash: H("ff") } : DEFAULT],
    ["CHAIN_MISMATCH", (args, trace) => args.method === "eth_chainId" && trace.filter((item) => item.method === "eth_chainId").length === 2 ? "0x2" : DEFAULT],
    ["IDENTITY_MISMATCH", (args) => args.method === "eth_getCode" ? "0x" : DEFAULT],
    ["IDENTITY_MISMATCH", (args) => args.method === "eth_getCode" ? "0x6004" : DEFAULT],
    ["IDENTITY_MISMATCH", (args) => args.method === "eth_call" && args.params[0].data === tokenAbi.encodeFunctionData("decimals", []) ? tokenAbi.encodeFunctionResult("decimals", [18n]) : DEFAULT],
    ["IDENTITY_MISMATCH", (args) => args.method === "eth_call" && args.params[0].data === lockAbi.encodeFunctionData("token", []) ? lockAbi.encodeFunctionResult("token", [A("f")]) : DEFAULT],
    ["RPC_RESPONSE_INVALID", (args) => args.method === "eth_getCode" ? "0x1" : DEFAULT],
    ["CONTRACT_RESPONSE_INVALID", (args) => args.method === "eth_call" ? "0x" : DEFAULT],
    ["CONTRACT_RESPONSE_INVALID", (args) => args.method === "eth_call" && args.params[0].to === A("a") ? tokenAbi.encodeFunctionResult("decimals", [9n]) + "00" : DEFAULT],
    ["RPC_FAILURE", (args) => { if (args.method === "eth_call") throw new Error("dummy-revert-no-raw-error-echo"); return DEFAULT; }],
    ["RPC_FAILURE", (args) => { if (args.method === "eth_getCode") throw { code: -32602, message: "EIP1898 unsupported" }; return DEFAULT; }],
  ];
  for (const [category, hook] of faultCases) {
    const input = fixtures();
    const capability = dummy(input, hook);
    rejected(await api.collectLockEvidence(input, capability.provider), category);
    assert.ok(capability.trace.length <= 12);
  }

  for (const [name, value, category] of [
    ["maxRequestBytes", "1", "LIMIT_EXCEEDED"], ["maxTotalRequestBytes", "1", "LIMIT_EXCEEDED"],
    ["maxResponseBytes", "1", "RPC_RESPONSE_INVALID"], ["maxTotalResponseBytes", "4", "LIMIT_EXCEEDED"],
    ["maxEvidenceBytes", "100", "LIMIT_EXCEEDED"],
  ]) {
    const input = fixtures(); input.policy.limits[name] = value;
    rejected(await api.collectLockEvidence(input, dummy(input).provider), category);
  }
  const oversized = fixtures();
  rejected(await api.collectLockEvidence(oversized, dummy(oversized, (args) => args.method === "eth_getCode" ? "0x" + "00".repeat(65536) : DEFAULT).provider), "RPC_RESPONSE_INVALID");
  const timeout = fixtures(); timeout.policy.limits.requestTimeoutMs = "1";
  const stalled = dummy(timeout, () => new Promise(() => {}));
  rejected(await api.collectLockEvidence(timeout, stalled.provider), "RPC_TIMEOUT");
  assert.equal(stalled.trace.length, 1);
  const totalTimeout = fixtures(); totalTimeout.policy.limits.totalTimeoutMs = "1";
  rejected(await api.collectLockEvidence(totalTimeout, dummy(totalTimeout, () => new Promise((resolve) => setTimeout(() => resolve(DEFAULT), 20))).provider), "RPC_TIMEOUT");

  for (const [category, edit] of [
    ["INPUT_INVALID", (input) => { input.requests.push(copy(input.requests[0])); }],
    ["INPUT_INVALID", (input) => { input.requests[0].wallet = A("c"); }],
    ["INPUT_INVALID", (input) => { input.requests[0].signature = "0x1"; }],
    ["INPUT_INVALID", (input) => { input.requests[0].signature = "0x"; }],
    ["INPUT_INVALID", (input) => { delete input.requests[0].contextHash; }],
    ["LIMIT_EXCEEDED", (input) => { input.policy.limits.maxSignatureBytes = "1"; }],
  ]) {
    const input = fixtures(true); edit(input);
    let touched = false;
    rejected(await api.collect1271Evidence(input, { request() { touched = true; } }), category);
    assert.equal(touched, false);
  }
  for (const [category, returnValue] of [
    ["SIGNATURE_INVALID", walletAbi.encodeFunctionResult("isValidSignature", ["0xffffffff"])],
    ["CONTRACT_RESPONSE_INVALID", "0x1626ba7e"],
    ["CONTRACT_RESPONSE_INVALID", "0x"],
    ["CONTRACT_RESPONSE_INVALID", walletAbi.encodeFunctionResult("isValidSignature", ["0x1626ba7e"]) + "00"],
  ]) {
    const input = fixtures(true);
    rejected(await api.collect1271Evidence(input, dummy(input, (args) => args.method === "eth_call" && args.params[0].to === A("d") ? returnValue : DEFAULT).provider), category);
  }
  const contractRevert = fixtures(true);
  rejected(await api.collect1271Evidence(contractRevert, dummy(contractRevert, (args) => {
    if (args.method === "eth_call" && args.params[0].to === A("d")) throw new Error("dummy-wallet-revert");
    return DEFAULT;
  }).provider), "RPC_FAILURE");
  const changedSignature = fixtures(true); changedSignature.requests[0].signature = "0x1234ac";
  const changed = await api.collect1271Evidence(changedSignature, dummy(changedSignature).provider);
  assert.notEqual(changed.observations[0].signatureHash, signatureResult.observations[0].signatureHash);
  assert.notEqual(changed.evidenceHash, signatureResult.evidenceHash);
  for (const field of ["digest", "contextHash"]) {
    const input = fixtures(true); input.requests[0][field] = H("78");
    const result = await api.collect1271Evidence(input, dummy(input).provider);
    assert.equal(result.status, "observed");
    assert.equal(result.observations[0][field], H("78"));
    assert.notEqual(result.inputHash, signatureResult.inputHash);
    assert.notEqual(result.evidenceHash, signatureResult.evidenceHash);
    assert.equal(result.policyHash, signatureResult.policyHash);
  }
  const wrongKind = fixtures(true); wrongKind.voters[1].codeHash = ethers.keccak256("0x");
  rejected(await api.collect1271Evidence(wrongKind, dummy(wrongKind, (args) => args.method === "eth_getCode" && args.params[0] === A("d") ? "0x" : DEFAULT).provider), "IDENTITY_MISMATCH");
  const providerGetter = {};
  Object.defineProperty(providerGetter, "request", { get() { throw new Error("provider getter must not run"); } });
  rejected(await api.collectLockEvidence(fixtures(), providerGetter), "PROVIDER_INVALID");
}

module.exports = Object.freeze({ runDummyTests });
