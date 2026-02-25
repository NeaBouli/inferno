import { lockChecker } from './lock-checker';
import { youtubeChecker } from './youtube-checker';

export interface EntitlementConfig {
  logic: 'OR' | 'AND';
  conditions: Array<
    | { type: 'ifr_lock'; minIFR: string }
    | { type: 'youtube_member' }
  >;
}

export const DEFAULT_ENTITLEMENT: EntitlementConfig = {
  logic: 'OR',
  conditions: [
    { type: 'youtube_member' },
    { type: 'ifr_lock', minIFR: '1000' },
  ],
};

export async function checkEntitlement(
  walletAddress: string | undefined,
  youtubeAccessToken: string | undefined,
  config: EntitlementConfig = DEFAULT_ENTITLEMENT
): Promise<{ granted: boolean; reasons: string[] }> {
  const results: boolean[] = [];
  const reasons: string[] = [];

  for (const condition of config.conditions) {
    if (condition.type === 'youtube_member' && youtubeAccessToken) {
      const ok = await youtubeChecker.isMember(youtubeAccessToken);
      results.push(ok);
      if (ok) reasons.push('YouTube Member');
    } else if (condition.type === 'ifr_lock' && walletAddress) {
      const ok = await lockChecker.isLocked(walletAddress, condition.minIFR);
      results.push(ok);
      if (ok) reasons.push(`IFR Lock >= ${condition.minIFR} IFR`);
    } else {
      results.push(false);
    }
  }

  const granted =
    config.logic === 'OR' ? results.some(Boolean) : results.every(Boolean);

  return { granted, reasons };
}
