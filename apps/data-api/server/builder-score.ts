export interface BuilderGenConfig {
  productName?: string;
  productUrl?: string;
  minAmount?: number;
  hardLock?: boolean;
  lockDuration?: number;
  tierSystem?: boolean;
  cooldown?: boolean;
  apiCheck?: boolean;
  tier1Amount?: number;
  tier2Amount?: number;
  tier3Amount?: number;
  cooldownHours?: number;
}

export type BuilderConfigLevel = "strong" | "partial" | "weak";

/** Display labels: a configuration description, not a security verdict (same wording as docs/builder.html). */
export const BUILDER_CONFIG_LEVELS: Record<BuilderConfigLevel, { label: string; emoji: string }> = {
  strong: { label: "Strong setup", emoji: "🟢" },
  partial: { label: "Partial setup", emoji: "🟡" },
  weak: { label: "Weak setup", emoji: "🔴" },
};

export const BUILDER_SCORE_DISCLAIMER =
  "Configuration heuristic only — not audited, not a security audit or certification.";

/** Configuration Score (0-100) for POST /api/builder/generate; same math as apps/builder/engine/SecurityScorer.ts. */
export function builderConfigurationScore(c: BuilderGenConfig) {
  let score = 0;
  if (c.hardLock) {
    if ((c.lockDuration || 0) >= 90) score += 30;
    else if ((c.lockDuration || 0) >= 30) score += 25;
    else if ((c.lockDuration || 0) >= 7) score += 20;
    else score += 10;
  }
  if (c.cooldown) score += 20;
  if (c.tierSystem) score += 15;
  if ((c.minAmount || 0) >= 10000) score += 20;
  else if ((c.minAmount || 0) >= 1000) score += 15;
  else if ((c.minAmount || 0) >= 500) score += 10;
  else if ((c.minAmount || 0) >= 100) score += 5;
  if (!c.apiCheck) score += 15; else score += 5;
  const level: BuilderConfigLevel = score >= 80 ? "strong" : score >= 50 ? "partial" : "weak";
  const { label, emoji } = BUILDER_CONFIG_LEVELS[level];

  const recommendations: string[] = [];
  if (!c.hardLock) recommendations.push("Enable Hard Lock to prevent flash access");
  if (!c.cooldown) recommendations.push("Enable Cooldown for anti-gaming protection");
  if ((c.minAmount || 0) < 500) recommendations.push("Increase minimum to >=500 IFR");
  if (!c.tierSystem) recommendations.push("Add Tier System for graduated access");

  return { scoreName: "Configuration Score", score, level, label, emoji, disclaimer: BUILDER_SCORE_DISCLAIMER, recommendations };
}
