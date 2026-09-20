/**
 * The persistence boundary for chat. This interface is exactly the
 * public surface store.ts already exposed — extracted, not redesigned,
 * so routes/chat.ts (which owns signature verification and XSS-escaping
 * — the actual security logic) needs zero changes regardless of which
 * implementation is wired in behind it.
 *
 * Two implementations exist:
 *  - MemoryChatRepository: today's real, working Map-based store,
 *    behavior-identical to what shipped before this refactor. The
 *    default, and the only one actually exercised against real
 *    requests anywhere this has run.
 *  - PrismaChatRepository: real repository logic, tested against a
 *    mock client (see chat-repository.test.ts) — but never run against
 *    an actual Postgres instance. That is a real, stated limit, not
 *    something to gloss over: no live Postgres exists anywhere this
 *    project has been built or tested.
 */

export interface ChatMessageRecord {
  id: string;
  roomId: string;
  walletAddress: string;
  content: string;
  createdAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
  reportCount: number;
}

export interface ChatRoomRecord {
  id: string;
  kind: 'main' | 'token';
  tokenAddress: string | null;
  createdAt: string;
}

export class RateLimitError extends Error {}
export class ValidationError extends Error {}
export class UnauthorizedError extends Error {}

export interface ChatRepository {
  getMainRoom(): Promise<ChatRoomRecord>;
  getOrCreateTokenRoom(tokenAddress: string): Promise<ChatRoomRecord>;
  getRoomById(roomId: string): Promise<ChatRoomRecord | null>;

  /** Throws RateLimitError or ValidationError — never silently drops a message. */
  postMessage(roomId: string, walletAddress: string, content: string): Promise<ChatMessageRecord>;
  listMessages(roomId: string, sinceId?: string): Promise<ChatMessageRecord[]>;

  /** Idempotent — a second report from the same wallet on the same message is a no-op, not an error. */
  reportMessage(messageId: string, reporterWallet: string): Promise<ChatMessageRecord>;

  /** Throws UnauthorizedError if walletAddress isn't on the moderator allowlist. */
  deleteMessage(messageId: string, requestingWallet: string): Promise<ChatMessageRecord>;

  isModerator(walletAddress: string): boolean;
}
