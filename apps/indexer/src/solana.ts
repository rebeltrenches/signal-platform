import { SolanaAdapter } from '../../../packages/blockchain/src/solana/SolanaAdapter.js';
import { PrismaTokenRepository } from '../../api/src/tokens/PrismaTokenRepository.js';
import { getSharedPrismaClient } from '../../api/src/db/prismaClient.js';
import { PrismaCheckpointStore } from './CheckpointStore.js';
import { SolanaTokenRefreshWorker } from './SolanaTokenRefreshWorker.js';
import { PrismaIndexerStatusStore } from './IndexerStatusStore.js';
import { Connection } from '@solana/web3.js';
import { SolanaFundingRelationshipWorker } from './SolanaFundingRelationshipWorker.js';

async function main(): Promise<void> {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) throw new Error('SOLANA_RPC_URL is required.');

  const intervalMs = Number(process.env.INDEXER_INTERVAL_MS ?? '60000');
  if (!Number.isFinite(intervalMs) || intervalMs < 1000) {
    throw new Error('INDEXER_INTERVAL_MS must be a number >= 1000.');
  }

  const prisma = await getSharedPrismaClient();
  const repository = new PrismaTokenRepository(prisma);
  const fundingWorker = new SolanaFundingRelationshipWorker(new Connection(rpcUrl, 'confirmed'), prisma);
  const worker = new SolanaTokenRefreshWorker(
    new SolanaAdapter({ rpcUrl }),
    repository,
    new PrismaCheckpointStore(prisma),
    { fundingScanner: { scanWallet: (address) => fundingWorker.scanFundingAncestry(address, 3, 50) } },
  );
  const status = new PrismaIndexerStatusStore(prisma);
  const statusKey = 'solana-token-refresh';
  const fundingStatusKey = 'solana-funding-relationships';

  async function runCycle(): Promise<void> {
    const totals = { attempted: 0, refreshed: 0, failed: 0 };
    const fundingTotals = { attempted: 0, refreshed: 0, failed: 0 };
    await status.markStarted(statusKey);
    await status.markStarted(fundingStatusKey);
    try {
      let result;
      do {
        result = await worker.runPage();
        totals.attempted += result.attempted;
        totals.refreshed += result.refreshed;
        totals.failed += result.failed;
        fundingTotals.attempted += result.fundingWalletsScanned;
        fundingTotals.refreshed += result.fundingRelationshipsDiscovered;
        fundingTotals.failed += result.fundingScanFailed;
        console.log('[indexer] page complete', result);
      } while (result.nextCursor);
      await status.markCompleted(statusKey, totals);
      await status.markCompleted(fundingStatusKey, fundingTotals);
    } catch (error) {
      await status.markFailed(statusKey, error, totals);
      await status.markFailed(fundingStatusKey, error, fundingTotals);
      throw error;
    }
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
}

main().catch((error) => {
  console.error('[indexer] fatal', error);
  process.exitCode = 1;
});
