export declare const DEFAULT_BENEFITS_API = "https://shop.ifrunit.tech";
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
export declare class IFRBenefitsClient {
    private readonly baseUrl;
    private readonly fetchImpl;
    constructor(config?: IFRBenefitsClientConfig);
    createCheckout(params: CreateBenefitsCheckoutParams): Promise<BenefitsCheckoutSession>;
}
