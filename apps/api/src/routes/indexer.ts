import { getSharedPrismaClient } from '../db/prismaClient.js';

export async function getIndexerStatus() {
  try {
    const db = await getSharedPrismaClient();
    const row = await db.indexerRunState.findUnique({ where: { key: 'solana-token-refresh' } });
    if (!row) {
      return { status: 200, body: { status: 'not_run', chain: 'SOLANA' } };
    }
    return {
      status: 200,
      body: {
        status: row.lastFailureAt && (!row.lastCompletedAt || row.lastFailureAt > row.lastCompletedAt) ? 'degraded' : 'ok',
        chain: row.chain,
        lastStartedAt: row.lastStartedAt?.toISOString?.() ?? row.lastStartedAt ?? null,
        lastCompletedAt: row.lastCompletedAt?.toISOString?.() ?? row.lastCompletedAt ?? null,
        lastFailureAt: row.lastFailureAt?.toISOString?.() ?? row.lastFailureAt ?? null,
        lastError: row.lastError ?? null,
        attempted: row.attempted,
        refreshed: row.refreshed,
        failed: row.failed,
      },
    };
  } catch (error) {
    return {
      status: 503,
      body: { status: 'unavailable', message: error instanceof Error ? error.message : String(error) },
    };
  }
}
