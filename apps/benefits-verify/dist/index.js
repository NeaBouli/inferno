"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIERS_V1 = exports.IfrBenefitVerifyError = exports.TIER_FILE_SHA256 = exports.TIER_FILE_V1 = exports.CONTRACTS = exports.MAX_RESULT_CACHE_MS = exports.MAX_MESSAGE_LIFETIME_MS = exports.MESSAGE_STATEMENT_MARKER = exports.PURPOSE_RESOURCE_PREFIX = exports.SPEC_RESOURCE = exports.IFR_DECIMALS = exports.SPEC_ID = void 0;
exports.parseTiers = parseTiers;
exports.tierForAmount = tierForAmount;
exports.sumActiveTimeOnly = sumActiveTimeOnly;
exports.verifyIfrBenefit = verifyIfrBenefit;
exports.buildBenefitMessage = buildBenefitMessage;
exports.parseBenefitMessage = parseBenefitMessage;
exports.verifyBenefitMessage = verifyBenefitMessage;
/**
 * Reference implementation of `ifr-benefits-verify/1`
 * (docs/specs/ifr-benefits-verify-1.md). MIT licence.
 *
 * Permissionless: reads the public IFR contracts at one pinned block. No API,
 * no hosted service, no registration.
 */
const ethers_1 = require("ethers");
exports.SPEC_ID = "ifr-benefits-verify/1";
exports.IFR_DECIMALS = 9;
exports.SPEC_RESOURCE = `urn:ifr-benefits:spec:${exports.SPEC_ID}`;
exports.PURPOSE_RESOURCE_PREFIX = "urn:ifr-benefits:purpose:";
exports.MESSAGE_STATEMENT_MARKER = "This signature does not move funds";
exports.MAX_MESSAGE_LIFETIME_MS = 5 * 60 * 1000;
exports.MAX_RESULT_CACHE_MS = 60 * 1000;
exports.CONTRACTS = Object.freeze({
    1: Object.freeze({
        token: "0x77e99917Eca8539c62F509ED1193ac36580A6e7B",
        ifrLock: "0x769928aBDfc949D0718d8766a1C2d7dBb63954Eb",
        commitmentVault: "0x0719d9eb28dF7f5e63F91fAc4Bbb2d579C4F73d3",
    }),
    11155111: Object.freeze({
        token: "0x3Bd71947F288d1dd8B21129B1bE4FF16EDd5d1F4",
        ifrLock: "0x0Cab0A9440643128540222acC6eF5028736675d3",
        commitmentVault: null,
    }),
});
/** Published tier file v1 (docs/specs/ifr-benefits-tiers.v1.json). */
exports.TIER_FILE_V1 = {
    schema: "ifr-benefits-tiers/1",
    spec: exports.SPEC_ID,
    version: 1,
    valid_from: "2026-10-01T00:00:00Z",
    decimals: 9,
    tiers: [
        { key: "BRONZE", label: "Bronze", minIFR: "1000", minBaseUnits: "1000000000000" },
        { key: "SILVER", label: "Silver", minIFR: "2500", minBaseUnits: "2500000000000" },
        { key: "GOLD", label: "Gold", minIFR: "5000", minBaseUnits: "5000000000000" },
        { key: "PLATINUM", label: "Platinum", minIFR: "10000", minBaseUnits: "10000000000000" },
    ],
};
/** SHA-256 of the published tier files, by version. */
exports.TIER_FILE_SHA256 = Object.freeze({
    1: "aaba67e43e8a2236d2c986a2aed308b8d58e0ebfddd484df3110e490b643d00b",
});
class IfrBenefitVerifyError extends Error {
    constructor(code, message) {
        super(`${code}: ${message}`);
        this.name = "IfrBenefitVerifyError";
        this.code = code;
    }
}
exports.IfrBenefitVerifyError = IfrBenefitVerifyError;
function fail(code, message) {
    throw new IfrBenefitVerifyError(code, message);
}
// ─── Tiers ──────────────────────────────────────────────────────────────
const DECIMAL_STRING = /^(0|[1-9][0-9]*)$/;
const TIER_KEY = /^[A-Z][A-Z0-9_]{0,31}$/;
/** Validates a tier file (spec §3, §7) and returns it in evaluation form. */
function parseTiers(file) {
    if (!file || typeof file !== "object")
        fail("INVALID_TIERS", "tier file must be an object");
    if (file.schema !== "ifr-benefits-tiers/1")
        fail("INVALID_TIERS", "unknown schema");
    if (file.spec !== exports.SPEC_ID)
        fail("INVALID_TIERS", "tier file belongs to another spec");
    if (!Number.isInteger(file.version) || file.version < 1)
        fail("INVALID_TIERS", "version must be a positive integer");
    if (typeof file.valid_from !== "string" || Number.isNaN(Date.parse(file.valid_from)) || !file.valid_from.endsWith("Z")) {
        fail("INVALID_TIERS", "valid_from must be an ISO 8601 UTC timestamp");
    }
    if (file.decimals !== exports.IFR_DECIMALS)
        fail("INVALID_TIERS", "decimals must be 9");
    if (!Array.isArray(file.tiers) || file.tiers.length === 0)
        fail("INVALID_TIERS", "tiers must be a non-empty list");
    const seen = new Set();
    let previous = 0n;
    const tiers = file.tiers.map((tier) => {
        if (!tier || typeof tier.key !== "string" || !TIER_KEY.test(tier.key))
            fail("INVALID_TIERS", "invalid tier key");
        if (seen.has(tier.key))
            fail("INVALID_TIERS", `duplicate tier key ${tier.key}`);
        seen.add(tier.key);
        if (typeof tier.label !== "string" || tier.label.trim() === "")
            fail("INVALID_TIERS", `tier ${tier.key} needs a label`);
        if (!DECIMAL_STRING.test(String(tier.minIFR)) || !DECIMAL_STRING.test(String(tier.minBaseUnits))) {
            fail("INVALID_TIERS", `tier ${tier.key} amounts must be decimal strings`);
        }
        const minBaseUnits = BigInt(tier.minBaseUnits);
        if (minBaseUnits <= 0n)
            fail("INVALID_TIERS", `tier ${tier.key} threshold must be greater than zero`);
        if (minBaseUnits !== BigInt(tier.minIFR) * 10n ** BigInt(exports.IFR_DECIMALS)) {
            fail("INVALID_TIERS", `tier ${tier.key} minBaseUnits must equal minIFR * 10^9`);
        }
        if (minBaseUnits <= previous)
            fail("INVALID_TIERS", "thresholds must strictly increase");
        previous = minBaseUnits;
        return Object.freeze({ key: tier.key, label: tier.label, minBaseUnits });
    });
    return Object.freeze({ version: file.version, validFrom: file.valid_from, tiers: Object.freeze(tiers) });
}
exports.TIERS_V1 = parseTiers(exports.TIER_FILE_V1);
/** Highest tier whose threshold is met by `amount` (base units), or null. */
function tierForAmount(amount, tiers = exports.TIERS_V1) {
    let result = null;
    for (const tier of tiers.tiers) {
        if (amount >= tier.minBaseUnits)
            result = tier.key;
    }
    return result;
}
function tierRank(tiers, key) {
    return key === null ? -1 : tiers.tiers.findIndex((tier) => tier.key === key);
}
function toProvider(rpc, fetchImpl) {
    if (typeof rpc === "object" && rpc !== null && typeof rpc.request === "function")
        return rpc;
    if (typeof rpc !== "string")
        fail("INVALID_INPUT", "rpc must be an HTTPS URL or an EIP-1193 provider");
    const url = new URL(rpc);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
        fail("INVALID_INPUT", "rpc URL must use HTTPS except on loopback hosts");
    }
    const doFetch = fetchImpl ?? globalThis.fetch;
    if (typeof doFetch !== "function")
        fail("INVALID_INPUT", "no fetch implementation available");
    let id = 0;
    return {
        async request({ method, params }) {
            const response = await doFetch(rpc, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }),
            });
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            const body = (await response.json());
            if (body.error) {
                const error = new Error(body.error.message || "JSON-RPC error");
                error.code = body.error.code;
                throw error;
            }
            return body.result;
        },
    };
}
async function rpcCall(provider, method, params) {
    try {
        return (await provider.request({ method, params }));
    }
    catch (error) {
        return fail("RPC_UNAVAILABLE", `${method} failed: ${error?.message ?? String(error)}`);
    }
}
const TOKEN_ABI = new ethers_1.Interface(["function decimals() view returns (uint8)"]);
const LOCK_ABI = new ethers_1.Interface([
    "function token() view returns (address)",
    "function isLocked(address user, uint256 minAmount) view returns (bool)",
]);
const VAULT_ABI = new ethers_1.Interface([
    "function ifrToken() view returns (address)",
    "function getTranches(address wallet) view returns (tuple(uint256 amount,uint8 cType,uint256 unlockTime,uint256 p0Multiplier,bool unlocked,uint256 conditionMetAt)[])",
]);
async function ethCall(provider, iface, to, fn, args, blockTag) {
    const data = iface.encodeFunctionData(fn, args);
    let raw;
    try {
        raw = (await provider.request({ method: "eth_call", params: [{ to, data }, blockTag] }));
    }
    catch (error) {
        // A revert means the address does not behave like the expected contract (spec §2), not an outage.
        const e = error;
        if (e?.code === 3 || /revert/i.test(String(e?.message ?? ""))) {
            fail("CONTRACT_MISMATCH", `${fn} reverted at ${to}`);
        }
        return fail("RPC_UNAVAILABLE", `eth_call failed: ${e?.message ?? String(error)}`);
    }
    if (typeof raw !== "string" || !raw.startsWith("0x") || raw === "0x") {
        fail("CONTRACT_MISMATCH", `${fn} returned no data at ${to}`);
    }
    try {
        return iface.decodeFunctionResult(fn, raw);
    }
    catch {
        return fail("CONTRACT_MISMATCH", `${fn} returned undecodable data at ${to}`);
    }
}
async function requireCode(provider, address, blockTag, label) {
    const code = await rpcCall(provider, "eth_getCode", [address, blockTag]);
    if (typeof code !== "string" || code === "0x" || code.length <= 2)
        fail("CONTRACT_MISMATCH", `${label} has no code`);
}
const LOCK_SOURCES = ["IFRLOCK", "COMMITMENT_TIME_ONLY", "EITHER"];
function isTierFile(value) {
    return value.schema !== undefined;
}
/** Sum of active TIME_ONLY tranches (spec §4). Price-conditioned tranches never count. */
function sumActiveTimeOnly(tranches) {
    let total = 0n;
    for (const tranche of tranches) {
        if (!tranche.unlocked && Number(tranche.cType) === 0 && tranche.amount > 0n)
            total += tranche.amount;
    }
    return total;
}
async function resolveBlock(provider, block) {
    let tag;
    let expectedHash = null;
    if (block === undefined || block === "latest")
        tag = "latest";
    else if (typeof block === "bigint" || typeof block === "number")
        tag = "0x" + BigInt(block).toString(16);
    else if (typeof block === "object" && block !== null) {
        tag = "0x" + BigInt(block.number).toString(16);
        expectedHash = String(block.hash).toLowerCase();
    }
    else
        return fail("INVALID_INPUT", "invalid block");
    const header = await rpcCall(provider, "eth_getBlockByNumber", [tag, false]);
    if (!header || typeof header.number !== "string" || typeof header.hash !== "string") {
        fail("BLOCK_MISMATCH", `block ${tag} is unknown to the node`);
    }
    const ref = { number: BigInt(header.number), hash: header.hash.toLowerCase() };
    if (expectedHash !== null && ref.hash !== expectedHash)
        fail("BLOCK_MISMATCH", "block hash differs from the requested hash");
    return ref;
}
/**
 * Evaluates the IFR benefit tier of `wallet` at one pinned block (spec §2–§5, §8).
 * Throws `IfrBenefitVerifyError` instead of returning a tier whenever a check fails.
 */
async function verifyIfrBenefit(params) {
    const source = params.source ?? "IFRLOCK";
    if (!LOCK_SOURCES.includes(source))
        fail("INVALID_INPUT", "unknown lock source");
    if (typeof params.wallet !== "string" || !(0, ethers_1.isAddress)(params.wallet))
        fail("INVALID_INPUT", "wallet must be an address");
    const wallet = (0, ethers_1.getAddress)(params.wallet);
    const chainId = Number(params.chainId);
    const listed = exports.CONTRACTS[chainId];
    if (!listed && !(params.allowTestChain === true && params.contracts)) {
        fail("WRONG_CHAIN", `unsupported chain id ${params.chainId}`);
    }
    const contracts = params.contracts ?? listed;
    const needsLock = source === "IFRLOCK" || source === "EITHER";
    const needsVault = source === "COMMITMENT_TIME_ONLY" || source === "EITHER";
    if (needsVault && !contracts.commitmentVault)
        fail("CONTRACT_MISMATCH", "no CommitmentVault on this chain");
    const tiers = params.tiers === undefined ? exports.TIERS_V1 : isTierFile(params.tiers) ? parseTiers(params.tiers) : params.tiers;
    if (!tiers.tiers.length || tiers.tiers.some((tier) => tier.minBaseUnits <= 0n)) {
        fail("INVALID_TIERS", "thresholds must be greater than zero");
    }
    const provider = toProvider(params.rpc, params.fetch);
    const reportedChain = await rpcCall(provider, "eth_chainId", []);
    if (typeof reportedChain !== "string" || BigInt(reportedChain) !== BigInt(chainId)) {
        fail("WRONG_CHAIN", `node reports chain ${reportedChain}, expected ${chainId}`);
    }
    const block = await resolveBlock(provider, params.block);
    const tag = "0x" + block.number.toString(16);
    // Contract identity at the pinned block (spec §2).
    await requireCode(provider, contracts.token, tag, "IFR token");
    const [decimals] = await ethCall(provider, TOKEN_ABI, contracts.token, "decimals", [], tag);
    if (Number(decimals) !== exports.IFR_DECIMALS)
        fail("CONTRACT_MISMATCH", "IFR token decimals must be 9");
    const token = (0, ethers_1.getAddress)(contracts.token);
    const result = {
        tier: null,
        block,
        source,
        tiersVersion: tiers.version,
        spec: exports.SPEC_ID,
        sources: {},
    };
    if (needsLock) {
        await requireCode(provider, contracts.ifrLock, tag, "IFRLock");
        const [lockToken] = await ethCall(provider, LOCK_ABI, contracts.ifrLock, "token", [], tag);
        if ((0, ethers_1.getAddress)(lockToken) !== token)
            fail("CONTRACT_MISMATCH", "IFRLock.token() is not the IFR token");
        // Highest threshold first; learns only the tier, never the amount (spec §4).
        let lockTier = null;
        for (const tier of [...tiers.tiers].reverse()) {
            const [locked] = await ethCall(provider, LOCK_ABI, contracts.ifrLock, "isLocked", [wallet, tier.minBaseUnits], tag);
            if (locked === true) {
                lockTier = tier.key;
                break;
            }
        }
        result.sources.IFRLOCK = lockTier;
    }
    if (needsVault) {
        const vault = contracts.commitmentVault;
        await requireCode(provider, vault, tag, "CommitmentVault");
        const [vaultToken] = await ethCall(provider, VAULT_ABI, vault, "ifrToken", [], tag);
        if ((0, ethers_1.getAddress)(vaultToken) !== token)
            fail("CONTRACT_MISMATCH", "CommitmentVault.ifrToken() is not the IFR token");
        const [tranches] = await ethCall(provider, VAULT_ABI, vault, "getTranches", [wallet], tag);
        const amount = sumActiveTimeOnly(Array.from(tranches, (t) => ({
            amount: t.amount,
            cType: t.cType,
            unlocked: t.unlocked,
        })));
        result.sources.COMMITMENT_TIME_ONLY = tierForAmount(amount, tiers);
    }
    // EITHER: the higher per-source tier; the sources are never added (spec §4).
    const candidates = [result.sources.IFRLOCK ?? null, result.sources.COMMITMENT_TIME_ONLY ?? null];
    result.tier = candidates.reduce((best, key) => (tierRank(tiers, key) > tierRank(tiers, best) ? key : best), null);
    return result;
}
const DEFAULT_STATEMENT = "Show my IFR benefit tier. This signature does not move funds and costs no gas.";
const PURPOSE = /^[A-Z0-9_]{1,32}$/;
const NONCE = /^[A-Za-z0-9]{24,}$/;
function assertSafeLine(value, label) {
    if (typeof value !== "string" || value === "" || /[\r\n]/.test(value))
        fail("INVALID_MESSAGE", `${label} must be a single line`);
}
/** Builds the EIP-4361 text an integrator asks the holder to sign. */
function buildBenefitMessage(fields) {
    assertSafeLine(fields.domain, "domain");
    assertSafeLine(fields.uri, "uri");
    if (!(0, ethers_1.isAddress)(fields.address))
        fail("INVALID_MESSAGE", "address must be an address");
    if (!PURPOSE.test(fields.purpose))
        fail("INVALID_MESSAGE", "purpose must match [A-Z0-9_]{1,32}");
    if (!NONCE.test(fields.nonce))
        fail("INVALID_MESSAGE", "nonce needs at least 24 alphanumeric characters");
    const statement = fields.statement ?? DEFAULT_STATEMENT;
    assertSafeLine(statement, "statement");
    if (!statement.includes(exports.MESSAGE_STATEMENT_MARKER))
        fail("INVALID_MESSAGE", "statement must say the signature does not move funds");
    const resources = [exports.SPEC_RESOURCE, `${exports.PURPOSE_RESOURCE_PREFIX}${fields.purpose}`, ...(fields.resources ?? [])];
    resources.forEach((resource) => assertSafeLine(resource, "resource"));
    const lines = [
        `${fields.domain} wants you to sign in with your Ethereum account:`,
        (0, ethers_1.getAddress)(fields.address),
        "",
        statement,
        "",
        `URI: ${fields.uri}`,
        "Version: 1",
        `Chain ID: ${fields.chainId}`,
        `Nonce: ${fields.nonce}`,
        `Issued At: ${fields.issuedAt}`,
        `Expiration Time: ${fields.expirationTime}`,
    ];
    if (fields.notBefore)
        lines.push(`Not Before: ${fields.notBefore}`);
    lines.push("Resources:", ...resources.map((resource) => `- ${resource}`));
    return lines.join("\n");
}
/** Parses the EIP-4361 profile; rejects anything outside it. */
function parseBenefitMessage(message) {
    if (typeof message !== "string" || message.includes("\r"))
        fail("INVALID_MESSAGE", "message must be LF-separated text");
    const lines = message.split("\n");
    const header = /^(\S+) wants you to sign in with your Ethereum account:$/.exec(lines[0] ?? "");
    if (!header)
        fail("INVALID_MESSAGE", "missing EIP-4361 header");
    const address = lines[1] ?? "";
    if (!(0, ethers_1.isAddress)(address))
        fail("INVALID_MESSAGE", "invalid address line");
    if (lines[2] !== "" || lines[4] !== "")
        fail("INVALID_MESSAGE", "statement must be surrounded by blank lines");
    const statement = lines[3] ?? "";
    const fields = {};
    let index = 5;
    const order = ["URI", "Version", "Chain ID", "Nonce", "Issued At", "Expiration Time"];
    for (const key of order) {
        const line = lines[index++] ?? "";
        if (!line.startsWith(`${key}: `))
            fail("INVALID_MESSAGE", `expected "${key}:"`);
        fields[key] = line.slice(key.length + 2);
    }
    let notBefore;
    if ((lines[index] ?? "").startsWith("Not Before: "))
        notBefore = lines[index++].slice("Not Before: ".length);
    if (lines[index++] !== "Resources:")
        fail("INVALID_MESSAGE", "expected Resources:");
    const resources = [];
    for (; index < lines.length; index++) {
        if (!lines[index].startsWith("- "))
            fail("INVALID_MESSAGE", "invalid resource line");
        resources.push(lines[index].slice(2));
    }
    if (!/^[0-9]+$/.test(fields["Chain ID"]))
        fail("INVALID_MESSAGE", "invalid chain id");
    return {
        domain: header[1],
        address: (0, ethers_1.getAddress)(address),
        statement,
        uri: fields.URI,
        version: fields.Version,
        chainId: Number(fields["Chain ID"]),
        nonce: fields.Nonce,
        issuedAt: fields["Issued At"],
        expirationTime: fields["Expiration Time"],
        notBefore,
        resources,
    };
}
/** Verifies the wallet ownership message (spec §6) and returns the signer address. */
function verifyBenefitMessage(params) {
    const parsed = parseBenefitMessage(params.message);
    const { expected } = params;
    const now = (expected.now ?? new Date()).getTime();
    if (parsed.domain !== expected.domain)
        fail("INVALID_MESSAGE", "domain mismatch");
    let uriHost;
    try {
        uriHost = new URL(parsed.uri).host;
    }
    catch {
        return fail("INVALID_MESSAGE", "invalid URI");
    }
    if (uriHost !== parsed.domain)
        fail("INVALID_MESSAGE", "URI host must equal the domain");
    if (!parsed.statement.includes(exports.MESSAGE_STATEMENT_MARKER))
        fail("INVALID_MESSAGE", "statement marker missing");
    if (parsed.version !== "1")
        fail("INVALID_MESSAGE", "version must be 1");
    if (parsed.chainId !== Number(expected.chainId))
        fail("INVALID_MESSAGE", "chain id mismatch");
    if (!NONCE.test(parsed.nonce) || parsed.nonce !== expected.nonce)
        fail("INVALID_MESSAGE", "nonce mismatch");
    const issuedAt = Date.parse(parsed.issuedAt);
    const expiresAt = Date.parse(parsed.expirationTime);
    if (Number.isNaN(issuedAt) || Number.isNaN(expiresAt))
        fail("INVALID_MESSAGE", "invalid timestamps");
    if (expiresAt <= issuedAt || expiresAt - issuedAt > exports.MAX_MESSAGE_LIFETIME_MS) {
        fail("INVALID_MESSAGE", "expiration must be within 5 minutes of issued at");
    }
    if (issuedAt > now + 60000)
        fail("INVALID_MESSAGE", "issued in the future");
    if (expiresAt <= now)
        fail("INVALID_MESSAGE", "message expired");
    if (parsed.notBefore !== undefined) {
        const notBefore = Date.parse(parsed.notBefore);
        if (Number.isNaN(notBefore) || notBefore > now)
            fail("INVALID_MESSAGE", "message not yet valid");
    }
    if (!parsed.resources.includes(exports.SPEC_RESOURCE))
        fail("INVALID_MESSAGE", "spec resource missing");
    const purposes = parsed.resources.filter((resource) => resource.startsWith(exports.PURPOSE_RESOURCE_PREFIX));
    if (purposes.length !== 1 || purposes[0] !== `${exports.PURPOSE_RESOURCE_PREFIX}${expected.purpose}`) {
        fail("INVALID_MESSAGE", "purpose mismatch");
    }
    let signer;
    try {
        signer = (0, ethers_1.getAddress)((0, ethers_1.verifyMessage)(params.message, params.signature));
    }
    catch {
        return fail("INVALID_MESSAGE", "invalid signature");
    }
    if (signer !== parsed.address)
        fail("INVALID_MESSAGE", "signer differs from the message address");
    return signer;
}
