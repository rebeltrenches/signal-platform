/**
 * Real, session-authenticated watchlist endpoints. The owning wallet
 * comes ONLY from a verified session token (auth/AuthSession.ts) —
 * never from a client-supplied field in the request body/query, which
 * would let anyone claim to be any wallet. This is what "ownership
 * enforced server-side" actually means in code, not just in a comment.
 */
import type { Handler } from '../router.js';
import { verifySessionToken } from '../auth/AuthSession.js';
import { addWatchlistItem, removeWatchlistItem, listWatchlistItems, WatchlistValidationError, WatchlistUnauthorizedError } from '../watchlist/watchlistStore.js';

function getSessionWallet(headers: Record<string, string | string[] | undefined>): string | null {
  const authHeader = headers.authorization;
  const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const token = headerValue?.startsWith('Bearer ') ? headerValue.slice('Bearer '.length) : '';
  if (!token) return null;
  const payload = verifySessionToken(token);
  return payload?.address ?? null;
}

function errorToResponse(err: unknown): { status: number; body: unknown } {
  if (err instanceof WatchlistValidationError) return { status: 400, body: { error: 'VALIDATION_ERROR', message: err.message } };
  if (err instanceof WatchlistUnauthorizedError) return { status: 403, body: { error: 'UNAUTHORIZED', message: err.message } };
  console.error('[watchlist] unexpected error:', err);
  return { status: 500, body: { error: 'INTERNAL_ERROR', message: 'Something went wrong handling this watchlist request.' } };
}

export const getWatchlist: Handler = async (req) => {
  const wallet = getSessionWallet(req.headers);
  if (!wallet) return { status: 401, body: { error: 'UNAUTHORIZED', message: 'A valid session is required.' } };
  const items = await listWatchlistItems(wallet);
  return { status: 200, body: { items } };
};

export const postWatchlistItem: Handler = async (req) => {
  const wallet = getSessionWallet(req.headers);
  if (!wallet) return { status: 401, body: { error: 'UNAUTHORIZED', message: 'A valid session is required.' } };
  const body = (req.body ?? {}) as Record<string, unknown>;
  const value = typeof body.value === 'string' ? body.value : '';
  try {
    const item = await addWatchlistItem(wallet, value);
    return { status: 201, body: { item } };
  } catch (err) {
    return errorToResponse(err);
  }
};

export const deleteWatchlistItem: Handler = async (req) => {
  const wallet = getSessionWallet(req.headers);
  if (!wallet) return { status: 401, body: { error: 'UNAUTHORIZED', message: 'A valid session is required.' } };
  const itemId = req.params.itemId ?? '';
  try {
    await removeWatchlistItem(wallet, itemId);
    return { status: 200, body: { removed: true } };
  } catch (err) {
    return errorToResponse(err);
  }
};
