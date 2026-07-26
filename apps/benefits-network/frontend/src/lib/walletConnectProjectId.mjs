const PROJECT_ID_PATTERN = /^[a-f0-9]{32}$/i;

export function normalizeWalletConnectProjectId(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  return PROJECT_ID_PATTERN.test(normalized) ? normalized : '';
}

export function hasValidWalletConnectProjectId(value) {
  return Boolean(normalizeWalletConnectProjectId(value));
}
