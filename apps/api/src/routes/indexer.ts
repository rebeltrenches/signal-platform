import { getSharedPrismaClient } from '../db/prismaClient.js';

export function formatIndexerRun(value: any) {
  return value ? {
    status: value.lastFailureAt && (!value.lastCompletedAt || value.lastFailureAt > value.lastCompletedAt) ? 'degraded' : 'ok',
    chain: value.chain,
    lastStartedAt: value.lastStartedAt?.toISOString?.() ?? value.lastStartedAt ?? null,
    lastCompletedAt: value.lastCompletedAt?.toISOString?.() ?? value.lastCompletedAt ?? null,
    lastFailureAt: value.lastFailureAt?.toISOString?.() ?? value.lastFailureAt ?? null,
    lastError: value.lastError ?? null,
    attempted: value.attempted,
    refreshed: value.refreshed,
    failed: value.failed,
  } : { status: 'not_run', chain: 'SOLANA' };
}

export async function getIndexerStatus() {
  try {
    const db = await getSharedPrismaClient();
    const row = await db.indexerRunState.findUnique({ where: { key: 'solana-token-refresh' } });
    const fundingRow = await db.indexerRunState.findUnique({ where: { key: 'solana-funding-relationships' } });
    const tokenRefresh = formatIndexerRun(row);
    const fundingRelationships = formatIndexerRun(fundingRow);
    return {
      status: 200,
      body: {
        ...tokenRefresh,
        tokenRefresh,
        fundingRelationships,
      },
    };
  } catch (error) {
    return {
      status: 503,
      body: { status: 'unavailable', message: error instanceof Error ? error.message : String(error) },
    };
  }
}
