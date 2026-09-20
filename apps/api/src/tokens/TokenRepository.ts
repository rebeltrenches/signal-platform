/**
 * The persistence boundary for "which tokens exist and what's known
 * about them" — the real gap behind Explore and cross-device Dashboard
 * state both being placeholders today (see packages/types/src/index.ts's
 * own comment on TokenIdentity.launchedOnSignal: "a fact to fetch —
 * check the Token table for a matching row", not something to assume).
 *
 * Two implementations, same pattern as ChatRepository:
 *  - MemoryTokenRepository: real, working, in-process — the only one
 *    ever actually exercised against real requests.
 *  - PrismaTokenRepository: real logic, tested against a mock client
 *    only — never run against actual Postgres. Same stated limit as
 *    PrismaChatRepository, for the same reason (see that file).
 */

export interface TokenRecord {
  id: string;
  chain: string;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  creatorWalletAddress: string;
  createdAt: string;
}

export interface RegisterTokenInput {
  chain: string;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  creatorWalletAddress: string;
}

export interface TokenMetadataRecord {
  holderCount: number | null;
  top10HolderPercent: number | null;
  mintAuthorityActive: boolean | null;
  freezeAuthorityActive: boolean | null;
  lastIndexedAt: string | null;
}

export interface HolderRecord {
  address: string;
  /** bigint as a string — never a JS number for an on-chain amount,
   *  same "no float for money" rule as the tax module, and bigint
   *  itself doesn't survive JSON without this. */
  balance: string;
}

export interface RecentTokensPage {
  tokens: TokenRecord[];
  /** Pass this back as `cursor` to get the next page. Null means
   *  there is genuinely nothing more — never a placeholder for "maybe
   *  more, try again." */
  nextCursor: string | null;
}

export class TokenValidationError extends Error {}

export interface TokenRepository {
  /** Idempotent — registering the same (chain, address) twice returns
   *  the existing row rather than erroring or duplicating. */
  registerToken(input: RegisterTokenInput): Promise<TokenRecord>;
  getTokenByAddress(chain: string, address: string): Promise<TokenRecord | null>;
  listTokensByCreator(creatorWalletAddress: string): Promise<TokenRecord[]>;
  /** Newest-first, real pagination — for Explore's "New" tab. Returns
   *  only real, already-registered tokens; never fabricates a row to
   *  pad out a page. `cursor` (from a previous page's `nextCursor`)
   *  resumes strictly after that point — never re-includes an item
   *  the caller has already seen, and never skips one added in
   *  between pages that sorts after the cursor. */
  listRecentTokens(limit: number, cursor?: string | null): Promise<RecentTokensPage>;
  /** Simple, case-insensitive substring match on name, symbol, or
   *  address — deliberately not fuzzy or ranked. Returns real,
   *  already-registered tokens only; an empty result is a genuine "no
   *  matches," never padded or approximated. */
  searchTokens(query: string, limit: number): Promise<TokenRecord[]>;
  getTokenMetadata(tokenId: string): Promise<TokenMetadataRecord | null>;
  /** Replaces this token's cached Holder rows and TokenMetadata with
   *  freshly-fetched on-chain facts. Never called with fabricated
   *  data — see TokenIndexer, the only intended caller. */
  saveIndexedData(tokenId: string, metadata: TokenMetadataRecord, holders: HolderRecord[]): Promise<void>;
}
