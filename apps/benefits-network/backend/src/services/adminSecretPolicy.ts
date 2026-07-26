export const ADMIN_SECRET_MIN_LENGTH = 32;

const documentedPlaceholders = new Set([
  'change-me-to-a-random-secret',
  'replace-with-a-long-random-admin-secret',
  'ci-admin-secret',
  'startup-test-secret',
]);

export function getAdminSecretPolicyIssue(secret: string | undefined): string | null {
  if (!secret || secret.length < ADMIN_SECRET_MIN_LENGTH) {
    return `ADMIN_SECRET must be at least ${ADMIN_SECRET_MIN_LENGTH} characters long`;
  }
  if (documentedPlaceholders.has(secret.trim().toLowerCase())) {
    return 'ADMIN_SECRET must not use a documented placeholder default';
  }
  return null;
}
