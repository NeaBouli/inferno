export declare const DEFAULT_BENEFITS_API = "https://shop.ifrunit.tech";
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
export type BenefitsCheckoutStatusValue = "PENDING" | "APPROVED" | "REJECTED" | "REDEEMED" | "EXPIRED";
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
export declare class IFRBenefitsClient {
    private readonly baseUrl;
    private readonly fetchImpl;
    constructor(config?: IFRBenefitsClientConfig);
    private requestSellerChallenge;
    private signSellerChallenge;
    createCheckout(params: CreateBenefitsCheckoutParams): Promise<BenefitsCheckoutSession>;
    getCheckoutStatus(sessionId: string): Promise<BenefitsCheckoutStatus>;
    redeemCheckout(params: RedeemBenefitsCheckoutParams): Promise<BenefitsCheckoutRedemption>;
}
