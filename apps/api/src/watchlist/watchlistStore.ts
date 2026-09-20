import { MemoryWatchlistRepository } from './MemoryWatchlistRepository.js';
import { PrismaWatchlistRepository } from './PrismaWatchlistRepository.js';
import type { WatchlistRepository } from './WatchlistRepository.js';
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

export function listWatchlist(walletAddress: string) {
  return resolveRepository().listWatchlist(walletAddress);
}

export function addToWatchlist(walletAddress: string, tokenAddress: string) {
  return resolveRepository().addToWatchlist(walletAddress, tokenAddress);
}

export function removeFromWatchlist(walletAddress: string, tokenAddress: string) {
  return resolveRepository().removeFromWatchlist(walletAddress, tokenAddress);
}

export function __resetForTests(): void {
  activeRepository = new MemoryWatchlistRepository();
  databaseReady = false;
}
