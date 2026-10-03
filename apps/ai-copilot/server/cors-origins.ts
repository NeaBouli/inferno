// CORS allowlist for the copilot API (T-212b-10). ALLOWED_ORIGINS wins when set. Without it,
// production keeps only the public HTTPS origins (fail closed: no localhost); local development
// origins are added only outside production.
const PRODUCTION_ORIGINS = ["https://ifrunit.tech", "https://www.ifrunit.tech", "https://neabouli.github.io"];
const DEVELOPMENT_ORIGINS = ["http://localhost:5175", "http://localhost:3003"];

export function resolveAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = (env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
  if (configured.length > 0) return configured;
  return env.NODE_ENV === "production" ? [...PRODUCTION_ORIGINS] : [...PRODUCTION_ORIGINS, ...DEVELOPMENT_ORIGINS];
}
