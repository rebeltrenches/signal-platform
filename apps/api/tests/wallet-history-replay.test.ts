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

  console.log('  ok  - preserves blockchain-derived transaction evidence');
  console.log('  ok  - orders replay by trace depth without claiming chronology');
  console.log('  ok  - keeps ownership inference disabled');
  console.log('  ok  - handles empty and truncated traces');
  console.log('\n4 test(s) passed.');
}

run();
