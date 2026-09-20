/**
 * Real sign-in-with-wallet + session tokens — the piece several
 * existing "needs auth (Stage 19)" markers across this project were
 * waiting on (apps/api/src/server.ts's watchlist/alerts stubs,
 * DashboardPage.tsx's cross-device-watchlist note, docs/ARCHITECTURE.md's
 * "Stage 19 (security hardening)").
 *
 * Reuses chat/verify.ts's existing, already-proven
 * verifyWalletSignature() for the actual cryptography — this module
 * does not implement or re-implement any signature verification of its
 * own. What it adds is session issuance on top of that: sign a
 * challenge once, get a short-lived token, use that token instead of
 * re-signing every request — the standard "Sign-In With X" pattern
 * (e.g. EIP-4361's shape, adapted to this project's existing
 * canonical-string convention rather than that exact spec).
 *
 * Session tokens are JWT-SHAPED (header.payload.signature, base64url,
 * HMAC-SHA256) using only node:crypto — not a claim of full JWT/RFC
 * 7519 spec compliance, since that wasn't verified against the spec
 * text itself, only that this shape is a real, standard, well-
 * understood pattern for exactly this purpose.
 *
 * AUTH_SECRET must be set to a real secret, never the .env.example
 * placeholder — this throws loudly at the first use rather than
 * silently signing sessions with a known, public value, the same
 * "wrong config is never a quiet surprise" rule as CHAT_STORAGE=database
 * in apps/api/src/chat/store.ts.
 */
import crypto from 'node:crypto';
import { verifyWalletSignature } from '../chat/verify.js';

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const CHALLENGE_MAX_AGE_MS = 5 * 60 * 1000; // a signed challenge must be used within 5 minutes

export class AuthError extends Error {}

const PLACEHOLDER_SECRET = 'change_me_generate_a_real_random_secret';

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret === PLACEHOLDER_SECRET) {
    throw new AuthError(
      'AUTH_SECRET is not set to a real secret (still unset or still the .env.example placeholder). ' +
      'Sessions cannot be issued or verified with a known, public value — generate a real random secret.'
    );
  }
  return secret;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

export interface SessionPayload {
  address: string;
  chain: string;
  iat: number;
  exp: number;
}

/** The exact message a wallet signs to prove ownership — mirrors
 *  chat/routes/chat.ts's canonical-string convention
 *  (signal-chat|...) rather than inventing a different shape. `nonce`
 *  should be freshly generated per attempt so the same signature can
 *  never mint two different sessions. */
export function createSignInMessage(address: string, chain: string, nonce: string, timestamp: number): string {
  return `signal-auth|${address}|${chain}|${nonce}|${timestamp}`;
}

export function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** Verifies a signed sign-in message and, if valid and recent, issues
 *  a real session token. Throws AuthError on any failure — never
 *  returns a token for an unverified signature. */
export function verifySignInAndIssueSession(params: {
  address: string;
  chain: string;
  nonce: string;
  timestamp: number;
  signature: string;
}): string {
  if (Math.abs(Date.now() - params.timestamp) > CHALLENGE_MAX_AGE_MS) {
    throw new AuthError('Sign-in challenge has expired — request a new one and try again.');
  }
  const message = createSignInMessage(params.address, params.chain, params.nonce, params.timestamp);
  if (!verifyWalletSignature(message, params.signature, params.address)) {
    throw new AuthError('Signature does not match the claimed wallet.');
  }
  return issueSessionToken(params.address, params.chain);
}

export function issueSessionToken(address: string, chain: string): string {
  const secret = getSecret();
  const now = Date.now();
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload: SessionPayload = { address, chain, iat: now, exp: now + SESSION_TTL_MS };

  const headerPart = base64url(JSON.stringify(header));
  const payloadPart = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(`${headerPart}.${payloadPart}`).digest('base64url');
  return `${headerPart}.${payloadPart}.${signature}`;
}

/** Verifies a session token's signature and expiry. Returns the
 *  verified payload, or null for anything invalid/expired/tampered —
 *  never throws for a bad token, since "not logged in" is an ordinary,
 *  expected outcome for a route to handle, not an exceptional one. */
export function verifySessionToken(token: string): SessionPayload | null {
  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return null; // misconfigured server -> no session is ever valid, not a crash per-request
  }

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signature] = parts;

  const expectedSignature = crypto.createHmac('sha256', secret).update(`${headerPart}.${payloadPart}`).digest('base64url');
  // Constant-time comparison — a session token's signature is exactly
  // the kind of secret-derived value a naive string===  comparison
  // could leak timing information about.
  const sigBuf = Buffer.from(signature!, 'utf8');
  const expectedBuf = Buffer.from(expectedSignature, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadPart!, 'base64url').toString('utf8')) as SessionPayload;
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
    if (typeof payload.address !== 'string' || typeof payload.chain !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}
