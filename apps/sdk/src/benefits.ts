export const DEFAULT_BENEFITS_API = "https://shop.ifrunit.tech";
const SELLER_AUTH_TTL_MS = 10 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;

export interface SellerAuthorizationChallenge {
  action: "sessions:create";
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

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`IFR Benefits API request failed (${response.status})`);
  return response.json() as Promise<T>;
}

function buildSellerAuthorizationMessage(
  businessId: string,
  timestamp: string,
  scope: string,
  nonce: string
) {
  return [
    "IFR Benefits Network - Seller Authorization",
    "Action: sessions:create",
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

  async createCheckout(params: CreateBenefitsCheckoutParams): Promise<BenefitsCheckoutSession> {
    const businessId = safeAuthorizationField(params.businessId, "business ID");
    const scope = safeAuthorizationField(params.benefitRuleId || "default", "benefit rule ID");
    if (!isAddress(params.walletAddress)) throw new Error("Invalid seller wallet address");
    if (typeof params.signMessage !== "function") throw new Error("Seller wallet signer is required");

    const challengeUrl = new URL("/api/seller/auth-message", this.baseUrl);
    challengeUrl.search = new URLSearchParams({
      action: "sessions:create",
      businessId,
      walletAddress: params.walletAddress,
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
      challenge.action !== "sessions:create" ||
      challenge.businessId !== businessId ||
      challenge.scope !== scope ||
      !/^0x[0-9a-fA-F]{40}$/.test(challenge.walletAddress || "") ||
      challenge.walletAddress.toLowerCase() !== params.walletAddress.toLowerCase() ||
      !/^\d{10,16}$/.test(challenge.timestamp || "") ||
      !Number.isSafeInteger(timestampMs) ||
      issuedAtMs !== timestampMs ||
      expiresAtMs !== timestampMs + SELLER_AUTH_TTL_MS ||
      timestampMs < now - SELLER_AUTH_TTL_MS ||
      timestampMs > now + MAX_FUTURE_SKEW_MS ||
      expiresAtMs <= now ||
      !/^[0-9a-f]{64}$/.test(challenge.nonce || "") ||
      challenge.message !== buildSellerAuthorizationMessage(
        businessId,
        challenge.timestamp,
        scope,
        challenge.nonce
      )
    ) {
      throw new Error("IFR Benefits API returned a mismatched seller authorization challenge");
    }

    const signature = await params.signMessage(challenge.message);
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      throw new Error("Seller wallet returned an invalid signature");
    }

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
}
