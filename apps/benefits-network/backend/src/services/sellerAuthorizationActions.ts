export const READ_ONLY_SELLER_ACTIONS = [
  'business:list',
  'operators:status',
  'operators:list',
  'products:list',
  'rewards:read',
  'rules:list',
  'sessions:list',
] as const;

export const MUTATING_SELLER_ACTIONS = [
  'business:create',
  'business:slug',
  'business:update',
  'business:delete',
  'business:reactivate',
  'operators:create',
  'operators:delete',
  'products:create',
  'products:update',
  'products:delete',
  'rewards:apply',
  'rewards:disable',
  'rewards:reward-wallet',
  'rules:create',
  'rules:update',
  'rules:delete',
  'sessions:create',
  'sessions:redeem',
  'passes:bind',
] as const;

const knownActions = new Set<string>([
  ...READ_ONLY_SELLER_ACTIONS,
  ...MUTATING_SELLER_ACTIONS,
]);
const readOnlyActions = new Set<string>(READ_ONLY_SELLER_ACTIONS);

// Every read-only authorization is bound to this fixed scope; the one-time
// nonce, action, business and wallet carry the exact request context.
export const READ_ONLY_SELLER_SCOPE = 'read';

export function isKnownSellerAction(action: string) {
  return knownActions.has(action);
}

// Reads and mutations alike consume a server-issued one-time challenge, so a
// captured signature cannot be replayed within the TTL (CWA-35).
export function requiresSingleUseSellerChallenge(action: string) {
  return knownActions.has(action);
}

export function isReadOnlySellerAction(action: string) {
  return readOnlyActions.has(action);
}

export function isSafeSellerAuthorizationField(value: string) {
  return value.length > 0
    && value.length <= 200
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
}
