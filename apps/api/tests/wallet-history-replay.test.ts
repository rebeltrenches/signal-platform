import assert from 'node:assert/strict';
import { buildWalletHistoryReplay } from '../src/wallets/WalletHistoryReplay.js';

function run() {
  const replay = buildWalletHistoryReplay({
    root: 'Root',
    chain: 'SOLANA',
    maxDepth: 3,
    nodes: [
      { address: 'Root', depth: 0, role: 'ROOT' },
      { address: 'Parent', depth: 1, role: 'FUNDING_SOURCE' },
      { address: 'Grandparent', depth: 2, role: 'FUNDING_SOURCE' },
    ],
    edges: [
      { from: 'Grandparent', to: 'Parent', depth: 2, relationshipType: 'funded', evidenceSource: 'BLOCKCHAIN_DERIVED', observedTxSignature: 'sig-2' },
      { from: 'Parent', to: 'Root', depth: 1, relationshipType: 'funded', evidenceSource: 'BLOCKCHAIN_DERIVED', observedTxSignature: 'sig-1' },
      { from: 'Claimed', to: 'Root', depth: 1, relationshipType: 'funded', evidenceSource: 'SIGNAL_VERIFIED', observedTxSignature: 'claim-only' },
    ],
    summary: { fundingSourceCount: 2, transactionEvidenceCount: 2, deepestObservedDepth: 2 },
    truncated: false,
    evidencePolicy: { ownershipInference: false, note: 'test' },
  });

  assert.equal(replay.root, 'Root');
  assert.equal(replay.chain, 'SOLANA');
  assert.equal(replay.events.length, 2);
  assert.equal(replay.ordering, 'TRACE_SEQUENCE');
  assert.deepEqual(replay.events.map((event) => event.depth), [1, 2]);
  assert.deepEqual(replay.events.map((event) => event.sequence), [1, 2]);
  assert.equal(replay.events[0]!.observedTxSignature, 'sig-1');
  assert.equal(replay.events[1]!.observedTxSignature, 'sig-2');
  assert.ok(replay.events.every((event) => event.evidenceSource === 'BLOCKCHAIN_DERIVED'));
  assert.ok(replay.events.every((event) => event.observedTxSignature !== 'claim-only'));
  assert.equal(replay.evidencePolicy.ownershipInference, false);
  assert.match(replay.evidencePolicy.note, /not transaction time/i);
  assert.equal(replay.truncated, false);

  const empty = buildWalletHistoryReplay({
    root: 'Solo',
    chain: 'SOLANA',
    maxDepth: 3,
    nodes: [{ address: 'Solo', depth: 0, role: 'ROOT' }],
    edges: [],
    summary: { fundingSourceCount: 0, transactionEvidenceCount: 0, deepestObservedDepth: 0 },
    truncated: true,
    evidencePolicy: { ownershipInference: false, note: 'test' },
  });
  assert.deepEqual(empty.events, []);
  assert.equal(empty.truncated, true);
  assert.equal(empty.ordering, 'TRACE_SEQUENCE');

  const chronological = buildWalletHistoryReplay({
    root: 'Root', chain: 'SOLANA', maxDepth: 3,
    nodes: [
      { address: 'Root', depth: 0, role: 'ROOT' },
      { address: 'Parent', depth: 1, role: 'FUNDING_SOURCE' },
      { address: 'Grandparent', depth: 2, role: 'FUNDING_SOURCE' },
    ],
    edges: [
      { from: 'Parent', to: 'Root', depth: 1, relationshipType: 'funded', evidenceSource: 'BLOCKCHAIN_DERIVED', observedTxSignature: 'later', observedAt: '2026-01-02T00:00:00.000Z' },
      { from: 'Grandparent', to: 'Parent', depth: 2, relationshipType: 'funded', evidenceSource: 'BLOCKCHAIN_DERIVED', observedTxSignature: 'earlier', observedAt: '2026-01-01T00:00:00.000Z' },
    ],
    summary: { fundingSourceCount: 2, transactionEvidenceCount: 2, deepestObservedDepth: 2 },
    truncated: false,
    evidencePolicy: { ownershipInference: false, note: 'test' },
  });
  assert.equal(chronological.ordering, 'VERIFIED_BLOCK_TIME');
  assert.deepEqual(chronological.events.map((event) => event.observedTxSignature), ['earlier', 'later']);
  assert.match(chronological.evidencePolicy.note, /verified on-chain block time/i);

  console.log('  ok  - preserves blockchain-derived transaction evidence');
  console.log('  ok  - orders replay by trace depth without claiming chronology');
  console.log('  ok  - keeps ownership inference disabled');
  console.log('  ok  - handles empty and truncated traces');
  console.log('  ok  - uses chronology only when every edge has verified block time');
  console.log('\n5 test(s) passed.');
}

run();
