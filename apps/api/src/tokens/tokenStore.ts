/**
 * The active token repository, chosen by CHAT_STORAGE (the same
 * variable chat's store.ts reads — one storage-mode switch for the
 * whole API, not two independently-configured ones). Same defaulting
 * and same loud-throw-rather-than-silent-fallback behavior as chat's
 * store.ts — see that file's header for the full reasoning, which
 * applies identically here.
 */
import type { TokenRepository } from './TokenRepository.js';
import { MemoryTokenRepository } from './MemoryTokenRepository.js';

export { TokenValidationError } from './TokenRepository.js';
export type { TokenRecord, RegisterTokenInput, TokenMetadataRecord, HolderRecord, RecentTokensPage } from './TokenRepository.js';

let activeRepository: TokenRepository = new MemoryTokenRepository();

function resolveRepository(): TokenRepository {
  if (process.env.CHAT_STORAGE === 'database') {
    throw new Error(
      'CHAT_STORAGE=database is set, but no real Prisma client is wired in for tokens. ' +
      'PrismaTokenRepository exists and is tested against a mock, but has never run ' +
      'against a real Postgres instance — see docs/BACKEND-DEPLOYMENT.md.'
    );
  }
  return activeRepository;
}

export function registerToken(input: import('./TokenRepository.js').RegisterTokenInput) {
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

/** Test-only. Never called from any real route handler. */
export function __resetForTests(): void {
  activeRepository = new MemoryTokenRepository();
}
