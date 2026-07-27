export const DEFAULT_BENEFITS_API = "https://shop.ifrunit.tech";
const SELLER_AUTH_TTL_MS = 10 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;

export type SellerAuthorizationAction = "sessions:create" | "sessions:redeem";

export interface SellerAuthorizationChallenge {
  action: SellerAuthorizationAction;
  businessId: string;
  walletAddress: string;
  scope: string;
  timestamp: string;
  issuedAt: string;
  expiresAt: string;
  message: string;
  nonce: string;
}

export interface BenefitsCheckoutSession {
  sessionId: string;
  expiresAt: string;
  qrUrl: string;
  customerUrl: string;
  benefitRuleId: string | null;
  label: string | null;
  category: string | null;
  productName: string | null;
  discountPercent: number;
  requiredLockIFR: number;
  dailyRedemptionLimit: number;
  monthlyRedemptionLimit: number;
  tierLabel: string | null;
}

export interface CreateBenefitsCheckoutParams {
  businessId: string;
  benefitRuleId?: string;
  walletAddress: string;
  signMessage: (message: string) => Promise<string>;
}

export interface RedeemBenefitsCheckoutParams {
  sessionId: string;
  walletAddress: string;
  signMessage: (message: string) => Promise<string>;
}

export type BenefitsCheckoutStatusValue =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "REDEEMED"
  | "EXPIRED";

const BENEFITS_CHECKOUT_STATUSES: readonly BenefitsCheckoutStatusValue[] = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "REDEEMED",
  "EXPIRED",
];

export interface BenefitsCheckoutStatus {
  status: BenefitsCheckoutStatusValue;
  reason: string | null;
  redeemedAt: string | null;
  expiresAt: string;
  attestAttempts: number;
  businessId: string;
  benefitRuleId: string | null;
  presentation: "CUSTOMER_PASS" | "SELLER_QR";
}

export interface BenefitsCheckoutRedemption {
  status: "REDEEMED";
}

export interface IFRBenefitsClientConfig {
  baseUrl?: string;
  fetch?: typeof fetch;
}

function safeAuthorizationField(value: string, label: string) {
  if (!value || value.length > 200 || value !== value.trim() || /[\r\n]/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function safeSessionPathSegment(value: string) {
  if (
    !value ||
    value.length > 200 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    /[/?#\\]/.test(value) ||
    value.includes("..")
  ) {
    throw new Error("Invalid checkout session ID");
  }
  return encodeURIComponent(value);
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Benefits API must use HTTPS except on loopback test hosts");
  }
  if (url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new Error("Benefits API must be an origin without credentials, path, query, or fragment");
  }
  url.pathname = "/";
  return url;
}

function isAddress(value: string) {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === value;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`IFR Benefits API request failed (${response.status})`);
  return response.json() as Promise<T>;
}

function buildSellerAuthorizationMessage(
  action: SellerAuthorizationAction,
  businessId: string,
  timestamp: string,
  scope: string,
  nonce: string
) {
  return [
    "IFR Benefits Network - Seller Authorization",
    `Action: ${action}`,
    `Business: ${businessId}`,
    `Timestamp: ${timestamp}`,
    `Scope: ${scope}`,
    `Nonce: ${nonce}`,
    "Only sign this message inside shop.ifrunit.tech.",
  ].join("\n");
}

export class IFRBenefitsClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;

  constructor(config: IFRBenefitsClientConfig = {}) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl || DEFAULT_BENEFITS_API);
    this.fetchImpl = config.fetch || fetch;
  }

  private async requestSellerChallenge(
    action: SellerAuthorizationAction,
    businessId: string,
    scope: string,
    walletAddress: string
  ): Promise<SellerAuthorizationChallenge> {
    const challengeUrl = new URL("/api/seller/auth-message", this.baseUrl);
    challengeUrl.search = new URLSearchParams({
      action,
      businessId,
      walletAddress,
      scope,
    }).toString();
    const challenge = await readJson<SellerAuthorizationChallenge>(
      await this.fetchImpl(challengeUrl.toString(), { method: "GET" })
    );
    const timestampMs = Number(challenge.timestamp);
    const issuedAtMs = Date.parse(challenge.issuedAt);
    const expiresAtMs = Date.parse(challenge.expiresAt);
    const now = Date.now();

    if (
      challenge.action !== action ||
      challenge.businessId !== businessId ||
      challenge.scope !== scope ||
      !/^0x[0-9a-fA-F]{40}$/.test(challenge.walletAddress || "") ||
      challenge.walletAddress.toLowerCase() !== walletAddress.toLowerCase() ||
      !/^\d{10,16}$/.test(challenge.timestamp || "") ||
      !Number.isSafeInteger(timestampMs) ||
      issuedAtMs !== timestampMs ||
      expiresAtMs !== timestampMs + SELLER_AUTH_TTL_MS ||
      timestampMs < now - SELLER_AUTH_TTL_MS ||
      timestampMs > now + MAX_FUTURE_SKEW_MS ||
      expiresAtMs <= now ||
      !/^[0-9a-f]{64}$/.test(challenge.nonce || "") ||
      challenge.message !== buildSellerAuthorizationMessage(
        action,
        businessId,
        challenge.timestamp,
        scope,
        challenge.nonce
      )
    ) {
      throw new Error("IFR Benefits API returned a mismatched seller authorization challenge");
    }
    return challenge;
  }

  private async signSellerChallenge(
    challenge: SellerAuthorizationChallenge,
    signMessage: (message: string) => Promise<string>
  ) {
    const signature = await signMessage(challenge.message);
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      throw new Error("Seller wallet returned an invalid signature");
    }
    return signature;
  }

  async createCheckout(params: CreateBenefitsCheckoutParams): Promise<BenefitsCheckoutSession> {
    const businessId = safeAuthorizationField(params.businessId, "business ID");
    const scope = safeAuthorizationField(params.benefitRuleId || "default", "benefit rule ID");
    if (!isAddress(params.walletAddress)) throw new Error("Invalid seller wallet address");
    if (typeof params.signMessage !== "function") throw new Error("Seller wallet signer is required");

    const challenge = await this.requestSellerChallenge(
      "sessions:create",
      businessId,
      scope,
      params.walletAddress
    );
    const signature = await this.signSellerChallenge(challenge, params.signMessage);

    const sessionUrl = new URL("/api/sessions", this.baseUrl);
    const session = await readJson<Omit<BenefitsCheckoutSession, "customerUrl">>(
      await this.fetchImpl(sessionUrl.toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ifr-wallet": params.walletAddress,
          "x-ifr-signature": signature,
          "x-ifr-timestamp": challenge.timestamp,
          "x-ifr-nonce": challenge.nonce,
        },
        body: JSON.stringify({
          businessId,
          ...(params.benefitRuleId ? { benefitRuleId: params.benefitRuleId } : {}),
        }),
      })
    );

    if (!session.sessionId || !session.qrUrl) {
      throw new Error("IFR Benefits API returned an invalid checkout session");
    }
    const customerUrl = new URL(session.qrUrl, this.baseUrl);
    if (
      customerUrl.origin !== this.baseUrl.origin ||
      !/^\/r\/[^/]+$/.test(customerUrl.pathname) ||
      customerUrl.search ||
      customerUrl.hash
    ) {
      throw new Error("IFR Benefits API returned an invalid customer URL");
    }
    return {
      ...session,
      customerUrl: customerUrl.toString(),
    };
  }

  async getCheckoutStatus(sessionId: string): Promise<BenefitsCheckoutStatus> {
    const segment = safeSessionPathSegment(sessionId);
    const statusUrl = new URL(`/api/sessions/${segment}`, this.baseUrl);
    const session = await readJson<BenefitsCheckoutStatus>(
      await this.fetchImpl(statusUrl.toString(), { method: "GET", cache: "no-store" })
    );
    if (!session || typeof session !== "object") {
      throw new Error("IFR Benefits API returned an invalid checkout status");
    }

    if (
      !BENEFITS_CHECKOUT_STATUSES.includes(session.status) ||
      !(session.reason === null || typeof session.reason === "string") ||
      !(session.redeemedAt === null || isCanonicalIsoDate(session.redeemedAt)) ||
      !isCanonicalIsoDate(session.expiresAt) ||
      !Number.isSafeInteger(session.attestAttempts) ||
      session.attestAttempts < 0 ||
      typeof session.businessId !== "string" ||
      !session.businessId ||
      !(session.benefitRuleId === null || typeof session.benefitRuleId === "string") ||
      (session.presentation !== "CUSTOMER_PASS" && session.presentation !== "SELLER_QR")
    ) {
      throw new Error("IFR Benefits API returned an invalid checkout status");
    }
    return {
      status: session.status,
      reason: session.reason,
      redeemedAt: session.redeemedAt,
      expiresAt: session.expiresAt,
      attestAttempts: session.attestAttempts,
      businessId: session.businessId,
      benefitRuleId: session.benefitRuleId,
      presentation: session.presentation,
    };
  }

  async redeemCheckout(params: RedeemBenefitsCheckoutParams): Promise<BenefitsCheckoutRedemption> {
    const segment = safeSessionPathSegment(params.sessionId);
    if (!isAddress(params.walletAddress)) throw new Error("Invalid seller wallet address");
    if (typeof params.signMessage !== "function") throw new Error("Seller wallet signer is required");

    const challenge = await this.requestSellerChallenge(
      "sessions:redeem",
      params.sessionId,
      params.sessionId,
      params.walletAddress
    );
    const signature = await this.signSellerChallenge(challenge, params.signMessage);

    const redeemUrl = new URL(`/api/sessions/${segment}/redeem`, this.baseUrl);
    const result = await readJson<BenefitsCheckoutRedemption>(
      await this.fetchImpl(redeemUrl.toString(), {
        method: "POST",
        headers: {
          "x-ifr-wallet": params.walletAddress,
          "x-ifr-signature": signature,
          "x-ifr-timestamp": challenge.timestamp,
          "x-ifr-nonce": challenge.nonce,
        },
      })
    );
    if (!result || result.status !== "REDEEMED") {
      throw new Error("IFR Benefits API returned an invalid checkout redemption");
    }
    return { status: "REDEEMED" };
  }
}
