/**
 * Chat route handlers. Every write (post, report, delete) requires a
 * real Ed25519 signature over a canonical payload — see chat/verify.ts
 * for why. The canonical signed string is:
 *
 *   signal-chat|<roomId>|<action>|<content-or-messageId>|<timestampMs>
 *
 * Including the room id and action in the signed payload means a valid
 * signature for "post 'hello' to the main room at time T" can't be
 * replayed as a report or a delete, and can't be replayed into a
 * different room. The timestamp is checked against server time within
 * SIGNATURE_MAX_AGE_MS — bounding how long a captured signature stays
 * usable, a standard real anti-replay measure for this shape of request
 * (there's no session/nonce system in this project — Stage 19 doesn't
 * exist — so a time-bounded signature is the honest, real mechanism
 * that fits what's actually here).
 *
 * XSS: content is HTML-escaped before ever being stored, not only at
 * render time — so every current and future reader of this API (this
 * frontend, a future admin tool, anything) gets already-safe text
 * rather than relying on each consumer to remember to escape it.
 */
import type { Handler } from '../router.js';
import { verifyWalletSignature } from '../chat/verify.js';
import {
  getMainRoom,
  getOrCreateTokenRoom,
  getRoomById,
  listMessages,
  postMessage,
  reportMessage,
  deleteMessage,
  isModerator,
  ValidationError,
  RateLimitError,
  UnauthorizedError,
  SIGNATURE_MAX_AGE_MS,
  type ChatMessage,
} from '../chat/store.js';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Shared shape check + signature verification for every write request.
 *  Accepts the {walletAddress, signature, timestamp} fields from
 *  wherever the caller has them (a parsed JSON body for POST, or a
 *  plain object built from query params for DELETE — see
 *  deleteChatMessage below for why DELETE specifically can't rely on a
 *  parsed body here). Returns the verified {walletAddress, timestamp}
 *  or throws ValidationError with a message safe to show the caller. */
function verifyWriteRequest(
  fields: unknown,
  roomId: string,
  action: string,
  payload: string
): { walletAddress: string; timestamp: number } {
  if (typeof fields !== 'object' || fields === null) {
    throw new ValidationError('Request must include walletAddress, signature, and timestamp.');
  }
  const { walletAddress, signature, timestamp } = fields as Record<string, unknown>;
  if (typeof walletAddress !== 'string' || walletAddress.length === 0) {
    throw new ValidationError('walletAddress is required.');
  }
  if (typeof signature !== 'string' || signature.length === 0) {
    throw new ValidationError('signature is required.');
  }
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    throw new ValidationError('timestamp is required.');
  }
  if (Math.abs(Date.now() - timestamp) > SIGNATURE_MAX_AGE_MS) {
    throw new ValidationError('Signature has expired — try again.');
  }

  const canonical = `signal-chat|${roomId}|${action}|${payload}|${timestamp}`;
  if (!verifyWalletSignature(canonical, signature, walletAddress)) {
    throw new ValidationError('Signature does not match the claimed wallet — message rejected.');
  }
  return { walletAddress, timestamp };
}

function serializeMessage(m: ChatMessage) {
  // A deleted message is returned as a real tombstone — never with its
  // original content — so room ordering/counts stay stable for anyone
  // polling, matching the schema's own soft-delete reasoning.
  if (m.deletedAt) {
    return { id: m.id, walletAddress: m.walletAddress, content: null, createdAt: m.createdAt, deleted: true, reportCount: m.reportCount };
  }
  return { id: m.id, walletAddress: m.walletAddress, content: m.content, createdAt: m.createdAt, deleted: false, reportCount: m.reportCount };
}

function errorToResponse(err: unknown): { status: number; body: unknown } {
  if (err instanceof RateLimitError) return { status: 429, body: { error: 'RATE_LIMITED', message: err.message } };
  if (err instanceof UnauthorizedError) return { status: 403, body: { error: 'UNAUTHORIZED', message: err.message } };
  if (err instanceof ValidationError) return { status: 400, body: { error: 'VALIDATION_ERROR', message: err.message } };
  // Anything else (a real database error once CHAT_STORAGE=database is
  // actually wired to a live Postgres, a network failure, etc.) is a
  // genuine 500 — but its raw message is never handed back to the
  // caller. A connection string, a table name, a driver's internal
  // wording are implementation detail, not something an API consumer
  // should see or depend on. Logged server-side for whoever operates
  // this, not silently swallowed.
  console.error('[chat] unexpected error:', err);
  return { status: 500, body: { error: 'INTERNAL_ERROR', message: 'Something went wrong handling this chat request.' } };
}

export const getMainMessages: Handler = async (req) => {
  const room = await getMainRoom();
  const since = req.query.get('since') ?? undefined;
  const messages = await listMessages(room.id, since);
  return { status: 200, body: { room: { id: room.id, kind: room.kind }, messages: messages.map(serializeMessage) } };
};

export const postMainMessage: Handler = async (req) => {
  try {
    const room = await getMainRoom();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const content = typeof body.content === 'string' ? body.content : '';
    const { walletAddress } = verifyWriteRequest(req.body, room.id, 'post', content);
    const message = await postMessage(room.id, walletAddress, escapeHtml(content));
    return { status: 201, body: { message: serializeMessage(message) } };
  } catch (err) {
    return errorToResponse(err);
  }
};

export const getTokenMessages: Handler = async (req) => {
  const tokenAddress = req.params.address!;
  const room = await getOrCreateTokenRoom(tokenAddress);
  const since = req.query.get('since') ?? undefined;
  const messages = await listMessages(room.id, since);
  return { status: 200, body: { room: { id: room.id, kind: room.kind, tokenAddress: room.tokenAddress }, messages: messages.map(serializeMessage) } };
};

export const postTokenMessage: Handler = async (req) => {
  try {
    const tokenAddress = req.params.address!;
    const room = await getOrCreateTokenRoom(tokenAddress);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const content = typeof body.content === 'string' ? body.content : '';
    const { walletAddress } = verifyWriteRequest(req.body, room.id, 'post', content);
    const message = await postMessage(room.id, walletAddress, escapeHtml(content));
    return { status: 201, body: { message: serializeMessage(message) } };
  } catch (err) {
    return errorToResponse(err);
  }
};

export const reportChatMessage: Handler = async (req) => {
  try {
    const messageId = req.params.messageId!;
    // The message id is already globally unique, so it — not a room id —
    // is what actually needs to be bound into the signature here; "msg"
    // is a fixed, documented scope segment, not a real room reference.
    const { walletAddress } = verifyWriteRequest(req.body, 'msg', 'report', messageId);
    const message = await reportMessage(messageId, walletAddress);
    return { status: 200, body: { message: serializeMessage(message) } };
  } catch (err) {
    return errorToResponse(err);
  }
};

export const checkModeratorStatus: Handler = (req) => {
  const walletAddress = req.query.get('walletAddress') ?? '';
  // Read-only, no signature needed — this only reveals whether ONE
  // already-known address is on the allowlist, the same information
  // anyone would learn anyway the instant that address tries (and either
  // succeeds or gets a 403 from) a real delete. Purely a UI affordance:
  // the real authorization check lives in deleteChatMessage regardless
  // of what this returns.
  return { status: 200, body: { isModerator: isModerator(walletAddress) } };
};

export const deleteChatMessage: Handler = async (req) => {
  try {
    const messageId = req.params.messageId!;
    // DELETE requests are not guaranteed to carry a parsed body — the
    // shared router (router.ts) only reads a request body for POST/PUT,
    // a pre-existing limitation this feature works within rather than
    // widening (changing shared router behavior for every route is a
    // bigger footprint than this feature needs). Query params are read
    // for every method, so the signed fields travel there instead —
    // also more broadly HTTP-idiomatic, since a DELETE body is
    // inconsistently supported across HTTP tooling in general.
    const fields = {
      walletAddress: req.query.get('walletAddress'),
      signature: req.query.get('signature'),
      timestamp: req.query.get('timestamp') !== null ? Number(req.query.get('timestamp')) : undefined,
    };
    const { walletAddress } = verifyWriteRequest(fields, 'msg', 'delete', messageId);
    if (!isModerator(walletAddress)) {
      return { status: 403, body: { error: 'UNAUTHORIZED', message: 'Only an authorized moderator can remove a message.' } };
    }
    const message = await deleteMessage(messageId, walletAddress);
    return { status: 200, body: { message: serializeMessage(message) } };
  } catch (err) {
    return errorToResponse(err);
  }
};
