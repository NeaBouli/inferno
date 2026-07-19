const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

async function fetchJSON<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    ...opts,
  });
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await res.json()
    : { error: (await res.text()).trim() };
  if (!res.ok) {
    const message = typeof data.error === 'string' && data.error
      ? data.error
      : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

export interface PublicBusinessProfile {
  id: string;
  name: string;
  description: string | null;
  website: string | null;
  categories: string[];
}

export interface BusinessInfo extends PublicBusinessProfile {
  discountPercent: number;
  requiredLockIFR: number;
  tierLabel: string | null;
}

export interface BenefitRule {
  id: string;
  businessId: string;
  productId: string | null;
  label: string;
  category: string;
  productName: string;
  discountPercent: number;
  requiredLockIFR: number;
  dailyRedemptionLimit: number;
  monthlyRedemptionLimit: number;
  ttlSeconds: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BenefitRuleInput {
  productId?: string | null;
  label: string;
  category: string;
  productName: string;
  discountPercent: number;
  requiredLockIFR: number;
  dailyRedemptionLimit: number;
  monthlyRedemptionLimit: number;
  ttlSeconds: number;
  active?: boolean;
}

export interface CatalogProduct {
  id: string;
  businessId: string;
  name: string;
  category: string;
  description: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { benefitRules: number };
}

export interface CatalogProductInput {
  name: string;
  category: string;
  description?: string | null;
  active?: boolean;
}

export interface PublicCatalogProduct extends CatalogProduct {
  benefitRules: Array<{
    id: string;
    label: string;
    discountPercent: number;
    requiredLockIFR: number;
    dailyRedemptionLimit: number;
    monthlyRedemptionLimit: number;
    ttlSeconds: number;
  }>;
}

export interface PublicOffer {
  id: string;
  label: string;
  category: string;
  productName: string;
  discountPercent: number;
  requiredLockIFR: number;
  dailyRedemptionLimit: number;
  monthlyRedemptionLimit: number;
  business: PublicBusinessProfile;
  product: { id: string; name: string; description: string | null } | null;
}

export interface PublicOfferDiscovery {
  offers: PublicOffer[];
  categories: string[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
  };
}

export interface AdminBusinessInput {
  name: string;
  description?: string | null;
  website?: string | null;
  categories?: string[];
  discountPercent: number;
  requiredLockIFR: number;
  ttlSeconds?: number;
  tierLabel?: string;
}

export interface AdminBusinessCreated {
  id: string;
  name?: string;
  description?: string | null;
  website?: string | null;
  categories?: string[];
  ownerAddress?: string | null;
  verifyUrl: string;
  qrUrl: string;
}

export interface SellerBusinessSummary extends AdminBusinessCreated {
  name: string;
  description: string | null;
  website: string | null;
  categories: string[];
  discountPercent: number;
  requiredLockIFR: number;
  tierLabel: string | null;
  createdAt: string;
  rulesCount: number;
  productsCount: number;
}

export interface SellerSessionSummary {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'REDEEMED';
  recoveredAddress: string | null;
  /** Legacy API field name; value is a human-readable IFR amount from ethers.formatUnits(..., 9). */
  lockAmountRaw: string | null;
  reason: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  redeemedAt: string | null;
  attestAttempts: number;
  benefitRuleId: string | null;
  label: string | null;
  category: string | null;
  productName: string | null;
  discountPercent: number;
  requiredLockIFR: number;
  dailyRedemptionLimit: number;
  monthlyRedemptionLimit: number;
}

export interface SellerActivityMetrics {
  generatedAt: string;
  todayStartedAt: string;
  today: { checks: number; approved: number; redeemed: number; rejected: number };
  allTime: { checks: number; approved: number; redeemed: number; rejected: number };
  openChecks: number;
  approvalRatePercent: number | null;
}

export interface SellerSessionPagination {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  snapshot: string;
}

export interface SellerSessionPage {
  sessions: SellerSessionSummary[];
  metrics: SellerActivityMetrics;
  pagination: SellerSessionPagination;
}

export interface CheckoutOperator {
  id: string;
  businessId: string;
  walletAddress: string;
  label: string | null;
  active: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutAccess {
  authorized: true;
  walletAddress: string;
  role: 'OWNER' | 'OPERATOR';
  operatorId: string | null;
  label: string | null;
  expiresAt: string | null;
}

export interface SellerRewardLink {
  id: string;
  businessId: string;
  status: 'APPLIED' | 'VERIFIED' | 'STALE' | 'REVOKED';
  partnerId: string | null;
  builderWallet: string | null;
  requestedAt: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  verificationBlock: string | null;
  reason: string | null;
}

export interface RewardOnChainStatus {
  checkedAt: string;
  blockNumber: number;
  chainId: number;
  contractCodeVerified: boolean;
  governanceAligned: boolean;
  partnerId: string;
  builderRegistered: boolean;
  builderActive: boolean;
  builderName: string;
  partnerExists: boolean;
  partnerActive: boolean;
  beneficiary: string | null;
  beneficiaryMatchesOwner: boolean;
  maxAllocationRaw: string;
  rewardAccruedRaw: string;
  claimedTotalRaw: string;
  vestedRaw: string;
  claimableRaw: string;
  rewardCallerConfigured: boolean;
  rewardCallerAuthorized: boolean;
  verified: boolean;
  submissionReady: boolean;
  reason: string | null;
}

export interface RewardEventSummary {
  id: string;
  sessionId: string;
  partnerId: string;
  customerWallet: string;
  lockAmountRaw: string;
  status: 'PENDING' | 'READY' | 'BLOCKED_CALLER' | 'BLOCKED_GOVERNANCE' | 'SUBMITTED' | 'CONFIRMED' | 'SKIPPED' | 'FAILED';
  reason: string | null;
  txHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SellerRewardStatus {
  link: SellerRewardLink | null;
  onChain: RewardOnChainStatus | null;
  onChainError: string | null;
  events: RewardEventSummary[];
}

export interface SellerAuth {
  walletAddress: string;
  signature: string;
  timestamp: string;
  nonce?: string;
}

export interface SellerAuthMessage {
  action: string;
  businessId: string;
  timestamp: string;
  issuedAt: string;
  expiresAt: string;
  message: string;
  nonce?: string;
  scope?: string;
}

export interface SessionCreated {
  sessionId: string;
  expiresAt: string;
  qrUrl: string;
  benefitRuleId: string | null;
  label: string | null;
  category: string | null;
  productName: string | null;
  discountPercent: number;
  requiredLockIFR: number;
  dailyRedemptionLimit: number;
  monthlyRedemptionLimit: number;
  tierLabel: string | null;
  createdBy?: CheckoutAccess;
}

export interface SessionBenefit {
  benefitRuleId: string | null;
  label: string | null;
  category: string | null;
  productName: string | null;
  discountPercent: number;
  requiredLockIFR: number;
  dailyRedemptionLimit: number;
  monthlyRedemptionLimit: number;
  ttlSeconds: number;
  tierLabel: string | null;
}

export interface SessionStatus {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'REDEEMED';
  recoveredAddress: string | null;
  reason: string | null;
  redeemedAt: string | null;
  expiresAt: string;
  attestAttempts: number;
  businessId: string;
  benefitRuleId: string | null;
  benefit: SessionBenefit;
}

export interface ChallengeResponse {
  message: string;
}

export interface AttestResult {
  status: 'APPROVED' | 'REJECTED';
  wallet?: string;
  eligible?: boolean;
  reason?: string;
  benefit?: SessionBenefit;
  attemptsRemaining?: number;
}

export interface CustomerHistoryChallenge {
  message: string;
  nonce: string;
  expiresAt: string;
}

export interface CustomerHistoryAuthorization {
  accessToken: string;
  expiresAt: string;
}

export interface CustomerHistoryItem {
  id: string;
  status: SessionStatus['status'];
  reason: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  redeemedAt: string | null;
  seller: { id: string; name: string };
  benefit: Omit<SessionBenefit, 'ttlSeconds' | 'tierLabel'>;
}

export interface CustomerHistoryPage {
  sessions: CustomerHistoryItem[];
  pagination: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
    snapshot: string;
  };
}

export function getBusiness(id: string) {
  return fetchJSON<BusinessInfo>(`/api/businesses/${id}`);
}

export function discoverOffers(filters: { query?: string; category?: string; page?: number; limit?: number } = {}) {
  const query = new URLSearchParams();
  if (filters.query) query.set('query', filters.query);
  if (filters.category) query.set('category', filters.category);
  if (filters.page) query.set('page', String(filters.page));
  if (filters.limit) query.set('limit', String(filters.limit));
  const suffix = query.toString();
  return fetchJSON<PublicOfferDiscovery>(`/api/businesses${suffix ? `?${suffix}` : ''}`);
}

export function getBusinessRules(id: string) {
  return fetchJSON<{ rules: BenefitRule[] }>(`/api/businesses/${id}/rules`);
}

export function getBusinessProducts(id: string, signal?: AbortSignal) {
  return fetchJSON<{ business: PublicBusinessProfile; products: PublicCatalogProduct[] }>(
    `/api/businesses/${id}/products`,
    { signal }
  );
}

function adminHeaders(adminSecret: string) {
  return { Authorization: `Bearer ${adminSecret}` };
}

export function buildSellerAuthMessage(
  action: string,
  businessId: string,
  timestamp: string,
  binding?: { nonce: string; scope: string }
) {
  const lines = [
    'IFR Benefits Network - Seller Authorization',
    `Action: ${action}`,
    `Business: ${businessId || 'new'}`,
    `Timestamp: ${timestamp}`,
  ];
  if (binding) lines.push(`Scope: ${binding.scope}`, `Nonce: ${binding.nonce}`);
  lines.push('Only sign this message inside shop.ifrunit.tech.');
  return lines.join('\n');
}

export function getSellerAuthMessage(
  action: string,
  businessId: string,
  binding?: { walletAddress: string; scope: string }
) {
  const query = new URLSearchParams({ action, businessId: businessId || 'new' });
  if (binding) {
    query.set('walletAddress', binding.walletAddress);
    query.set('scope', binding.scope);
  }
  return fetchJSON<SellerAuthMessage>(`/api/seller/auth-message?${query.toString()}`);
}

function sellerHeaders(auth: SellerAuth) {
  const headers: Record<string, string> = {
    'x-ifr-wallet': auth.walletAddress,
    'x-ifr-signature': auth.signature,
    'x-ifr-timestamp': auth.timestamp,
  };
  if (auth.nonce) headers['x-ifr-nonce'] = auth.nonce;
  return headers;
}

export function createAdminBusiness(adminSecret: string, input: AdminBusinessInput) {
  return fetchJSON<AdminBusinessCreated>('/api/admin/businesses', {
    method: 'POST',
    headers: adminHeaders(adminSecret),
    body: JSON.stringify(input),
  });
}

export function getAdminBusinessProfile(businessId: string, adminSecret: string) {
  return fetchJSON<SellerBusinessSummary>(`/api/admin/businesses/${businessId}`, {
    headers: adminHeaders(adminSecret),
  });
}

export function updateAdminBusinessProfile(
  businessId: string,
  adminSecret: string,
  input: Pick<PublicBusinessProfile, 'name' | 'description' | 'website' | 'categories'>
) {
  return fetchJSON<PublicBusinessProfile>(`/api/admin/businesses/${businessId}`, {
    method: 'PATCH',
    headers: adminHeaders(adminSecret),
    body: JSON.stringify(input),
  });
}

export function getAdminBusinessRules(businessId: string, adminSecret: string) {
  return fetchJSON<{ rules: BenefitRule[] }>(`/api/admin/businesses/${businessId}/rules`, {
    headers: adminHeaders(adminSecret),
  });
}

export function createAdminBusinessRule(
  businessId: string,
  adminSecret: string,
  input: BenefitRuleInput
) {
  return fetchJSON<BenefitRule>(`/api/admin/businesses/${businessId}/rules`, {
    method: 'POST',
    headers: adminHeaders(adminSecret),
    body: JSON.stringify(input),
  });
}

export function updateAdminBusinessRule(
  ruleId: string,
  adminSecret: string,
  input: Partial<BenefitRuleInput>
) {
  return fetchJSON<BenefitRule>(`/api/admin/rules/${ruleId}`, {
    method: 'PATCH',
    headers: adminHeaders(adminSecret),
    body: JSON.stringify(input),
  });
}

export function deleteAdminBusinessRule(ruleId: string, adminSecret: string) {
  return fetchJSON<void>(`/api/admin/rules/${ruleId}`, {
    method: 'DELETE',
    headers: adminHeaders(adminSecret),
  });
}

export function createSellerBusiness(auth: SellerAuth, input: AdminBusinessInput) {
  return fetchJSON<AdminBusinessCreated>('/api/seller/businesses', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      ownerAddress: auth.walletAddress,
      signature: auth.signature,
      timestamp: auth.timestamp,
      nonce: auth.nonce,
    }),
  });
}

export function getSellerBusinesses(auth: SellerAuth) {
  return fetchJSON<{ businesses: SellerBusinessSummary[] }>('/api/seller/businesses', {
    headers: sellerHeaders(auth),
  });
}

export function updateSellerBusinessProfile(
  businessId: string,
  auth: SellerAuth,
  input: Pick<PublicBusinessProfile, 'name' | 'description' | 'website' | 'categories'>
) {
  return fetchJSON<PublicBusinessProfile>(`/api/seller/businesses/${businessId}`, {
    method: 'PATCH',
    headers: sellerHeaders(auth),
    body: JSON.stringify(input),
  });
}

export function getSellerBusinessRules(businessId: string, auth: SellerAuth) {
  return fetchJSON<{ rules: BenefitRule[] }>(`/api/seller/businesses/${businessId}/rules`, {
    headers: sellerHeaders(auth),
  });
}

export function getSellerBusinessProducts(businessId: string, auth: SellerAuth) {
  return fetchJSON<{ products: CatalogProduct[] }>(`/api/seller/businesses/${businessId}/products`, {
    headers: sellerHeaders(auth),
  });
}

export function createSellerBusinessProduct(
  businessId: string,
  auth: SellerAuth,
  input: CatalogProductInput
) {
  return fetchJSON<CatalogProduct>(`/api/seller/businesses/${businessId}/products`, {
    method: 'POST',
    headers: sellerHeaders(auth),
    body: JSON.stringify(input),
  });
}

export function updateSellerBusinessProduct(
  productId: string,
  auth: SellerAuth,
  input: Partial<CatalogProductInput>
) {
  return fetchJSON<CatalogProduct>(`/api/seller/products/${productId}`, {
    method: 'PATCH',
    headers: sellerHeaders(auth),
    body: JSON.stringify(input),
  });
}

export function deleteSellerBusinessProduct(productId: string, auth: SellerAuth) {
  return fetchJSON<void>(`/api/seller/products/${productId}`, {
    method: 'DELETE',
    headers: sellerHeaders(auth),
  });
}

export function getSellerBusinessSessions(
  businessId: string,
  auth: SellerAuth,
  limit = 10,
  cursor?: string | null,
  snapshot?: string | null
) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  if (snapshot) query.set('snapshot', snapshot);
  return fetchJSON<SellerSessionPage>(
    `/api/seller/businesses/${businessId}/sessions?${query.toString()}`,
    { headers: sellerHeaders(auth) }
  );
}

export function applyForSellerRewards(businessId: string, auth: SellerAuth) {
  return fetchJSON<{ link: SellerRewardLink }>(`/api/seller/businesses/${businessId}/rewards/apply`, {
    method: 'POST',
    headers: sellerHeaders(auth),
  });
}

export function getSellerRewardStatus(businessId: string, auth: SellerAuth) {
  return fetchJSON<SellerRewardStatus>(`/api/seller/businesses/${businessId}/rewards`, {
    headers: sellerHeaders(auth),
  });
}

export function getSellerCheckoutOperators(businessId: string, auth: SellerAuth) {
  return fetchJSON<{ operators: CheckoutOperator[] }>(`/api/seller/businesses/${businessId}/operators`, {
    headers: sellerHeaders(auth),
  });
}

export function createSellerCheckoutOperator(
  businessId: string,
  auth: SellerAuth,
  input: { walletAddress: string; label?: string; expiresAt?: string | null }
) {
  return fetchJSON<CheckoutOperator>(`/api/seller/businesses/${businessId}/operators`, {
    method: 'POST',
    headers: sellerHeaders(auth),
    body: JSON.stringify(input),
  });
}

export function deleteSellerCheckoutOperator(operatorId: string, auth: SellerAuth) {
  return fetchJSON<void>(`/api/seller/operators/${operatorId}`, {
    method: 'DELETE',
    headers: sellerHeaders(auth),
  });
}

export function getCheckoutOperatorStatus(businessId: string, auth: SellerAuth) {
  return fetchJSON<CheckoutAccess>(`/api/seller/businesses/${businessId}/operator-status`, {
    headers: sellerHeaders(auth),
  });
}

export function deleteSellerBusiness(businessId: string, auth: SellerAuth) {
  return fetchJSON<void>(`/api/seller/businesses/${businessId}`, {
    method: 'DELETE',
    headers: sellerHeaders(auth),
  });
}

export function createSellerBusinessRule(
  businessId: string,
  auth: SellerAuth,
  input: BenefitRuleInput
) {
  return fetchJSON<BenefitRule>(`/api/seller/businesses/${businessId}/rules`, {
    method: 'POST',
    headers: sellerHeaders(auth),
    body: JSON.stringify(input),
  });
}

export function updateSellerBusinessRule(
  ruleId: string,
  auth: SellerAuth,
  input: Partial<BenefitRuleInput>
) {
  return fetchJSON<BenefitRule>(`/api/seller/rules/${ruleId}`, {
    method: 'PATCH',
    headers: sellerHeaders(auth),
    body: JSON.stringify(input),
  });
}

export function deleteSellerBusinessRule(ruleId: string, auth: SellerAuth) {
  return fetchJSON<void>(`/api/seller/rules/${ruleId}`, {
    method: 'DELETE',
    headers: sellerHeaders(auth),
  });
}

export function createSession(businessId: string, benefitRuleId: string | undefined, auth: SellerAuth) {
  return fetchJSON<SessionCreated>('/api/sessions', {
    method: 'POST',
    headers: sellerHeaders(auth),
    body: JSON.stringify({ businessId, benefitRuleId }),
  });
}

export function getSessionStatus(id: string) {
  return fetchJSON<SessionStatus>(`/api/sessions/${id}`);
}

export function getChallenge(sessionId: string) {
  return fetchJSON<ChallengeResponse>(`/api/sessions/${sessionId}/challenge`);
}

export function submitAttest(sessionId: string, signature: string) {
  return fetchJSON<AttestResult>('/api/attest', {
    method: 'POST',
    body: JSON.stringify({ sessionId, signature }),
  });
}

export function getCustomerHistoryChallenge(walletAddress: string) {
  return fetchJSON<CustomerHistoryChallenge>('/api/customer/history/challenge', {
    method: 'POST',
    body: JSON.stringify({ walletAddress }),
  });
}

export function authorizeCustomerHistory(input: {
  walletAddress: string;
  nonce: string;
  signature: string;
}) {
  return fetchJSON<CustomerHistoryAuthorization>('/api/customer/history/authorize', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getCustomerHistory(
  accessToken: string,
  limit = 20,
  cursor?: string | null,
  snapshot?: string | null
) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  if (snapshot) query.set('snapshot', snapshot);
  return fetchJSON<CustomerHistoryPage>(`/api/customer/history?${query.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
}

export function redeemSession(sessionId: string, auth: SellerAuth) {
  return fetchJSON<{ status: string }>(`/api/sessions/${sessionId}/redeem`, {
    method: 'POST',
    headers: sellerHeaders(auth),
  });
}
