export interface BuilderConfig {
  productName: string;
  productUrl: string;
  minAmount: number;
  hardLock: boolean;
  lockDuration: number;  // days: 7, 30, 90, 180, 365
  tierSystem: boolean;
  cooldown: boolean;
  apiCheck: boolean;
  tier1Amount?: number;  // default 500
  tier2Amount?: number;  // default 2000
  tier3Amount?: number;  // default 10000
  cooldownHours?: number; // default 24
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const VALID_DURATIONS = [7, 30, 90, 180, 365];

export function validateConfig(config: BuilderConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!config.productName?.trim()) errors.push("productName is required");
  if (!config.productUrl?.trim()) errors.push("productUrl is required");

  // Min amount
  if (!config.minAmount || config.minAmount < 1) {
    errors.push("minAmount must be >= 1 IFR");
  } else if (config.minAmount < 100) {
    warnings.push("minAmount < 100 IFR: barrier very low, gaming risk high");
  }

  // Lock duration
  if (config.hardLock) {
    if (!VALID_DURATIONS.includes(config.lockDuration)) {
      errors.push("lockDuration must be: 7, 30, 90, 180, or 365 days");
    }
  }

  // Tier thresholds
  if (config.tierSystem) {
    const t1 = config.tier1Amount || 500;
    const t2 = config.tier2Amount || 2000;
    const t3 = config.tier3Amount || 10000;
    if (!(t1 < t2 && t2 < t3)) {
      errors.push("Tier thresholds must be ascending: t1 < t2 < t3");
    }
  }

  // Cooldown
  if (config.cooldown && config.cooldownHours !== undefined) {
    if (config.cooldownHours < 1 || config.cooldownHours > 720) {
      errors.push("cooldownHours must be between 1 and 720 (30 days)");
    }
  }

  // Security warnings
  if (!config.hardLock) {
    warnings.push("No hard lock: flash access possible — users can buy, access, then sell");
  }
  if (!config.cooldown) {
    warnings.push("No cooldown: gaming risk — consider enabling anti-gaming protection");
  }
  if (!config.tierSystem) {
    warnings.push("No tier system: binary on/off access — consider tiers for better monetization");
  }
  if (config.hardLock && config.lockDuration < 30) {
    warnings.push("Lock duration < 30 days: moderate commitment — consider 30+ days");
  }

  return { valid: errors.length === 0, errors, warnings };
}
