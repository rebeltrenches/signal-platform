import { MemoryTokenRepository } from './MemoryTokenRepository.js';
import { PrismaTokenRepository } from './PrismaTokenRepository.js';
import type { TokenRepository } from './TokenRepository.js';
export { TokenValidationError } from './TokenRepository.js';
import { getSharedPrismaClient } from '../db/prismaClient.js';

let activeRepository: TokenRepository = new MemoryTokenRepository();
let databaseReady = false;

export async function initializeStorage(): Promise<void> {
  if (process.env.CHAT_STORAGE !== 'database') {
    return;
  }

  const prisma = await getSharedPrismaClient();
  activeRepository = new PrismaTokenRepository(prisma);
  databaseReady = true;
}

function resolveRepository(): TokenRepository {
  if (process.env.CHAT_STORAGE === 'database' && !databaseReady) {
    throw new Error(
      'Database token storage requested but initializeStorage() has not completed.',
    );
  }

  return activeRepository;
}

export function registerToken(
  input: import('./TokenRepository.js').RegisterTokenInput,
) {
  return resolveRepository().registerToken(input);
}

export function getTokenByAddress(chain: string, address: string) {
  return resolveRepository().getTokenByAddress(chain, address);
}

export function listTokensByCreator(creatorWalletAddress: string) {
  return resolveRepository().listTokensByCreator(creatorWalletAddress);
}

export function listRecentTokens(limit: number, cursor?: string | null) {
  return resolveRepository().listRecentTokens(limit, cursor);
}

export function searchTokens(query: string, limit: number) {
  return resolveRepository().searchTokens(query, limit);
}

export function getTokenMetadata(tokenId: string) {
  return resolveRepository().getTokenMetadata(tokenId);
}

export function __resetForTests(): void {
  activeRepository = new MemoryTokenRepository();
  databaseReady = false;
}
