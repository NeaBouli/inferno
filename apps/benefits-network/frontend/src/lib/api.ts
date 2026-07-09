const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

async function fetchJSON<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    ...opts,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

export interface BusinessInfo {
  id: string;
  name: string;
  discountPercent: number;
  requiredLockIFR: number;
  tierLabel: string | null;
}

export interface BenefitRule {
  id: string;
  businessId: string;
  label: string;
  category: string;
  productName: string;
  discountPercent: number;
  requiredLockIFR: number;
  ttlSeconds: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BenefitRuleInput {
  label: string;
  category: string;
  productName: string;
  discountPercent: number;
  requiredLockIFR: number;
  ttlSeconds: number;
  active?: boolean;
}

export interface SessionCreated {
  sessionId: string;
  expiresAt: string;
  qrUrl: string;
  discountPercent: number;
  requiredLockIFR: number;
  tierLabel: string | null;
}

export interface SessionStatus {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'REDEEMED';
  recoveredAddress: string | null;
  reason: string | null;
  redeemedAt: string | null;
  expiresAt: string;
}

export interface ChallengeResponse {
  message: string;
}

export interface AttestResult {
  status: 'APPROVED' | 'REJECTED';
  wallet?: string;
  eligible?: boolean;
  reason?: string;
}

export function getBusiness(id: string) {
  return fetchJSON<BusinessInfo>(`/api/businesses/${id}`);
}

export function getBusinessRules(id: string) {
  return fetchJSON<{ rules: BenefitRule[] }>(`/api/businesses/${id}/rules`);
}

function adminHeaders(adminSecret: string) {
  return { Authorization: `Bearer ${adminSecret}` };
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

export function createSession(businessId: string) {
  return fetchJSON<SessionCreated>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ businessId }),
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

export function redeemSession(sessionId: string) {
  return fetchJSON<{ status: string }>(`/api/sessions/${sessionId}/redeem`, {
    method: 'POST',
  });
}
