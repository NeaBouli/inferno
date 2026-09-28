import { createHash, randomBytes, timingSafeEqual } from 'crypto';

interface StoreEntry<T> {
  value: T;
  expiresAt: number;
}

class TtlStore<T> {
  private entries = new Map<string, StoreEntry<T>>();

  constructor(
    private ttlMs: number,
    private keyFactory: () => string = () => randomBytes(32).toString('base64url')
  ) {
    const cleanup = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.entries) {
        if (entry.expiresAt <= now) this.entries.delete(key);
      }
    }, 60_000);
    cleanup.unref();
  }

  create(value: T): string {
    const key = this.keyFactory();
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    return key;
  }

  /** Atomic single-use read: removes the entry even when expired, so replay always fails. */
  claim(key: string, matches?: (value: T) => boolean): T | null {
    if (typeof key !== 'string' || key.length === 0) return null;
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    if (entry.expiresAt <= Date.now()) return null;
    if (matches && !matches(entry.value)) return null;
    return entry.value;
  }

  /** Non-destructive, expiry-checked read for long-lived sessions. */
  peek(key: string): T | null {
    if (typeof key !== 'string' || key.length === 0) return null;
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }
}

export interface OAuthState {
  walletAddress?: string;
  /** SHA-256 of the browser-held verifier cookie — the cookie itself is never stored. */
  verifierHash: string;
}

export interface YouTubeSession {
  accessToken: string;
  refreshToken?: string;
}

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const SIWE_NONCE_TTL_MS = 10 * 60 * 1000;
// Google access tokens live ~1h; after that lookups fail closed.
const YOUTUBE_SESSION_TTL_MS = 60 * 60 * 1000;

const oauthStates = new TtlStore<OAuthState>(OAUTH_STATE_TTL_MS);
// SIWE grammar requires alphanumeric nonces — hex, not base64url.
const siweNonces = new TtlStore<true>(SIWE_NONCE_TTL_MS, () =>
  randomBytes(16).toString('hex')
);
const youtubeSessions = new TtlStore<YouTubeSession>(YOUTUBE_SESSION_TTL_MS);

function hashVerifier(verifier: string): Buffer {
  return createHash('sha256').update(verifier, 'utf8').digest();
}

// The OAuth state is bound to the initiating browser: the server stores only
// the hash of a CSPRNG verifier that travels in an HttpOnly cookie. The state
// key alone (e.g. leaked from a URL) is useless without the matching cookie.
export function createOAuthState(walletAddress?: string): { state: string; verifier: string } {
  const verifier = randomBytes(32).toString('base64url');
  const state = oauthStates.create({
    walletAddress,
    verifierHash: hashVerifier(verifier).toString('hex'),
  });
  return { state, verifier };
}

/** Single-use claim; fails on unknown, expired, replayed or foreign-cookie states. */
export function claimOAuthState(state: string, verifier: string): OAuthState | null {
  if (typeof verifier !== 'string' || verifier.length === 0) return null;
  return oauthStates.claim(state, (value) =>
    timingSafeEqual(hashVerifier(verifier), Buffer.from(value.verifierHash, 'hex'))
  );
}

export function createSiweNonce(): string {
  return siweNonces.create(true);
}

export function claimSiweNonce(nonce: string): boolean {
  return siweNonces.claim(nonce) === true;
}

export function createYouTubeSession(session: YouTubeSession): string {
  return youtubeSessions.create(session);
}

export function getYouTubeSession(sid: string | undefined): YouTubeSession | null {
  if (!sid) return null;
  return youtubeSessions.peek(sid);
}
