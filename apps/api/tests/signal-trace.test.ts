import assert from 'node:assert/strict';
import { buildSignalTrace } from '../src/wallets/SignalTrace.js';
import type { FundingAncestryResult } from '../src/wallets/FundingAncestry.js';

function run() {
  const ancestry: FundingAncestryResult = {
    root: 'Root',
    maxDepth: 3,
    nodes: [
      { address: 'Root', depth: 0 },
      { address: 'ParentA', depth: 1 },
      { address: 'ParentB', depth: 1 },
      { address: 'Grandparent', depth: 2 },
    ],
    edges: [
      { from: 'ParentA', to: 'Root', depth: 1, evidenceSource: 'BLOCKCHAIN_DERIVED', observedTxSignature: 'sig-1' },
      { from: 'ParentB', to: 'Root', depth: 1, evidenceSource: 'BLOCKCHAIN_DERIVED', observedTxSignature: 'sig-2' },
      { from: 'Grandparent', to: 'ParentA', depth: 2, evidenceSource: 'BLOCKCHAIN_DERIVED', observedTxSignature: 'sig-3' },
      { from: 'Grandparent', to: 'ParentB', depth: 2, evidenceSource: 'BLOCKCHAIN_DERIVED', observedTxSignature: 'sig-3' },
    ],
    truncated: false,
  };

  const trace = buildSignalTrace('SOLANA', ancestry);

  assert.equal(trace.root, 'Root');
  assert.equal(trace.chain, 'SOLANA');
  assert.equal(trace.maxDepth, 3);
  assert.equal(trace.truncated, false);
  assert.deepEqual(trace.summary, {
    fundingSourceCount: 3,
    transactionEvidenceCount: 3,
    deepestObservedDepth: 2,
  });

  assert.deepEqual(trace.nodes.find((node) => node.address === 'Root'), {
    address: 'Root',
    depth: 0,
    role: 'ROOT',
  });
  assert.ok(trace.nodes.filter((node) => node.address !== 'Root').every((node) => node.role === 'FUNDING_SOURCE'));
  assert.ok(trace.edges.every((edge) =>
    edge.relationshipType === 'funded' &&
    edge.evidenceSource === 'BLOCKCHAIN_DERIVED' &&
    Boolean(edge.observedTxSignature)
  ));
  assert.equal(trace.evidencePolicy.ownershipInference, false);
  assert.match(trace.evidencePolicy.note, /does not claim common ownership or identity/i);

  const empty: FundingAncestryResult = {
    root: 'Solo',
    maxDepth: 3,
    nodes: [{ address: 'Solo', depth: 0 }],
    edges: [],
    truncated: false,
  };
  const emptyTrace = buildSignalTrace('SOLANA', empty);
  assert.deepEqual(emptyTrace.summary, {
    fundingSourceCount: 0,
    transactionEvidenceCount: 0,
    deepestObservedDepth: 0,
  });

  console.log('  ok  - builds graph nodes and funding edges');
  console.log('  ok  - summarizes unique transaction evidence');
  console.log('  ok  - preserves neutral evidence policy');
  console.log('  ok  - handles a root with no observed funding ancestry');
  console.log('\n4 test(s) passed.');
}

run();
