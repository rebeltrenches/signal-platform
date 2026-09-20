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
