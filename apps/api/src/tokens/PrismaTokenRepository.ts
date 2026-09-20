import type { TokenRepository, TokenRecord, RegisterTokenInput, TokenMetadataRecord, HolderRecord, RecentTokensPage } from './TokenRepository.js';
import { TokenValidationError } from './TokenRepository.js';
import { ensureWallet, type WalletCapableClient } from '../db/ensureWallet.js';

/**
 * The narrow slice of a real Prisma client this repository calls —
 * loosely typed for the same reason as PrismaChatRepository's
 * PrismaLikeClient (see that file): no @prisma/client has ever been
 * generated anywhere this project has been built, so there is no
 * generated-types file to import against. Tested against a mock
 * implementing this exact interface (token-repository.test.ts).
 */
export interface TokenPrismaLikeClient extends WalletCapableClient {
  token: {
    findUnique(args: any): Promise<any>;
    findMany(args: any): Promise<any[]>;
    create(args: any): Promise<any>;
  };
  tokenMetadata: {
    upsert(args: any): Promise<any>;
    findUnique(args: any): Promise<any>;
  };
  holder: {
    deleteMany(args: any): Promise<any>;
    createMany(args: any): Promise<any>;
  };
}

function mapToken(row: any): TokenRecord {
  return {
    id: row.id,
    chain: row.chain,
    address: row.address,
    name: row.name,
    symbol: row.symbol,
    decimals: row.decimals,
    creatorWalletAddress: row.creator?.address ?? row.creatorWalletAddress,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

function mapMetadata(row: any): TokenMetadataRecord | null {
  if (!row) return null;
  return {
    holderCount: row.holderCount ?? null,
    top10HolderPercent: row.top10HolderPercent !== null && row.top10HolderPercent !== undefined ? Number(row.top10HolderPercent) : null,
    mintAuthorityActive: row.mintAuthorityActive ?? null,
    freezeAuthorityActive: row.freezeAuthorityActive ?? null,
    lastIndexedAt: row.lastIndexedAt ? (row.lastIndexedAt instanceof Date ? row.lastIndexedAt.toISOString() : row.lastIndexedAt) : null,
  };
}

/**
 * Real repository logic against the EXISTING schema — zero schema
 * changes, same discipline as PrismaChatRepository. Token.creatorId
 * requires a Wallet row exactly like ChatMessage.authorWalletId did;
 * the same ensureWallet() (now shared — see db/ensureWallet.ts)
 * resolves it.
 *
 * Deliberately does NOT create a Launch row when registering a token.
 * The Launch model (bondingCurve, graduation, creatorAllocationBps,
 * launchAllocationBps) encodes a bonding-curve launch mechanism that
 * doesn't exist yet (Stage 8, still notImplemented in server.ts) and
 * doesn't describe what the current fixed-supply direct-mint flow
 * actually does. Forcing values into those fields to satisfy the
 * schema would be fabricating a launch mechanism that isn't real —
 * exactly what this project's whole "never fabricate" discipline
 * argues against. Token registration stands on its own; Launch can be
 * added truthfully once Stage 8 exists.
 *
 * NEVER RUN AGAINST A REAL DATABASE. Tested via a mock
 * TokenPrismaLikeClient only (token-repository.test.ts).
 */
export class PrismaTokenRepository implements TokenRepository {
  constructor(private readonly db: TokenPrismaLikeClient) {}

  async registerToken(input: RegisterTokenInput): Promise<TokenRecord> {
    if (!input.chain || !input.address || !input.name || !input.symbol || !input.creatorWalletAddress) {
      throw new TokenValidationError('chain, address, name, symbol, and creatorWalletAddress are required.');
    }
    const existing = await this.db.token.findUnique({
      where: { chain_address: { chain: input.chain, address: input.address } },
      include: { creator: true },
    });
    if (existing) return mapToken(existing);

    const wallet = await ensureWallet(this.db, input.creatorWalletAddress);
    const created = await this.db.token.create({
      data: {
        chain: input.chain,
        address: input.address,
        name: input.name,
        symbol: input.symbol,
        decimals: input.decimals,
        totalSupply: '0', // not known at registration time; the indexer fills this in on first refresh
        creatorId: wallet.id,
      },
    });
    return mapToken({ ...created, creator: { address: input.creatorWalletAddress } });
  }

  async getTokenByAddress(chain: string, address: string): Promise<TokenRecord | null> {
    const row = await this.db.token.findUnique({ where: { chain_address: { chain, address } }, include: { creator: true } });
    return row ? mapToken(row) : null;
  }

  async listTokensByCreator(creatorWalletAddress: string): Promise<TokenRecord[]> {
    const wallet = await ensureWallet(this.db, creatorWalletAddress);
    const rows = await this.db.token.findMany({ where: { creatorId: wallet.id }, include: { creator: true } });
    return rows.map(mapToken);
  }

  /** Prisma's own native cursor pagination (cursor + skip: 1) — the
   *  cursor is a row's real id, resuming means "the row right after
   *  this one in the given orderBy," which Prisma implements directly
   *  rather than needing a hand-rolled WHERE comparison. orderBy on
   *  (createdAt desc, id desc) for the same tiebreaker reasoning as
   *  MemoryTokenRepository. */
  async listRecentTokens(limit: number, cursor?: string | null): Promise<RecentTokensPage> {
    const rows = await this.db.token.findMany({
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { creator: true },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      tokens: page.map(mapToken),
      nextCursor: hasMore && last ? last.id : null,
    };
  }

  async getTokenMetadata(tokenId: string): Promise<TokenMetadataRecord | null> {
    const row = await this.db.tokenMetadata.findUnique({ where: { tokenId } });
    return mapMetadata(row);
  }

  /** Simple, case-insensitive substring match via Prisma's own
   *  `contains`/`mode: 'insensitive'` — a real, standard Postgres/
   *  Prisma pattern, not a hand-rolled approximation. No fuzzy/ranked
   *  logic, as scoped. */
  async searchTokens(query: string, limit: number): Promise<TokenRecord[]> {
    const q = query.trim();
    if (!q) return [];
    const rows = await this.db.token.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { symbol: { contains: q, mode: 'insensitive' } },
          { address: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: limit,
      include: { creator: true },
    });
    return rows.map(mapToken);
  }

  async saveIndexedData(tokenId: string, metadata: TokenMetadataRecord, holders: HolderRecord[]): Promise<void> {
    await this.db.tokenMetadata.upsert({
      where: { tokenId },
      create: {
        tokenId,
        holderCount: metadata.holderCount,
        top10HolderPercent: metadata.top10HolderPercent,
        mintAuthorityActive: metadata.mintAuthorityActive,
        freezeAuthorityActive: metadata.freezeAuthorityActive,
        lastIndexedAt: new Date(),
      },
      update: {
        holderCount: metadata.holderCount,
        top10HolderPercent: metadata.top10HolderPercent,
        mintAuthorityActive: metadata.mintAuthorityActive,
        freezeAuthorityActive: metadata.freezeAuthorityActive,
        lastIndexedAt: new Date(),
      },
    });
    // Replace-all rather than diff/merge: a holder list is a point-in-
    // time snapshot from the indexer, not something callers partially
    // update — same reasoning as MemoryTokenRepository's Map overwrite.
    await this.db.holder.deleteMany({ where: { tokenId } });
    if (holders.length > 0) {
      await this.db.holder.createMany({
        data: holders.map((h) => ({ tokenId, address: h.address, balance: h.balance })),
      });
    }
  }
}
