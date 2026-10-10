"use strict";

const UINT256_MAX = (1n << 256n) - 1n;
const HARD_LIMITS = Object.freeze({
  maxCalls: 2048, maxVoters: 128, maxContracts: 32, maxSignatures: 256,
  maxRequestBytes: 32768, maxTotalRequestBytes: 4194304, maxResponseBytes: 131072,
  maxTotalResponseBytes: 4194304, maxEvidenceBytes: 8388608,
  maxSignatureBytes: 4096, requestTimeoutMs: 10000, totalTimeoutMs: 120000,
});

class Refusal extends Error {
  constructor(category) { super(category); this.category = category; }
}

function need(condition, category = "INPUT_INVALID") {
  if (!condition) throw new Refusal(category);
}

function markers() {
  return {
    authority: "ADVISORY", productionReady: false, chainEvidenceVerified: false,
    trust: "rpc-observations", policyApproval: "not-established",
    snapshotFinality: "not-established", eligibleSupply: "unknown", intakeOrdering: "unknown",
  };
}

function freeze(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

// Inert JSON-shaped data only; executable objects/Proxies are outside this API's trust model.
function copyData(value, maxChars, category) {
  const seen = new Set();
  let nodes = 0;
  let chars = 0;
  const copy = (item, depth) => {
    need(++nodes <= 30000 && depth <= 16, category);
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") {
      chars += item.length;
      need(chars <= maxChars && /^[\x20-\x7e]*$/.test(item), category);
      return item;
    }
    need(typeof item === "object" && !seen.has(item), category);
    seen.add(item);
    const array = Array.isArray(item);
    const proto = Object.getPrototypeOf(item);
    need(array ? proto === Array.prototype : proto === Object.prototype || proto === null, category);
    const keys = Reflect.ownKeys(item);
    need(keys.length <= 30000, category);
    if (array) {
      const length = Object.getOwnPropertyDescriptor(item, "length");
      need(length && "value" in length && length.value <= 30000, category);
      need(keys.length === length.value + 1, category);
      const result = [];
      for (let i = 0; i < length.value; i += 1) {
        const field = Object.getOwnPropertyDescriptor(item, String(i));
        need(field && field.enumerable && "value" in field, category);
        result.push(copy(field.value, depth + 1));
      }
      return Object.freeze(result);
    }
    const result = {};
    for (const key of keys) {
      need(typeof key === "string" && /^[\x20-\x7e]{1,64}$/.test(key), category);
      chars += key.length;
      need(chars <= maxChars, category);
      const field = Object.getOwnPropertyDescriptor(item, key);
      need(field && field.enumerable && "value" in field, category);
      Object.defineProperty(result, key, {
        value: copy(field.value, depth + 1), enumerable: true,
      });
    }
    return Object.freeze(result);
  };
  return copy(value, 0);
}

function record(value, fields) {
  need(value !== null && typeof value === "object" && !Array.isArray(value));
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  need(keys.length === expected.length && keys.every((key, i) => key === expected[i]));
}

function uint(value) {
  need(typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value));
  need(BigInt(value) <= UINT256_MAX);
  return value;
}

function hash(value) {
  need(typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value));
  return value;
}

function identifier(value) {
  need(typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value));
  return value;
}

function address(value, ethers) {
  need(typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value));
  let result;
  try { result = ethers.getAddress(value).toLowerCase(); } catch { throw new Refusal("INPUT_INVALID"); }
  need(result !== "0x" + "0".repeat(40));
  return result;
}

function choice(value, allowed) {
  need(allowed.includes(value), "POLICY_UNSUPPORTED");
  return value;
}

function list(value, minimum, maximum) {
  need(Array.isArray(value) && value.length >= minimum && value.length <= maximum);
  return value;
}

function unique(values) { need(new Set(values).size === values.length); }
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function engine() {
  try {
    const ethers = require("ethers");
    need(ethers.version === "6.17.0", "DEPENDENCY_UNAVAILABLE");
    return ethers;
  } catch { throw new Refusal("DEPENDENCY_UNAVAILABLE"); }
}

function normalizePolicy(value, ethers) {
  record(value, ["schema", "approval", "chainId", "token", "contracts", "condition", "ownerAttribution",
    "aggregation", "overlap", "finality", "callContext", "limits"]);
  record(value.token, ["address", "codeHash", "decimals"]);
  record(value.finality, ["basis", "reference"]);
  record(value.callContext, ["from", "gasLimit"]);
  record(value.limits, Object.keys(HARD_LIMITS));
  const limits = {};
  for (const [name, ceiling] of Object.entries(HARD_LIMITS)) {
    const amount = uint(value.limits[name]);
    need(BigInt(amount) > 0n && BigInt(amount) <= BigInt(ceiling), "LIMIT_EXCEEDED");
    limits[name] = amount;
  }
  const contracts = list(value.contracts, 1, Number(limits.maxContracts)).map((contract) => {
    record(contract, ["address", "type", "codeHash", "ownerSlot"]);
    return {
      address: address(contract.address, ethers), type: choice(contract.type, ["IFRLOCK"]),
      codeHash: hash(contract.codeHash), ownerSlot: choice(contract.ownerSlot, ["wallet-aggregate"]),
    };
  }).sort((a, b) => compare(a.address, b.address));
  unique(contracts.map((contract) => contract.address));
  const gasLimit = uint(value.callContext.gasLimit);
  need(BigInt(gasLimit) > 0n && BigInt(gasLimit) <= 10000000n, "LIMIT_EXCEEDED");
  const result = {
    schema: choice(value.schema, ["forum-eligibility-input-v1"]),
    approval: choice(value.approval, ["not-established"]), chainId: uint(value.chainId),
    token: { address: address(value.token.address, ethers), codeHash: hash(value.token.codeHash),
      decimals: choice(value.token.decimals, ["9"]) }, contracts,
    condition: choice(value.condition, ["recorded-balance-at-snapshot"]),
    ownerAttribution: choice(value.ownerAttribution, ["supplied-wallet"]),
    aggregation: choice(value.aggregation, ["no-cross-slot-total"]),
    overlap: choice(value.overlap, ["reject-duplicate-slots"]),
    finality: { basis: choice(value.finality.basis, ["caller-selected-unverified"]), reference: identifier(value.finality.reference) },
    callContext: { from: address(value.callContext.from, ethers), gasLimit }, limits,
  };
  need(BigInt(result.chainId) > 0n);
  need(!contracts.some((contract) => contract.address === result.token.address));
  return result;
}

function prepare(input, provider, kind) {
  const value = copyData(input, 4194304, "INPUT_INVALID");
  const fields = ["schema", "policy", "snapshot", "voters", "providerId"];
  record(value, kind === "eip1271-observations" ? [...fields, "requests"] : fields);
  const ethers = engine();
  const policy = normalizePolicy(value.policy, ethers);
  record(value.snapshot, ["chainId", "height", "blockHash"]);
  const snapshot = { chainId: uint(value.snapshot.chainId), height: uint(value.snapshot.height), blockHash: hash(value.snapshot.blockHash) };
  need(snapshot.chainId === policy.chainId);
  const voters = list(value.voters, 1, Number(policy.limits.maxVoters)).map((voter) => {
    record(voter, ["wallet", "kind", "codeHash"]);
    return { wallet: address(voter.wallet, ethers), kind: choice(voter.kind, ["EOA", "EIP1271"]), codeHash: hash(voter.codeHash) };
  }).sort((a, b) => compare(a.wallet, b.wallet));
  unique(voters.map((voter) => voter.wallet));
  for (const voter of voters) {
    if (voter.kind === "EOA") need(voter.codeHash === ethers.keccak256("0x"));
  }
  const normalized = {
    schema: choice(value.schema, ["forum-chain-evidence-input-v1"]), policy, snapshot,
    voters, providerId: identifier(value.providerId),
  };
  if (kind === "eip1271-observations") {
    normalized.requests = list(value.requests, 1, Number(policy.limits.maxSignatures)).map((request) => {
      record(request, ["wallet", "digest", "signature", "contextHash"]);
      const wallet = address(request.wallet, ethers);
      need(voters.some((voter) => voter.wallet === wallet && voter.kind === "EIP1271"));
      need(typeof request.signature === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(request.signature));
      need((request.signature.length - 2) / 2 <= Number(policy.limits.maxSignatureBytes), "LIMIT_EXCEEDED");
      return { wallet, digest: hash(request.digest), signature: request.signature.toLowerCase(), contextHash: hash(request.contextHash) };
    }).sort((a, b) => compare(a.wallet, b.wallet) || compare(a.digest, b.digest));
    unique(normalized.requests.map((request) => request.wallet + ":" + request.digest));
  }
  const expectedCalls = 6 + policy.contracts.length * 2 + voters.length
    + (kind === "lock-observations" ? policy.contracts.length * voters.length : normalized.requests.length);
  need(expectedCalls <= Number(policy.limits.maxCalls), "LIMIT_EXCEEDED");
  freeze(normalized);
  need(provider !== null && typeof provider === "object", "PROVIDER_INVALID");
  const descriptor = Object.getOwnPropertyDescriptor(provider, "request");
  need(descriptor && "value" in descriptor && typeof descriptor.value === "function", "PROVIDER_INVALID");
  const iface = {
    token: new ethers.Interface(["function decimals() view returns (uint8)"]),
    lock: new ethers.Interface(["function token() view returns (address)", "function lockedBalance(address) view returns (uint256)"]),
    wallet: new ethers.Interface(["function isValidSignature(bytes32,bytes) view returns (bytes4)"]),
  };
  return { input: normalized, ethers, iface, provider, request: descriptor.value, expectedCalls };
}

function hashJSON(ethers, value) { return ethers.keccak256(ethers.toUtf8Bytes(canonical(value))); }

function reader(prepared) {
  const { input, request, provider } = prepared;
  const limits = input.policy.limits;
  const deadline = performance.now() + Number(limits.totalTimeoutMs);
  let bytes = 0;
  let requestBytes = 0;
  const calls = [];
  const remaining = () => {
    const time = deadline - performance.now();
    need(time > 0, "RPC_TIMEOUT");
    return time;
  };
  const read = async (method, params) => {
    need(["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call"].includes(method), "INTERNAL_FAILURE");
    need(calls.length < Number(limits.maxCalls), "LIMIT_EXCEEDED");
    const args = freeze({ method, params });
    const requestSize = canonical(args).length;
    need(requestSize <= Number(limits.maxRequestBytes), "LIMIT_EXCEEDED");
    requestBytes += requestSize;
    need(requestBytes <= Number(limits.maxTotalRequestBytes), "LIMIT_EXCEEDED");
    const timeout = Math.min(Number(limits.requestTimeoutMs), remaining());
    const started = performance.now();
    let timer;
    let raw;
    try {
      raw = await Promise.race([
        Promise.resolve().then(() => {
          remaining();
          need(performance.now() - started < timeout, "RPC_TIMEOUT");
          return request.call(provider, args);
        }),
        new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Refusal("RPC_TIMEOUT")), timeout); }),
      ]);
    } catch (error) {
      if (error instanceof Refusal && error.category === "RPC_TIMEOUT") throw error;
      throw new Refusal("RPC_FAILURE");
    } finally { clearTimeout(timer); }
    need(performance.now() - started < timeout, "RPC_TIMEOUT");
    remaining();
    const response = copyData(raw, Number(limits.maxResponseBytes), "RPC_RESPONSE_INVALID");
    const size = canonical(response).length;
    need(size <= Number(limits.maxResponseBytes), "LIMIT_EXCEEDED");
    bytes += size;
    need(bytes <= Number(limits.maxTotalResponseBytes), "LIMIT_EXCEEDED");
    let result = response;
    if (method === "eth_getBlockByNumber") {
      need(response !== null && typeof response === "object" && !Array.isArray(response), "SNAPSHOT_MISMATCH");
      need(typeof response.number === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(response.number), "SNAPSHOT_MISMATCH");
      need(typeof response.hash === "string" && /^0x[0-9a-f]{64}$/.test(response.hash), "SNAPSHOT_MISMATCH");
      need(BigInt(response.number) === BigInt(input.snapshot.height) && response.hash === input.snapshot.blockHash, "SNAPSHOT_MISMATCH");
      result = freeze({ number: response.number, hash: response.hash });
    } else if (method === "eth_chainId") {
      need(typeof response === "string" && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(response), "CHAIN_MISMATCH");
      need(BigInt(response) === BigInt(input.snapshot.chainId), "CHAIN_MISMATCH");
    } else {
      need(typeof response === "string" && /^0x(?:[0-9a-fA-F]{2})*$/.test(response), "RPC_RESPONSE_INVALID");
    }
    calls.push(freeze({ method, params, result }));
    return result;
  };
  return { read, calls, remaining };
}

async function call(prepared, rpc, iface, to, fn, args) {
  const { from, gasLimit } = prepared.input.policy.callContext;
  const data = iface.encodeFunctionData(fn, args);
  const tx = { to, from, gas: "0x" + BigInt(gasLimit).toString(16), value: "0x0", data };
  const tag = { blockHash: prepared.input.snapshot.blockHash, requireCanonical: true };
  const raw = await rpc.read("eth_call", [tx, tag]);
  try {
    const decoded = iface.decodeFunctionResult(fn, raw);
    need(iface.encodeFunctionResult(fn, Array.from(decoded)).toLowerCase() === raw.toLowerCase(), "CONTRACT_RESPONSE_INVALID");
    return decoded;
  } catch { throw new Refusal("CONTRACT_RESPONSE_INVALID"); }
}

async function checkCode(prepared, rpc, to, expectedHash, kind) {
  const tag = { blockHash: prepared.input.snapshot.blockHash, requireCanonical: true };
  const code = await rpc.read("eth_getCode", [to, tag]);
  need(prepared.ethers.keccak256(code) === expectedHash, "IDENTITY_MISMATCH");
  need(kind === "EOA" ? code === "0x" : code !== "0x", "IDENTITY_MISMATCH");
}

async function checkSnapshot(prepared, rpc) {
  await rpc.read("eth_chainId", []);
  await rpc.read("eth_getBlockByNumber", ["0x" + BigInt(prepared.input.snapshot.height).toString(16), false]);
}

async function identities(prepared, rpc) {
  const { policy, voters } = prepared.input;
  await checkCode(prepared, rpc, policy.token.address, policy.token.codeHash, "contract");
  const [decimals] = await call(prepared, rpc, prepared.iface.token, policy.token.address, "decimals", []);
  need(decimals.toString() === policy.token.decimals, "IDENTITY_MISMATCH");
  for (const contract of policy.contracts) {
    await checkCode(prepared, rpc, contract.address, contract.codeHash, "contract");
    const [token] = await call(prepared, rpc, prepared.iface.lock, contract.address, "token", []);
    need(token.toLowerCase() === policy.token.address, "IDENTITY_MISMATCH");
  }
  for (const voter of voters) await checkCode(prepared, rpc, voter.wallet, voter.codeHash, voter.kind);
}

async function collect(input, provider, kind) {
  try {
    // All caller data, signatures, limits and the provider method are captured before the first await.
    const prepared = prepare(input, provider, kind);
    const rpc = reader(prepared);
    await checkSnapshot(prepared, rpc);
    await identities(prepared, rpc);
    const observations = [];
    if (kind === "lock-observations") {
      for (const contract of prepared.input.policy.contracts) {
        for (const voter of prepared.input.voters) {
          const [weight] = await call(prepared, rpc, prepared.iface.lock, contract.address, "lockedBalance", [voter.wallet]);
          const slot = {
            chainId: prepared.input.snapshot.chainId, blockHash: prepared.input.snapshot.blockHash,
            contract: contract.address, owner: voter.wallet, ownerSlot: contract.ownerSlot,
          };
          observations.push({ claimId: hashJSON(prepared.ethers, slot), ...slot,
            weight: weight.toString(), state: weight === 0n ? "zero" : "positive" });
        }
      }
      observations.sort((a, b) => compare(a.claimId, b.claimId));
      need(new Set(observations.map((item) => item.claimId)).size === observations.length, "INTERNAL_FAILURE");
    } else {
      for (const request of prepared.input.requests) {
        const [magicValue] = await call(prepared, rpc, prepared.iface.wallet, request.wallet, "isValidSignature", [request.digest, request.signature]);
        need(magicValue === "0x1626ba7e", "SIGNATURE_INVALID");
        observations.push({ wallet: request.wallet, digest: request.digest,
          signatureHash: prepared.ethers.keccak256(request.signature), contextHash: request.contextHash,
          magicValue, snapshot: prepared.input.snapshot });
      }
    }
    await checkSnapshot(prepared, rpc);
    need(rpc.calls.length === prepared.expectedCalls, "INTERNAL_FAILURE");
    const result = {
      schema: "forum-chain-evidence-v1", kind, status: "observed", ...markers(),
      inputHash: hashJSON(prepared.ethers, prepared.input),
      policyHash: hashJSON(prepared.ethers, prepared.input.policy), policy: prepared.input.policy,
      snapshot: prepared.input.snapshot, providerId: prepared.input.providerId,
      coverage: { scope: "supplied-voters-only", voters: prepared.input.voters,
        contracts: prepared.input.policy.contracts, signatureRequests: kind === "lock-observations" ? "0" : prepared.input.requests.length.toString() },
      observations, calls: rpc.calls,
    };
    const encoded = canonical(result);
    need(encoded.length <= Number(prepared.input.policy.limits.maxEvidenceBytes), "LIMIT_EXCEEDED");
    result.evidenceHash = prepared.ethers.keccak256(prepared.ethers.toUtf8Bytes(encoded));
    need(canonical(result).length <= Number(prepared.input.policy.limits.maxEvidenceBytes), "LIMIT_EXCEEDED");
    const frozen = freeze(result);
    rpc.remaining();
    return frozen;
  } catch (error) {
    return freeze({ schema: "forum-chain-evidence-v1", kind, status: "rejected", ...markers(),
      error: error instanceof Refusal ? error.category : "INTERNAL_FAILURE" });
  }
}

function collectLockEvidence(input, provider) { return collect(input, provider, "lock-observations"); }
function collect1271Evidence(input, provider) { return collect(input, provider, "eip1271-observations"); }

module.exports = Object.freeze({ collectLockEvidence, collect1271Evidence });
