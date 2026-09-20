/**
 * The active watchlist repository, chosen by CHAT_STORAGE (the same
 * variable every other store facade in this project reads). Same
 * defaulting and loud-throw-rather-than-silent-fallback behavior as
 * chat/store.ts and tokens/tokenStore.ts — see chat/store.ts's header
 * for the full reasoning, which applies identically here.
 */
import type { WatchlistRepository } from './WatchlistRepository.js';
import { MemoryWatchlistRepository } from './MemoryWatchlistRepository.js';

export { WatchlistValidationError, WatchlistUnauthorizedError } from './WatchlistRepository.js';
export type { WatchlistItemRecord } from './WatchlistRepository.js';

let activeRepository: WatchlistRepository = new MemoryWatchlistRepository();

function resolveRepository(): WatchlistRepository {
  if (process.env.CHAT_STORAGE === 'database') {
    throw new Error(
      'CHAT_STORAGE=database is set, but no real Prisma client is wired in for watchlists. ' +
      'PrismaWatchlistRepository exists and is tested against a mock, but has never run ' +
      'against a real Postgres instance — see docs/BACKEND-DEPLOYMENT.md.'
    );
  }
  return activeRepository;
}

export function addWatchlistItem(ownerWalletAddress: string, value: string) {
  return resolveRepository().addItem(ownerWalletAddress, value);
}
export function removeWatchlistItem(ownerWalletAddress: string, itemId: string) {
  return resolveRepository().removeItem(ownerWalletAddress, itemId);
}
export function listWatchlistItems(ownerWalletAddress: string) {
  return resolveRepository().listItems(ownerWalletAddress);
}

/** Test-only. Never called from any real route handler. */
export function __resetForTests(): void {
  activeRepository = new MemoryWatchlistRepository();
}
