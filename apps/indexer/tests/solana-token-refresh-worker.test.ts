import assert from 'node:assert/strict';
import { MemoryTokenRepository } from '../../api/src/tokens/MemoryTokenRepository.js';
import { MemoryCheckpointStore } from '../src/CheckpointStore.js';
import { SolanaTokenRefreshWorker } from '../src/SolanaTokenRefreshWorker.js';

async function main() {
  const repo = new MemoryTokenRepository();
  await repo.registerToken({ chain: 'SOLANA', address: 'MintA', name: 'A', symbol: 'A', decimals: 6, creatorWalletAddress: 'CreatorA' });
  await repo.registerToken({ chain: 'SOLANA', address: 'MintB', name: 'B', symbol: 'B', decimals: 6, creatorWalletAddress: 'CreatorB' });

  const reads: string[] = [];
  const chain = {
    async getTransparencyReport(address: string) {
      reads.push(address);
      return {
        mintAuthorityActive: { status: 'available' as const, value: false },
        freezeAuthorityActive: { status: 'available' as const, value: false },
        holderCount: { status: 'available' as const, value: 1 },
        top10HolderPercent: { status: 'available' as const, value: 100 },
      };
    },
    async getTopHolders(address: string) {
      return [{ address: 'Holder-' + address, balance: 42n }];
    },
  };

  const checkpoints = new MemoryCheckpointStore();
  const worker = new SolanaTokenRefreshWorker(chain, repo, checkpoints, { pageSize: 1, holderLimit: 10 });

  const first = await worker.runPage();
  assert.equal(first.attempted, 1);
  assert.equal(first.refreshed, 1);
  assert.ok(first.nextCursor);

  const second = await worker.runPage();
  assert.equal(second.attempted, 1);
  assert.equal(second.refreshed, 1);
  assert.equal(second.nextCursor, null);
  assert.equal(reads.length, 2);

  const token = await repo.getTokenByAddress('SOLANA', reads[0]!);
  assert.ok(token);
  const metadata = await repo.getTokenMetadata(token.id);
  assert.equal(metadata?.holderCount, 1);
  assert.equal(metadata?.top10HolderPercent, 100);

  console.log('solana-token-refresh-worker: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
