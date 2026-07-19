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
  'business:update',
  'business:delete',
  'operators:create',
  'operators:delete',
  'products:create',
  'products:update',
  'products:delete',
  'rewards:apply',
  'rules:create',
  'rules:update',
  'rules:delete',
  'sessions:create',
  'sessions:redeem',
] as const;

const knownActions = new Set<string>([
  ...READ_ONLY_SELLER_ACTIONS,
  ...MUTATING_SELLER_ACTIONS,
]);
const mutatingActions = new Set<string>(MUTATING_SELLER_ACTIONS);

export function isKnownSellerAction(action: string) {
  return knownActions.has(action);
}

export function requiresSingleUseSellerChallenge(action: string) {
  return mutatingActions.has(action);
}

export function isSafeSellerAuthorizationField(value: string) {
  return value.length > 0
    && value.length <= 200
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
}
