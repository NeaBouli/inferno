export type CopilotSurface = 'landing' | 'web3' | 'benefits' | 'standalone';

const SURFACE_CONTEXT: Record<CopilotSurface, string> = {
  landing: `The user is asking from the public IFR Protocol landing page. Explain concepts first, then route live wallet actions to https://web3.ifrunit.tech/ and customer or seller benefit actions to https://shop.ifrunit.tech/. Use the Wiki for deeper reference.`,
  web3: `The user is asking from https://web3.ifrunit.tech/, the live user execution surface. Prioritize concise in-page guidance for wallet connection, buying or adding IFR, refundable IFRLock access, CommitmentVault tranches, and LendingVault actions. Route benefits checkout and seller tools to https://shop.ifrunit.tech/. Never imply that the assistant can sign or submit a transaction.`,
  benefits: `The user is asking from https://shop.ifrunit.tech/, the IFR Benefits customer and seller app. Prioritize customer offer discovery, IFRLock eligibility and locking, the recommended customer-presented checkout pass, exact-offer confirmation, My benefits, seller profiles, catalogs, rules, checkout operators, reconciliation, and one-time redemption. Describe seller-issued QR as the compatible alternative. Never claim PartnerVault seller rewards are generally active.`,
  standalone: `The user is asking from the standalone IFR Copilot. Give protocol-wide guidance and name the correct canonical surface: https://web3.ifrunit.tech/ for live token actions, https://shop.ifrunit.tech/ for customer or seller benefits, and https://ifrunit.tech/wiki/ for technical reference.`,
};

export function normalizeCopilotSurface(value: unknown): CopilotSurface {
  return value === 'landing' || value === 'web3' || value === 'benefits' ? value : 'standalone';
}

export function buildSurfaceContext(value: unknown): string {
  const surface = normalizeCopilotSurface(value);
  return `--- CURRENT PRODUCT SURFACE: ${surface.toUpperCase()} ---\n${SURFACE_CONTEXT[surface]}\n--- END CURRENT PRODUCT SURFACE ---`;
}
