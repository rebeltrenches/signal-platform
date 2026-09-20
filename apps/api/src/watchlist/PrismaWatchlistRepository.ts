import type { WatchlistRepository, WatchlistItemRecord } from './WatchlistRepository.js';
import { WatchlistValidationError, WatchlistUnauthorizedError } from './WatchlistRepository.js';
import { ensureUserForWallet, type UserCapableClient } from '../db/ensureWallet.js';

/**
 * The narrow slice of a real Prisma client this repository calls —
 * loosely typed for the same reason as every other Prisma*Repository
 * in this project (PrismaChatRepository, PrismaTokenRepository): no
 * @prisma/client has ever been generated anywhere this project has
 * been built, so there is no generated-types file to import against.
 */
export interface WatchlistPrismaLikeClient extends UserCapableClient {
  watchlist: {
    findFirst(args: any): Promise<any>;
    findUnique(args: any): Promise<any>;
    findMany(args: any): Promise<any[]>;
    create(args: any): Promise<any>;
    delete(args: any): Promise<any>;
  };
}

function mapItem(row: any, ownerWalletAddress: string): WatchlistItemRecord {
  return {
    id: row.id,
    ownerWalletAddress,
    value: row.walletAddress,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

/**
 * Real repository logic against the EXISTING schema — zero schema
 * changes, same discipline as every prior Prisma*Repository.
 * Watchlist.userId requires a real User row exactly like
 * ChatMessage/Token did; ensureUserForWallet() (shared, db/ensureWallet.ts)
 * resolves it. The schema's Watchlist.walletAddress field (free text,
 * no FK) is used to store whatever raw string the client sends — it
 * doesn't have to actually be a wallet address, matching the client's
 * own real behavior (checked directly against watchlist.js before
 * writing this).
 *
 * NEVER RUN AGAINST A REAL DATABASE. Tested via a mock
 * WatchlistPrismaLikeClient only.
 */
export class PrismaWatchlistRepository implements WatchlistRepository {
  constructor(private readonly db: WatchlistPrismaLikeClient) {}

  async addItem(ownerWalletAddress: string, value: string): Promise<WatchlistItemRecord> {
    const trimmed = value.trim();
    if (!ownerWalletAddress) throw new WatchlistValidationError('ownerWalletAddress is required.');
    if (!trimmed) throw new WatchlistValidationError('value cannot be empty.');

    const userId = await ensureUserForWallet(this.db, ownerWalletAddress);
    const existing = await this.db.watchlist.findFirst({ where: { userId, walletAddress: trimmed } });
    if (existing) return mapItem(existing, ownerWalletAddress);

    const created = await this.db.watchlist.create({ data: { userId, walletAddress: trimmed } });
    return mapItem(created, ownerWalletAddress);
  }

  async removeItem(ownerWalletAddress: string, itemId: string): Promise<void> {
    const item = await this.db.watchlist.findUnique({ where: { id: itemId }, include: { user: { include: { wallets: true } } } });
    if (!item) return; // genuinely doesn't exist — a real no-op

    const ownerWallets: any[] = item.user?.wallets ?? [];
    const isOwner = ownerWallets.some((w: any) => w.address === ownerWalletAddress);
    if (!isOwner) {
      throw new WatchlistUnauthorizedError('This watchlist item does not belong to the requesting wallet.');
    }
    await this.db.watchlist.delete({ where: { id: itemId } });
  }

  async listItems(ownerWalletAddress: string): Promise<WatchlistItemRecord[]> {
    const userId = await ensureUserForWallet(this.db, ownerWalletAddress);
    const rows = await this.db.watchlist.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => mapItem(r, ownerWalletAddress));
  }
}
