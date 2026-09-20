import { SolanaAdapter } from '../../../packages/blockchain/src/solana/SolanaAdapter.js';
import { PrismaTokenRepository } from '../../api/src/tokens/PrismaTokenRepository.js';
import { getSharedPrismaClient } from '../../api/src/db/prismaClient.js';
import { PrismaCheckpointStore } from './CheckpointStore.js';
import { SolanaTokenRefreshWorker } from './SolanaTokenRefreshWorker.js';

const rpcUrl = process.env.SOLANA_RPC_URL;
if (!rpcUrl) throw new Error('SOLANA_RPC_URL is required.');

const intervalMs = Number(process.env.INDEXER_INTERVAL_MS ?? '60000');
if (!Number.isFinite(intervalMs) || intervalMs < 1000) {
  throw new Error('INDEXER_INTERVAL_MS must be a number >= 1000.');
}

const prisma = await getSharedPrismaClient();
const repository = new PrismaTokenRepository(prisma);
const worker = new SolanaTokenRefreshWorker(
  new SolanaAdapter({ rpcUrl }),
  repository,
  new PrismaCheckpointStore(prisma),
);

async function runCycle(): Promise<void> {
  let result;
  do {
    result = await worker.runPage();
    console.log('[indexer] page complete', result);
  } while (result.nextCursor);
}

let shuttingDown = false;
process.once('SIGTERM', () => { shuttingDown = true; });
process.once('SIGINT', () => { shuttingDown = true; });

try {
  await runCycle();

  if (!process.argv.includes('--once')) {
    // Await each cycle before sleeping so a slow RPC/database cycle can
    // never overlap the next one.
    while (!shuttingDown) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      if (shuttingDown) break;
      try {
        await runCycle();
      } catch (error) {
        console.error('[indexer] cycle failed', error);
      }
    }
  }
} finally {
  if (typeof prisma.$disconnect === 'function') {
    await prisma.$disconnect();
  }
}
