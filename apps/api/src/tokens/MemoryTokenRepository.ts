import crypto from 'node:crypto';
import type {
  TokenRepository,
  TokenRecord,
  RegisterTokenInput,
  TokenMetadataRecord,
  HolderRecord,
  RecentTokensPage,
} from './TokenRepository.js';
import { TokenValidationError } from './TokenRepository.js';

function validateRegisterInput(input: RegisterTokenInput): void {
  if (!input.chain) throw new TokenValidationError('chain is required.');
  if (!input.address) throw new TokenValidationError('address is required.');
  if (!input.name || !input.symbol) throw new TokenValidationError('name and symbol are required.');
  if (!Number.isInteger(input.decimals) || input.decimals < 0) {
    throw new TokenValidationError('decimals must be a non-negative integer.');
  }
  if (!input.creatorWalletAddress) throw new TokenValidationError('creatorWalletAddress is required.');
}

/** Real, working, in-process — same honest limits as MemoryChatRepository:
 *  genuinely there for as long as this process runs, gone on restart,
 *  the only implementation ever actually exercised against real requests. */
export class MemoryTokenRepository implements TokenRepository {
  private tokens = new Map<string, TokenRecord>(); // key: `${chain}:${address}`
  private metadata = new Map<string, TokenMetadataRecord>(); // key: tokenId
  private holders = new Map<string, HolderRecord[]>(); // key: tokenId

  private key(chain: string, address: string): string {
    return `${chain}:${address}`;
  }

  async registerToken(input: RegisterTokenInput): Promise<TokenRecord> {
    validateRegisterInput(input);
    const key = this.key(input.chain, input.address);
    const existing = this.tokens.get(key);
    if (existing) return existing;

    const record: TokenRecord = {
      id: crypto.randomUUID(),
      chain: input.chain,
      address: input.address,
      name: input.name,
      symbol: input.symbol,
      decimals: input.decimals,
      creatorWalletAddress: input.creatorWalletAddress,
      createdAt: new Date().toISOString(),
    };
    this.tokens.set(key, record);
    return record;
  }

  async getTokenByAddress(chain: string, address: string): Promise<TokenRecord | null> {
    return this.tokens.get(this.key(chain, address)) ?? null;
  }

  async listTokensByCreator(creatorWalletAddress: string): Promise<TokenRecord[]> {
    return Array.from(this.tokens.values()).filter((t) => t.creatorWalletAddress === creatorWalletAddress);
  }

  /** Sort key: (createdAt DESC, id DESC) — the id tiebreaker matters
   *  because two tokens registered in the same millisecond would
   *  otherwise have an undefined relative order, which could silently
   *  duplicate or skip a row across a page boundary. The cursor itself
   *  is just the id (globally unique) — resuming means "the row right
   *  after this id, in this same sort order," matching Prisma's own
   *  native cursor-pagination pattern (cursor + skip: 1) so both
   *  implementations share one external cursor format. */
  async listRecentTokens(limit: number, cursor?: string | null): Promise<RecentTokensPage> {
    const sorted = Array.from(this.tokens.values()).sort((a, b) => {
      if (a.createdAt !== b.createdAt) return b.createdAt.localeCompare(a.createdAt);
      return b.id.localeCompare(a.id);
    });

    let startIndex = 0;
    if (cursor) {
      const cursorIndex = sorted.findIndex((t) => t.id === cursor);
      startIndex = cursorIndex === -1 ? sorted.length : cursorIndex + 1;
    }

    const page = sorted.slice(startIndex, startIndex + limit);
    const last = page[page.length - 1];
    const hasMore = startIndex + limit < sorted.length;
    return {
      tokens: page,
      nextCursor: hasMore && last ? last.id : null,
    };
  }

  async getTokenMetadata(tokenId: string): Promise<TokenMetadataRecord | null> {
    return this.metadata.get(tokenId) ?? null;
  }

  /** Simple, case-insensitive substring match — no fuzzy/ranked
   *  logic, as scoped. Checks name, symbol, and address; a match on
   *  any one is enough. */
  async searchTokens(query: string, limit: number): Promise<TokenRecord[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return Array.from(this.tokens.values())
      .filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.symbol.toLowerCase().includes(q) ||
          t.address.toLowerCase().includes(q)
      )
      .slice(0, limit);
  }

  async saveIndexedData(tokenId: string, metadata: TokenMetadataRecord, holders: HolderRecord[]): Promise<void> {
    this.metadata.set(tokenId, metadata);
    this.holders.set(tokenId, holders);
  }

  /** Test-only. Never called from any real route handler. */
  __resetForTests(): void {
    this.tokens.clear();
    this.metadata.clear();
    this.holders.clear();
  }
}
