/**
 * The active chat repository, chosen by CHAT_STORAGE. Defaults to
 * MemoryChatRepository (the real, working, in-process store this
 * project has run on throughout) unless CHAT_STORAGE=database AND a
 * real Prisma client is actually wired in below — which it isn't yet,
 * deliberately: no Prisma client has ever been generated anywhere this
 * project has been built (no internet to install the `prisma` CLI), so
 * there is nothing real to construct here. Setting CHAT_STORAGE=database
 * without that wiring throws loudly at startup rather than silently
 * falling back to memory — a wrong storage mode should never be a quiet
 * surprise in production.
 *
 * routes/chat.ts calls the functions below exactly as it always has;
 * this module is the only thing that changed shape, not the security
 * logic that sits above it (signature verification, XSS-escaping) or
 * below it (rate limiting, moderation, validation - all unchanged,
 * now living in MemoryChatRepository/PrismaChatRepository).
 */
import type { ChatRepository } from './ChatRepository.js';
import { MemoryChatRepository, MAX_MESSAGE_LENGTH, RATE_LIMIT_MS } from './MemoryChatRepository.js';

export { RateLimitError, ValidationError, UnauthorizedError } from './ChatRepository.js';
export type { ChatMessageRecord as ChatMessage, ChatRoomRecord as ChatRoomMeta } from './ChatRepository.js';
export { MAX_MESSAGE_LENGTH, RATE_LIMIT_MS };
export const SIGNATURE_MAX_AGE_MS = 60_000;

let activeRepository: ChatRepository = new MemoryChatRepository();

function resolveRepository(): ChatRepository {
  if (process.env.CHAT_STORAGE === 'database') {
    // Intentionally throws: see the module doc above for why this isn't
    // a silent fallback. Wiring a real PrismaClient in here is the one
    // remaining step, and it needs a real Postgres instance + a real
    // `prisma generate` run — neither possible in this sandbox.
    throw new Error(
      'CHAT_STORAGE=database is set, but no real Prisma client is wired in. ' +
      'PrismaChatRepository exists and is tested against a mock, but has never run ' +
      'against a real Postgres instance — construct a real PrismaClient and pass it ' +
      'to PrismaChatRepository where this repository is chosen, then remove this guard.'
    );
  }
  return activeRepository;
}

export function getMainRoom() {
  return resolveRepository().getMainRoom();
}
export function getOrCreateTokenRoom(tokenAddress: string) {
  return resolveRepository().getOrCreateTokenRoom(tokenAddress);
}
export function getRoomById(roomId: string) {
  return resolveRepository().getRoomById(roomId);
}
export function postMessage(roomId: string, walletAddress: string, content: string) {
  return resolveRepository().postMessage(roomId, walletAddress, content);
}
export function listMessages(roomId: string, sinceId?: string) {
  return resolveRepository().listMessages(roomId, sinceId);
}
export function reportMessage(messageId: string, reporterWallet: string) {
  return resolveRepository().reportMessage(messageId, reporterWallet);
}
export function deleteMessage(messageId: string, requestingWallet: string) {
  return resolveRepository().deleteMessage(messageId, requestingWallet);
}
export function isModerator(walletAddress: string): boolean {
  return resolveRepository().isModerator(walletAddress);
}

/** Test-only — resets the active in-memory repository. Never called
 *  from any real route handler. Only meaningful when memory storage is
 *  active (the only mode this has ever actually run in). */
export function __resetForTests(): void {
  activeRepository = new MemoryChatRepository();
}
