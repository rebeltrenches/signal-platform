import type { WalletIntelligenceRepository } from './WalletIntelligenceRepository.js';
import { PrismaWalletIntelligenceRepository, type WalletIntelligencePrismaLikeClient } from './PrismaWalletIntelligenceRepository.js';
import { getSharedPrismaClient } from '../db/prismaClient.js';

let repository: WalletIntelligenceRepository | null = null;

export async function initializeWalletIntelligenceStorage(): Promise<void> {
  if (process.env.CHAT_STORAGE !== 'database') return;
  const db = (await getSharedPrismaClient()) as WalletIntelligencePrismaLikeClient;
  repository = new PrismaWalletIntelligenceRepository(db);
}

export async function getWalletIntelligence(chain: string, address: string) {
  // Wallet Intelligence is intentionally database-backed only. Returning
  // a fake in-memory wallet would undermine the evidence guarantees.
  if (!repository) {
    if (process.env.CHAT_STORAGE !== 'database') return null;
    throw new Error('Database wallet intelligence storage requested but initializeWalletIntelligenceStorage() has not completed.');
  }
  return repository.getWallet(chain, address);
}
