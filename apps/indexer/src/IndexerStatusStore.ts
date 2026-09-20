export interface IndexerRunSnapshot {
  attempted: number;
  refreshed: number;
  failed: number;
}

export interface IndexerStatusPrismaLikeClient {
  indexerRunState: {
    upsert(args: any): Promise<any>;
  };
}

export class PrismaIndexerStatusStore {
  constructor(private readonly db: IndexerStatusPrismaLikeClient) {}

  async markStarted(key: string): Promise<void> {
    const now = new Date();
    await this.db.indexerRunState.upsert({
      where: { key },
      create: { key, chain: 'SOLANA', lastStartedAt: now },
      update: { lastStartedAt: now },
    });
  }

  async markCompleted(key: string, totals: IndexerRunSnapshot): Promise<void> {
    const now = new Date();
    await this.db.indexerRunState.upsert({
      where: { key },
      create: { key, chain: 'SOLANA', lastStartedAt: now, lastCompletedAt: now, ...totals },
      update: { lastCompletedAt: now, lastError: null, ...totals },
    });
  }

  async markFailed(key: string, error: unknown, totals: IndexerRunSnapshot): Promise<void> {
    const now = new Date();
    const message = error instanceof Error ? error.message : String(error);
    await this.db.indexerRunState.upsert({
      where: { key },
      create: { key, chain: 'SOLANA', lastStartedAt: now, lastFailureAt: now, lastError: message.slice(0, 2000), ...totals },
      update: { lastFailureAt: now, lastError: message.slice(0, 2000), ...totals },
    });
  }
}
