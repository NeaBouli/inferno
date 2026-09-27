// Bare lowercase hostname (optionally with port) bound into every seller authorization.
export const SELLER_AUTH_DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/;

export function getSellerAuthConfigIssues(input: {
  nodeEnv?: string;
  rawChainId?: string;
  sellerAuthDomain?: string;
}): Array<{ path: 'CHAIN_ID' | 'SELLER_AUTH_DOMAIN'; message: string }> {
  const issues: Array<{ path: 'CHAIN_ID' | 'SELLER_AUTH_DOMAIN'; message: string }> = [];
  const domain = input.sellerAuthDomain;
  if (domain !== undefined && (domain.length > 253 || !SELLER_AUTH_DOMAIN_PATTERN.test(domain))) {
    issues.push({
      path: 'SELLER_AUTH_DOMAIN',
      message: 'SELLER_AUTH_DOMAIN must be a bare lowercase hostname without scheme or path',
    });
  }
  if (input.nodeEnv === 'production') {
    if (!domain) {
      issues.push({ path: 'SELLER_AUTH_DOMAIN', message: 'SELLER_AUTH_DOMAIN is required in production' });
    } else if (/^(localhost|127\.0\.0\.1)(:|$)/.test(domain)) {
      issues.push({ path: 'SELLER_AUTH_DOMAIN', message: 'SELLER_AUTH_DOMAIN must be the official public domain in production' });
    }
    if (!input.rawChainId || !input.rawChainId.trim()) {
      issues.push({ path: 'CHAIN_ID', message: 'CHAIN_ID must be set explicitly in production' });
    }
  }
  return issues;
}
