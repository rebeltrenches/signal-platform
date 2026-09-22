import assert from 'node:assert/strict';
import { formatIndexerRun } from '../src/routes/indexer.js';

function run() {
  assert.deepEqual(formatIndexerRun(null), { status: 'not_run', chain: 'SOLANA' });
  const completed = formatIndexerRun({
    chain: 'SOLANA',
    lastStartedAt: new Date('2026-09-22T01:00:00Z'),
    lastCompletedAt: new Date('2026-09-22T01:01:00Z'),
    lastFailureAt: null,
    lastError: null,
    attempted: 4,
    refreshed: 7,
    failed: 0,
  });
  assert.equal(completed.status, 'ok');
  assert.equal(completed.lastCompletedAt, '2026-09-22T01:01:00.000Z');
  assert.equal(completed.attempted, 4);

  const degraded = formatIndexerRun({
    chain: 'SOLANA',
    lastStartedAt: new Date('2026-09-22T02:00:00Z'),
    lastCompletedAt: new Date('2026-09-22T01:01:00Z'),
    lastFailureAt: new Date('2026-09-22T02:01:00Z'),
    lastError: 'RPC unavailable',
    attempted: 2,
    refreshed: 0,
    failed: 1,
  });
  assert.equal(degraded.status, 'degraded');
  assert.equal(degraded.lastError, 'RPC unavailable');

  console.log('  ok  - represents never-run indexer tasks honestly');
  console.log('  ok  - formats completed and degraded task state');
  console.log('\n2 test(s) passed.');
}

run();
