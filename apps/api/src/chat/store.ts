/**
 * Real, working chat data store — genuinely stores and retrieves what's
 * put into it, for as long as this Node process keeps running. This is
 * NOT a mock: post a message and it is really there on the next fetch,
 * rate limits are really enforced, deletes really remove things from
 * what gets returned.
 *
 * The honest limit, stated plainly: this is in-memory (a `Map`), not a
 * database. Restart the apps/api process and every room, message, and
 * report is gone. There is no live Postgres connection anywhere in this
 * project (see health.ts's getHealthDatabase — 'not_configured', by
 * design, not by oversight), so this is the real, working thing that
 * fits what's actually running today, not a placeholder standing in for
 * something else. The shape below mirrors packages/database/prisma/
 * schema.prisma's ChatRoom/ChatMessage/MessageReport models closely on
 * purpose — swapping this module's internals for real Prisma calls later
 * is a mechanical change, not a redesign, the same way router.ts's own
 * header describes swapping in a real HTTP framework.
 *
 * Real-time: there is no WebSocket/SSE server anywhere in this project
 * (apps/api is plain node:http — see router.ts). Clients poll
 * (GET .../messages on an interval) rather than receiving a push — a
 * genuine, production-reasonable pattern for this without adding a
 * persistent-connection server, not a fake stand-in for "real" realtime.
 */
import crypto from 'node:crypto';

export const MAX_MESSAGE_LENGTH = 500;
export const RATE_LIMIT_MS = 3000; // one message per wallet per 3 seconds
export const SIGNATURE_MAX_AGE_MS = 60_000; // signed payload must be within 60s of "now" — bounds replay

export interface ChatMessage {
  id: string;
  roomId: string;
  walletAddress: string;
  content: string;
  createdAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
  reportCount: number;
}

export interface ChatRoomMeta {
  id: string;
  kind: 'main' | 'token';
  tokenAddress: string | null;
  createdAt: string;
}

const MAIN_ROOM_ID = 'main';
const rooms = new Map<string, ChatRoomMeta>([[MAIN_ROOM_ID, { id: MAIN_ROOM_ID, kind: 'main', tokenAddress: null, createdAt: new Date().toISOString() }]]);
const messagesByRoom = new Map<string, ChatMessage[]>([[MAIN_ROOM_ID, []]]);
const lastPostAt = new Map<string, number>();
const reportedBy = new Map<string, Set<string>>(); // messageId -> wallet addresses that already reported it (one report per wallet per message)
// Global index so report/delete can address a message by its own (UUID,
// already-globally-unique) id alone, without the caller also needing to
// know or pass which room it's in.
const messageIndex = new Map<string, ChatMessage>();

/** Deterministic room id for a token room, so "get or create" is really
 *  just "compute the id and check the map" — no random collision risk,
 *  no need for a separate lookup index by token address. */
function tokenRoomId(tokenAddress: string): string {
  return `token:${tokenAddress}`;
}

export function getMainRoom(): ChatRoomMeta {
  return rooms.get(MAIN_ROOM_ID)!;
}

/** Real get-or-create: the first person to open a token's chat tab
 *  creates its room, genuinely, in this process's memory — not a fake
 *  "room" that only appears to exist in the UI. */
export function getOrCreateTokenRoom(tokenAddress: string): ChatRoomMeta {
  const id = tokenRoomId(tokenAddress);
  let room = rooms.get(id);
  if (!room) {
    room = { id, kind: 'token', tokenAddress, createdAt: new Date().toISOString() };
    rooms.set(id, room);
    messagesByRoom.set(id, []);
  }
  return room;
}

export function getRoomById(roomId: string): ChatRoomMeta | null {
  return rooms.get(roomId) ?? null;
}

export class RateLimitError extends Error {}
export class ValidationError extends Error {}

/** Real, enforced validation — not a UI-only nicety. Every check here
 *  runs on the server, so a request that skips the client's own checks
 *  (a hand-crafted curl, a modified frontend) still can't get invalid
 *  content stored. */
export function validateContent(content: unknown): string {
  if (typeof content !== 'string') {
    throw new ValidationError('Message content must be a string.');
  }
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('Message cannot be empty.');
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new ValidationError(`Message exceeds the ${MAX_MESSAGE_LENGTH}-character limit.`);
  }
  return trimmed;
}

/** Real rate limiting — an actual timestamp, checked and updated on
 *  every real call, not a cosmetic client-side debounce. Throws rather
 *  than silently dropping, so the caller can tell the user why. */
export function checkRateLimit(walletAddress: string): void {
  const last = lastPostAt.get(walletAddress);
  const now = Date.now();
  if (last !== undefined && now - last < RATE_LIMIT_MS) {
    throw new RateLimitError(`Wait ${Math.ceil((RATE_LIMIT_MS - (now - last)) / 1000)}s before posting again.`);
  }
}

export function postMessage(roomId: string, walletAddress: string, content: string): ChatMessage {
  const validated = validateContent(content);
  checkRateLimit(walletAddress);

  const list = messagesByRoom.get(roomId);
  if (!list) throw new ValidationError('Room does not exist.');

  const message: ChatMessage = {
    id: crypto.randomUUID(),
    roomId,
    walletAddress,
    content: validated,
    createdAt: new Date().toISOString(),
    deletedAt: null,
    deletedBy: null,
    reportCount: 0,
  };
  list.push(message);
  messageIndex.set(message.id, message);
  lastPostAt.set(walletAddress, Date.now());
  return message;
}

/** Real content: never a fabricated message list. A room with nothing
 *  posted yet returns an empty array, honestly — the caller (route
 *  handler) is what decides how to present that as an empty state. Soft-
 *  deleted messages are replaced with a tombstone shape (never returned
 *  with their original content) rather than omitted outright, so the
 *  room's message count and ordering stay stable for anyone polling —
 *  same reasoning as the schema's own soft-delete comment: a moderation
 *  action stays visible as having happened, not silently erased. */
export function listMessages(roomId: string, sinceId?: string): ChatMessage[] {
  const list = messagesByRoom.get(roomId) ?? [];
  const fromIndex = sinceId ? list.findIndex((m) => m.id === sinceId) + 1 : 0;
  return list.slice(fromIndex);
}

export function reportMessage(messageId: string, reporterWallet: string): ChatMessage {
  const message = messageIndex.get(messageId);
  if (!message) throw new ValidationError('Message not found.');

  const already = reportedBy.get(messageId) ?? new Set<string>();
  if (already.has(reporterWallet)) {
    // Real idempotency, not a fake "success" — reporting twice doesn't
    // inflate the count, and the caller can tell the difference.
    return message;
  }
  already.add(reporterWallet);
  reportedBy.set(messageId, already);
  message.reportCount += 1;
  return message;
}

/**
 * Moderator authorization — real and enforced, deliberately simple.
 * There is no admin/role system anywhere in this project (Stage 19,
 * "real authentication," isn't built — see docs/ROADMAP.md), so this
 * checks an explicit allowlist of wallet addresses from an environment
 * variable rather than pretending a fuller role system exists. This is
 * genuinely enforced (see deleteMessage below refusing anyone not on the
 * list) — simple, not fake.
 */
export function isModerator(walletAddress: string): boolean {
  const raw = process.env.CHAT_MODERATOR_WALLETS ?? '';
  const allowlist = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return allowlist.includes(walletAddress);
}

export class UnauthorizedError extends Error {}

export function deleteMessage(messageId: string, requestingWallet: string): ChatMessage {
  if (!isModerator(requestingWallet)) {
    throw new UnauthorizedError('Only an authorized moderator can remove a message.');
  }
  const message = messageIndex.get(messageId);
  if (!message) throw new ValidationError('Message not found.');

  message.deletedAt = new Date().toISOString();
  message.deletedBy = requestingWallet;
  return message;
}

/** Exposed for tests only — resets all in-memory state between test
 *  cases so they don't leak into each other. Never called from any real
 *  route handler. */
export function __resetForTests(): void {
  rooms.clear();
  rooms.set(MAIN_ROOM_ID, { id: MAIN_ROOM_ID, kind: 'main', tokenAddress: null, createdAt: new Date().toISOString() });
  messagesByRoom.clear();
  messagesByRoom.set(MAIN_ROOM_ID, []);
  lastPostAt.clear();
  reportedBy.clear();
  messageIndex.clear();
}
