/**
 * The active chat repository, chosen by CHAT_STORAGE. Defaults to
 * MemoryChatRepository (the real, working, in-process store this
 * project has run on throughout) unless CHAT_STORAGE=database AND
 * initializeStorage() below has actually run and succeeded — server.ts
 * calls it once, at startup, before the server begins accepting
 * requests (see its own "run directly" block). Every exported function
 * below stays exactly as synchronous as it already was: the one-time
 * async work (dynamically importing @prisma/client, connecting) happens
 * ONCE at startup, not on every call, so nothing calling these
 * functions — routes/chat.ts included — needs to change at all.
 *
 * routes/chat.ts calls the functions below exactly as it always has;
 * this module is the only thing that changed shape, not the security
 * logic that sits above it (signature verification, XSS-escaping) or
 * below it (rate limiting, moderation, validation - all unchanged,
 * now living in MemoryChatRepository/PrismaChatRepository).
 */
import type { ChatRepository } from './ChatRepository.js';
import { MemoryChatRepository, MAX_MESSAGE_LENGTH, RATE_LIMIT_MS } from './MemoryChatRepository.js';
import { PrismaChatRepository, type PrismaLikeClient } from './PrismaChatRepository.js';
import { getSharedPrismaClient } from '../db/prismaClient.js';

export { RateLimitError, ValidationError, UnauthorizedError } from './ChatRepository.js';
export type { ChatMessageRecord as ChatMessage, ChatRoomRecord as ChatRoomMeta } from './ChatRepository.js';
export { MAX_MESSAGE_LENGTH, RATE_LIMIT_MS };
export const SIGNATURE_MAX_AGE_MS = 60_000;

let activeRepository: ChatRepository = new MemoryChatRepository();
let databaseReady = false;

/**
 * Call once, at process startup, before serving any requests — never
 * from a request handler. A no-op unless CHAT_STORAGE=database. Throws
 * (rather than silently staying on memory) if the real connection
 * fails, since a requested database mode that quietly falls back to
 * memory is exactly the "wrong storage mode should never be a quiet
 * surprise" problem this design exists to avoid.
 */
export async function initializeStorage(): Promise<void> {
  if (process.env.CHAT_STORAGE !== 'database') return;
  const client = (await getSharedPrismaClient()) as PrismaLikeClient;
  activeRepository = new PrismaChatRepository(client);
  databaseReady = true;
}

function resolveRepository(): ChatRepository {
  if (process.env.CHAT_STORAGE === 'database' && !databaseReady) {
    throw new Error(
      'CHAT_STORAGE=database is set, but initializeStorage() has not run yet ' +
      '(or failed) in this process. It must be awaited once at startup, before ' +
      'the server begins accepting requests — see server.ts.'
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
 *  active (the only mode any existing test has ever actually run in). */
export function __resetForTests(): void {
  activeRepository = new MemoryChatRepository();
  databaseReady = false;
}
