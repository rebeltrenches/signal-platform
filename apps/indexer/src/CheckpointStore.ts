export interface IndexCheckpoint {
  cursor: string | null;
  updatedAt: string;
}

export interface CheckpointStore {
  load(key: string): Promise<IndexCheckpoint | null>;
  save(key: string, checkpoint: IndexCheckpoint): Promise<void>;
}

export class MemoryCheckpointStore implements CheckpointStore {
  private readonly values = new Map<string, IndexCheckpoint>();

  async load(key: string): Promise<IndexCheckpoint | null> {
    return this.values.get(key) ?? null;
  }

  async save(key: string, checkpoint: IndexCheckpoint): Promise<void> {
    this.values.set(key, checkpoint);
  }
}

export interface CheckpointPrismaLikeClient {
  indexerCheckpoint: {
    findUnique(args: any): Promise<any>;
    upsert(args: any): Promise<any>;
  };
}

/** Persistent Stage 11 checkpoint storage. The cursor is only advanced
 * after a complete page has been processed, so a crash before save()
 * safely replays that page on restart. */
export class PrismaCheckpointStore implements CheckpointStore {
  constructor(private readonly db: CheckpointPrismaLikeClient) {}

  async load(key: string): Promise<IndexCheckpoint | null> {
    const row = await this.db.indexerCheckpoint.findUnique({ where: { key } });
    if (!row) return null;
    return {
      cursor: row.cursor ?? null,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    };
  }

  async save(key: string, checkpoint: IndexCheckpoint): Promise<void> {
    await this.db.indexerCheckpoint.upsert({
      where: { key },
      create: { key, cursor: checkpoint.cursor },
      update: { cursor: checkpoint.cursor },
    });
  }
}
