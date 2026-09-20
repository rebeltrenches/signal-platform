/**
 * The persistence boundary for watchlist entries — the piece
 * apps/web/src/client/watchlist.js's own comment names directly: "A
 * watchlist that syncs across devices needs a real account system
 * (Stage 19) and a database (Stage 2)". Both now exist; this is what
 * connects them.
 *
 * Matches the client's ACTUAL data shape, not an imagined richer one:
 * watchlist.js stores a plain array of raw strings the user typed
 * (checked directly before writing this) — no chain field, no
 * distinction between "this is a token" vs "this is a wallet". The
 * schema's Watchlist.walletAddress field (a free-text string, no FK)
 * is the natural fit for that, regardless of what the string actually
 * represents.
 *
 * Same two-implementation pattern as ChatRepository/TokenRepository:
 *  - MemoryWatchlistRepository: real, working, in-process.
 *  - PrismaWatchlistRepository: real logic, tested against a mock
 *    client only — never run against actual Postgres.
 */

export interface WatchlistItemRecord {
  id: string;
  ownerWalletAddress: string;
  value: string;
  createdAt: string;
}

export class WatchlistValidationError extends Error {}
export class WatchlistUnauthorizedError extends Error {}

export interface WatchlistRepository {
  /** Idempotent — adding a value already on this owner's watchlist
   *  returns the existing record rather than creating a duplicate,
   *  matching watchlist.js's own existing dedupe behavior. */
  addItem(ownerWalletAddress: string, value: string): Promise<WatchlistItemRecord>;
  /** Throws WatchlistUnauthorizedError if the item exists but belongs
   *  to a DIFFERENT owner — an explicit, testable check, not a silent
   *  no-op, since "nothing happened because it wasn't there" and
   *  "nothing happened because the ownership check blocked it" need to
   *  be distinguishable to actually verify enforcement. A no-op is
   *  correct only when the item genuinely doesn't exist at all. */
  removeItem(ownerWalletAddress: string, itemId: string): Promise<void>;
  listItems(ownerWalletAddress: string): Promise<WatchlistItemRecord[]>;
}
