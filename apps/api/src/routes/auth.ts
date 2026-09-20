/**
 * Real sign-in-with-wallet endpoints. No new cryptography here — this
 * wires AuthSession.ts (which itself reuses chat/verify.ts's proven
 * signature verification) into real HTTP routes.
 */
import type { Handler } from '../router.js';
import { generateNonce, verifySignInAndIssueSession, verifySessionToken, AuthError } from '../auth/AuthSession.js';

/** In-memory nonce store — real for as long as this process runs, same
 *  honest limit as chat's in-memory store (apps/api/src/chat/store.ts).
 *  A nonce is single-use and short-lived (CHALLENGE_MAX_AGE_MS), so
 *  losing this on restart only means an in-flight sign-in must be
 *  retried, never a security regression. */
const pendingNonces = new Map<string, number>(); // nonce -> issuedAt

export const getAuthChallenge: Handler = (req) => {
  const address = req.query.get('address') ?? '';
  const chain = req.query.get('chain') ?? '';
  if (!address || !chain) {
    return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'address and chain query params are required.' } };
  }
  const nonce = generateNonce();
  const timestamp = Date.now();
  pendingNonces.set(nonce, timestamp);
  return {
    status: 200,
    body: {
      nonce,
      timestamp,
      message: `signal-auth|${address}|${chain}|${nonce}|${timestamp}`,
    },
  };
};

export const postAuthSession: Handler = (req) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const address = typeof body.address === 'string' ? body.address : '';
  const chain = typeof body.chain === 'string' ? body.chain : '';
  const nonce = typeof body.nonce === 'string' ? body.nonce : '';
  const timestamp = typeof body.timestamp === 'number' ? body.timestamp : NaN;
  const signature = typeof body.signature === 'string' ? body.signature : '';

  if (!address || !chain || !nonce || !signature || !Number.isFinite(timestamp)) {
    return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'address, chain, nonce, timestamp, and signature are all required.' } };
  }
  // A nonce this endpoint never issued (or already consumed) is
  // rejected before signature verification even runs — real, checked
  // single-use, not just documented as single-use.
  if (!pendingNonces.has(nonce)) {
    return { status: 400, body: { error: 'INVALID_NONCE', message: 'This nonce was not issued by this server, or has already been used.' } };
  }
  pendingNonces.delete(nonce);

  try {
    const token = verifySignInAndIssueSession({ address, chain, nonce, timestamp, signature });
    return { status: 200, body: { sessionToken: token } };
  } catch (err) {
    if (err instanceof AuthError) {
      return { status: 401, body: { error: 'AUTH_FAILED', message: err.message } };
    }
    console.error('[auth] unexpected error:', err);
    return { status: 500, body: { error: 'INTERNAL_ERROR', message: 'Something went wrong verifying this sign-in.' } };
  }
};

export const getAuthSession: Handler = (req) => {
  const authHeader = req.headers.authorization;
  const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const token = headerValue?.startsWith('Bearer ') ? headerValue.slice('Bearer '.length) : '';
  const payload = verifySessionToken(token);
  if (!payload) {
    return { status: 401, body: { error: 'UNAUTHORIZED', message: 'No valid session.' } };
  }
  return { status: 200, body: { address: payload.address, chain: payload.chain, expiresAt: new Date(payload.exp).toISOString() } };
};
