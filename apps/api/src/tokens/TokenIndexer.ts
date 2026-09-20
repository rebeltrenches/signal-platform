import type { TokenRepository, HolderRecord } from './TokenRepository.js';

/**
 * The exact shape of packages/blockchain/src/solana/SolanaAdapter.ts's
 * existing, already-tested read methods — not a new interface designed
 * around this indexer, but the indexer designed around what already
 * exists. A real SolanaAdapter instance satisfies this structurally
 * with zero changes to that file: this indexer reuses its account-
 * parsing logic rather than duplicating it.
 *
 * DataPoint<T> matches packages/types' own definition
 * ({status:'available', value} | {status:'unavailable'}) — not
 * re-imported here to avoid this file depending on the exact
 * packages/types build path; the shape is checked structurally instead.
 */
type DataPointLike<T> = { status: 'available'; value: T } | { status: 'unavailable' };

export interface ChainTransparencyReport {
  mintAuthorityActive: DataPointLike<boolean>;
  freezeAuthorityActive: DataPointLike<boolean>;
  holderCount: DataPointLike<number>;
  top10HolderPercent: DataPointLike<number>;
}

export interface ChainHolderInfo {
  address: string;
  balance: bigint;
}

export interface ChainReader {
  getTransparencyReport(tokenAddress: string): Promise<ChainTransparencyReport>;
  getTopHolders(tokenAddress: string, limit: number): Promise<ChainHolderInfo[]>;
}

function unwrap<T>(point: DataPointLike<T>): T | null {
  return point.status === 'available' ? point.value : null;
}

/**
 * Refreshes ONE token's cached on-chain facts (TokenMetadata + Holder
 * rows) by actually reading the chain via the supplied ChainReader,
 * then persisting through the supplied TokenRepository. Never
 * fabricates a value — a DataPoint the chain reports 'unavailable'
 * stays null here too, the same "never fabricate a metric" rule this
 * whole project holds to everywhere else.
 *
 * NEVER RUN AGAINST A LIVE RPC ENDPOINT. Tested against a mock
 * ChainReader only (token-indexer.test.ts) — that proves this class
 * calls the right methods and maps their results correctly, not that
 * a real Solana RPC endpoint returns what the mock assumes. No
 * internet has existed anywhere this project was built, so live RPC
 * connectivity remains genuinely untested — stated here precisely, the
 * same as every other real-infrastructure boundary in this project.
 */
export class TokenIndexer {
  constructor(
    private readonly chain: ChainReader,
    private readonly repository: TokenRepository
  ) {}

  async refreshToken(tokenId: string, tokenAddress: string, holderLimit = 100): Promise<void> {
    const report = await this.chain.getTransparencyReport(tokenAddress);
    const chainHolders = await this.chain.getTopHolders(tokenAddress, holderLimit);

    const holders: HolderRecord[] = chainHolders.map((h) => ({
      address: h.address,
      balance: h.balance.toString(),
    }));

    await this.repository.saveIndexedData(
      tokenId,
      {
        holderCount: unwrap(report.holderCount),
        top10HolderPercent: unwrap(report.top10HolderPercent),
        mintAuthorityActive: unwrap(report.mintAuthorityActive),
        freezeAuthorityActive: unwrap(report.freezeAuthorityActive),
        lastIndexedAt: new Date().toISOString(),
      },
      holders
    );
  }
}
