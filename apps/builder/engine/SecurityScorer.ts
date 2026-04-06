import { BuilderConfig } from "./ConfigValidator";

export type SecurityLevel = "SAFE" | "MEDIUM" | "RISKY";

export interface ScoreBreakdown {
  category: string;
  points: number;
  maxPoints: number;
  passed: boolean;
  note: string;
}

export interface SecurityScore {
  score: number;
  level: SecurityLevel;
  emoji: string;
  breakdown: ScoreBreakdown[];
  recommendations: string[];
}

export function calculateSecurityScore(config: BuilderConfig): SecurityScore {
  const breakdown: ScoreBreakdown[] = [];
  let total = 0;

  // Hard Lock (max 30)
  let lockPoints = 0;
  if (config.hardLock) {
    if (config.lockDuration >= 90) lockPoints = 30;
    else if (config.lockDuration >= 30) lockPoints = 25;
    else if (config.lockDuration >= 7) lockPoints = 20;
    else lockPoints = 10;
  }
  total += lockPoints;
  breakdown.push({
    category: "Hard Lock",
    points: lockPoints,
    maxPoints: 30,
    passed: config.hardLock && config.lockDuration >= 7,
    note: config.hardLock ? `${config.lockDuration}-day lock` : "No lock — flash access possible",
  });

  // Cooldown (max 20)
  const cooldownPoints = config.cooldown ? 20 : 0;
  total += cooldownPoints;
  breakdown.push({
    category: "Cooldown",
    points: cooldownPoints,
    maxPoints: 20,
    passed: config.cooldown,
    note: config.cooldown ? `${config.cooldownHours || 24}h anti-gaming` : "No cooldown — gaming risk",
  });

  // Tier System (max 15)
  const tierPoints = config.tierSystem ? 15 : 0;
  total += tierPoints;
  breakdown.push({
    category: "Tier System",
    points: tierPoints,
    maxPoints: 15,
    passed: config.tierSystem,
    note: config.tierSystem ? "3-tier graduated access" : "Binary on/off access",
  });

  // Min Amount (max 20)
  let amountPoints = 0;
  if (config.minAmount >= 10000) amountPoints = 20;
  else if (config.minAmount >= 1000) amountPoints = 15;
  else if (config.minAmount >= 500) amountPoints = 10;
  else if (config.minAmount >= 100) amountPoints = 5;
  total += amountPoints;
  breakdown.push({
    category: "Minimum Amount",
    points: amountPoints,
    maxPoints: 20,
    passed: config.minAmount >= 500,
    note: `${config.minAmount} IFR minimum`,
  });

  // Verification Method (max 15)
  const chainPoints = config.apiCheck ? 5 : 15;
  total += chainPoints;
  breakdown.push({
    category: "Verification",
    points: chainPoints,
    maxPoints: 15,
    passed: !config.apiCheck,
    note: config.apiCheck ? "API check (centralized)" : "On-chain verification (trustless)",
  });

  // Level
  const level: SecurityLevel = total >= 80 ? "SAFE" : total >= 50 ? "MEDIUM" : "RISKY";
  const emoji = level === "SAFE" ? "🟢" : level === "MEDIUM" ? "🟡" : "🔴";

  // Recommendations
  const recommendations: string[] = [];
  if (!config.hardLock) recommendations.push("Enable Hard Lock to prevent flash access");
  if (!config.cooldown) recommendations.push("Enable Cooldown for anti-gaming protection");
  if (config.minAmount < 500) recommendations.push("Increase minimum to >=500 IFR");
  if (!config.tierSystem) recommendations.push("Add Tier System for graduated access");
  if (config.apiCheck) recommendations.push("Switch to on-chain verification for trustless security");
  if (config.hardLock && config.lockDuration < 30) recommendations.push("Increase lock to >=30 days for stronger commitment");

  return { score: total, level, emoji, breakdown, recommendations };
}
