import { TokenIndexer, type ChainReader } from '../../api/src/tokens/TokenIndexer.js';
import type { TokenRepository } from '../../api/src/tokens/TokenRepository.js';
import type { CheckpointStore } from './CheckpointStore.js';

export interface RefreshWorkerOptions {
  pageSize?: number;
  holderLimit?: number;
  fundingScanner?: {
    scanWallet(address: string): Promise<{ scanned: number; discovered: number; skipped: number }>;
  };
}

export interface RefreshRunResult {
  attempted: number;
  refreshed: number;
  failed: number;
  fundingWalletsScanned: number;
  fundingRelationshipsDiscovered: number;
  fundingScanFailed: number;
  nextCursor: string | null;
}

export class SolanaTokenRefreshWorker {
  private readonly indexer: TokenIndexer;
  private readonly pageSize: number;
  private readonly holderLimit: number;
  private readonly fundingScanner: RefreshWorkerOptions['fundingScanner'];

  constructor(
    chain: ChainReader,
    private readonly repository: TokenRepository,
    private readonly checkpoints: CheckpointStore,
    options: RefreshWorkerOptions = {},
  ) {
    this.indexer = new TokenIndexer(chain, repository);
    this.pageSize = options.pageSize ?? 25;
    this.holderLimit = options.holderLimit ?? 100;
    this.fundingScanner = options.fundingScanner;
  }

  async runPage(checkpointKey = 'solana-token-refresh'): Promise<RefreshRunResult> {
    const checkpoint = await this.checkpoints.load(checkpointKey);
    const page = await this.repository.listRecentTokens(this.pageSize, checkpoint?.cursor ?? null);

    let attempted = 0;
    let refreshed = 0;
    let failed = 0;
    let fundingWalletsScanned = 0;
    let fundingRelationshipsDiscovered = 0;
    let fundingScanFailed = 0;
    const scannedCreators = new Set<string>();

    for (const token of page.tokens) {
      if (token.chain.toUpperCase() !== 'SOLANA') continue;
      attempted += 1;
      try {
        await this.indexer.refreshToken(token.id, token.address, this.holderLimit);
        refreshed += 1;
      } catch (error) {
        failed += 1;
        console.error('[indexer] refresh failed', token.address, error);
      }

      if (this.fundingScanner && !scannedCreators.has(token.creatorWalletAddress)) {
        scannedCreators.add(token.creatorWalletAddress);
        try {
          const funding = await this.fundingScanner.scanWallet(token.creatorWalletAddress);
          fundingWalletsScanned += 1;
          fundingRelationshipsDiscovered += funding.discovered;
        } catch (error) {
          fundingScanFailed += 1;
          console.error('[indexer] funding relationship scan failed', token.creatorWalletAddress, error);
        }
      }
    }

    // Save only after the page has been processed. A crash before this
    // write replays the page; saveIndexedData is replace/upsert based, so
    // replay is safe and preferable to silently skipping data.
    await this.checkpoints.save(checkpointKey, {
      cursor: page.nextCursor,
      updatedAt: new Date().toISOString(),
    });

    return {
      attempted,
      refreshed,
      failed,
      fundingWalletsScanned,
      fundingRelationshipsDiscovered,
      fundingScanFailed,
      nextCursor: page.nextCursor,
    };
  }
}
