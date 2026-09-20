/**
 * Real token registration and lookup — the piece that makes
 * TokenIdentity.launchedOnSignal (packages/types) an actual fact to
 * check rather than something assumed. No signature verification here
 * (unlike chat's writes): registering a token doesn't move funds or
 * change on-chain state — it's Signal's own record of a launch that
 * already happened on-chain, and the source of truth for "is this
 * real" is always the chain itself (see GET below), not this record.
 * A false registration can't forge a launch; it can only mislead
 * Signal's own cache, which the indexer's real chain reads keep honest.
 */
import type { Handler } from '../router.js';
import { registerToken, getTokenByAddress, listTokensByCreator, listRecentTokens, searchTokens, TokenValidationError } from '../tokens/tokenStore.js';

function errorToResponse(err: unknown): { status: number; body: unknown } {
  if (err instanceof TokenValidationError) return { status: 400, body: { error: 'VALIDATION_ERROR', message: err.message } };
  console.error('[tokens] unexpected error:', err);
  return { status: 500, body: { error: 'INTERNAL_ERROR', message: 'Something went wrong handling this token request.' } };
}

export const registerTokenRoute: Handler = async (req) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const token = await registerToken({
      chain: typeof body.chain === 'string' ? body.chain.toUpperCase() : '',
      address: typeof body.address === 'string' ? body.address : '',
      name: typeof body.name === 'string' ? body.name : '',
      symbol: typeof body.symbol === 'string' ? body.symbol : '',
      decimals: typeof body.decimals === 'number' ? body.decimals : NaN,
      creatorWalletAddress: typeof body.creatorWalletAddress === 'string' ? body.creatorWalletAddress : '',
    });
    return { status: 201, body: { token } };
  } catch (err) {
    return errorToResponse(err);
  }
};

export const getTokenRoute: Handler = async (req) => {
  const chain = (req.params.chain ?? '').toUpperCase();
  const address = req.params.address ?? '';
  const token = await getTokenByAddress(chain, address);
  if (!token) {
    // A real, honest "not found" — never a fabricated placeholder
    // token. This is exactly what lets TokenIdentity.launchedOnSignal
    // be a real DataPoint rather than an assumption: no row here means
    // 'unavailable', not 'false'.
    return { status: 404, body: { error: 'NOT_FOUND', message: 'No Signal-registered token at this address.' } };
  }
  return { status: 200, body: { token } };
};

export const listMyTokensRoute: Handler = async (req) => {
  const creatorWalletAddress = req.query.get('creatorWalletAddress') ?? '';
  if (!creatorWalletAddress) {
    return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'creatorWalletAddress query param is required.' } };
  }
  const tokens = await listTokensByCreator(creatorWalletAddress);
  return { status: 200, body: { tokens } };
};

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

/**
 * Public, read-only, unauthenticated — this is discovery data (Explore's
 * "New" tab), not per-user data, so it's deliberately NOT gated behind
 * a session the way Watchlist/Alerts are. Real registration facts only
 * (name, symbol, address, chain, creation time) — no holder counts, no
 * volume, no supply analysis. Those need live on-chain data (a real
 * TokenIndexer run against real RPC, which doesn't exist here) or the
 * bonding curve (Stage 8, unbuilt) — explicitly out of scope for this
 * endpoint, not a gap to quietly fill with an invented number.
 */
export const listRecentTokensRoute: Handler = async (req) => {
  const rawLimit = req.query.get('limit');
  let limit = DEFAULT_LIST_LIMIT;
  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'limit must be a positive integer.' } };
    }
    limit = Math.min(parsed, MAX_LIST_LIMIT);
  }
  const cursor = req.query.get('cursor');
  const page = await listRecentTokens(limit, cursor);
  return { status: 200, body: page };
};

/**
 * Public, read-only, unauthenticated — same posture as
 * listRecentTokensRoute above, same reasoning. Simple substring
 * matching only, as scoped — no fuzzy/ranked search. Real registered
 * tokens only; an empty result is a genuine "no matches."
 */
export const searchTokensRoute: Handler = async (req) => {
  const q = req.query.get('q') ?? '';
  if (!q.trim()) {
    return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'q query param is required.' } };
  }
  const rawLimit = req.query.get('limit');
  let limit = DEFAULT_LIST_LIMIT;
  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'limit must be a positive integer.' } };
    }
    limit = Math.min(parsed, MAX_LIST_LIMIT);
  }
  const tokens = await searchTokens(q, limit);
  return { status: 200, body: { tokens } };
};
