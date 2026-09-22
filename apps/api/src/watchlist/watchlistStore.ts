import { MemoryWatchlistRepository } from './MemoryWatchlistRepository.js';
import { PrismaWatchlistRepository } from './PrismaWatchlistRepository.js';
import type { WatchlistRepository } from './WatchlistRepository.js';
export {
  WatchlistValidationError,
  WatchlistUnauthorizedError,
} from './WatchlistRepository.js';
import { getSharedPrismaClient } from '../db/prismaClient.js';

let activeRepository: WatchlistRepository = new MemoryWatchlistRepository();
let databaseReady = false;

export async function initializeStorage(): Promise<void> {
  if (process.env.CHAT_STORAGE !== 'database') {
    return;
  }

  const prisma = await getSharedPrismaClient();
  activeRepository = new PrismaWatchlistRepository(prisma);
  databaseReady = true;
}

function resolveRepository(): WatchlistRepository {
  if (process.env.CHAT_STORAGE === 'database' && !databaseReady) {
    throw new Error(
      'Database watchlist storage requested but initializeStorage() has not completed.',
    );
  }

  return activeRepository;
}

export function listWatchlistItems(walletAddress: string) {
  return resolveRepository().listItems(walletAddress);
}

export function addWatchlistItem(walletAddress: string, value: string) {
  return resolveRepository().addItem(walletAddress, value);
}

export function removeWatchlistItem(walletAddress: string, itemId: string) {
  return resolveRepository().removeItem(walletAddress, itemId);
}

export function __resetForTests(): void {
  activeRepository = new MemoryWatchlistRepository();
  databaseReady = false;
}
