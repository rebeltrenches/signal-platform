import assert from 'node:assert/strict';
import { MemoryTokenRepository } from '../../api/src/tokens/MemoryTokenRepository.js';
import { MemoryCheckpointStore } from '../src/CheckpointStore.js';
import { SolanaTokenRefreshWorker } from '../src/SolanaTokenRefreshWorker.js';

function report(holderCount = 1) {
  return {
    mintAuthorityActive: { status: 'available' as const, value: false },
    freezeAuthorityActive: { status: 'available' as const, value: false },
    holderCount: { status: 'available' as const, value: holderCount },
    top10HolderPercent: { status: 'available' as const, value: 100 },
  };
}

async function failureIsolation() {
  const repo = new MemoryTokenRepository();
  await repo.registerToken({ chain: 'SOLANA', address: 'FailMint', name: 'Fail', symbol: 'F', decimals: 6, creatorWalletAddress: 'CreatorF' });
  await new Promise((resolve) => setTimeout(resolve, 2));
  await repo.registerToken({ chain: 'SOLANA', address: 'GoodMint', name: 'Good', symbol: 'G', decimals: 6, creatorWalletAddress: 'CreatorG' });

  const chain = {
    async getTransparencyReport(address: string) {
      if (address === 'FailMint') throw new Error('simulated RPC failure');
      return report();
    },
    async getTopHolders(address: string) {
      return [{ address: 'Holder-' + address, balance: 42n }];
    },
  };

  const worker = new SolanaTokenRefreshWorker(chain, repo, new MemoryCheckpointStore(), { pageSize: 10 });
  const result = await worker.runPage();
  assert.equal(result.attempted, 2);
  assert.equal(result.refreshed, 1);
  assert.equal(result.failed, 1);

  const good = await repo.getTokenByAddress('SOLANA', 'GoodMint');
  const failed = await repo.getTokenByAddress('SOLANA', 'FailMint');
  assert.ok(good && failed);
  assert.equal((await repo.getTokenMetadata(good.id))?.holderCount, 1);
  assert.equal(await repo.getTokenMetadata(failed.id), null);
}

async function replayIsIdempotent() {
  const repo = new MemoryTokenRepository();
  const token = await repo.registerToken({ chain: 'SOLANA', address: 'ReplayMint', name: 'Replay', symbol: 'R', decimals: 6, creatorWalletAddress: 'CreatorR' });
  let reads = 0;
  const chain = {
    async getTransparencyReport() { reads += 1; return report(2); },
    async getTopHolders() { return [{ address: 'HolderReplay', balance: 99n }]; },
  };

  // Two fresh checkpoint stores simulate replay after a crash before a
  // durable checkpoint was committed.
  await new SolanaTokenRefreshWorker(chain, repo, new MemoryCheckpointStore(), { pageSize: 10 }).runPage();
  await new SolanaTokenRefreshWorker(chain, repo, new MemoryCheckpointStore(), { pageSize: 10 }).runPage();

  assert.equal(reads, 2);
  const metadata = await repo.getTokenMetadata(token.id);
  assert.equal(metadata?.holderCount, 2);
}

await failureIsolation();
await replayIsIdempotent();
console.log('indexer-safety: ok');
