/**
 * Real token registration and lookup — the piece that makes
 * TokenIdentity.launchedOnSignal (packages/types) an actual fact to
 * check rather than something assumed.
 *
 * Registration is a claim of "this wallet launched this token", so it
 * is proven, not trusted (audit item C2):
 *  - the creator is the wallet of a verified session (a signed
 *    sign-in challenge, auth/AuthSession.ts), never a request field;
 *  - the chain must show that wallet created the mint
 *    (tokens/verifyMintCreator.ts);
 *  - a token registered to one creator can never be claimed by another.
 */
import { timingSafeEqual } from 'node:crypto';
import type { Handler } from '../router.js';
import { verifySessionToken } from '../auth/AuthSession.js';
import { registerToken, getTokenByAddress, listTokensByCreator, listRecentTokens, searchTokens, TokenValidationError, TokenConflictError } from '../tokens/tokenStore.js';
import {
  isSolanaAddress,
  solanaRpcFromEnv,
  verifySolanaMintCreator,
  MintOwnershipError,
  MintVerificationUnavailableError,
} from '../tokens/verifyMintCreator.js';

function getSessionWallet(headers: Record<string, string | string[] | undefined>): string | null {
  const authHeader = headers.authorization;
  const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const token = headerValue?.startsWith('Bearer ') ? headerValue.slice('Bearer '.length) : '';
  if (!token) return null;
  const payload = verifySessionToken(token);
  return payload?.chain.toUpperCase() === 'SOLANA' ? payload.address : null;
}

function errorToResponse(err: unknown): { status: number; body: unknown } {
  if (err instanceof TokenValidationError) return { status: 400, body: { error: 'VALIDATION_ERROR', message: err.message } };
  if (err instanceof TokenConflictError) return { status: 409, body: { error: 'TOKEN_ALREADY_REGISTERED', message: err.message } };
  if (err instanceof MintOwnershipError) return { status: 403, body: { error: 'NOT_MINT_CREATOR', message: err.message } };
  if (err instanceof MintVerificationUnavailableError) {
    return { status: 503, body: { error: 'VERIFICATION_UNAVAILABLE', message: `Could not verify this mint on-chain right now. ${err.message}` } };
  }
  console.error('[tokens] unexpected error:', err);
  return { status: 500, body: { error: 'INTERNAL_ERROR', message: 'Something went wrong handling this token request.' } };
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string {
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/**
 * Registrations are accepted only when forwarded by Signal's Cloudflare
 * Worker (functions/api/register-token.js), which refuses blocked regions
 * and sanctioned wallets before forwarding: the request must carry the
 * shared secret SIGNAL_EDGE_SECRET, and the wallet the Worker screened
 * must be this session's wallet. Without the secret configured here,
 * registration fails safe (nothing is accepted).
 */
/**
 * Devnet test APIs only: Devnet test builds register straight with their
 * own test API (there is no Worker in front of it). Allowed only when BOTH
 * SIGNAL_TEST_ALLOW_DIRECT_REGISTRATION is exactly "devnet" AND this API's
 * SOLANA_RPC_URL is a Devnet endpoint, so the flag can never open a way
 * around the Worker on a Mainnet API, even if set there by mistake.
 */
export function directRegistrationAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.SIGNAL_TEST_ALLOW_DIRECT_REGISTRATION !== 'devnet') return false;
  try {
    const host = new URL(env.SOLANA_RPC_URL ?? '').hostname.toLowerCase();
    return host.includes('devnet');
  } catch {
    return false;
  }
}

function edgeRefusal(headers: Record<string, string | string[] | undefined>, wallet: string): { status: number; body: unknown } | null {
  if (directRegistrationAllowed()) return null;
  const expected = process.env.SIGNAL_EDGE_SECRET ?? '';
  if (!expected) {
    return { status: 503, body: { error: 'REGISTRATION_NOT_CONFIGURED', message: 'Listing on Signal is not available right now.' } };
  }
  const given = Buffer.from(headerValue(headers, 'x-signal-edge-secret'));
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { status: 403, body: { error: 'EDGE_REQUIRED', message: 'Register tokens through the Signal site.' } };
  }
  if (headerValue(headers, 'x-signal-screened-wallet') !== wallet) {
    return { status: 403, body: { error: 'SCREENING_MISMATCH', message: 'The screened wallet does not match the signed-in wallet.' } };
  }
  return null;
}

export const registerTokenRoute: Handler = async (req) => {
  const wallet = getSessionWallet(req.headers);
  if (!wallet) return { status: 401, body: { error: 'UNAUTHORIZED', message: 'Sign in with the creator wallet to register a token.' } };
  const refusal = edgeRefusal(req.headers, wallet);
  if (refusal) return refusal;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const chain = typeof body.chain === 'string' ? body.chain.toUpperCase() : '';
  const address = typeof body.address === 'string' ? body.address : '';
  const decimals = typeof body.decimals === 'number' ? body.decimals : NaN;
  const name = typeof body.name === 'string' ? body.name : '';
  const symbol = typeof body.symbol === 'string' ? body.symbol : '';
  if (!name || !symbol) {
    return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'name and symbol are required.' } };
  }
  if (chain !== 'SOLANA') {
    return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Only Solana tokens can be registered.' } };
  }
  if (!isSolanaAddress(address)) {
    return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'address must be a Solana mint address.' } };
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) {
    return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'decimals must be a whole number from 0 to 9.' } };
  }
  if (body.creatorWalletAddress !== undefined && body.creatorWalletAddress !== wallet) {
    return { status: 403, body: { error: 'NOT_MINT_CREATOR', message: 'creatorWalletAddress must be the signed-in wallet.' } };
  }

  try {
    // Cheap check first: never spend RPC calls on a token that is
    // already registered (to this wallet: idempotent; to another: 409).
    const existing = await getTokenByAddress(chain, address);
    if (existing) {
      if (existing.creatorWalletAddress !== wallet) throw new TokenConflictError('This token is already registered to a different creator.');
      return { status: 200, body: { token: existing } };
    }

    const rpc = solanaRpcFromEnv();
    if (!rpc) throw new MintVerificationUnavailableError('SOLANA_RPC_URL is not configured on this server.');
    await verifySolanaMintCreator(rpc, address, wallet, decimals);

    const token = await registerToken({
      chain,
      address,
      name,
      symbol,
      decimals,
      creatorWalletAddress: wallet,
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
