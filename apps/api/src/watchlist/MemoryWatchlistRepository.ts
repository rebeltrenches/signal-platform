import crypto from 'node:crypto';
import type { WatchlistRepository, WatchlistItemRecord } from './WatchlistRepository.js';
import { WatchlistValidationError, WatchlistUnauthorizedError } from './WatchlistRepository.js';

/** Real, working, in-process — same honest limits as every other
 *  Memory* repository in this project: genuinely there for as long as
 *  this process runs, gone on restart. */
export class MemoryWatchlistRepository implements WatchlistRepository {
  private items = new Map<string, WatchlistItemRecord>(); // id -> record

  async addItem(ownerWalletAddress: string, value: string): Promise<WatchlistItemRecord> {
    const trimmed = value.trim();
    if (!ownerWalletAddress) throw new WatchlistValidationError('ownerWalletAddress is required.');
    if (!trimmed) throw new WatchlistValidationError('value cannot be empty.');

    const existing = Array.from(this.items.values()).find(
      (i) => i.ownerWalletAddress === ownerWalletAddress && i.value === trimmed
    );
    if (existing) return existing;

    const record: WatchlistItemRecord = {
      id: crypto.randomUUID(),
      ownerWalletAddress,
      value: trimmed,
      createdAt: new Date().toISOString(),
    };
    this.items.set(record.id, record);
    return record;
  }

  async removeItem(ownerWalletAddress: string, itemId: string): Promise<void> {
    const item = this.items.get(itemId);
    if (!item) return; // genuinely doesn't exist — a real no-op
    if (item.ownerWalletAddress !== ownerWalletAddress) {
      throw new WatchlistUnauthorizedError('This watchlist item does not belong to the requesting wallet.');
    }
    this.items.delete(itemId);
  }

  async listItems(ownerWalletAddress: string): Promise<WatchlistItemRecord[]> {
    return Array.from(this.items.values())
      .filter((i) => i.ownerWalletAddress === ownerWalletAddress)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Test-only. Never called from any real route handler. */
  __resetForTests(): void {
    this.items.clear();
  }
}
