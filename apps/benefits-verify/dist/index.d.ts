export declare const SPEC_ID = "ifr-benefits-verify/1";
export declare const SPEC_ID_V2 = "ifr-benefits-verify/2";
export type SpecId = typeof SPEC_ID | typeof SPEC_ID_V2;
export declare const SPEC_IDS: readonly SpecId[];
export declare const IFR_DECIMALS = 9;
export declare const SPEC_RESOURCE = "urn:ifr-benefits:spec:ifr-benefits-verify/1";
export declare const SPEC_RESOURCE_V2 = "urn:ifr-benefits:spec:ifr-benefits-verify/2";
export declare function specResource(spec: SpecId): string;
export declare const PURPOSE_RESOURCE_PREFIX = "urn:ifr-benefits:purpose:";
export declare const MESSAGE_STATEMENT_MARKER = "This signature does not move funds";
export declare const MAX_MESSAGE_LIFETIME_MS: number;
export declare const MAX_RESULT_CACHE_MS: number;
export type SupportedChainId = 1 | 11155111;
export type LockSource = "IFRLOCK" | "COMMITMENT_TIME_ONLY" | "EITHER";
export interface ChainContracts {
    token: string;
    ifrLock: string;
    /** The single CommitmentVault read by `/1`. */
    commitmentVault: string | null;
    /** Every CommitmentVault read by `/2`, in order. Defaults to `[commitmentVault]` when absent. */
    commitmentVaults?: readonly string[];
}
export declare const CONTRACTS: Readonly<Record<SupportedChainId, ChainContracts>>;
/** Vaults read by a given spec version for `contracts`. */
export declare function commitmentVaultsFor(contracts: ChainContracts, spec: SpecId): string[];
export interface TierDefinition {
    key: string;
    label: string;
    minIFR: string;
    minBaseUnits: string;
}
export interface TierFile {
    schema: "ifr-benefits-tiers/1";
    spec: string;
    version: number;
    valid_from: string;
    decimals: number;
    tiers: TierDefinition[];
}
export interface Tiers {
    version: number;
    validFrom: string;
    /** Ascending by threshold. */
    tiers: ReadonlyArray<{
        key: string;
        label: string;
        minBaseUnits: bigint;
    }>;
}
/** Published tier file v1 (docs/specs/ifr-benefits-tiers.v1.json). */
export declare const TIER_FILE_V1: TierFile;
/** SHA-256 of the published tier files, by version. */
export declare const TIER_FILE_SHA256: Readonly<Record<number, string>>;
export type VerifyErrorCode = "WRONG_CHAIN" | "CONTRACT_MISMATCH" | "RPC_UNAVAILABLE" | "BLOCK_MISMATCH" | "INVALID_TIERS" | "INVALID_MESSAGE" | "INVALID_INPUT";
export declare class IfrBenefitVerifyError extends Error {
    readonly code: VerifyErrorCode;
    constructor(code: VerifyErrorCode, message: string);
}
/**
 * Validates a tier file (spec §3, §7) and returns it in evaluation form.
 * `/2` reuses the `/1` tier files unchanged, so a `/2` verifier accepts tier files of either spec.
 */
export declare function parseTiers(file: TierFile, spec?: SpecId): Tiers;
export declare const TIERS_V1: Tiers;
/** Highest tier whose threshold is met by `amount` (base units), or null. */
export declare function tierForAmount(amount: bigint, tiers?: Tiers): string | null;
/** Minimal EIP-1193 provider. */
export interface Eip1193Provider {
    request(args: {
        method: string;
        params?: unknown[] | object;
    }): Promise<unknown>;
}
export type RpcInput = string | Eip1193Provider;
export interface BlockRef {
    number: bigint;
    hash: string;
}
export interface VerifyIfrBenefitParams {
    wallet: string;
    chainId: number;
    /** Block to read at: "latest" (default), a block number, or a number + hash pair. */
    block?: "latest" | bigint | number | {
        number: bigint | number;
        hash: string;
    };
    tiers?: Tiers | TierFile;
    source?: LockSource;
    rpc: RpcInput;
    /** Override contract addresses (tests only); defaults to CONTRACTS[chainId]. */
    contracts?: ChainContracts;
    /** Tests only: allow a chain id outside spec §2 together with `contracts`. */
    allowTestChain?: boolean;
    fetch?: typeof fetch;
    /** Specification version to evaluate; defaults to `ifr-benefits-verify/1`. */
    spec?: SpecId;
}
export interface VerifyIfrBenefitResult {
    /** Highest tier met, or null when no tier is met. */
    tier: string | null;
    block: BlockRef;
    source: LockSource;
    tiersVersion: number;
    spec: SpecId;
    /** CommitmentVault addresses read for COMMITMENT_TIME_ONLY (empty when the source was not read). */
    commitmentVaults: string[];
    /** Per-source tiers (only the sources that were read). */
    sources: {
        IFRLOCK?: string | null;
        COMMITMENT_TIME_ONLY?: string | null;
    };
}
/** Sum of active TIME_ONLY tranches (spec §4). Price-conditioned tranches never count. */
export declare function sumActiveTimeOnly(tranches: ReadonlyArray<{
    amount: bigint;
    cType: bigint | number;
    unlocked: boolean;
}>): bigint;
/**
 * Evaluates the IFR benefit tier of `wallet` at one pinned block (spec §2–§5, §8).
 * Throws `IfrBenefitVerifyError` instead of returning a tier whenever a check fails.
 */
export declare function verifyIfrBenefit(params: VerifyIfrBenefitParams): Promise<VerifyIfrBenefitResult>;
export interface BenefitMessageFields {
    domain: string;
    address: string;
    uri: string;
    chainId: number;
    nonce: string;
    issuedAt: string;
    expirationTime: string;
    purpose: string;
    notBefore?: string;
    statement?: string;
    /** Extra resources after the spec and purpose resources (for example a device binding). */
    resources?: string[];
    /** Specification the holder signs for; defaults to `ifr-benefits-verify/1`. */
    spec?: SpecId;
}
/** Builds the EIP-4361 text an integrator asks the holder to sign. */
export declare function buildBenefitMessage(fields: BenefitMessageFields): string;
export interface ParsedBenefitMessage {
    domain: string;
    address: string;
    statement: string;
    uri: string;
    version: string;
    chainId: number;
    nonce: string;
    issuedAt: string;
    expirationTime: string;
    notBefore?: string;
    resources: string[];
}
/** Parses the EIP-4361 profile; rejects anything outside it. */
export declare function parseBenefitMessage(message: string): ParsedBenefitMessage;
export interface VerifyBenefitMessageParams {
    message: string;
    signature: string;
    expected: {
        domain: string;
        chainId: number;
        purpose: string;
        /** Nonce the integrator issued; single use is the integrator's job (spec §6.4). */
        nonce: string;
        now?: Date;
        /**
         * Specification versions the integrator accepts; defaults to `["ifr-benefits-verify/1"]`.
         * During the transition an integrator MAY accept both and evaluate with the version the
         * message names (see `benefitMessageSpec`).
         */
        specs?: readonly SpecId[];
    };
}
/**
 * The specification version to evaluate a parsed message with: the highest version that the
 * message names and the integrator accepts. A message that names none of them is rejected.
 * (`/1` messages MAY carry other resources, so additional spec resources do not invalidate them.)
 */
export declare function benefitMessageSpec(parsed: ParsedBenefitMessage, accepted?: readonly SpecId[]): SpecId;
/** Verifies the wallet ownership message (spec §6) and returns the signer address. */
export declare function verifyBenefitMessage(params: VerifyBenefitMessageParams): string;
